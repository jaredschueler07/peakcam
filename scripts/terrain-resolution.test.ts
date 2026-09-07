import assert from 'node:assert/strict';
import test from 'node:test';
import { measureSurface, triangleHeight } from './measure-terrain-resolution';

test('triangle interpolation agrees with both renderer triangle halves and negative cells',()=>{
 const plane=(x:number,z:number)=>100+x*.125-z*.25;
 for(const spacing of [1,4,8])for(const [x,z] of [[.1,.2],[3.9,3.8],[-4,-8],[-.3,-.6],[0,0]])assert.ok(Math.abs(triangleHeight(plane,x,z,spacing)-plane(x,z))<1e-5);
 const curved=(x:number,z:number)=>x*z;
 assert.equal(triangleHeight(curved,1,1,4),0);
 assert.equal(triangleHeight(curved,3,3,4),8);
});
test('coarser cells increase measured curved-surface error',()=>{
 const height=(x:number,z:number)=>2000+.03*x*x+.02*z*z;
 const points=Array.from({length:100},(_,i)=>({x:-20+i*.39,z:-10+i*.19}));
 const fine=measureSurface(height,points,1),coarse=measureSurface(height,points,8);
 assert.ok(coarse.rmseM>fine.rmseM*10);assert.equal(coarse.count,100);
});
test('invalid and unmeasured points cannot produce a passing empty summary',()=>{
 assert.throws(()=>measureSurface(()=>0,[],4),/points/);
 assert.throws(()=>triangleHeight(()=>0,0,0,0),/spacing/);
 assert.throws(()=>triangleHeight(()=>NaN,0,0,4),/finite/);
 assert.throws(()=>measureSurface(()=>0,[{x:Infinity,z:0}],4),/finite/);
});

test('offline comparison agrees with actual terrain renderer contact at both mesh tiers',async()=>{
 const THREE=await import('three');
 const {TerrainRenderer}=await import('../lib/game/rendering/TerrainRenderer');
 const {createProceduralWorld}=await import('../lib/game/terrain/obstacles');
 const {DROP_IN_GAME_PROFILES}=await import('../lib/game/config/profiles');
 const world=createProceduralWorld(DROP_IN_GAME_PROFILES.breckenridge,1);
 const height=(x:number,z:number)=>3000+x*.1+z*.2+.004*x*x+.006*z*z;
 world.terrain.height=height;
 const renderer=new TerrainRenderer(new THREE.Scene(),world);renderer.update(-1,-1);
 for(const rung of [1,4] as const){renderer.setQuality(rung);for(const p of [{x:-.3,z:-.6},{x:3.1,z:7.9},{x:-200,z:-200},{x:0,z:0}]){
  assert.ok(Math.abs(renderer.sampleRenderedHeight(p.x,p.z)-triangleHeight(height,p.x,p.z,rung===1?8:4))<1e-8);
 }}
 renderer.dispose();
});
