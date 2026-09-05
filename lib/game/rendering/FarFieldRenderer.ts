import * as THREE from "three";
import type { DecodedFarField } from "../terrain/far-field-format";
import { GRID_HALF, GRID_SIZE, TILE_SIZE, Z_TILES_BEHIND } from "./nearFieldReach";
import type { NodeFactories } from "./nodeFactories";

/**
 * Draws the baked far field (`scripts/bake-far-field.ts`, PCFF) — the real mountain from the edge
 * of the streamed near-field tiles out to 30 km, as 16 angular wedges that are culled whole.
 *
 * ## What this replaces
 *
 * Two procedural ridge bands at 1750 m and 2900 m (`SceneFactory.makeRidge`) that followed the
 * camera and were painted with `fog: false`. Those remain as the **fallback** for a resort with no
 * baked asset, or a load that failed — see `opts.fallback`. This renderer hides them on attach and
 * restores them on dispose, so a missing asset degrades to the old horizon instead of an empty sky,
 * and no recovery path has to run.
 *
 * ## Fog, and why the material is so plain
 *
 * The seam between near and far field reads as a colour step unless both take the *same*
 * atmosphere. That treatment is applied from outside, per backend, and this class's only job is to
 * stay eligible for it:
 *
 *  - **WebGL** — `Renderer.configureSceneMaterials` calls `addHeightFog` on every material with
 *    `fog !== false` that is not a `ShaderMaterial` and is not opted out via
 *    `userData.heightFog === false`. The material below is a `MeshStandardMaterial` with all three
 *    left alone. Because the asset arrives asynchronously, long after the constructor ran that
 *    sweep, `opts.configureMaterial` lets the caller re-run it for this one material.
 *  - **WebGPU** — `scene.fogNode` fogs every material with `fog !== false`. Nothing to do but not
 *    opt out.
 *
 * The height fog measures altitude from a *player-relative* reference (`referenceHeight` is set to
 * `state.pos.y` each frame; absolute-Y fog saturates at these altitudes). At the seam the far field
 * is at roughly the player's own altitude, so both sides land on the same fog value — which is the
 * property that makes the seam invisible. Note the corollary: terrain far *above* the player, such
 * as Aconcagua at +4 km over Portillo, gets almost no fog and renders crisp.
 *
 * ## Shadows
 *
 * None, by design. The cascade's `maxFar` is 250 m (`CsmShadows`) and this geometry runs from the
 * resort centre to 30 km; `castShadow`/`receiveShadow` are false, which also keeps the material out of
 * `configureSceneMaterials`' cascade setup. Do not extend the cascades to reach it.
 *
 * ## Per-frame cost
 *
 * `update()` sets 16 booleans. It allocates nothing, touches no geometry, and reuses the `Box3`
 * bounds and the visibility scratch built in the constructor (Task 8 regime).
 */

/**
 * Inner radius of the baked mesh, metres. Zero: the far field runs from the resort centre. It
 * once reserved a hole for the streamed near-field tiles, but those follow the *player* while a
 * baked asset is anchored to the *resort*, so the hole was uncovered as soon as the player moved.
 * Mirrors `innerRadiusFor` in the baker.
 */
export const FAR_FIELD_INNER_RADIUS_M = 0;

/** Outer radius of the baked mesh, metres — must match the baker and the asset header. */
export const FAR_FIELD_RADIUS_M = 30_000;

/** Scene-graph name, so tests and debugging can find the far field without reaching into Renderer. */
export const FAR_FIELD_GROUP_NAME = "far-field";

/**
 * Far-field albedo.
 *
 * Was `#dfe9f5`, whose luminance (231.7) sat **1.4 out of 255** from Portillo's sky horizon
 * (`#d8ecff`, 233.1) — a 0.6% difference. Aconcagua receives literally zero fog (the height term
 * removes it entirely at that altitude), and was still invisible, because the mesh was painted
 * almost exactly the colour of the sky behind it. Fixing the fog curve alone would not have
 * revealed it.
 *
 * `#adc2d8` gives ~30 luminance units of separation after the long-range fog blend. Deliberately
 * still light and blue — real distant ranges are lighter and bluer than near terrain, and
 * over-darkening reads as a cut-out silhouette, which is the opposite failure.
 */
const FAR_FIELD_COLOR = 0xadc2d8;

export interface FarFieldOptions {
  /**
   * Non-null exactly on WebGPU (`Renderer` passes `loadNodeFactories()`'s result there and `null`
   * on WebGL). This class imports nothing from `three/webgpu` itself — the node material comes
   * through this handle, so the WebGL bundle never pulls the node chunk.
   */
  nodes: NodeFactories | null;
  /** The procedural ridge bands, hidden while a real far field is attached. */
  fallback?: THREE.Object3D;
  /** Applies the backend's fog/shadow treatment; needed because the asset attaches late. */
  configureMaterial?: (material: THREE.Material) => void;
}

