import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { DROP_IN_GAME_PROFILES } from "../config/profiles";
import { createTerrainSource } from "../terrain/terrain-source";
import { createWorld } from "../terrain/obstacles";
import { createSkierState } from "../physics/skier";
import { simulationConfig } from "./config";
import { prepareLiftPath, sampleLiftPath, stepRealLifts, liftSpeed, RIDER_DROP_M } from "./lifts";
import { createSimulation } from "./simulation";
import type { RealLift } from "./types";
const point={x:0,y:0,z:0,heading:0};

for(const slug of ['breckenridge','heavenly','ski-portillo'] as const){
  test(`${slug}: every baked lift boards, rides at cable speed and unloads at its own top`,()=>{
    const prefix=`public/game/terrain/${slug}`, packed=brotliDecompressSync(readFileSync(`${prefix}.height.u16.br`));
    const profile=DROP_IN_GAME_PROFILES[slug];
    const source=createTerrainSource({profile,mode:'real',assets:{heightfield:packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),meta:JSON.parse(readFileSync(`${prefix}.meta.json`,'utf8')),trails:JSON.parse(readFileSync(`${prefix}.trails.json`,'utf8'))}});
    const world=createWorld(profile,profile.seed,source.sampler,{...simulationConfig('packed','v2'),allowLifts:true});
    createSimulation(profile,profile.seed,source.sampler);
    assert.ok(source.sampler.realLifts!.length>1);
    for(const lift of source.sampler.realLifts!){
      if(lift.complete===false || lift.stations?.length!==2)continue;
      // Isolate overlapping station zones when checking each inventory entry.
      const isolated={...world,terrain:{...source.sampler,realLifts:[lift]}};
      const path=prepareLiftPath(lift),s=createSkierState();
      const base=path.points[0],top=path.points.at(-1)!;
      for(const p of path.points) assert.ok(p.y-RIDER_DROP_M>=source.sampler.height(p.x,p.z)-0.2, `${lift.name}: cable/rider above terrain`);
      Object.assign(s.pos,{x:base.x,y:base.y-RIDER_DROP_M,z:base.z});
      assert.equal(stepRealLifts(s,1/120,isolated),true,lift.name);
      assert.equal(s.liftIndex,0,lift.name);
      assert.equal(s.liftDistanceM,liftSpeed(lift)/120);
      sampleLiftPath(path,s.liftDistanceM,point);
      assert.equal(s.pos.y,point.y-RIDER_DROP_M);
      const first={...s.pos};
      while(s.liftIndex>=0)stepRealLifts(s,1/120,isolated);
      assert.equal(s.pos.x,top.x,lift.name);assert.equal(s.pos.z,top.z,lift.name);
      assert.equal(s.pos.y,source.sampler.height(top.x,top.z),lift.name);
      assert.ok(s.events.liftFinished && s.onGround);assert.equal(s.liftProgress,1);
      assert.ok(Math.hypot(first.x-base.x,first.z-base.z)<0.1,'no teleport to summit');
      assert.ok(s.liftCooldown>0);
    }
  });
}

const lift:RealLift={kind:'real',name:'Fixture chair',type:'chair_lift',points:[{x:0,y:0,z:0},{x:0,y:30,z:200}],lengthM:202.237,speedMps:5,stations:[{x:0,y:0,z:0,radiusM:7},{x:0,y:30,z:200,radiusM:7}],towers:[{x:0,y:15,z:100}]};
test('catenary is below the support chord; reverse input still climbs; sample never allocates',()=>{
  const path=prepareLiftPath(lift);const middle=path.points[Math.floor(path.points.length/4)];
  const a=path.supports[0],b=path.supports[1],t=middle.z/b.z;
  assert.ok(middle.y<a.y+(b.y-a.y)*t);
  assert.equal(sampleLiftPath(path,10,point),point);
  const reversed=prepareLiftPath({...lift,points:[...lift.points].reverse()});
  assert.deepEqual(reversed.points,path.points);
});
test('boarding requires Free Ride, low speed, ground contact and finite station bounds',()=>{
  const profile=DROP_IN_GAME_PROFILES.breckenridge;
  const terrain={kind:'real' as const,profile,seed:1,noiseOffset:{x:0,z:0},realLifts:[lift],height:()=>0,normal:()=>({x:0,y:1,z:0}),trailField:()=>0,nearestTrail:()=>{throw new Error('unused');}};
  const world=createWorld(profile,1,terrain,{...simulationConfig(),allowLifts:true});prepareLiftPath(lift);
  for(const change of ['far','fast','air','crash','ranked']){
    const s=createSkierState();if(change==='far')s.pos.x=20;if(change==='fast')s.vel.z=11;if(change==='air')s.onGround=false;if(change==='crash')s.crash=1;
    assert.equal(stepRealLifts(s,1/120,change==='ranked'?{...world,config:simulationConfig()}:world),false,change);
    assert.equal(s.liftIndex,-1);
  }
  for(const partial of [{...lift,complete:false},{...lift,stations:[]}]) {
    prepareLiftPath(partial);const s=createSkierState();
    assert.equal(stepRealLifts(s,1/120,{...world,terrain:{...terrain,realLifts:[partial]}}),false);
  }
  const a=createSkierState(),b=createSkierState();
  for(let i=0;i<300;i++){stepRealLifts(a,1/120,world);stepRealLifts(b,1/120,world);}assert.deepEqual(a,b);
});
test('surface lifts remain on the tow track and all type fallback speeds are plausible',()=>{
  for(const type of ['platter','t-bar','rope_tow','chair_lift','gondola','cable_car']){
    const l={...lift,type,speedMps:undefined},p=prepareLiftPath(l);
    assert.ok(liftSpeed(l)>=2 && liftSpeed(l)<=6);
    if(p.surface) for(const v of p.points)assert.ok(Math.abs(v.y-RIDER_DROP_M-v.z*0.15)<1e-10);
  }
});
