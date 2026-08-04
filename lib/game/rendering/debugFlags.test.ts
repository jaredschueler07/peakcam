import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { CSM_DEBUG, csmDebugMode, postBypassEnabled, SNOW_DEBUG, snowDebugMode, treeDebugEnabled, weatherOverride } from "./debugFlags";
import { CsmShadowsNode } from "./CsmShadowsNode";
import { visualWeatherPreset } from "./VisualPresets";
import { createSnowNodeMaterial, createSnowNodeUniforms } from "./SnowNodeMaterial";
import { buildSnowDetailNormal } from "./SnowMaterial";
import { createScene } from "./SceneFactory";
import { staticNodeFactories } from "./nodeFactories.fixture";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";

test("the debug flags parse from a query string and default to off", () => {
  assert.equal(snowDebugMode(""), 0);
  assert.equal(snowDebugMode("?snowdbg=3"), 3);
  assert.equal(snowDebugMode("?snowdbg=0"), 0, "zero is off, not a mode");
  assert.equal(snowDebugMode("?snowdbg=banana"), 0, "unparseable is off, never NaN");
  assert.equal(snowDebugMode("?other=1"), 0);

  assert.equal(treeDebugEnabled(""), false);
  assert.equal(treeDebugEnabled("?treedbg=1"), true);

  assert.equal(postBypassEnabled(""), false);
  assert.equal(postBypassEnabled("?nopost"), true);
});

test("each snowdbg step removes one more term from the node graph", () => {
  const detail = buildSnowDetailNormal(3);
  const build = (mode: number) => createSnowNodeMaterial(detail, createSnowNodeUniforms(), mode);
  const overridesOutput = (material: THREE.Material) =>
    Object.getPrototypeOf(material).setupOutput !== MeshStandardNodeMaterial.prototype.setupOutput;

  // Terms must be dropped from the graph, not multiplied by zero — a NaN survives `* 0`.
  for (const mode of [SNOW_DEBUG.NONE, SNOW_DEBUG.NO_GLINT, SNOW_DEBUG.NO_WRAP_RIM]) {
    const material = build(mode);
    assert.ok(material.normalNode, `mode ${mode} keeps the detail normal`);
    assert.ok(overridesOutput(material), `mode ${mode} keeps the custom shading pass`);
  }

  const noDetail = build(SNOW_DEBUG.NO_DETAIL_NORMAL);
  assert.equal(noDetail.normalNode, null, "mode 3 drops the triplanar perturbation");
  assert.ok(overridesOutput(noDetail), "but keeps the shading pass");

  const plain = build(SNOW_DEBUG.PLAIN);
  assert.equal(plain.normalNode, null);
  assert.equal(overridesOutput(plain), false, "mode 4 is the stock node material");
  assert.equal(plain.roughness, 0.86, "on the same surface settings, so only the terms differ");
  assert.equal(plain.vertexColors, true);

  const fogOnly = build(SNOW_DEBUG.NO_FOG);
  assert.ok(fogOnly.normalNode, "mode 5 leaves the snow material fully intact");
  assert.ok(overridesOutput(fogOnly));
});

test("snowdbg=5 leaves the scene without a fog node", () => {
  // The flag is read from location.search, which the scene factory consults directly.
  const original = globalThis.location;
  Object.defineProperty(globalThis, "location", { value: { search: "?snowdbg=5" }, configurable: true });
  try {
    const built = createScene(DROP_IN_GAME_PROFILES["ski-portillo"], 1.6, staticNodeFactories());
    assert.equal((built.scene as THREE.Scene & { fogNode?: unknown }).fogNode, undefined);
  } finally {
    if (original === undefined) delete (globalThis as { location?: unknown }).location;
    else Object.defineProperty(globalThis, "location", { value: original, configurable: true });
  }

  const built = createScene(DROP_IN_GAME_PROFILES["ski-portillo"], 1.6, staticNodeFactories());
  assert.ok((built.scene as THREE.Scene & { fogNode?: unknown }).fogNode, "and installs it otherwise");
});


test("csmdbg partitions the light from the cascades", () => {
  assert.equal(csmDebugMode(""), CSM_DEBUG.NONE);
  assert.equal(csmDebugMode("?csmdbg=1"), CSM_DEBUG.NO_SHADOW);
  assert.equal(csmDebugMode("?csmdbg=2"), CSM_DEBUG.ONE_CASCADE);

  const withFlag = (search: string, assertion: (shadows: CsmShadowsNode) => void) => {
    const original = globalThis.location;
    Object.defineProperty(globalThis, "location", { value: { search }, configurable: true });
    try {
      assertion(new CsmShadowsNode(
        new THREE.PerspectiveCamera(), new THREE.Scene(), false,
        DROP_IN_GAME_PROFILES["ski-portillo"].weather[0], visualWeatherPreset(0),
      ));
    } finally {
      if (original === undefined) delete (globalThis as { location?: unknown }).location;
      else Object.defineProperty(globalThis, "location", { value: original, configurable: true });
    }
  };

  withFlag("?csmdbg=1", (shadows) => {
    assert.equal(shadows.light.castShadow, false, "the light stays, the shadow node does not");
    assert.equal(shadows.light.intensity > 0, true);
  });
  withFlag("?csmdbg=2", (shadows) => {
    assert.equal(shadows.light.castShadow, true);
    assert.equal((shadows.light.shadow.shadowNode as unknown as { cascades: number }).cascades, 1);
  });
  withFlag("", (shadows) => {
    assert.equal((shadows.light.shadow.shadowNode as unknown as { cascades: number }).cascades, 3);
  });
});

test("?weather pins the starting preset, and anything else leaves live conditions in charge", () => {
  assert.equal(weatherOverride("?weather=0"), 0, "0 is a real preset, not an absent flag");
  assert.equal(weatherOverride("?weather=1"), 1);
  assert.equal(weatherOverride("?weather=2"), 2);
  for (const absent of ["", "?cam=wide", "?weather=", "?weather=3", "?weather=-1", "?weather=x"]) {
    assert.equal(weatherOverride(absent), null, `"${absent}" falls back to live conditions`);
  }
});
