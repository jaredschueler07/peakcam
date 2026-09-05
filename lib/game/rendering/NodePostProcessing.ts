import * as THREE from "three";
import { NodeUpdateType, RenderPipeline } from "three/webgpu";
import type { Node, Renderer, UniformNode } from "three/webgpu";
import { colorSpaceToWorking, convertToTexture, float, mix, pass, perspectiveDepthToViewZ, renderOutput, screenUV, smoothstep, texture3D, uniform, vec2, vec4, workingToColorSpace } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { lut3D } from "three/addons/tsl/display/Lut3DNode.js";
import { godrays } from "three/addons/tsl/display/GodraysNode.js";
import type { QualityRung } from "./QualityController";
import { buildPosterLut } from "./SnowMaterial";
import { chromaticAberrationOffset } from "./MotionEffects";
import { SUN_DIRECTION } from "./SceneFactory";

const LUT_SIZE = 32;
const BLOOM_STRENGTH = 0.5;
/** `postprocessing`'s BloomEffect defaulted to 0.85; the side-by-side in Task 6 settles this. */
const BLOOM_RADIUS = 0.8;
/**
 * Luminance a fragment must exceed to bloom. Raised from 0.85 (the `postprocessing` BloomEffect
 * default the WebGL chain still uses) after the Task 6 CSM fix: with the cascades no longer
 * triple-counting the key light, the scene sits brighter overall, and spray and snowfall
 * particles — white sprites over white snow — cleared 0.85 and read as glowing orbs in the
 * browser-matrix screenshots. 0.9 keeps the bloom on the sun disc and glint, which is what it
 * was for. Empirical, not derived: revisit against screenshots if the exposure changes again.
 */
const BLOOM_THRESHOLD = 0.9;
const VIGNETTE_OFFSET = 0.35;
const VIGNETTE_DARKNESS = 0.5;
/** `postprocessing`'s ChromaticAberrationEffect radial modulation offset. */
const ABERRATION_MODULATION = 0.15;

/*
 * GTAO tuning. three's defaults (radius 0.25, distanceExponent 1, scale 1) are pitched at
 * architectural interiors — hand-width creases between walls and furniture. An open snow slope has
 * no such feature, so the defaults produce a uniformly white AO buffer and cost a full-screen pass
 * for nothing. Everything below is scaled to what actually occludes light in this scene: props,
 * rocks, the skier, and metre-scale terrain rolls.
 */
/**
 * View-space metres. Sized to the scene's real occluders — gate poles, rocks, trees, the skier's
 * body against the slope — rather than to creases. At the 0.25 default the sampling hemisphere is
 * smaller than any feature the terrain has.
 */
const AO_RADIUS = 1.5;
/**
 * The march places step `j` at `pow((j+1)/steps, exponent) * radius`. At exponent 1 with a 1.5 m
 * radius the *nearest* sample is already 0.25 m out, which steps straight over the contact shadow
 * at the base of a pole — the one place AO reads on snow. Exponent 2 pulls the first steps in to
 * ~0.04/0.17/0.38 m while the last still reaches the full radius.
 */
const AO_DISTANCE_EXPONENT = 2;
/**
 * The |Δz| cutoff in view space for accepting a sample as an occluder. Deliberately left at the
 * default, *below* the radius: on an open slope the terrain behind any silhouette is tens of metres
 * further away, and a thickness generous enough to accept it would ring every prop with a dark
 * halo. On a flat white field that halo is the most damaging artifact available.
 */
const AO_THICKNESS = 1;
/**
 * `ao = pow(ao, scale)` — the contrast knob, and the right one for a high-albedo surface because it
 * is a no-op where nothing is occluded (`pow(1, s) === 1`). It deepens the contact shadows around
 * props without touching the open snow, which is exactly the asymmetry this scene needs.
 */
