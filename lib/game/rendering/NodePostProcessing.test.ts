import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { Renderer } from "three/webgpu";
import { ColorSpaceNode, NodeUpdateType } from "three/webgpu";
import { chromaticAberrationOffset } from "./MotionEffects";
import { NodePostProcessing, postChainPolicy } from "./NodePostProcessing";
import { PostProcessing } from "./PostProcessing";
import { SUN_DIRECTION } from "./SceneFactory";

// SMAANode decodes its edge/area lookup atlases through `new Image()`, which Node lacks.
// The stub only has to exist; nothing in these structure tests reads the decoded pixels.
class StubImage {
  src = "";
  onload: (() => void) | null = null;
}
(globalThis as { Image?: unknown }).Image ??= StubImage;

type Traversable = { getChildren?: () => Iterable<Traversable> };

function collectNodes(root: unknown): Set<unknown> {
  const seen = new Set<unknown>();
  const walk = (node: Traversable | null) => {
    if (!node || seen.has(node) || typeof node.getChildren !== "function") return;
    seen.add(node);
    for (const child of node.getChildren()) walk(child);
  };
  walk(root as Traversable | null);
  return seen;
}

function stubRenderer() {
  const calls = { render: 0 };
  const renderer = {
    toneMapping: THREE.NoToneMapping,
    outputColorSpace: THREE.SRGBColorSpace,
    xr: { enabled: false },
    render() { calls.render += 1; },
  };
  return { renderer: renderer as unknown as Renderer, calls };
}

function build(options?: { reducedMotion?: boolean; antialias?: "smaa" | "fxaa"; camera?: THREE.PerspectiveCamera }) {
  const { renderer, calls } = stubRenderer();
  const speed = { value: 0 };
  const camera = options?.camera ?? new THREE.PerspectiveCamera();
  const sunLight = new THREE.DirectionalLight();
  const post = new NodePostProcessing(
    renderer,
    new THREE.Scene(),
    camera,
    speed,
    options?.reducedMotion ?? false,
    sunLight,
    options?.antialias,
  );
  return { post, speed, calls, camera, sunLight };
}

test("the rung policy matches what PostProcessing.setQuality does today", () => {
  // PostProcessing.ts:41-46 — effectPass rung>0, chromaticPass rung>0 && !reducedMotion,
  // bloom rung>=3, smaa rung>=2. `ao` joins the table at rung 3, `godrays` at rung 4.
  assert.deepEqual(postChainPolicy(0, false), { chain: false, bloom: false, aa: false, chromatic: false, ao: false, godrays: false });
  assert.deepEqual(postChainPolicy(1, false), { chain: true, bloom: false, aa: false, chromatic: true, ao: false, godrays: false });
  assert.deepEqual(postChainPolicy(2, false), { chain: true, bloom: false, aa: true, chromatic: true, ao: false, godrays: false });
  assert.deepEqual(postChainPolicy(3, false), { chain: true, bloom: true, aa: true, chromatic: true, ao: true, godrays: false });
  assert.deepEqual(postChainPolicy(4, false), { chain: true, bloom: true, aa: true, chromatic: true, ao: true, godrays: true });

  for (const rung of [0, 1, 2, 3, 4] as const) {
    assert.equal(postChainPolicy(rung, true).chromatic, false, "reduced motion always drops the aberration");
    assert.equal(postChainPolicy(rung, true).chain, rung > 0, "and nothing else changes");
    assert.equal(postChainPolicy(rung, true).ao, rung >= 3, "AO is not a motion effect — reduced motion keeps it");
    assert.equal(postChainPolicy(rung, true).godrays, rung >= 4, "nor are godrays");
  }
});

test("NodePostProcessing is drop-in compatible with PostProcessing", () => {
  for (const name of ["setSize", "setQuality", "render", "dispose"] as const) {
    const ported = NodePostProcessing.prototype[name];
    const original = PostProcessing.prototype[name];
    assert.equal(typeof ported, "function", `NodePostProcessing.${name} exists`);
    assert.equal(ported.length, original.length, `NodePostProcessing.${name} takes the same arguments`);
  }
});

