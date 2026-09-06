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

test('a wide groomer retains its cut and excludes a closer narrow black corridor',()=>{
  const wide:TrailsFile={...trails,runs:[{n:'Wide groomer',g:'classic',widthM:70,p:encodeDelta([[0,2300],[0,-2300]])}]};
  const mixed:TrailsFile={...wide,runs:[...wide.runs,{n:'Narrow black',g:'backcountry',widthM:8,p:encodeDelta([[160,2300],[160,-2300]])}]};
  const groomer=bakeMountainDetail(field,structuredClone(wide),17);
  const overlap=bakeMountainDetail(field,structuredClone(mixed),17);
  for(let r=10;r<110;r++)for(let c=60;c<72;c++)assert.equal(overlap[r*width+c],groomer[r*width+c]);
});

test('tree wells respect explicit DEM treeline and avoid trail corridors',()=>{
  const wooded:TrailsFile={...trails,forests:[{sourceId:'osm:way:wood',points:[{x:-240,y:240},{x:240,y:240},{x:240,y:-240},{x:-240,y:-240},{x:-240,y:240}]}]};
  const full=structuredClone(wooded),below=structuredClone(wooded),none=structuredClone(wooded);
  bakeMountainDetail(field,full,17,4000);bakeMountainDetail(field,below,17,2950);bakeMountainDetail(field,none,17,0);
  assert.ok(full.detail!.treeWells.length>below.detail!.treeWells.length);
  assert.ok(below.detail!.treeWells.length>0);assert.equal(none.detail!.treeWells.length,0);
  assert.equal(below.detail!.treeLineElevationM,2950);
  for(const p of below.detail!.treeWells){
    const col=(p.x+256)/4,row=(256-p.y)/4;
    assert.ok(sampleGridBicubic(field,col,row,createGridSample()).value<=2950.01);
    assert.ok(Math.abs(p.x)>=14*1.2+6);
  }
});

 test('mapped forest planting uses dense repeatable 30m cells with bounded jitter',()=>{
  const woods:TrailsFile={...trails,runs:[],forests:[{sourceId:'wood',points:[{x:-240,y:240},{x:240,y:240},{x:240,y:-240},{x:-240,y:-240},{x:-240,y:240}]}]};
  const other=structuredClone(woods);
  bakeMountainDetail(field,woods,19,4000);bakeMountainDetail(field,other,19,4000);
  assert.deepEqual(woods.detail!.treeWells,other.detail!.treeWells);
  assert.equal(woods.detail!.treeWells.length,256);
  for(const site of woods.detail!.treeWells){
    for(const value of [site.x,site.y])assert.ok(Math.abs(value-(-220+Math.round((value+220)/30)*30))<=5.01);
  }
});
