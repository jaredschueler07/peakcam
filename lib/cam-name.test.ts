import { test } from "node:test";
import assert from "node:assert";
import { camDisplayName, withResolvedCamNames } from "./cam-name";

/** Only the fields the naming logic reads; the real rows carry ~20 more. */
function cam(over: Partial<{ name: string; embed_url: string | null; youtube_id: string | null }>) {
  return { name: "", embed_url: null, youtube_id: null, ...over };
}

test("a real name wins, trimmed", () => {
  assert.strictEqual(camDisplayName(cam({ name: "  Summit Express  " })), "Summit Express");
});

test("a blank name falls back to the feed URL's filename", () => {
  assert.strictEqual(
    camDisplayName(cam({ name: "   ", embed_url: "https://cams.example.com/CP/base_lodge.png" })),
    "base lodge",
  );
});

test("a URL with no filename falls back to the host", () => {
  assert.strictEqual(
    camDisplayName(cam({ embed_url: "https://www.cams.example.com/" })),
    "cams.example.com",
  );
});

test("a YouTube-only cam falls back to the stream id, then the generic label", () => {
  assert.strictEqual(camDisplayName(cam({ youtube_id: "dQw4w9WgXcQ" })), "dQw4w9WgXcQ");
  assert.strictEqual(camDisplayName(cam({})), "Live cam");
});

test("callers that would rather omit the element get an empty string", () => {
  assert.strictEqual(camDisplayName(cam({}), ""), "");
});

test("the data edge resolves derivable names but never invents a generic one", () => {
  const rows = [
    cam({ name: "Peak 8" }),
    cam({ name: "", embed_url: "https://cams.example.com/AGS.jpg" }),
    cam({ name: "" }),
  ];
  const resolved = withResolvedCamNames(rows);

  assert.deepStrictEqual(
    resolved.map((c) => c.name),
    ["Peak 8", "AGS", ""],
  );
  // Untouched rows keep their identity, so React sees stable props.
  assert.strictEqual(resolved[0], rows[0]);
  // …and the generic label stays a presentation decision.
  assert.strictEqual(camDisplayName(resolved[2]), "Live cam");
});
