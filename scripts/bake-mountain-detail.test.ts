import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeMountainDetail } from './bake-mountain-detail';
import { createGridSample, sampleGridBicubic } from '../lib/game/terrain/bicubic';
import { encodeDelta, type Heightfield, type TrailsFile } from '../lib/game/terrain/formats';
const width=129,sizeM=512,cellSizeM=4;
const heights=new Float32Array(width*width);
for(let r=0;r<width;r++)for(let c=0;c<width;c++)heights[r*width+c]=3000-r*.8+c*.1;
const field:Heightfield={width,height:width,sizeM,cellSizeM,minZ:2890,maxZ:3020,heights};
const trails:TrailsFile={v:2,center:[0,0],sizeM,unit:.1,runs:[{n:'Groomer',g:'classic',d:'easy',widthM:28,p:encodeDelta([[0,2300],[0,-2300]])},{n:'Black',g:'backcountry',d:'expert',widthM:24,p:encodeDelta([[1000,2300],[1000,-2300]])}],lifts:[]};
test('baked relief is repeatable, seed-sensitive and leaves source DEM untouched',()=>{
 const copy=field.heights.slice();const a=bakeMountainDetail(field,structuredClone(trails),1),b=bakeMountainDetail(field,structuredClone(trails),1),c=bakeMountainDetail(field,structuredClone(trails),2);
 assert.deepEqual(a,b);assert.notDeepEqual(a,c);assert.deepEqual(field.heights,copy);
 const sample=(data:Float32Array,x:number)=>data[64*width+Math.round((x+256)/4)];
 assert.ok(sample(a,16)-sample(heights,16)>.5,'corridor bank must be physical geometry');
 assert.ok(a.some((h,i)=>Math.abs(h-heights[i])>.6),'meso relief survives source quantisation');
});
test('baked relief normals match the same interpolated physical height',()=>{
 const detailed={...field,heights:bakeMountainDetail(field,structuredClone(trails),1)},scratch=createGridSample(),eps=.0001;
 for(const x of [0.3,3.1,12.2,17.8,28.5,96.3,104.7]){
  const col=(x+256)/4,row=64.3;sampleGridBicubic(detailed,col,row,scratch);const dx=scratch.dCol;
  const high=sampleGridBicubic(detailed,col+eps,row,scratch).value,low=sampleGridBicubic(detailed,col-eps,row,scratch).value;
  assert.ok(Math.abs(dx-(high-low)/(2*eps))<1e-5);
 }
});
