import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { stitchRings,clipFarField,clipHalfPlane,insidePolygon } from './bake-landmarks';
import baked from '../public/game/terrain/landmarks.json';
test('landmark rings stitch reversed source ways and fail rather than fabricate gaps',()=>{
 assert.deepEqual(stitchRings([[[0,0],[1,0]],[[1,1],[1,0]],[[1,1],[0,0]]]),[[[0,0],[1,0],[1,1],[0,0]]]);
 assert.throws(()=>stitchRings([[[0,0],[1,0]],[[2,2],[3,3]]]),/not closed/);
});
test('lake clipping preserves actual footprint within the existing distant terrain',()=>{
 const clipped=clipFarField([[-40000,-40000],[40000,-40000],[40000,40000],[-40000,40000],[-40000,-40000]]);
 assert.ok(clipped.length>8);assert.ok(clipped.every(p=>Math.hypot(...p)<=29500.01));
 const half=clipHalfPlane([[0,0],[2,0],[2,2],[0,2]],1,0,1);
 assert.ok(half.every(p=>p[0]<=1));assert.ok(insidePolygon([.5,.5],half));assert.ok(!insidePolygon([1.5,.5],half));
});
test('baked landmarks retain OSM identity and stay inside the shared 16 KB compressed budget',()=>{
 assert.equal(baked.hotel.sourceId,'osm:way:272711273');
 assert.equal(baked.lakes.heavenly.sourceId,'osm:relation:1823287');
 assert.equal(baked.lakes['ski-portillo'].sourceId,'osm:way:25749554');
 assert.equal(baked.lakes.heavenly.sourceElevationM,1897);
 assert.ok(brotliCompressSync(fs.readFileSync('public/game/terrain/landmarks.json')).length<16000);
 assert.ok(baked.hotel.main.length>4&&baked.hotel.annex.length>4);
});
