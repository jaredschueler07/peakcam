import assert from "node:assert/strict";
import test from "node:test";
import type { Cam } from "./types";
import { availableCameras, cameraPreview, cameraPreviews } from "./cam-preview";
const cam = (patch: Partial<Cam> = {}): Cam => ({ id: "image", resort_id: "resort", name: "Summit", elevation: null, embed_type: "image", embed_url: "https://cam.example/summit.jpg", youtube_id: null, is_active: true, auto_disabled: false, consecutive_failures: 0, last_checked_at: null, created_at: "2026-01-01", ...patch });
test("counts only enabled cameras with a usable source and rejects non-web URLs", () => {
  const cams=[cam(),cam({id:"disabled",is_active:false}),cam({id:"auto",auto_disabled:true}),cam({id:"bad",embed_url:"javascript:alert(1)"}),cam({id:"empty",embed_url:null}),cam({id:"site",embed_type:"link"})];
  assert.deepEqual(availableCameras(cams).map(c=>c.id),["image","site"]);
});
test("preview selection prefers a healthy still, with YouTube as fallback, without mutating source order", () => {
  const youtube=cam({id:"youtube",embed_type:"youtube",youtube_id:"dQw4w9WgXcQ",embed_url:null});
  const cams=[youtube,cam({id:"failing",consecutive_failures:2}),cam()];
  assert.deepEqual(cameraPreviews(cams).map(p=>p.cam.id),["image","youtube","failing"]);
  assert.deepEqual(cams.map(c=>c.id),["youtube","failing","image"]);
  assert.equal(cameraPreviews([youtube])[0].src,"https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});
test("links, iframes and insecure image sources remain available without pretending to have a thumbnail", () => {
  const cams=[cam({embed_type:"link"}),cam({embed_type:"iframe"}),cam({embed_url:"http://cam.example/still.jpg"})];
  assert.equal(availableCameras(cams).length,3);
  assert.deepEqual(cameraPreviews(cams),[]);
});
test("a recent health check does not label a still or thumbnail as live", () => {
  const preview=cameraPreviews([cam({last_checked_at:new Date().toISOString()})])[0];
  assert.equal(preview.label,"Camera still");
  assert.equal(preview.src,"https://cam.example/summit.jpg");
  assert.equal(availableCameras([cam({embed_type:"youtube",youtube_id:"invalid"})]).length,0);
});
test("supported player thumbnails use provider-published URLs and reject lookalike hosts", () => {
  const brown=cam({embed_type:"iframe",embed_url:"https://player.brownrice.com/embed/vailch21"});
  assert.equal(cameraPreviews([brown])[0].src,"https://player.brownrice.com/snapshot/vailch21");
  assert.equal(cameraPreviews([cam({embed_type:"iframe",embed_url:"https://aspen.roundshot.com/aspen/"})])[0].src,"https://aspen.roundshot.com/cams/91/thumbnail");
  assert.deepEqual(cameraPreviews([cam({...brown,embed_url:"https://player.brownrice.com.evil.example/embed/vailch21"})]),[]);
});
test("cameraPreview resolves one cam's still and never throws on a malformed URL", () => {
  assert.equal(cameraPreview(cam({embed_type:"iframe",embed_url:"https://player.brownrice.com/embed/mammothmain"}))?.src,"https://player.brownrice.com/snapshot/mammothmain");
  assert.equal(cameraPreview(cam({embed_type:"youtube",youtube_id:"awxz_oIlJE0",embed_url:null}))?.src,"https://i.ytimg.com/vi/awxz_oIlJE0/hqdefault.jpg");
  assert.equal(cameraPreview(cam({embed_type:"iframe",embed_url:"not a url"})),null);
  assert.equal(cameraPreview(cam({embed_type:"iframe",embed_url:"https://g1.ipcamlive.com/player/player.php?alias=x"}))?.src,"https://g1.ipcamlive.com/player/snapshot.php?alias=x");
  assert.equal(cameraPreview(cam({embed_type:"link"})),null);
});
test("brownrice stills resolve from regional hosts, snapshot URLs and longer player paths", () => {
  const still=(embed_url:string)=>cameraPreview(cam({embed_type:"iframe",embed_url}))?.src ?? null;
  assert.equal(still("https://live3.brownrice.com/embed/mtrose1"),"https://player.brownrice.com/snapshot/mtrose1");
  assert.equal(still("https://live2.brownrice.com/embed/wolfcreektreasure&em=1"),"https://player.brownrice.com/snapshot/wolfcreektreasure");
  assert.equal(still("https://player.brownrice.com/embed/windhammountainclub/timelapse/24hr"),"https://player.brownrice.com/snapshot/windhammountainclub");
  assert.equal(still("https://player.brownrice.com/snapshot/santafe"),"https://player.brownrice.com/snapshot/santafe");
  assert.equal(still("https://tsvweather.brownrice.com/embed/poco"),null);
  assert.equal(still("https://live1.brownrice.com.evil.example/embed/afbasearea"),null);
  assert.equal(still("http://live1.brownrice.com/embed/afbasearea"),null);
});
test("ipcamlive stills come from the player's own snapshot endpoint and reject lookalikes", () => {
  const still=(embed_url:string)=>cameraPreview(cam({embed_type:"iframe",embed_url}))?.src ?? null;
  assert.equal(still("https://www.ipcamlive.com/player/player.php?alias=corralco1&autoplay=1"),"https://www.ipcamlive.com/player/snapshot.php?alias=corralco1");
  assert.equal(still("https://g3.ipcamlive.com/player/player.php?alias=laguna"),"https://g3.ipcamlive.com/player/snapshot.php?alias=laguna");
  assert.equal(still("https://ipcamlive.com.evil.example/player/player.php?alias=x"),null);
  assert.equal(still("https://g1.ipcamlive.com/player/player.php"),null);
  assert.equal(still("https://g1.ipcamlive.com/player/player.php?alias=bad%20alias%2F.."),null);
  assert.equal(still("https://g1.ipcamlive.com/other.php?alias=x"),null);
});
test("ozolio posters and the Taos weather still resolve; lookalikes and other commands do not", () => {
  const still=(embed_url:string)=>cameraPreview(cam({embed_type:"iframe",embed_url}))?.src ?? null;
  assert.equal(still("https://relay.ozolio.com/pub.api?cmd=embed&oid=EMB_ZIGI00000147"),"https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_ZIGI00000147");
  assert.equal(still("https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_ZIGI00000147"),null);
  assert.equal(still("https://relay.ozolio.com.evil.example/pub.api?cmd=embed&oid=EMB_X"),null);
  assert.equal(still("https://tsvweather.brownrice.com/poco-webcam.php"),"https://tsvweather.brownrice.com/img/poco.jpg");
  assert.equal(still("https://tsvweather.brownrice.com/other.php"),null);
});
