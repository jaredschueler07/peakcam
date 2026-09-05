import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BlendFunction } from "postprocessing";
import { gateEffectUpdate, PostProcessing } from "./PostProcessing";

const renderer = {} as THREE.WebGLRenderer;
const input = {} as THREE.WebGLRenderTarget;

test("inactive effect updates allocate no targets and restore the original receiver and arguments", () => {
  let active = false, calls = 0, allocations = 0;
  const effect = {
    allocated: false,
    update(actualRenderer: THREE.WebGLRenderer, actualInput: THREE.WebGLRenderTarget, delta: number) {
      assert.equal(this, effect); assert.equal(actualRenderer, renderer); assert.equal(actualInput, input);
      assert.equal(delta, 1 / 60); calls++;
      if (!this.allocated) { this.allocated = true; allocations++; }
    },
  };
  gateEffectUpdate(effect, () => active);
  const wrapper = effect.update;
  effect.update(renderer, input, 1 / 60);
  assert.equal(calls, 0); assert.equal(allocations, 0);
  active = true; effect.update(renderer, input, 1 / 60);
  active = false; effect.update(renderer, input, 1 / 60);
  active = true; effect.update(renderer, input, 1 / 60);
  assert.equal(calls, 2); assert.equal(allocations, 1);
  assert.equal(effect.update, wrapper, "quality changes never wrap/reallocate the update method");
});

test("WebGL 4→1→2→3→0→4 quality gates skip only invisible effect renders", () => {
  let bloomCalls = 0, smaaCalls = 0, disposals = 0;
  const fake = {
    rung: 4,
    reducedMotion: false,
    effectPass: { enabled: true }, chromaticPass: { enabled: true },
    bloom: { blendMode: { blendFunction: BlendFunction.SCREEN }, update() { bloomCalls++; }, dispose() { disposals++; } },
    smaa: { blendMode: { blendFunction: BlendFunction.SRC }, update() { smaaCalls++; }, dispose() { disposals++; } },
  };
  gateEffectUpdate(fake.bloom, () => fake.rung >= 3);
  gateEffectUpdate(fake.smaa, () => fake.rung >= 2);
  const frame = () => { fake.bloom.update(); fake.smaa.update(); };
  const quality = (rung: 0 | 1 | 2 | 3 | 4) => PostProcessing.prototype.setQuality.call(fake as unknown as PostProcessing, rung);
  quality(4); frame(); assert.deepEqual([bloomCalls, smaaCalls], [1, 1]);
  quality(1); frame(); assert.deepEqual([bloomCalls, smaaCalls], [1, 1]);
  assert.equal(fake.bloom.blendMode.blendFunction, BlendFunction.SKIP);
  assert.equal(fake.smaa.blendMode.blendFunction, BlendFunction.SKIP);
  quality(2); frame(); assert.deepEqual([bloomCalls, smaaCalls], [1, 2]);
  quality(3); frame(); assert.deepEqual([bloomCalls, smaaCalls], [2, 3]);
  quality(0); frame(); assert.deepEqual([bloomCalls, smaaCalls], [2, 3]);
  assert.equal(fake.effectPass.enabled, false); assert.equal(fake.chromaticPass.enabled, false);
  quality(4); frame(); assert.deepEqual([bloomCalls, smaaCalls], [3, 4]);
  assert.equal(fake.effectPass.enabled, true); assert.equal(fake.chromaticPass.enabled, true);
  assert.equal(fake.bloom.blendMode.blendFunction, BlendFunction.SCREEN);
  assert.equal(fake.smaa.blendMode.blendFunction, BlendFunction.SRC);
  assert.equal(disposals, 0, "downshifts retain resources for immediate reuse");
});
