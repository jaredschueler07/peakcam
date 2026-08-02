import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { CsmShadows } from "./CsmShadows";
import { cascadeCountFor, CsmShadowsNode, type ShadowSystem } from "./CsmShadowsNode";
import { SUN_DIRECTION } from "./SceneFactory";
import { visualWeatherPreset } from "./VisualPresets";

const profile = DROP_IN_GAME_PROFILES["ski-portillo"];
const weather = profile.weather[0];
const visual = visualWeatherPreset(0);

function build(mobile: boolean) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 900);
  const shadows = new CsmShadowsNode(camera, scene, mobile, weather, visual);
  return { scene, camera, shadows };
}

function shadowNodeOf(shadows: CsmShadowsNode): CSMShadowNode {
  const node = shadows.light.shadow.shadowNode;
  assert.ok(node instanceof CSMShadowNode, "the light's shadow is driven by a CSMShadowNode");
  return node;
}

test("the cascade policy is one cascade on mobile or below rung 3, three otherwise", () => {
  for (const rung of [0, 1, 2, 3, 4] as const) {
    assert.equal(cascadeCountFor(true, rung), 1, `mobile rung ${rung} stays at one cascade`);
  }
  assert.equal(cascadeCountFor(false, 0), 1);
  assert.equal(cascadeCountFor(false, 2), 1);
  assert.equal(cascadeCountFor(false, 3), 3);
  assert.equal(cascadeCountFor(false, 4), 3);
});

test("CsmShadowsNode is drop-in compatible with CsmShadows", () => {
  // Every method Renderer calls must exist on both, with the same name and arity.
  for (const name of ["setupMaterial", "setWeather", "setQuality", "update", "dispose"] as const) {
    const ported = CsmShadowsNode.prototype[name];
    const original = CsmShadows.prototype[name];
    assert.equal(typeof ported, "function", `CsmShadowsNode.${name} exists`);
    assert.equal(ported.length, original.length, `CsmShadowsNode.${name} takes the same arguments`);
  }

  // And structurally, so Task 6 can swap the import behind the shared type.
  const { shadows } = build(false);
  const asSystem: ShadowSystem = shadows;
  const alsoSystem: ShadowSystem = new CsmShadows(
    new THREE.PerspectiveCamera(), new THREE.Scene(), false, weather, visual,
  );
  assert.equal(typeof asSystem.update, "function");
  assert.equal(typeof alsoSystem.update, "function");
});

test("construction puts one shadow-casting light in the scene, aimed down the sun direction", () => {
  const { scene, shadows } = build(false);
  assert.ok(scene.children.includes(shadows.light), "the light is parented — CSMShadowNode adds its cascades to light.parent");
  assert.ok(scene.children.includes(shadows.light.target), "the target is parented so the direction resolves");
  assert.equal(shadows.light.castShadow, true);

  const direction = shadows.light.target.position.clone().sub(shadows.light.position).normalize();
  assert.ok(direction.distanceTo(SUN_DIRECTION.clone().negate()) < 1e-9, "light travels along -SUN_DIRECTION");

  assert.equal(shadows.light.shadow.bias, -0.0009);
  assert.equal(shadows.light.shadow.mapSize.width, 2048);
  assert.equal(shadows.light.shadow.mapSize.height, 2048);
});

test("the shadow node carries the CSM configuration and stays uninitialised until first render", () => {
  const { shadows } = build(false);
  const node = shadowNodeOf(shadows);
  assert.equal(node.cascades, 3);
  assert.equal(node.maxFar, 250);
  assert.equal(node.mode, "practical");
  assert.equal(node.fade, true, "cascade fade on desktop");
  assert.equal(node.light, shadows.light);

  // CSMShadowNode discovers the camera from the NodeBuilder on first setup(); presetting
  // `camera` would skip _init() and leave the cascades unbuilt.
  assert.equal(node.camera, null);

  const mobile = build(true);
  const mobileNode = shadowNodeOf(mobile.shadows);
  assert.equal(mobileNode.cascades, 1);
  assert.equal(mobileNode.fade, false, "no cascade fade on mobile");
  assert.equal(mobile.shadows.light.shadow.mapSize.width, 1024);
});

test("a quality change rebuilds the shadow node, because cascade count is constructor-time", () => {
  const { shadows } = build(false);
  const initial = shadowNodeOf(shadows);
  assert.equal(initial.cascades, 3);

  shadows.setQuality(2);
  const lowered = shadowNodeOf(shadows);
  assert.notEqual(lowered, initial, "dropping below rung 3 re-creates the node");
  assert.equal(lowered.cascades, 1);
  assert.equal(lowered.fade, true, "fade still follows the platform, not the rung");

  shadows.setQuality(1);
  assert.equal(shadowNodeOf(shadows), lowered, "no rebuild when the cascade count does not change");

  shadows.setQuality(4);
  const restored = shadowNodeOf(shadows);
  assert.notEqual(restored, lowered);
  assert.equal(restored.cascades, 3);
});

test("mobile never rebuilds, since every rung maps to a single cascade", () => {
  const { shadows } = build(true);
  const node = shadowNodeOf(shadows);
  for (const rung of [0, 2, 3, 4] as const) {
    shadows.setQuality(rung);
    assert.equal(shadowNodeOf(shadows), node);
  }
});

test("light intensity preserves the total illumination the WebGL cascades used to emit", () => {
  const { shadows } = build(false);
  // three.js CSM (WebGL) parents one real DirectionalLight per cascade, each at weather.sun.
  // CSMShadowNode's cascade placeholders emit nothing, so the single light carries the sum.
  assert.equal(shadows.light.intensity, weather.sun * 3);
  assert.equal(shadows.light.color.getHex(), visual.sunCol);

  shadows.setQuality(0);
  assert.equal(shadows.light.intensity, weather.sun * 1, "one cascade means one light's worth");

  const stormy = profile.weather[1];
  shadows.setWeather(stormy, visualWeatherPreset(1));
  assert.equal(shadows.light.intensity, stormy.sun * 1);
  assert.equal(shadows.light.color.getHex(), visualWeatherPreset(1).sunCol);

  shadows.setQuality(4);
  assert.equal(shadows.light.intensity, stormy.sun * 3, "a rebuild re-applies the current weather");
});

test("setupMaterial and update are inert, and dispose detaches the light", () => {
  const { scene, shadows } = build(false);
  const material = new THREE.MeshStandardMaterial();
  const compile = material.onBeforeCompile;
  shadows.setupMaterial(material);
  assert.equal(material.onBeforeCompile, compile, "no per-material shader injection on the node path");
  assert.equal(material.customProgramCacheKey().includes("csm"), false);

  shadows.update();

  shadows.dispose();
  assert.equal(scene.children.includes(shadows.light), false);
  assert.equal(scene.children.includes(shadows.light.target), false);
});
