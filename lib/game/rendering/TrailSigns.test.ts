import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { TrailSigns, paintJunctionSign, difficultyMarker, buildBoundaryRopes, SIGN_POOL_SIZE, ROPE_POOL_SIZE } from './TrailSigns';
import type { RealJunction, SimulationState, TerrainSampler } from '../core/types';
import { createProceduralTerrain } from '../terrain/heightfield';
import { DROP_IN_GAME_PROFILES } from '../config/profiles';
import { nearestJunction } from '../terrain/junctions';
const junction:RealJunction={id:'cross',x:0,y:100,z:100,heading:0,halfWidthM:14,choices:[{id:'a',name:'Imperial Bowl',difficulty:'expert'},{id:'b',name:'4 O’Clock',difficulty:'intermediate'}]};
function terrain():TerrainSampler {
 const base=createProceduralTerrain(DROP_IN_GAME_PROFILES.breckenridge,7);
 const junctions=[junction];
 return {...base,kind:'real',junctions,nearbyJunction:(x,z,r=65)=>nearestJunction(junctions,x,z,r),height:(_x,z)=>100-z*.1,realRuns:[{kind:'real',sourceIndex:0,name:'4 O’Clock',difficulty:'intermediate',grooming:'classic',halfWidthM:14,points:[{x:0,y:100,z:0},{x:0,y:60,z:400}],lengthM:400,finishM:400,gates:[],ramps:[]}]};
}
test('wood signs paint source names and recognisable difficulty markers',()=>{
 const text:string[]=[];
 const ctx={fillRect(){},strokeRect(){},fillText(value:string){text.push(value);}} as unknown as CanvasRenderingContext2D;
 paintJunctionSign(ctx,junction);
 assert.ok(text.includes('Imperial Bowl'));assert.ok(text.includes('4 O’Clock'));assert.ok(text.includes('◆◆'));assert.ok(text.includes('■'));
 assert.equal(difficultyMarker('easy'),difficultyMarker('easy'));
});
test('rope geometry opens junctions and follows terrain instead of bridging cliffs',()=>{
 const t=terrain(),spans=buildBoundaryRopes(t);assert.ok(spans.length>0);
 for(const s of spans){assert.ok(Math.hypot(s.mx,s.mz-100)>=28);assert.equal(s.ay,t.height(s.ax,s.az)+1.1);assert.ok(Math.abs(s.ay-s.by)<=12);}
});
test('sign and rope pools stay bounded and reuse geometry while skier moves',()=>{
 const signs=new TrailSigns(terrain());
 const state={pos:{x:0,y:100,z:70},selectedTrail:0} as SimulationState;
 signs.update(state);
 assert.equal(signs.group.children.length,SIGN_POOL_SIZE+2);
 const objects=[...signs.group.children];
 const instances=signs.group.children.filter(c=>c instanceof THREE.InstancedMesh) as THREE.InstancedMesh[];
 assert.equal(instances.length,2);assert.ok(instances.every(mesh=>mesh.count<=ROPE_POOL_SIZE*2));
 assert.ok(signs.group.children.some(c=>c instanceof THREE.Group&&c.visible));
 state.pos.z=200;signs.update(state);assert.deepEqual(signs.group.children,objects);
 state.pos.x=5000;signs.update(state);assert.equal(instances[0].count,0);
 assert.ok(signs.group.children.filter(c=>c instanceof THREE.Group).every(c=>!c.visible));
 signs.dispose();assert.equal(signs.group.children.length,0);
});
