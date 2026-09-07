import assert from 'node:assert/strict';
import test from 'node:test';
import { validCoverage, validateWindow } from './probe-terrain-source';
test('native source probe counts nodata and nonfinite gaps without filling', () => {
  assert.deepEqual(validCoverage(new Float32Array([3000, 3100, -3.4028235e38, NaN]), -3.4028235e38), { sampleCount: 4, validSamples: 2, validFraction: .5, minimumM: 3000, maximumM: 3100 });
  assert.equal(validCoverage([0], null).validFraction, 1);
  assert.equal(validCoverage([-999999], -999999).minimumM, null);
  assert.equal(validCoverage([-999999, 3000], null).validFraction, .5, 'undeclared sentinels are not measured ground');
  assert.throws(() => validCoverage([], null), /Empty/);
});
test('native source probe cannot silently pad a window outside coverage or read unbounded pixels', () => {
  assert.doesNotThrow(() => validateWindow([0, 0, 1024, 1024], 1024, 1024));
  for (const window of [[-1,0,1,1], [0,0,1025,1], [0,0,1,0], [0,0,Infinity,1], [0,0,.5,1], [0,0,4096,4096]] as [number,number,number,number][]) assert.throws(() => validateWindow(window, 1024, 1024), /Pixel window/);
});
