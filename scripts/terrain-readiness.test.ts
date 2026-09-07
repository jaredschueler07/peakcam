import assert from 'node:assert/strict';
import test from 'node:test';
import { assessReadiness, type ReadinessEvidence } from './terrain-readiness';
const artifact={reference:'Synthetic test artifact only',sha256:'a'.repeat(64)};
function fixture():ReadinessEvidence {
 return {schemaVersion:1,slug:'breckenridge',courseVersion:4,sourceGridSha256:'b'.repeat(64),sourceMetaSha256:'c'.repeat(64),
  scope:{sizeM:1000,minElevationM:1000,maxElevationM:2000,requiredClasses:['open','forest','steep','runout']},
  targets:{horizontalM:.5,verticalM:.25,minControlCount:30,minAxisSpanFraction:.5,minElevationSpanFraction:.6,maxMeshErrorM:.1},
  source:{originalDelivery:artifact,horizontalReference:{datum:'WGS84',realization:'test realization',epoch:'2020.0',transform:artifact},verticalReference:{datum:'NAVD88',evidence:artifact},validCoverage:{fraction:1,mask:artifact}},
  survey:{independent:true,report:artifact,checkpoints:Array.from({length:32},(_,i)=>({id:`C${i}`,x:-450+(i%8)*125,z:-450+Math.floor(i/8)*300,elevationM:1100+i*25,surfaceClass:['open','forest','steep','runout'][i%4] as 'open',horizontalErrorM:.1,verticalErrorM:.05,horizontalUncertaintyM:.02,verticalUncertaintyM:.02}))},
  mesh:{maxErrorM:.05,coverage:'validated-bound',reference:artifact},reviewer:null};
}
test('complete synthetic evidence is ready for independent review, never certification',()=>{
 const result=assessReadiness(fixture());assert.equal(result.status,'ready-for-review');assert.deepEqual(result.blockers,[]);assert.equal(result.certified,false);
});
test('missing evidence is blocked rather than filled with reassuring zeros',()=>{
 const f=fixture();f.source.originalDelivery=null;f.source.verticalReference=null;f.survey=null;f.mesh=null;
 const result=assessReadiness(f);assert.equal(result.status,'blocked');
 for(const code of ['original-delivery','vertical-reference','independent-control','mesh-error'])assert.ok(result.blockers.some(b=>b.code===code),code);
});
test('a large clustered survey does not pass spatial coverage',()=>{
 const f=fixture();f.survey!.checkpoints.forEach((p,i)=>{p.x=i;p.z=i;p.elevationM=1100+i;});
 const codes=assessReadiness(f).blockers.map(b=>b.code);
 assert.ok(codes.includes('control-quadrants'));assert.ok(codes.includes('control-axis-span'));assert.ok(codes.includes('control-elevation-span'));
});
test('independence, sample count, terrain classes, bounds and per-point errors are enforced',()=>{
 const f=fixture();f.survey!.independent=false;f.survey!.checkpoints=f.survey!.checkpoints.slice(0,5);
 f.survey!.checkpoints.forEach(p=>p.surfaceClass='open');f.survey!.checkpoints[0].x=600;
 f.survey!.checkpoints[1].horizontalErrorM=.49;f.survey!.checkpoints[1].verticalErrorM=.24;
 const codes=assessReadiness(f).blockers.map(b=>b.code);
 for(const code of ['independent-control','control-count','control-classes','control-bounds','horizontal-error','vertical-error'])assert.ok(codes.includes(code),code);
});
test('partial coverage and coarse rendered error fail acceptance',()=>{
 const f=fixture();f.source.validCoverage!.fraction=.999;f.mesh!.maxErrorM=.11;
 const codes=assessReadiness(f).blockers.map(b=>b.code);assert.ok(codes.includes('source-coverage'));assert.ok(codes.includes('mesh-error'));
});
test('duplicates and nonfinite evidence are rejected and cannot inflate survey count',()=>{
 const f=fixture();f.survey!.checkpoints[1]={...f.survey!.checkpoints[0]};assert.throws(()=>assessReadiness(f),/Duplicate/);
 const bad=fixture();bad.mesh!.maxErrorM=NaN;assert.throws(()=>assessReadiness(bad));
});
test('mesh and surveyed ground errors must fit the combined vertical budget',()=>{
 const f=fixture();f.survey!.checkpoints[0].verticalErrorM=.2;f.mesh!.maxErrorM=.08;
 assert.ok(assessReadiness(f).blockers.some(b=>b.code==='combined-surface-error'));
});
test('a small sampled mesh error cannot masquerade as a full-scope accuracy bound',()=>{
 const f=fixture();f.mesh!.coverage='sampled';assert.ok(assessReadiness(f).blockers.some(b=>b.code==='mesh-coverage'));
});
test('operator readiness command returns a blocked report and a failing release gate for current mountains',async()=>{
 const {spawnSync}=await import('node:child_process');
 const report=spawnSync(process.execPath,['--import','tsx','scripts/terrain-readiness.ts','all','--require-ready'],{encoding:'utf8'});
 assert.equal(report.status,2,report.stderr);
 const rows=JSON.parse(report.stdout);assert.equal(rows.length,3);assert.ok(rows.every((r:{status:string;certified:boolean})=>r.status==='blocked'&&!r.certified));
});