test("the pipeline owns the output transform so AA lands on the right side of sRGB", () => {
  const { post } = build();
  assert.equal(post.pipeline.outputColorTransform, false, "renderOutput() is placed by hand");
  assert.ok(post.pipeline.outputNode, "the chain is installed as the output node");
  assert.equal(post.lut.image.width, 32, "the poster LUT is the same 32³ cube the WebGL chain used");
});

test("quality changes flip uniforms without ever rebuilding the graph", () => {
  const { post } = build();
  const graph = post.pipeline.outputNode;

  post.setQuality(4);
  assert.equal(post.uniforms.chain.value, 1);
  assert.equal(post.uniforms.bloom.value, 1);
  assert.equal(post.uniforms.aa.value, 1);
  assert.equal(post.uniforms.ao.value, 1);

  post.setQuality(3);
  assert.equal(post.uniforms.ao.value, 1, "AO survives the step down to rung 3");
  assert.equal(post.uniforms.godrays.value, 0, "but godrays does not — it is a rung 4 exclusive");

  post.setQuality(2);
  assert.equal(post.uniforms.bloom.value, 0, "bloom is a rung 3 luxury");
  assert.equal(post.uniforms.ao.value, 0, "and so is the occlusion");
  assert.equal(post.uniforms.aa.value, 1);

  post.setQuality(1);
  assert.equal(post.uniforms.aa.value, 0);
  assert.equal(post.uniforms.chain.value, 1);

  post.setQuality(0);
  assert.equal(post.uniforms.chain.value, 0, "rung 0 is the raw render");
  assert.equal(post.uniforms.bloom.value, 0);
  assert.equal(post.uniforms.aa.value, 0);
  assert.equal(post.uniforms.ao.value, 0);
  assert.equal(post.uniforms.godrays.value, 0);

  assert.equal(post.pipeline.outputNode, graph, "same node graph throughout — no recompile mid-run");
});

test("godrays stay at zero below rung 4 no matter where the camera looks", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(SUN_DIRECTION); // dead on the sun — would be maximal proximity at rung 4
  const { post } = build({ camera });

  for (const rung of [0, 1, 2, 3] as const) {
    post.setQuality(rung);
    post.render(1 / 60);
    assert.equal(post.uniforms.godrays.value, 0, `rung ${rung} keeps godrays at zero even facing the sun`);
  }
});

test("godrays are gated on the sun being near the frame, not just the rung", () => {
  const facingSun = new THREE.PerspectiveCamera();
  facingSun.lookAt(SUN_DIRECTION);
  const { post: onSun } = build({ camera: facingSun });
  onSun.setQuality(4);
  onSun.render(1 / 60);
  assert.ok(onSun.uniforms.godrays.value > 0, "sun dead ahead — the shaft has a visible source");

  const facingAway = new THREE.PerspectiveCamera();
  facingAway.lookAt(SUN_DIRECTION.clone().negate());
  const { post: awaySun } = build({ camera: facingAway });
  awaySun.setQuality(4);
  awaySun.render(1 / 60);
  assert.equal(awaySun.uniforms.godrays.value, 0, "sun directly behind the camera — no shaft with no source");
});

test("the godrays render pass stops running when the rung drops below it", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.lookAt(SUN_DIRECTION);
  const { post } = build({ camera });
  post.setQuality(4);
  assert.equal(post.godraysNode.updateBeforeType, NodeUpdateType.FRAME, "the raymarch runs when godrays are on");
  post.setQuality(3);
  assert.equal(post.godraysNode.updateBeforeType, NodeUpdateType.NONE, "and stops entirely one rung down");
  post.setQuality(4);
  assert.equal(post.godraysNode.updateBeforeType, NodeUpdateType.FRAME, "restored on the way back up");
});

test("dispose releases the godrays render target too", () => {
  const { post } = build();
  let disposed = false;
  const target = (post.godraysNode as unknown as { _godraysRenderTarget: THREE.RenderTarget })._godraysRenderTarget;
  target.addEventListener("dispose", () => { disposed = true; });
  post.dispose();
  assert.equal(disposed, true);
});

