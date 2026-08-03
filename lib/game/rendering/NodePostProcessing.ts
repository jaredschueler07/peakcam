import * as THREE from "three";
import { NodeUpdateType, RenderPipeline } from "three/webgpu";
import type { Node, Renderer, UniformNode } from "three/webgpu";
import { colorSpaceToWorking, convertToTexture, float, mix, pass, renderOutput, screenUV, smoothstep, texture3D, uniform, vec2, vec4, workingToColorSpace } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { lut3D } from "three/addons/tsl/display/Lut3DNode.js";
import type { QualityRung } from "./QualityController";
import { buildPosterLut } from "./SnowMaterial";
import { chromaticAberrationOffset } from "./MotionEffects";

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

export interface PostChainPolicy {
  chain: boolean;
  bloom: boolean;
  aa: boolean;
  chromatic: boolean;
  ao: boolean;
}

/** The rung ladder from `PostProcessing.setQuality`, lifted out so it cannot drift. */
export function postChainPolicy(rung: QualityRung, reducedMotion: boolean): PostChainPolicy {
  return { chain: rung > 0, bloom: rung >= 3, aa: rung >= 2, chromatic: rung > 0 && !reducedMotion, ao: rung >= 3 };
}

export interface PostChainUniforms {
  chain: UniformNode<"float", number>;
  bloom: UniformNode<"float", number>;
  aa: UniformNode<"float", number>;
  ao: UniformNode<"float", number>;
  aberration: UniformNode<"vec2", THREE.Vector2>;
  aspect: UniformNode<"float", number>;
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
    aberration: uniform(new THREE.Vector2()),
    aspect: uniform(1),
  };
  readonly aoNode: ReturnType<typeof ao>;
  /** The single-channel occlusion buffer as it is wired into the chain. */
  readonly aoTexture: Vec4;
  readonly bloomNode: ReturnType<typeof bloom>;
  /** The poster lookup. Everything reachable from here is graded; everything after it is not. */
  readonly lutNode: Vec4;
  /** The single render target the graded chain lands in — both the AA input and the blend base. */
  readonly aaInput: Vec4;
  readonly aaNode: ReturnType<typeof smaa> | ReturnType<typeof fxaa>;
  private policy = postChainPolicy(4, false);

  constructor(
    renderer: Renderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private readonly speed: { value: number },
    private readonly reducedMotion: boolean,
    readonly antialias: "smaa" | "fxaa" = "smaa",
  ) {
    const scenePass = pass(scene, camera);
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
    const occlusion = mix(float(1), this.aoTexture.r, this.uniforms.ao);
    const occluded = vec4(aberrated.rgb.mul(occlusion), aberrated.a);

    this.bloomNode = bloom(occluded, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    // `postprocessing` screen-blended the bloom (BlendFunction.SCREEN), not additive.
    const lit = asVec4(this.bloomNode).mul(this.uniforms.bloom);
    const bloomed = vec4(occluded.add(lit).sub(occluded.mul(lit)).rgb, occluded.a);

    // `postprocessing`'s LUT3DEffect declares `inputColorSpace = SRGBColorSpace`, so the effect
    // framework encoded the linear working buffer to sRGB around it. Feeding the same cube linear
    // values washes the whole frame out, so do the same round trip here.
    const encoded = asVec4(workingToColorSpace(bloomed, THREE.SRGBColorSpace));
    this.lutNode = asVec4(lut3D(encoded, texture3D(this.lut), LUT_SIZE, this.uniforms.chain));
    const graded = asVec4(colorSpaceToWorking(this.lutNode, THREE.SRGBColorSpace));
    const shaded = vec4(graded.rgb.mul(vignetteFactor(this.uniforms)), graded.a);

    // SMAA wants linear input and FXAA wants sRGB, so each sits on its own side of renderOutput.
    // The AA nodes wrap their input in convertToTexture(). Hoisting that render target out and
    // using it as the blend base too means the graded chain above is evaluated once, not once
    // inside the AA target and again inline. convertToTexture() is a no-op on a texture node.
    let output: Vec4;
    if (antialias === "smaa") {
      this.aaInput = asVec4(convertToTexture(shaded));
      this.aaNode = smaa(this.aaInput);
      output = asVec4(renderOutput(this.blend(this.aaInput, asVec4(this.aaNode))));
    } else {
      this.aaInput = asVec4(convertToTexture(renderOutput(shaded)));
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
    this.uniforms.aa.value = this.policy.chain && this.policy.aa ? 1 : 0;
    this.uniforms.ao.value = this.policy.chain && this.policy.ao ? 1 : 0;
    // Zeroing the uniform hides bloom but the mip chain would still render every frame; muting
    // updateBefore skips that work without touching the compiled graph. The AO buffer is the more
    // expensive of the two off-screen passes, so it gets the same treatment.
    this.bloomNode.updateBeforeType = this.uniforms.bloom.value > 0 ? NodeUpdateType.FRAME : NodeUpdateType.NONE;
    this.aoNode.updateBeforeType = this.uniforms.ao.value > 0 ? NodeUpdateType.FRAME : NodeUpdateType.NONE;
  }

  render(deltaTime: number): void {
    // The node frame owns its own timing; the argument is kept only for arity parity with the
    // WebGL PostProcessing, whose composer.render(dt) drove effect animation.
    void deltaTime;
    const [x, y] = this.policy.chromatic
      ? chromaticAberrationOffset(this.speed.value, this.reducedMotion)
      : [0, 0];
    this.uniforms.aberration.value.set(x, y);
    this.pipeline.render();
  }

  dispose(): void {
    this.pipeline.dispose();
    this.lut.dispose();
    // RenderPipeline.dispose() only releases its own quad material — it never walks the graph — so
    // the AO node's full-screen render target has to be released here or every renderer re-init
    // leaks one. `dispose()` is missing from the r185 GTAONode typings but present on the class.
    (this.aoNode as unknown as { dispose(): void }).dispose();
  }

  /** Cross-fades an optional stage in and out on the `aa` uniform without dropping it from the graph. */
  private blend(base: Vec4, applied: Vec4): Vec4 {
    return mix(base, applied, this.uniforms.aa);
  }
}