const AO_SCALE = 1.5;
/** three's default: 3 slice directions × 6 steps × 2 march directions = 36 depth taps per pixel. */
const AO_SAMPLES = 16;
/**
 * Half resolution, so those 36 taps run over a quarter of the pixels. AO is a low-frequency term and
 * this is the standard trade; the cost is some bleed at prop silhouettes, which is where our AO
 * lives, so it is the first thing to check in the visual round.
 */
const AO_RESOLUTION_SCALE = 0.5;
/**
 * View-space metres over which the AO term fades out — full strength inside `AO_FADE_START_M`, gone
 * by `AO_FADE_END_M`. See the banding note at the `occlusion` term for why the far end has to be
 * switched off rather than left to fall off on its own.
 *
 * Both numbers were read off a fade sweep against real WebGPU frames, not derived: at a 160 m cutoff
 * the distant ridges came clean but the grazing-angle mid slope still hatched, at 25 m a faint hatch
 * survived, and at 12 m the frame was clean. Grazing surfaces are the binding constraint rather than
 * raw distance — the depth *gradient* per pixel is what defeats the normal reconstruction, and it
 * blows up on a slope seen edge-on long before distance alone would hurt. 10/28 sits below where the
 * artifact starts on the worst surface in any of the three resorts, and still covers what this AO is
 * for: the chase camera holds the skier at roughly 8-15 m, with the gate poles and rocks they pass
 * inside the same band.
 */
const AO_FADE_START_M = 10;
const AO_FADE_END_M = 28;

/*
 * Godrays tuning. This genre over-uses sun shafts until they read as a lens effect rather than
 * atmosphere, so every knob below pulls the other way: quiet density, a hard cap on brightness,
 * and a gate that only opens when the sun is actually near the middle of the frame.
 */
/**
 * Multiplies the raymarched shaft on top of GodraysNode's own [0, `maxDensity`] output. Kept low
 * on purpose — this is the single biggest lever on "atmosphere" vs. "lens flare", and 0.35 was
 * chosen to be visible on the sun-facing frames of the Task 3 screenshots without lifting the
 * mean luminance of a full slope-away frame at all (the gate below already zeroes it there).
 */
const GODRAYS_INTENSITY = 0.35;
/** GodraysNode default (0.7) darkens too much of the open sky between the skier and the sun on a
 *  slope with no real "humid air" to speak of; softened to keep the shaft thin. */
const GODRAYS_DENSITY = 0.45;
/** GodraysNode default (0.5) is a lens-flare-bright ceiling; halved so the brightest shaft pixel
 *  still reads as haze, not glow. */
const GODRAYS_MAX_DENSITY = 0.22;
/** Half resolution, matching AO: godrays are as low-frequency as light shafts get. */
const GODRAYS_RESOLUTION_SCALE = 0.5;
/**
 * The sun-proximity gate is expressed as the cosine of the angle between the camera's forward
 * vector and the (constant) sun direction, computed fresh each frame from `camera.fov` so it
 * tracks zoom. Full intensity inside `GODRAYS_INNER_FOV_FRACTION` of the half-FOV cone around
 * dead-centre; zero at the edge of the vertical field of view, where the sun disc itself would be
 * leaving frame. Between the two it smoothsteps, so the shaft doesn't pop as the camera pans.
 */
const GODRAYS_INNER_FOV_FRACTION = 0.4;

/** Cosine of `angleDeg`, cached per call — cheap, but named so the gate math reads as geometry. */
function cosDeg(angleDeg: number): number {
  return Math.cos(THREE.MathUtils.degToRad(angleDeg));
}

/** Plain-JS smoothstep for the CPU-side proximity gate; the shader graph has its own via TSL. */
function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Module-scope scratch for the per-frame camera-forward dot product — no per-frame allocation. */
const forwardScratch = new THREE.Vector3();

/**
 * How much the sun is "in frame" this frame: 1 when it sits within `GODRAYS_INNER_FOV_FRACTION` of
 * the half-FOV cone around dead-centre, 0 once it would be outside the vertical field of view
 * (where the shaft's own source, the sun disc, is no longer visible), smoothstepped between.
 */
