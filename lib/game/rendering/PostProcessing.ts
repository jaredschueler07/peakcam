import * as THREE from "three";
// The exact package is pinned in the manifest; this keeps offline type-checks usable
// in worktrees where the orchestrator has not materialized node_modules yet.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- resolved from postprocessing@6.39.4 after npm install.
import { BlendFunction, BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, LUT3DEffect, RenderPass, SMAAEffect, SMAAPreset, VignetteEffect } from "postprocessing";
import type { QualityRung } from "./QualityController";
import { buildPosterLut } from "./SnowMaterial";
import { chromaticAberrationOffset } from "./MotionEffects";

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly effectPass: EffectPass;
  // ChromaticAberrationEffect is a convolution effect in postprocessing 6.x —
  // it cannot be merged into the shared EffectPass ("Convolution effects
  // cannot be merged"), so it rides in its own pass after the main chain.
  private readonly chromaticPass: EffectPass;
  private readonly bloom: BloomEffect;
  private readonly lutEffect: LUT3DEffect;
  private readonly vignette: VignetteEffect;
  private readonly smaa: SMAAEffect;
  private readonly chromatic: ChromaticAberrationEffect;
  private readonly lut = buildPosterLut(32);

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, private readonly speed: THREE.IUniform<number>, private readonly reducedMotion: boolean) {
    this.composer = new EffectComposer(renderer, { multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.85, intensity: 0.5 });
    this.lutEffect = new LUT3DEffect(this.lut);
    this.vignette = new VignetteEffect({ offset: 0.35, darkness: 0.5 });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
    this.chromatic = new ChromaticAberrationEffect({ radialModulation: true, modulationOffset: 0.15, offset: new THREE.Vector2() });
    this.effectPass = new EffectPass(camera, this.bloom, this.lutEffect, this.vignette, this.smaa);
    this.composer.addPass(this.effectPass);
    this.chromaticPass = new EffectPass(camera, this.chromatic);
    this.composer.addPass(this.chromaticPass);
  }

  setSize(width: number, height: number): void { this.composer.setSize(width, height); }

  setQuality(rung: QualityRung): void {
    this.effectPass.enabled = rung > 0;
    this.chromaticPass.enabled = rung > 0 && !this.reducedMotion;
    this.bloom.blendMode.blendFunction = rung >= 3 ? BlendFunction.SCREEN : BlendFunction.SKIP;
    this.smaa.blendMode.blendFunction = rung >= 2 ? BlendFunction.SRC : BlendFunction.SKIP;
  }

  render(deltaTime: number): void {
    const [x, y] = chromaticAberrationOffset(this.speed.value, this.reducedMotion);
    this.chromatic.offset.set(x, y);
    this.composer.render(deltaTime);
  }

  dispose(): void { this.composer.dispose(); this.lut.dispose(); }
}