test("AO is a lighting term: it lands before the bloom threshold and before the poster LUT", () => {
  const { post } = build();
  // Reachability from a stage means the stage consumes it, i.e. the AO is applied upstream.
  // Grading occlusion is the whole point — applying it over the LUT would darken the poster
  // palette instead of the light, and letting it bypass bloom would let occluded creases glow.
  assert.ok(collectNodes(post.lutNode).has(post.aoTexture), "the LUT grades an already-occluded frame");
  assert.ok(collectNodes(post.bloomNode).has(post.aoTexture), "and the bloom threshold sees the darkened creases");
});

test("the AO node is tuned for metre-scale occluders on snow, not for architecture", () => {
  // three's defaults (radius 0.25, distanceExponent 1, scale 1) find hand-width creases, of which
  // an open snow slope has none. These values are the ones the visual round signs off; pinning them
  // here means a silent revert to the defaults fails the suite rather than quietly doing nothing.
  const { post } = build();
  assert.equal(post.aoNode.radius.value, 1.5, "metre-scale reach — props, rocks, terrain rolls");
  assert.equal(post.aoNode.distanceExponent.value, 2, "steps cluster at the contact shadow");
  assert.equal(post.aoNode.thickness.value, 1, "below the radius, so silhouettes get no dark halo");
  assert.equal(post.aoNode.scale.value, 1.5, "contrast knob that is a no-op on unoccluded snow");
  assert.equal(post.aoNode.samples.value, 16);
  assert.equal(post.aoNode.resolutionScale, 0.5, "AO is low-frequency; half-res is the standard trade");
  assert.equal(post.aoNode.useTemporalFiltering, false, "temporal filtering needs a TRAANode we do not have");
});

test("disabled stages also stop doing their off-screen work", () => {
  const { post } = build();
  post.setQuality(4);
  assert.equal(post.bloomNode.updateBeforeType, NodeUpdateType.FRAME, "the mip chain renders when bloom is on");
  post.setQuality(2);
  assert.equal(post.bloomNode.updateBeforeType, NodeUpdateType.NONE, "and is skipped entirely when it is off");
  post.setQuality(3);
  assert.equal(post.bloomNode.updateBeforeType, NodeUpdateType.FRAME, "restored on the way back up");
});

test("the AO buffer also stops rendering when the rung drops below it", () => {
  const { post } = build();
  post.setQuality(3);
  assert.equal(post.aoNode.updateBeforeType, NodeUpdateType.FRAME, "the AO target is filled when AO is on");
  post.setQuality(2);
  assert.equal(post.aoNode.updateBeforeType, NodeUpdateType.NONE, "zeroing the uniform must not leave the pass running");
  post.setQuality(4);
  assert.equal(post.aoNode.updateBeforeType, NodeUpdateType.FRAME, "restored on the way back up");
});

test("each frame pushes the speed-driven aberration offset and renders once", () => {
  const { post, speed, calls } = build();
  post.setQuality(4);

  speed.value = 1;
  post.render(1 / 60);
  const [x, y] = chromaticAberrationOffset(1, false);
  assert.equal(post.uniforms.aberration.value.x, x);
  assert.equal(post.uniforms.aberration.value.y, y);
  assert.equal(calls.render, 1);

  speed.value = 0.5;
  post.render(1 / 60);
  assert.equal(post.uniforms.aberration.value.x, chromaticAberrationOffset(0.5, false)[0]);
  assert.equal(calls.render, 2);

  // Rung 0 kills the chain, so the aberration has to go with it.
  post.setQuality(0);
  post.render(1 / 60);
  assert.equal(post.uniforms.aberration.value.x, 0);
  assert.equal(post.uniforms.aberration.value.y, 0);
});

test("reduced motion never aberrates, at any speed or rung", () => {
  const { post, speed } = build({ reducedMotion: true });
  post.setQuality(4);
  speed.value = 1;
  post.render(1 / 60);
  assert.equal(post.uniforms.aberration.value.x, 0);
  assert.equal(post.uniforms.aberration.value.y, 0);
});