function sunFrameProximity(camera: THREE.PerspectiveCamera): number {
  const halfFov = camera.fov * 0.5;
  const outer = cosDeg(halfFov);
  const inner = cosDeg(halfFov * GODRAYS_INNER_FOV_FRACTION);
  const facing = camera.getWorldDirection(forwardScratch).dot(SUN_DIRECTION);
  return smoothstep01(outer, inner, facing);
}

export interface PostChainPolicy {
  chain: boolean;
  bloom: boolean;
  aa: boolean;
  chromatic: boolean;
  ao: boolean;
  godrays: boolean;
}

/** The rung ladder from `PostProcessing.setQuality`, lifted out so it cannot drift. */
export function postChainPolicy(rung: QualityRung, reducedMotion: boolean): PostChainPolicy {
  return { chain: rung > 0, bloom: rung >= 3, aa: true, chromatic: rung > 0 && !reducedMotion, ao: rung >= 3, godrays: rung >= 4 };
}

export interface PostChainUniforms {
  chain: UniformNode<"float", number>;
  bloom: UniformNode<"float", number>;
  aa: UniformNode<"float", number>;
  ao: UniformNode<"float", number>;
  godrays: UniformNode<"float", number>;
  aberration: UniformNode<"vec2", THREE.Vector2>;
  aspect: UniformNode<"float", number>;
  /** The *scene* camera's clip planes — see the note at `sceneViewZ` for why the built-ins can't. */
  near: UniformNode<"float", number>;
  far: UniformNode<"float", number>;
}

type Vec4 = Node<"vec4">;

/**
 * The display addons (`bloom`, `lut3D`, `smaa`, `fxaa`) return their own node classes, which the
 * r185 typings do not give the vec4 swizzles. They are all vec4-valued in the generated shader.
 */
const asVec4 = (node: object): Vec4 => node as Vec4;

/**
 * Directional 3-tap RGB shift, ported from `postprocessing`'s ChromaticAberrationEffect with
 * `radialModulation` on: the shift is aspect-corrected, then faded in with distance from the
 * screen centre so the centre of frame stays clean.
 */
function aberrate(sceneColor: ReturnType<ReturnType<typeof pass>["getTextureNode"]>, uniforms: PostChainUniforms): Vec4 {
  const shift = uniforms.aberration.mul(vec2(1, uniforms.aspect));
  const radial = screenUV.sub(0.5).length().mul(2).sub(ABERRATION_MODULATION).max(0);
  const red = sceneColor.sample(mix(screenUV, screenUV.add(shift), radial));
  const blue = sceneColor.sample(mix(screenUV, screenUV.sub(shift), radial));
  const green = sceneColor.sample(screenUV);
  return vec4(red.r, green.g, blue.b, green.a);
}

/** `1 - smoothstep(offset, 1, |uv - centre| * √2) * darkness`, gated by the chain uniform. */
function vignetteFactor(uniforms: PostChainUniforms) {
  const falloff = smoothstep(VIGNETTE_OFFSET, 1, screenUV.sub(0.5).length().mul(Math.SQRT2));
  return float(1).sub(falloff.mul(VIGNETTE_DARKNESS).mul(uniforms.chain));
}

/**
 * The poster post chain on the node pipeline: chromatic aberration, bloom, the 32³ poster LUT,
 * vignette, and antialiasing. Mirrors `PostProcessing`'s surface so Task 6 swaps the import.
 *
 * The graph is built once. `setQuality` only moves uniform values, because changing the node graph
 * forces a shader recompile, which is a visible hitch mid-run.
 */
