import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJunctions, nearestJunction } from './junctions';
import type { DrapedRun } from './real-heightfield';
const run=(id:string,name:string,x:number):DrapedRun=>({id,name,difficulty:'intermediate',grooming:'classic',gladed:false,oneway:false,groomed:true,halfWidthM:14,points:[{x,y:100,z:0},{x:0,y:70,z:100}]});
test('source junctions retain real choice IDs and names and convert north to game Z',()=>{
 const result=buildJunctions([{id:'cross',x:0,y:-100,runIds:['a','b','c']}],[run('a','Ridge Run',0),run('b','Gunbarrel',50),run('c','Ridge Run',0)],()=>70);
 assert.equal(result.length,1);assert.equal(result[0].z,100);assert.equal(result[0].y,70);
 assert.deepEqual(result[0].choices.map(c=>c.name),['Ridge Run','Gunbarrel']);
 assert.equal(nearestJunction(result,0,110),result[0]);assert.equal(nearestJunction(result,0,180),null);
 assert.equal(nearestJunction(result,0,110),nearestJunction(result,0,110),'query returns retained prompt data');
});
test('same-name source seams and missing source ways do not create misleading prompts',()=>{
 assert.equal(buildJunctions([{id:'seam',x:0,y:0,runIds:['a','c','missing']}],[run('a','Ridge Run',0),run('c','Ridge Run',0)],()=>0).length,0);
});