test("setSize feeds the aspect ratio the aberration shift needs", () => {
  const { post } = build();
  post.setSize(1600, 800);
  assert.equal(post.uniforms.aspect.value, 2);
  post.setSize(800, 1600);
  assert.equal(post.uniforms.aspect.value, 0.5);
  post.setSize(800, 0);
  assert.equal(post.uniforms.aspect.value, 1, "a zero-height canvas must not produce a NaN uniform");
});

test("either antialiasing node can be selected, and FXAA needs no DOM", () => {
  assert.equal(build({ antialias: "smaa" }).post.antialias, "smaa", "SMAA is the default-quality match");
  assert.equal(build({ antialias: "fxaa" }).post.antialias, "fxaa");
  assert.equal(build().post.antialias, "smaa");

  // Both graphs must survive RenderPipeline._update(), which is where the output node is composed.
  for (const antialias of ["smaa", "fxaa"] as const) {
    const { post, calls } = build({ antialias });
    post.setQuality(4);
    post.render(1 / 60);
    assert.equal(calls.render, 1, `${antialias} composes without throwing`);
  }
});

test("the graded chain lands in one render target, shared by the AA input and the blend base", () => {
  for (const antialias of ["smaa", "fxaa"] as const) {
    const { post } = build({ antialias });
    const consumed = (post.aaNode as unknown as { textureNode: unknown }).textureNode;
    assert.equal(consumed, post.aaInput, `${antialias} antialiases the very node the blend falls back to`);
    assert.equal((post.aaInput as unknown as { isTextureNode?: boolean }).isTextureNode, true);
  }
});

test("dispose releases the LUT and the pipeline", () => {
  const { post } = build();
  let lutDisposed = false;
  post.lut.addEventListener("dispose", () => { lutDisposed = true; });
  post.dispose();
  assert.equal(lutDisposed, true);
});

test("dispose releases the AO render target, which the pipeline does not own", () => {
  // RenderPipeline.dispose() only disposes its own quad material — it never walks the graph, so a
  // node holding a full-screen render target has to be released by hand or every re-init leaks one.
  const { post } = build();
  let aoDisposed = false;
  const target = (post.aoNode as unknown as { _aoRenderTarget: THREE.RenderTarget })._aoRenderTarget;
  target.addEventListener("dispose", () => { aoDisposed = true; });
  post.dispose();
  assert.equal(aoDisposed, true);
});

test("the poster LUT is fed sRGB, the way postprocessing's LUT3DEffect was", () => {
  // LUT3DEffect declares `inputColorSpace = SRGBColorSpace`, so the effect framework encoded the
  // linear working buffer around it. Feeding the same cube linear values washes the frame out.
  const { post } = build();
  const spaces: string[][] = [];
  for (const node of collectNodes(post.pipeline.outputNode)) {
    if (!(node instanceof ColorSpaceNode)) continue;
    const { source, target } = node as unknown as { source: string; target: string };
    spaces.push([source, target]);
  }
  assert.ok(
    spaces.some(([, target]) => target === THREE.SRGBColorSpace),
    "the chain encodes to sRGB before the lookup",
  );
  assert.ok(
    spaces.some(([source]) => source === THREE.SRGBColorSpace),
    "and decodes back afterwards",
  );
});

test("the AO distance gate reads the scene camera's clip planes, not the post quad's", () => {
  // The AO fade converts the scene pass's depth back to view-space metres, which is only meaningful
  // against the *scene* camera's near/far. TSL's `cameraNear`/`cameraFar` built-ins would instead
  // resolve to whichever camera is rendering at that point in the graph — the post chain's own
  // full-screen quad camera — which silently pins the gate open at every distance and leaves the
  // depth-precision banding it exists to remove. Pin the seeding so that can't regress.
  const camera = new THREE.PerspectiveCamera(65, 1.6, 0.5, 34_000);
  const { post } = build({ camera });

  assert.equal(post.uniforms.near.value, camera.near, "near comes from the scene camera");
  assert.equal(post.uniforms.far.value, camera.far, "far comes from the scene camera");
  assert.notEqual(post.uniforms.far.value, new THREE.PerspectiveCamera().far, "not a default camera's far");
});
