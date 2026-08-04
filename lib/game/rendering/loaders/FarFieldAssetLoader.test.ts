import assert from "node:assert/strict";
import test from "node:test";

import { encodeFarField, type FarFieldWedge } from "../../terrain/far-field-format";
import { FarFieldAssetLoader } from "./FarFieldAssetLoader";
import { assertAcceptableReceivers, receiverCheckingFetch } from "./fetch-receiver.fixture";

const CENTRE: [number, number] = [-32.842, -70.129];
const RADIUS_M = 30_000;
const EXPECT = { centre: CENTRE, radiusM: RADIUS_M };

function asset(slug = "ski-portillo", centre = CENTRE): Uint8Array {
  const wedges: FarFieldWedge[] = [];
  for (let w = 0; w < 4; w += 1) {
    const azimuthStartRad = (w * 2 * Math.PI) / 4;
    const azimuthEndRad = ((w + 1) * 2 * Math.PI) / 4;
    wedges.push({
      index: w, azimuthStartRad, azimuthEndRad,
      positions: new Float32Array([0, 3000, -200, 200, 3000, 0, 0, 3100, -30_000]),
      indices: new Uint32Array([0, 1, 2]),
      minY: 3000, maxY: 3100,
    });
  }
  return encodeFarField(wedges, {
    slug, radiusM: RADIUS_M, wedgeCount: 4, centre,
    demSource: "test", bakedAt: "2026-08-02T00:00:00.000Z",
  });
}

function responding(body: Uint8Array | null, status = 200) {
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => (body ? body.slice().buffer : new ArrayBuffer(0)),
    } as unknown as Response;
  };
  return { fetcher, calls };
}

test("loads the far field from the brotli-encoded path and validates the resort", async () => {
  const { fetcher, calls } = responding(asset());
  const loaded = await new FarFieldAssetLoader(fetcher).load("ski-portillo", { expect: EXPECT });
  assert.equal(calls[0], "/game/terrain/ski-portillo.far.bin.br");
  assert.ok(loaded);
  assert.equal(loaded.meta.slug, "ski-portillo");
  assert.equal(loaded.wedges.length, 4);
});

test("a missing asset degrades to null and never breaks the run", async () => {
  const warnings: string[] = [];
  const { fetcher } = responding(null, 404);
  const loaded = await new FarFieldAssetLoader(fetcher).load("heavenly", {
    expect: EXPECT, onWarn: (m) => warnings.push(m),
  });
  assert.equal(loaded, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ridge bands/);
});

test("a corrupt asset degrades to null rather than throwing", async () => {
  const bytes = asset();
  bytes[0] ^= 0xff; // break the PCFF magic
  const warnings: string[] = [];
  const loaded = await new FarFieldAssetLoader(responding(bytes).fetcher).load("ski-portillo", {
    expect: EXPECT, onWarn: (m) => warnings.push(m),
  });
  assert.equal(loaded, null);
  assert.match(warnings[0], /magic/);
});

test("an asset baked for another resort is refused, not rendered", async () => {
  const warnings: string[] = [];
  const loaded = await new FarFieldAssetLoader(responding(asset("heavenly")).fetcher).load(
    "ski-portillo", { expect: EXPECT, onWarn: (m) => warnings.push(m) },
  );
  assert.equal(loaded, null);
  assert.match(warnings[0], /baked for "heavenly"/);

  const moved = await new FarFieldAssetLoader(responding(asset("ski-portillo", [38.9, -119.9])).fetcher)
    .load("ski-portillo", { expect: EXPECT, onWarn: (m) => warnings.push(m) });
  assert.equal(moved, null, "a matching slug with the wrong centre must still be refused");
});

test("an abort propagates — the caller cancelled and needs to know", async () => {
  const controller = new AbortController();
  const loader = new FarFieldAssetLoader((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const pending = loader.load("ski-portillo", { expect: EXPECT, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e: unknown) => e instanceof DOMException && e.name === "AbortError");
});

test("the fetcher is invoked with a receiver real fetch accepts", async () => {
  // The bug this pins shipped: `this.fetcher(url)` is a method call, and fetch's WebIDL binding
  // rejects any receiver that is not the global — `TypeError: Illegal invocation`. Every existing
  // test passed anyway, because a plain injected function does not care what `this` is. The loader
  // then swallowed the TypeError as "unusable asset" and fell back to the ridge bands, so the far
  // field silently never rendered while looking like a working fallback.
  const bytes = asset();
  const recorded = receiverCheckingFetch(() => ({
    ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer,
  } as unknown as Response));

  const warnings: string[] = [];
  const loaded = await new FarFieldAssetLoader(recorded.fetcher).load("ski-portillo", {
    expect: EXPECT, onWarn: (m) => warnings.push(m),
  });

  assertAcceptableReceivers(recorded, "FarFieldAssetLoader");
  assert.deepEqual(warnings, [], `the load warned instead of succeeding: ${warnings[0]}`);
  assert.ok(loaded, "a well-formed asset over an honest fetch stub must load");
});

test("the default fetcher survives being called as a method", () => {
  // Belt to the call-shape braces: even if someone reintroduces `this.fetcher(...)`, the bound
  // default keeps production working.
  const loader = new FarFieldAssetLoader() as unknown as { fetcher: (i: string) => Promise<Response> };
  assert.equal(typeof loader.fetcher, "function");
  // A bound function ignores its receiver, which is exactly the property being asserted.
  assert.equal(loader.fetcher.name, "bound fetch");
});
