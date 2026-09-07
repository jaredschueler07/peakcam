/** Offline engineering evidence gate. Passing requests review; never certifies terrain. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { COURSE_VERSION } from '../lib/game/config/versions';
import { RESORT_SLUGS } from '../lib/game/terrain/resorts';
import { auditResort } from './audit-terrain';

const number=z.number().finite(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const Artifact=z.object({reference:z.string().trim().min(1),sha256:hash}).strict();
const Horizontal=z.object({datum:z.string().trim().min(1),realization:z.string().trim().min(1),epoch:z.string().trim().min(1),transform:Artifact}).strict();
const Point=z.object({id:z.string().min(1),x:number,z:number,elevationM:number,surfaceClass:z.enum(['open','forest','steep','runout']),horizontalErrorM:number.nonnegative(),verticalErrorM:number,horizontalUncertaintyM:number.nonnegative(),verticalUncertaintyM:number.nonnegative()}).strict();
export const ReadinessSchema=z.object({
 schemaVersion:z.literal(1),slug:z.enum(['breckenridge','heavenly','ski-portillo']),courseVersion:z.number().int().positive(),sourceGridSha256:hash,sourceMetaSha256:hash,
 scope:z.object({sizeM:number.positive(),minElevationM:number,maxElevationM:number,requiredClasses:z.array(Point.shape.surfaceClass).min(1)}).strict(),
 targets:z.object({horizontalM:number.positive(),verticalM:number.positive(),minControlCount:z.number().int().min(30),minAxisSpanFraction:number.min(.5).max(1),minElevationSpanFraction:number.min(.6).max(1),maxMeshErrorM:number.positive()}).strict(),
 source:z.object({originalDelivery:Artifact.nullable(),horizontalReference:Horizontal.nullable(),verticalReference:z.object({datum:z.string().trim().min(1),evidence:Artifact}).strict().nullable(),validCoverage:z.object({fraction:number.min(0).max(1),mask:Artifact}).strict().nullable()}).strict(),
 survey:z.object({independent:z.boolean(),report:Artifact,checkpoints:z.array(Point)}).strict().nullable(),
 mesh:z.object({maxErrorM:number.nonnegative(),coverage:z.enum(['sampled','validated-bound']),reference:Artifact}).strict().nullable(),reviewer:Artifact.nullable(),
}).strict().refine(v=>v.scope.maxElevationM>v.scope.minElevationM,'Invalid elevation scope');
export type ReadinessEvidence=z.infer<typeof ReadinessSchema>;
export function assessReadiness(input:unknown) {
 const e=ReadinessSchema.parse(input),blockers:{code:string;detail:string}[]=[];
 const block=(code:string,detail:string)=>blockers.push({code,detail});
 if(!e.source.originalDelivery)block('original-delivery','Archive original raster/point-cloud delivery, metadata and source hashes.');
 if(!e.source.horizontalReference)block('horizontal-reference','Document horizontal datum, realization, epoch and coordinate transformation.');
 if(!e.source.verticalReference)block('vertical-reference','Verify the delivery-specific vertical datum and geoid transformation.');
 if(!e.source.validCoverage||e.source.validCoverage.fraction!==1)block('source-coverage','Provide valid measured coverage for the complete declared scope and retain its mask.');
 if(!e.mesh||e.mesh.maxErrorM>e.targets.maxMeshErrorM)block('mesh-error','Measure the rendered surface against its reference and meet the mesh error allocation.');
 if(e.mesh&&e.mesh.coverage!=='validated-bound')block('mesh-coverage','A sampled maximum is not a validated bound across the declared scope.');
 if(!e.survey||!e.survey.independent)block('independent-control','Supply independent survey report and control observations; DEM-derived control does not qualify.');
 const points=e.survey?.checkpoints??[],ids=new Set<string>(),locations=new Set<string>(),quadrants=new Set<number>(),classes=new Set<string>();
 let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,minH=Infinity,maxH=-Infinity;
 let maxHorizontal=0,maxVertical=0,outside=0;
 for(const p of points){
  const key=`${p.x},${p.z}`;if(ids.has(p.id)||locations.has(key))throw new Error('Duplicate control IDs or positions');ids.add(p.id);locations.add(key);
  if(Math.abs(p.x)>e.scope.sizeM/2||Math.abs(p.z)>e.scope.sizeM/2||p.elevationM<e.scope.minElevationM||p.elevationM>e.scope.maxElevationM)outside++;
  if(p.x!==0&&p.z!==0)quadrants.add((p.x>0?1:0)+(p.z>0?2:0));classes.add(p.surfaceClass);
  minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);minH=Math.min(minH,p.elevationM);maxH=Math.max(maxH,p.elevationM);
  maxHorizontal=Math.max(maxHorizontal,p.horizontalErrorM+p.horizontalUncertaintyM);
  maxVertical=Math.max(maxVertical,Math.abs(p.verticalErrorM)+p.verticalUncertaintyM);
 }
 const xSpan=points.length?(maxX-minX)/e.scope.sizeM:null,zSpan=points.length?(maxZ-minZ)/e.scope.sizeM:null;
 const elevationSpan=points.length?(maxH-minH)/(e.scope.maxElevationM-e.scope.minElevationM):null;
 if(points.length<e.targets.minControlCount)block('control-count',`${points.length}/${e.targets.minControlCount} minimum independent controls supplied.`);
 if(outside)block('control-bounds',`${outside} controls outside the declared spatial/elevation scope.`);
 if(quadrants.size<4)block('control-quadrants',`${quadrants.size}/4 scope quadrants have control.`);
 if(xSpan===null||zSpan===null||xSpan<e.targets.minAxisSpanFraction||zSpan<e.targets.minAxisSpanFraction)block('control-axis-span','Controls must span at least the required fraction of both horizontal axes.');
 if(elevationSpan===null||elevationSpan<e.targets.minElevationSpanFraction)block('control-elevation-span','Controls do not cover the required elevation range.');
 const missing=e.scope.requiredClasses.filter(c=>!classes.has(c));if(missing.length)block('control-classes',`Missing surveyed classes: ${missing.join(', ')}.`);
 if(!points.length||maxHorizontal>e.targets.horizontalM)block('horizontal-error','Horizontal error plus survey uncertainty exceeds tolerance or is unknown.');
 if(!points.length||maxVertical>e.targets.verticalM)block('vertical-error','Vertical error plus survey uncertainty exceeds tolerance or is unknown.');
 if(points.length&&e.mesh&&maxVertical+e.mesh.maxErrorM>e.targets.verticalM)block('combined-surface-error','Conservative vertical control + uncertainty + mesh error exceeds the total vertical tolerance.');
 return {schemaVersion:1,slug:e.slug,courseVersion:e.courseVersion,status:blockers.length?'blocked':'ready-for-review',certified:false,
  targets:e.targets,controlCoverage:{count:points.length,quadrants:quadrants.size,xSpanFraction:xSpan,zSpanFraction:zSpan,elevationSpanFraction:elevationSpan,classes:[...classes].sort()},
  errors:{maxHorizontalIncludingUncertaintyM:points.length?maxHorizontal:null,maxVerticalIncludingUncertaintyM:points.length?maxVertical:null,maxMeshM:e.mesh?.maxErrorM??null},blockers,
  note:'Evidence declarations require independent inspection of their referenced artifacts, datum alignment and sampling design. This engineering gate never issues a survey certificate.'};
}

export function checkCurrentEvidence(input:unknown) {
 const e=ReadinessSchema.parse(input),audit=auditResort(e.slug);
 if(e.courseVersion!==COURSE_VERSION||e.sourceGridSha256!==audit.sourceFidelity.sourceGridSha256||e.sourceMetaSha256!==audit.sourceFidelity.sourceMetaSha256)throw new Error(`${e.slug}: stale evidence does not match the active course/source fingerprints`);
 const meta=JSON.parse(fs.readFileSync(`public/game/terrain/${e.slug}.meta.json`,'utf8'));
 if(e.scope.sizeM!==meta.sizeM||e.scope.minElevationM!==meta.minZ||e.scope.maxElevationM!==meta.maxZ)throw new Error(`${e.slug}: evidence scope differs from the active full-grid scope`);
 const report=assessReadiness(e);
 if(e.source.verticalReference&&!audit.coordinates.verticalDatumVerified)report.blockers.push({code:'active-datum-unverified',detail:'The active source manifest has not verified its vertical datum.'});
 if(e.source.verticalReference&&e.source.verticalReference.datum!==audit.coordinates.verticalDatum)report.blockers.push({code:'active-datum-mismatch',detail:'Evidence datum does not match the active source manifest.'});
 report.status=report.blockers.length?'blocked':'ready-for-review';
 return {...report,evidenceSha256:createHash('sha256').update(JSON.stringify(e)).digest('hex')};
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try {
  const args=process.argv.slice(2);let selected='all',output:string|undefined,requireReady=false,hasSlug=false;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--require-ready')requireReady=true;
   else if(args[i]==='--output'){output=args[++i];if(!output||output.startsWith('--'))throw new Error('--output requires a file');}
   else if(!hasSlug&&(args[i]==='all'||RESORT_SLUGS.includes(args[i]))){selected=args[i];hasSlug=true;}
   else throw new Error(`Unknown argument ${args[i]}`);
  }
  const reports=(selected==='all'?RESORT_SLUGS:[selected]).map(slug=>checkCurrentEvidence(JSON.parse(fs.readFileSync(`docs/terrain/readiness/${slug}.json`,'utf8'))));
  const text=JSON.stringify(reports,null,2)+'\n';if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,text);}else process.stdout.write(text);
  if(requireReady&&reports.some(r=>r.status!=='ready-for-review'))process.exitCode=2;
 }catch(error){console.error(String(error));process.exitCode=1;}
}
