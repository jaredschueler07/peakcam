import assert from 'node:assert/strict';
import test from 'node:test';
import { bakeMountainNetwork, type OsmSource } from './bake-mountain-network';
import { decodeTrails, type Heightfield } from '../lib/game/terrain/formats';
import { RESORT_BAKE_CONFIGS, M_PER_DEG_LAT, mPerDegLon } from '../lib/game/terrain/resorts';
const cfg={...RESORT_BAKE_CONFIGS.heavenly,sizeM:1000};
const field:Heightfield={width:3,height:3,sizeM:1000,cellSizeM:500,minZ:2000,maxZ:2200,heights:new Float32Array([2200,2200,2200,2100,2100,2100,2000,2000,2000])};
const geo=(x:number,y:number)=>({lat:cfg.center[0]+y/M_PER_DEG_LAT,lon:cfg.center[1]+x/mPerDegLon(cfg.center[0])});
const source:OsmSource={osm3s:{timestamp_osm_base:'2026-09-05T00:00:00Z'},elements:[
 {type:'way',id:10,tags:{name:'Named descent','piste:type':'downhill','piste:difficulty':'advanced',width:'21'},geometry:[geo(0,400),geo(0,0),geo(700,-200),geo(0,-400)]},
 {type:'way',id:20,tags:{name:'Joining trail','piste:type':'downhill','piste:grooming':'classic'},geometry:[geo(-300,300),geo(0,0)]},
 {type:'node',id:30,tags:{aerialway:'pylon'},...geo(100,0)},
 {type:'way',id:40,nodes:[30],tags:{name:'Chair',aerialway:'chair_lift','aerialway:occupancy':'4'},geometry:[geo(100,400),geo(100,0),geo(100,-400)]},
]};
test('network clips disconnected source pieces, IDs survive source ordering, heights and widths are explicit',()=>{
 const a=bakeMountainNetwork(cfg,source,field),b=bakeMountainNetwork(cfg,{...source,elements:[...source.elements].reverse()},field);
 assert.deepEqual(a,b);assert.equal(a.runs.filter(r=>r.sourceId==='osm:way:10').length,2);
 assert.equal(new Set(a.runs.map(r=>r.id)).size,a.runs.length);
 for(const r of decodeTrails(a).runs){assert.ok(r.points.every(p=>Math.abs(p.x)<=500&&Math.abs(p.y)<=500));assert.ok(r.topElevationM!>r.bottomElevationM!);}
 assert.equal(a.runs[0].widthM,21);assert.equal(a.runs[0].widthSource,'osm');assert.equal(a.runs[0].g,'backcountry');
 assert.ok(a.junctions!.some(j=>j.runIds.includes('osm:way:10:0')&&j.runIds.includes('osm:way:20:0')));
 const lift=a.lifts[0];assert.equal(lift.occupancy,4);assert.equal(lift.speedSource,'type-default');assert.equal(lift.towers!.length,1);assert.ok(lift.stations![0].elevationM<lift.stations![1].elevationM);
});