export class FarFieldRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.Material;
  /** Per-wedge world bounds, allocated once and never replaced. */
  readonly wedgeBounds: THREE.Box3[] = [];
  /** Per-wedge visibility from the last `update()`; a scratch, not a fresh array. */
  readonly visibility: Uint8Array;

  readonly nearBounds = new THREE.Vector4(0, 0, 0, 0);
  private readonly meshes: THREE.Mesh[] = [];
  private visible = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    asset: DecodedFarField,
    private readonly opts: FarFieldOptions,
  ) {
    this.material = opts.nodes
      ? opts.nodes.snow.createFarFieldNodeMaterial(new THREE.Color(FAR_FIELD_COLOR), this.nearBounds)
      : new THREE.MeshStandardMaterial({
        color: FAR_FIELD_COLOR, roughness: 1, metalness: 0, flatShading: false, dithering: true,
        // See createFarFieldNodeMaterial: the far field underlies the near-field tiles from
        // r = 0 outwards, so it is biased back to keep the finer mesh in front.
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
    opts.configureMaterial?.(this.material);
    if (!opts.nodes) {
      const material = this.material as THREE.MeshStandardMaterial;
      const previous = material.onBeforeCompile;
      const previousKey = material.customProgramCacheKey.bind(material);
      const key = previousKey();
      material.customProgramCacheKey = () => `${key}:streamed-terrain-cutout-v3`;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.uNearBounds = { value: this.nearBounds };
        shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vFarXZ;")
          .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvFarXZ=(modelMatrix*vec4(transformed,1.)).xz;");
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec4 uNearBounds; varying vec2 vFarXZ;")
          .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif(vFarXZ.x>uNearBounds.x&&vFarXZ.y>uNearBounds.y&&vFarXZ.x<uNearBounds.z&&vFarXZ.y<uNearBounds.w)discard;");
      };
    }

    this.visibility = new Uint8Array(asset.wedges.length);

    for (const wedge of asset.wedges) {
      const geometry = new THREE.BufferGeometry();
      // The decoder already hands back Float32Array/Uint32Array views, so these are adopted
      // rather than copied.
      geometry.setAttribute("position", new THREE.BufferAttribute(wedge.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(wedge.indices, 1));
      // The asset carries no normals — 3 floats per vertex is a third of the payload for something
      // derivable. Computed once here, never per frame.
      geometry.computeVertexNormals();

      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // We cull by wedge below; three's bounding-sphere test is worthless on a 15 km-radius sphere.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.meshes.push(mesh);
      this.group.add(mesh);

      const bounds = new THREE.Box3();
      bounds.setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
      this.wedgeBounds.push(bounds);
    }

    // Georeferenced: unlike the ridge bands, the far field does NOT follow the camera. The whole
    // point is that it is the real mountain, in the same world coordinates as everything else.
    this.group.position.set(0, 0, 0);
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
    this.group.name = FAR_FIELD_GROUP_NAME;
    scene.add(this.group);

    if (opts.fallback) opts.fallback.visible = false;
  }

  /** Wedges drawn after the last {@link update}. */
  get visibleWedgeCount(): number { return this.visible; }

  wedgeVisible(index: number): boolean { return this.visibility[index] === 1; }

  /**
   * Toggle wedge visibility against the camera frustum. Allocation-free: `Frustum.intersectsBox`
   * uses three's own module-level scratch, and everything else here is preallocated.
   *
   * A wedge's box spans its azimuth sector from the inner rim to 30 km, so sectors behind the
   * camera fail the test outright — which is where the ~4-of-16 draw estimate comes from.
   */
  update(cameraPosition: THREE.Vector3, frustum: THREE.Frustum, player?: { x: number; z: number }): void {
    if (player) {
      // Coarse far-field triangles can sit metres above the edited DEM. Depth
      // bias cannot fix that: remove them exactly where streamed tiles exist.
      const x = Math.floor(player.x / TILE_SIZE), z = Math.floor(player.z / TILE_SIZE);
      this.nearBounds.set((x-GRID_HALF)*TILE_SIZE+1, (z-Z_TILES_BEHIND)*TILE_SIZE+1,
        (x+GRID_HALF+1)*TILE_SIZE-1, (z-Z_TILES_BEHIND+GRID_SIZE)*TILE_SIZE-1);
    }
    void cameraPosition; // The boxes are world-space; the frustum already carries the camera.
    let visible = 0;
    for (let i = 0; i < this.meshes.length; i += 1) {
      const drawn = frustum.intersectsBox(this.wedgeBounds[i]);
      this.meshes[i].visible = drawn;
      this.visibility[i] = drawn ? 1 : 0;
      if (drawn) visible += 1;
    }
    this.visible = visible;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.scene.remove(this.group);
    this.meshes.length = 0;
    // Put the fallback horizon back, so a route change that rebuilds without an asset is not
    // left staring at empty sky.
    if (this.opts.fallback) this.opts.fallback.visible = true;
  }
}