export class NodePostProcessing {
  readonly pipeline: RenderPipeline;
  readonly lut = buildPosterLut(LUT_SIZE);
  readonly uniforms: PostChainUniforms = {
    chain: uniform(1),
    bloom: uniform(1),
    aa: uniform(1),
    ao: uniform(1),
    // Zero, not one like the other rung-4 stages: this one is also gated on sun proximity, which
    // is only known once a frame has actually run, so it must not default to visible.
    godrays: uniform(0),
    aberration: uniform(new THREE.Vector2()),
    aspect: uniform(1),
    near: uniform(0),
    far: uniform(0),
  };
  readonly aoNode: ReturnType<typeof ao>;
  /** The single-channel occlusion buffer as it is wired into the chain. */
  readonly aoTexture: Vec4;
  readonly godraysNode: ReturnType<typeof godrays>;
  readonly bloomNode: ReturnType<typeof bloom>;
  /** The poster lookup. Everything reachable from here is graded; everything after it is not. */
  readonly lutNode: Vec4;
  /** The single render target the graded chain lands in — both the AA input and the blend base. */
  readonly aaInput: Vec4;
  readonly aaNode: ReturnType<typeof smaa> | ReturnType<typeof fxaa>;
  private policy = postChainPolicy(4, false);
  private readonly scenePass: ReturnType<typeof pass>;
  private ownedShadowStub: THREE.RenderTarget | null = null;
  private disposed = false;

