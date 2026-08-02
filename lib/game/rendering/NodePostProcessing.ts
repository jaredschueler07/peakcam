import * as THREE from "three";
import { NodeUpdateType, RenderPipeline } from "three/webgpu";
import type { Node, Renderer, UniformNode } from "three/webgpu";
import { colorSpaceToWorking, convertToTexture, float, mix, pass, renderOutput, screenUV, smoothstep, texture3D, uniform, vec2, vec4, workingToColorSpace } from "three/tsl";
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

export interface PostChainPolicy {
  chain: boolean;
  bloom: boolean;
  aa: boolean;
  chromatic: boolean;
}

/** The rung ladder from `PostProcessing.setQuality`, lifted out so it cannot drift. */
export function postChainPolicy(rung: QualityRung, reducedMotion: boolean): PostChainPolicy {
  return { chain: rung > 0, bloom: rung >= 3, aa: rung >= 2, chromatic: rung > 0 && !reducedMotion };
}

export interface PostChainUniforms {
  chain: UniformNode<"float", number>;
  bloom: UniformNode<"float", number>;
  aa: UniformNode<"float", number>;
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
    aberration: uniform(new THREE.Vector2()),
    aspect: uniform(1),
  };
  readonly bloomNode: ReturnType<typeof bloom>;
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

    this.bloomNode = bloom(aberrated, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    // `postprocessing` screen-blended the bloom (BlendFunction.SCREEN), not additive.
    const lit = asVec4(this.bloomNode).mul(this.uniforms.bloom);
    const bloomed = vec4(aberrated.add(lit).sub(aberrated.mul(lit)).rgb, aberrated.a);

    // `postprocessing`'s LUT3DEffect declares `inputColorSpace = SRGBColorSpace`, so the effect
    // framework encoded the linear working buffer to sRGB around it. Feeding the same cube linear
    // values washes the whole frame out, so do the same round trip here.
    const encoded = asVec4(workingToColorSpace(bloomed, THREE.SRGBColorSpace));
    const lut = asVec4(lut3D(encoded, texture3D(this.lut), LUT_SIZE, this.uniforms.chain));
    const graded = asVec4(colorSpaceToWorking(lut, THREE.SRGBColorSpace));
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
    // Zeroing the uniform hides bloom but the mip chain would still render every frame; muting
    // updateBefore skips that work without touching the compiled graph.
    this.bloomNode.updateBeforeType = this.uniforms.bloom.value > 0 ? NodeUpdateType.FRAME : NodeUpdateType.NONE;
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
  }

  /** Cross-fades an optional stage in and out on the `aa` uniform without dropping it from the graph. */
  private blend(base: Vec4, applied: Vec4): Vec4 {
    return mix(base, applied, this.uniforms.aa);
  }
}
