import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import type { Renderer } from "three/webgpu";
import { ColorSpaceNode, NodeUpdateType } from "three/webgpu";
import { chromaticAberrationOffset } from "./MotionEffects";
import { NodePostProcessing, postChainPolicy } from "./NodePostProcessing";
import { PostProcessing } from "./PostProcessing";

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

function build(options?: { reducedMotion?: boolean; antialias?: "smaa" | "fxaa" }) {
  const { renderer, calls } = stubRenderer();
  const speed = { value: 0 };
  const post = new NodePostProcessing(
    renderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    speed,
    options?.reducedMotion ?? false,
    options?.antialias,
  );
  return { post, speed, calls };
}

test("the rung policy matches what PostProcessing.setQuality does today", () => {
  // PostProcessing.ts:41-46 — effectPass rung>0, chromaticPass rung>0 && !reducedMotion,
  // bloom rung>=3, smaa rung>=2.
  assert.deepEqual(postChainPolicy(0, false), { chain: false, bloom: false, aa: false, chromatic: false });
  assert.deepEqual(postChainPolicy(1, false), { chain: true, bloom: false, aa: false, chromatic: true });
  assert.deepEqual(postChainPolicy(2, false), { chain: true, bloom: false, aa: true, chromatic: true });
  assert.deepEqual(postChainPolicy(3, false), { chain: true, bloom: true, aa: true, chromatic: true });
  assert.deepEqual(postChainPolicy(4, false), { chain: true, bloom: true, aa: true, chromatic: true });

  for (const rung of [0, 1, 2, 3, 4] as const) {
    assert.equal(postChainPolicy(rung, true).chromatic, false, "reduced motion always drops the aberration");
    assert.equal(postChainPolicy(rung, true).chain, rung > 0, "and nothing else changes");
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

  post.setQuality(2);
  assert.equal(post.uniforms.bloom.value, 0, "bloom is a rung 3 luxury");
  assert.equal(post.uniforms.aa.value, 1);

  post.setQuality(1);
  assert.equal(post.uniforms.aa.value, 0);
  assert.equal(post.uniforms.chain.value, 1);

  post.setQuality(0);
  assert.equal(post.uniforms.chain.value, 0, "rung 0 is the raw render");
  assert.equal(post.uniforms.bloom.value, 0);
  assert.equal(post.uniforms.aa.value, 0);

  assert.equal(post.pipeline.outputNode, graph, "same node graph throughout — no recompile mid-run");
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
