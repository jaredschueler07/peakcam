import { test } from "node:test";
import assert from "node:assert";
import { camEmbedSrc, safeCamUrl } from "./cam-url";

test("safeCamUrl and camEmbedSrc enforce web/https schemes and 11-char YouTube IDs", () => {
  assert.strictEqual(safeCamUrl("javascript:alert(1)"), null);
  assert.strictEqual(safeCamUrl("data:text/html,hi"), null);
  assert.strictEqual(safeCamUrl("https://resort.example/cam"), "https://resort.example/cam");
  assert.strictEqual(safeCamUrl("http://resort.example/cam", ["https:"]), null);

  assert.strictEqual(
    camEmbedSrc({ embed_type: "youtube", youtube_id: "dQw4w9WgXcQ", embed_url: null }),
    "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1",
  );
  assert.strictEqual(
    camEmbedSrc({ embed_type: "youtube", youtube_id: "../../bad", embed_url: null }),
    null,
  );
  assert.strictEqual(
    camEmbedSrc({ embed_type: "iframe", youtube_id: null, embed_url: "http://insecure.example/embed" }),
    null,
  );
  assert.strictEqual(
    camEmbedSrc({ embed_type: "iframe", youtube_id: null, embed_url: "https://player.brownrice.com/embed/abc" }),
    "https://player.brownrice.com/embed/abc",
  );
});