  constructor(
    renderer: Renderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly speed: { value: number },
    private readonly reducedMotion: boolean,
    /** The CSM key light — see `CsmShadowsNode.light`, the narrow accessor this reads. */
    private readonly sunLight: THREE.DirectionalLight,
    readonly antialias: "smaa" | "fxaa" = "smaa",
  ) {
    // `renderer` is constructed with `antialias: true` (backend.ts), which without an override
    // PassNode inherits onto this offscreen render target (`renderTarget.samples = options.samples
    // ?? renderer.samples` — PassNode.js `setup()`). On real WebGPU hardware that makes the pass's
    // depth attachment a multisampled texture; GTAONode's depth sampling compiles a
    // `textureDimensions(tex, level)` call that has no WGSL overload for
    // `texture_depth_multisampled_2d` (only the no-level form is valid on a multisampled texture),
    // which fails renderPipeline_GTAO creation with a GPUValidationError on the real backend —
    // invisible under SwiftShader/unit tests, which don't enforce the overload set as strictly.
    // This chain already antialiases explicitly via SMAA/FXAA below, so hardware MSAA on the scene
    // pass was never load-bearing; disabling it here removes the failure without touching the AA
    // the user actually sees.
    this.uniforms.near.value = camera.near;
    this.uniforms.far.value = camera.far;
    const scenePass = this.scenePass = pass(scene, camera, { samples: 0 });
    const aberrated = aberrate(scenePass.getTextureNode(), this.uniforms);

    // GTAO is given depth but no normals, so it reconstructs them from depth in the shader. That is
    // a deliberate choice, not an omission: supplying normals means adding `normal: normalView` to
    // the scene pass's MRT, which is a second full-resolution RGBA16F attachment (16.6 MB and about
    // as much write bandwidth per frame at 1080p) — a real cost on exactly the mid-tier hardware
    // that sits at rung 3. Worse, snowfall and spray are `transparent` with `depthWrite = false`
    // (ParticleNodeMaterial), so they would blend into the normal attachment while contributing
    // nothing to depth: the AO would read particle normals against terrain depth, wrong precisely
    // when the weather is heaviest. Suppressing that needs a per-material MRT override on every
    // transparent material in the scene. The depth reconstruction is an 8-tap edge-aware estimate
    // that picks the smoother side of a discontinuity, which is the right safeguard around props,
    // and snow's geometry is smooth and large-scale enough to suit it.
    this.aoNode = ao(scenePass.getTextureNode("depth"), null as unknown as Node, camera);
    this.aoNode.radius.value = AO_RADIUS;
    this.aoNode.distanceExponent.value = AO_DISTANCE_EXPONENT;
    this.aoNode.thickness.value = AO_THICKNESS;
    this.aoNode.scale.value = AO_SCALE;
    this.aoNode.samples.value = AO_SAMPLES;
    this.aoNode.resolutionScale = AO_RESOLUTION_SCALE;
    // Temporal filtering needs a TRAANode to resolve against; without one it only adds per-frame
    // rotation noise. GTAONode self-sizes from the drawing buffer in updateBefore(), so setSize()
    // below has nothing to forward.
    this.aoNode.useTemporalFiltering = false;
    this.aoTexture = asVec4(this.aoNode.getTextureNode());

    // AO multiplies the light, so it is gated by lerping the *factor* towards 1 rather than by
    // scaling the term the way additive bloom is. It lands here, ahead of bloom and the LUT: the
    // threshold must see the darkened creases or occluded geometry still glows, and the poster
    // palette must grade the occlusion rather than have it laid over the grade.
    //
    // ...and only over the range where a 1.5 m hemisphere still means something. GTAO here has no
    // normal attachment, so it reconstructs normals from depth (see above) — which makes it only as
    // good as the depth buffer's *local* precision. This camera runs near 0.5 / far 34_000 to reach
    // the baked far field, and a 24-bit buffer spends almost all of that precision in the first few
    // hundred metres: out on the far ridges, neighbouring pixels quantise onto the same depth value,
    // the reconstructed normal snaps between a handful of orientations, and the AO term snaps with
    // it. That is the horizontal banding and moiré across the mid-ground and prop fields on real
    // hardware — not a texture mip problem, which is where it looks like it comes from.
    //
    // Fading the term out with distance is the fix rather than a workaround, because AO is a contact
    // shadow: past a few tens of metres a 1.5 m sampling radius projects to under a pixel and the
    // term carries no signal worth keeping even where depth is exact. So this gives up nothing
    // visible and removes the whole class of artifact at its source.
    // `cameraNear`/`cameraFar` are deliberately NOT used here. Those built-ins resolve to whatever
    // camera is rendering, and by this point in the graph that is the post chain's own internal
    // full-screen quad camera — not the scene's perspective camera. Reading them yields a depth
    // conversion off by orders of magnitude, which silently pins the gate open at every distance.
    // GTAONode sidesteps the same trap with its own `_cameraNear`/`_cameraFar` uniforms.
    const sceneViewZ = perspectiveDepthToViewZ(
      scenePass.getTextureNode("depth").sample(screenUV).r,
      this.uniforms.near,
      this.uniforms.far,
    );
    const aoReach = float(1).sub(smoothstep(float(AO_FADE_START_M), float(AO_FADE_END_M), sceneViewZ.negate()));
    const occlusion = mix(float(1), this.aoTexture.r, this.uniforms.ao.mul(aoReach));
    const occluded = vec4(aberrated.rgb.mul(occlusion), aberrated.a);

    // Additive, not a lerp like AO: a shaft is light being added into the frame, not light being
    // removed from it. It lands after occlusion (a shaft is unaffected by contact shadows on the
    // snow) but before the bloom threshold, so a bright shaft can still bloom the way the sun disc
    // does — the whole point of keeping it "atmosphere" is that it behaves like the rest of the
    // light in the scene rather than a screen-space decal on top of it. GodraysNode itself is fed
    // no normals for the same MRT-cost reason as GTAO above, and needs no depth-space reasoning of
    // its own: the raymarch only ever samples the *light's* shadow map, not scene normals.
    // GodraysNode's directional-light branch unconditionally reads `light.shadow.map.depthTexture`
    // to test whether a raymarch sample is occluded (GodraysNode.js's `inShadow`). `sunLight` is
    // `CsmShadowsNode`'s light, whose shadow is driven entirely by `light.shadow.shadowNode`
    // (`CSMShadowNode`): `AnalyticLightNode.setupShadow()` takes the `customShadowNode` branch
    // whenever that field is set and never runs the code that assigns `light.shadow.map` — so under
    // CSM, `.map` stays `null` forever, by construction, not by ordering. GodraysNode was never
    // written with CSM in mind ("the main light must cast shadows" in its own docs assumes a plain
    // single shadow map). SwiftShader and the unit suite never build a real WGSL pipeline, so
    // nothing caught this before the real-hardware gate: on actual WebGPU, `godraysNode.setup()`
    // throws building the shader the instant it dereferences `null.depthTexture`, which crashes
    // every frame's pipeline compile. A dedicated single-map shadow light for godrays' own occlusion
    // test is a real fix but out of scope for this round; this stub only keeps the property access
    // valid so the shader compiles. Cost: godrays are not geometry-occluded (a shaft can pass
    // through shadowed terrain) until that's built — a visible-but-minor gap on an already-subtle,
    // rung-4-only, near-sun-gated effect, versus the total real-hardware crash it replaces.
    //
    // The depth texture alone isn't enough: `inShadow`'s `texture(...).compare(...)` compiles to a
    // WGSL `textureSampleCompare`, which needs a *comparison* sampler bound alongside the texture.
    // The WebGPU backend only creates that binding when `depthTexture.compareFunction` is set — real
    // shadow maps get it from `ShadowNode.js`'s own setup (`depthTexture.compareFunction =
    // reversedDepthBuffer ? GreaterEqualCompare : LessEqualCompare`), which this stub bypasses
    // entirely, so it must set the same thing itself or the shader compiles but references a sampler
    // the backend never bound ("unresolved value ..._sampler").
    if (sunLight.shadow.map === null) {
      const stubShadowMap = new THREE.RenderTarget(1, 1, { depthBuffer: true });
      const stubDepthTexture = new THREE.DepthTexture(1, 1);
      stubDepthTexture.compareFunction = renderer.reversedDepthBuffer ? THREE.GreaterEqualCompare : THREE.LessEqualCompare;
      stubShadowMap.depthTexture = stubDepthTexture;
      sunLight.shadow.map = this.ownedShadowStub = stubShadowMap;
    }
    this.godraysNode = godrays(scenePass.getTextureNode("depth"), camera, sunLight);
    this.godraysNode.density.value = GODRAYS_DENSITY;
    this.godraysNode.maxDensity.value = GODRAYS_MAX_DENSITY;
    this.godraysNode.resolutionScale = GODRAYS_RESOLUTION_SCALE;
    const shaftTexture = asVec4(this.godraysNode.getTextureNode());
    const shafted = vec4(occluded.rgb.add(shaftTexture.r.mul(GODRAYS_INTENSITY).mul(this.uniforms.godrays)), occluded.a);

    // Tone map HERE, not at the tail of the chain — but tone map ONLY, staying in linear.
    //
    // Everything below this line is calibrated for low dynamic range: BLOOM_THRESHOLD is a
    // luminance cut-off, and the poster LUT is a 32³ cube whose domain is [0, 1]. The WebGL chain
    // gets that for free — `postprocessing`'s RenderPass hands its EffectPass an already
    // tone-mapped buffer, so BloomEffect's 0.85 and LUT3DEffect both see LDR. This chain used to
    // defer `renderOutput()` to the very end, which fed both stages raw HDR radiance, and both
    // mis-fired in the same direction:
    //
    //   - Bloom: on a bright snow field, essentially every pixel cleared a 0.9 threshold measured
    //     against HDR linear, so the bloom buffer was bright *everywhere*. A screen blend lifts
    //     darks hardest, so the dark trees and ridge shadows were dragged up to the level of the
    //     snow. At heavenly's start view that collapsed the sampled luminance into [186, 228] —
    //     stdev 4.8 against WebGL's 26.3 — a whiteout with the mean still on budget.
    //   - LUT: HDR values ran off the top of the cube and clamped, capping every highlight at 228
    //     where WebGL reaches 250+, flattening the frame's whole top end.
    //
    // Tone mapping first restores parity with WebGL by construction rather than by re-tuning two
    // constants against the artifact, and it is why BLOOM_THRESHOLD can stay at the value its own
    // comment always described. `pipeline.outputColorTransform` stays false: the transform is still
    // applied exactly once, just earlier.
    //
    // Tone mapping and the output-colour-space encode are split apart deliberately. WebGL's working
    // buffer is tone-mapped *linear* — three applies tone mapping in the material shader on the way
    // into RenderPass's linear render target — and `postprocessing` grades in that space, with
    // LUT3DEffect doing its own sRGB round trip around itself and VignetteEffect multiplying in
    // linear. Encoding to sRGB here as well would put bloom, the LUT and the vignette in a space
    // none of them was authored for; the frame came back structurally right but grey, with the
    // vignette biting far too hard. So: tone map now, keep linear, and encode at the very end.
    const toned = asVec4(renderOutput(shafted, renderer.toneMapping, THREE.LinearSRGBColorSpace));

    this.bloomNode = bloom(toned, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    // `postprocessing` screen-blended the bloom (BlendFunction.SCREEN), not additive. Written as
    // `a + b·(1 − saturate(a))`, which is the same identity for `a` in [0, 1]. With tone mapping
    // now upstream that is the only range this ever sees, so the saturate is belt-and-braces —
    // kept because it costs nothing and the alternative failure (negative colour, i.e. the black
    // sky this chain shipped with) is silent and total.
    const lit = asVec4(this.bloomNode).mul(this.uniforms.bloom);
    const bloomed = vec4(toned.rgb.add(lit.rgb.mul(toned.rgb.clamp(0, 1).oneMinus())), toned.a);

    // `postprocessing`'s LUT3DEffect declares `inputColorSpace = SRGBColorSpace`, so the effect
    // framework encoded the linear working buffer to sRGB around it. The chain is linear again by
    // this point, so the same round trip still applies — the difference from before is only that
    // the values going in are now tone-mapped, so they land inside the cube's [0, 1] domain instead
    // of running off the top of it and clamping every highlight.
    const encoded = asVec4(workingToColorSpace(bloomed, THREE.SRGBColorSpace));
    this.lutNode = asVec4(lut3D(encoded, texture3D(this.lut), LUT_SIZE, this.uniforms.chain));
    const graded = asVec4(colorSpaceToWorking(this.lutNode, THREE.SRGBColorSpace));
    const shaded = vec4(graded.rgb.mul(vignetteFactor(this.uniforms)), graded.a);

    // SMAA wants linear input and FXAA wants sRGB, so each still sits on its own side of the
    // encode — only the encode no longer carries tone mapping with it. The AA nodes wrap their
    // input in convertToTexture(); hoisting that render target out and using it as the blend base
    // too means the graded chain above is evaluated once, not once inside the AA target and again
    // inline. convertToTexture() is a no-op on a texture node.
    const encodeOnly = (node: Vec4): Vec4 =>
      asVec4(renderOutput(node, THREE.NoToneMapping, renderer.outputColorSpace));
    let output: Vec4;
    if (antialias === "smaa") {
      this.aaInput = asVec4(convertToTexture(shaded, null, null, { type: THREE.HalfFloatType, depthBuffer: false }));
      this.aaNode = smaa(this.aaInput);
      // r185 SMAA defaults every intermediate to RGBA16F. Edge flags and blend
      // weights are bounded [0,1], matching the reference SMAA UNORM8 buffers.
      // Keep the colour blend/input half-float to avoid quantising the poster sky.
      const targets = this.aaNode as unknown as {
        _renderTargetEdges: THREE.RenderTarget; _renderTargetWeights: THREE.RenderTarget;
      };
      targets._renderTargetEdges.texture.type = THREE.UnsignedByteType;
      targets._renderTargetWeights.texture.type = THREE.UnsignedByteType;
      output = encodeOnly(this.blend(this.aaInput, asVec4(this.aaNode)));
    } else {
      this.aaInput = asVec4(convertToTexture(encodeOnly(shaded), null, null, { type: THREE.UnsignedByteType, depthBuffer: false }));
      this.aaNode = fxaa(this.aaInput);
      output = this.blend(this.aaInput, asVec4(this.aaNode));
    }

    this.pipeline = new RenderPipeline(renderer, output);
    // renderOutput() is placed by hand above; letting the pipeline add its own would double-convert.
    this.pipeline.outputColorTransform = false;
  }

  setSize(width: number, height: number): void {
    this.uniforms.aspect.value = height > 0 ? width / height : 1;
  }

  setQuality(rung: QualityRung): void {
    this.policy = postChainPolicy(rung, this.reducedMotion);
    this.uniforms.chain.value = this.policy.chain ? 1 : 0;
    this.uniforms.bloom.value = this.policy.chain && this.policy.bloom ? 1 : 0;
    this.uniforms.aa.value = this.policy.aa ? 1 : 0;
    this.uniforms.ao.value = this.policy.chain && this.policy.ao ? 1 : 0;
    // Zeroing the uniform hides bloom but the mip chain would still render every frame; muting
    // updateBefore skips that work without touching the compiled graph. The AO buffer is the more
    // expensive of the two off-screen passes, so it gets the same treatment.
    this.bloomNode.updateBeforeType = this.uniforms.bloom.value > 0 ? NodeUpdateType.FRAME : NodeUpdateType.NONE;
    this.aoNode.updateBeforeType = this.uniforms.ao.value > 0 ? NodeUpdateType.FRAME : NodeUpdateType.NONE;
    // The rung gate is fixed here; the sun-proximity gate that multiplies it is per-frame and set
    // in render(), so a rung-3 step-down must also zero the uniform immediately rather than wait
    // for the next render() call to notice the policy changed.
    if (!(this.policy.chain && this.policy.godrays)) this.uniforms.godrays.value = 0;
    this.godraysNode.updateBeforeType = this.policy.chain && this.policy.godrays ? NodeUpdateType.FRAME : NodeUpdateType.NONE;
  }

  render(deltaTime: number): void {
    // The node frame owns its own timing; the argument is kept only for arity parity with the
    // WebGL PostProcessing, whose composer.render(dt) drove effect animation.
    void deltaTime;
    const [x, y] = chromaticAberrationOffset(this.speed.value, !this.policy.chromatic);
    this.uniforms.aberration.value.set(x, y);
    this.uniforms.godrays.value = this.policy.chain && this.policy.godrays ? sunFrameProximity(this.camera) : 0;
    this.pipeline.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pipeline.dispose();
    this.lut.dispose();
    // RenderPipeline owns only its quad material, not its input graph. Delegate
    // actual owning nodes to their r185 disposers (FXAA owns no extra targets).
    this.scenePass.dispose();
    (this.bloomNode as unknown as { dispose(): void }).dispose();
    if (this.antialias === "smaa") (this.aaNode as unknown as { dispose(): void }).dispose();
    (this.aoNode as unknown as { dispose(): void }).dispose();
    (this.godraysNode as unknown as { dispose(): void }).dispose();
    // RTTNode inherits Node.dispose(), which only emits an event in r185.
    // Release its target/material explicitly; QuadMesh geometry is shared.
    const input = this.aaInput as unknown as {
      renderTarget: THREE.RenderTarget; _quadMesh: { material: THREE.Material };
    };
    input.renderTarget.dispose();
    input._quadMesh.material.dispose();
    // GTAO's disposer omits its per-instance generated noise texture.
    (this.aoNode as unknown as { _noiseNode: { value: THREE.Texture } })._noiseNode.value.dispose();
    if (this.ownedShadowStub) {
      if (this.sunLight.shadow.map === this.ownedShadowStub) this.sunLight.shadow.map = null;
      this.ownedShadowStub.dispose();
      this.ownedShadowStub = null;
    }
  }

  /** Cross-fades an optional stage in and out on the `aa` uniform without dropping it from the graph. */
  private blend(base: Vec4, applied: Vec4): Vec4 {
    return mix(base, applied, this.uniforms.aa);
  }
}
