/** Offline comparison of Float32 rendered triangles to the shared physical surface. */
import fs from 'node:fs';
import path from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRealTerrain } from '../lib/game/terrain/real-heightfield';
import { pointAtArcLength } from '../lib/game/terrain/real-course';
import { DROP_IN_GAME_PROFILES } from '../lib/game/config/profiles';
import { COURSE_VERSION } from '../lib/game/config/versions';
import { RESORT_SLUGS } from '../lib/game/terrain/resorts';
import { TILE_SIZE, GRID_SIZE } from '../lib/game/rendering/nearFieldReach';
import { residualSummary } from './audit-terrain';
import type { DropInResortSlug } from '../lib/game/config/schema';
import type { TerrainMeta, TrailsFile } from '../lib/game/terrain/formats';

type Point={x:number;z:number};
export function triangleHeight(height:(x:number,z:number)=>number,x:number,z:number,spacingM:number):number {
 if(!Number.isFinite(spacingM)||spacingM<=0)throw new Error('Positive finite spacing required');
 if(!Number.isFinite(x)||!Number.isFinite(z))throw new Error('Point must be finite');
 const ax=Math.floor(x/spacingM)*spacingM,az=Math.floor(z/spacingM)*spacingM;
 // Float32 vertices, same b-c diagonal and interpolation as TerrainRenderer.
 const a=Math.fround(height(ax,az)),b=Math.fround(height(ax+spacingM,az)),c=Math.fround(height(ax,az+spacingM)),d=Math.fround(height(ax+spacingM,az+spacingM));
 if(![a,b,c,d].every(Number.isFinite))throw new Error('Mesh vertices must be finite');
 const u=(x-ax)/spacingM,v=(z-az)/spacingM;
 return u+v<=1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
}
export function measureSurface(height:(x:number,z:number)=>number,points:readonly Point[],spacingM:number) {
 if(!points.length)throw new Error('Nonempty measured points required');
 const errors=points.map(p=>triangleHeight(height,p.x,p.z,spacingM)-height(p.x,p.z));
 return {spacingM,...residualSummary(errors)};
}
export function measureResort(slug:DropInResortSlug) {
 const dir='public/game/terrain',bytes=brotliDecompressSync(fs.readFileSync(`${dir}/${slug}.height.u16.br`));
 const meta=JSON.parse(fs.readFileSync(`${dir}/${slug}.meta.json`,'utf8')) as TerrainMeta;
 const trailBytes=fs.readFileSync(`${dir}/${slug}.trails.json`);
 const trails=JSON.parse(trailBytes.toString()) as TrailsFile;
 const terrain=createRealTerrain(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length) as ArrayBuffer,meta,trails,{profile:DROP_IN_GAME_PROFILES[slug]});
 const all:Point[]=[],routes=[];
 let omittedEdgeSamples=0;
 for(const run of terrain.realRuns!){
  const points:Point[]=[];
  // Every selected named piece, centre and +/-5 m laterally, at <=25 m intervals.
  const segments=Math.max(1,Math.ceil(run.lengthM/25));
  for(let i=0;i<=segments;i++){
   const p=pointAtArcLength(run.points,run.lengthM*i/segments),rx=Math.cos(p.heading),rz=-Math.sin(p.heading);
   for(const side of [-5,0,5]){
    const sample={x:p.x+side*rx,z:p.z+side*rz};
    // All four corners at every tested spacing must remain inside measured coverage.
    if(Math.abs(sample.x)>meta.sizeM/2-8||Math.abs(sample.z)>meta.sizeM/2-8){omittedEdgeSamples++;continue;}
    points.push(sample);all.push(sample);
   }
  }
  if(points.length)routes.push({id:run.id,name:run.name,lengthM:run.lengthM,samples:points.length,meshes:[4,8].map(s=>measureSurface(terrain.height,points,s))});
 }
 const meshes=[1,2,4,8].map(spacing=>({...measureSurface(terrain.height,all,spacing),
  fullWindowTerrainTriangles:2*(TILE_SIZE/spacing)**2*GRID_SIZE**2,
  terrainAloneBelowMobileTriangleCeiling:2*(TILE_SIZE/spacing)**2*GRID_SIZE**2<150000}));
 return {schemaVersion:1,slug,courseVersion:COURSE_VERSION,sourceGridSha256:createHash('sha256').update(bytes).digest('hex'),trailsSha256:createHash('sha256').update(trailBytes).digest('hex'),
  reference:'Existing bicubic physical sampler over resampled DEM; not independent measured ground.',
  method:'Float32 vertices with actual renderer triangle split; projected x/z aligned at spacing multiples. Current desktop uses 4 m, mobile uses 8 m. Hypothetical 1/2 m grids are offline experiments only.',
  limitations:['Route sampling is not an exhaustive maximum error proof.','This does not measure the DEM against original LiDAR or surveyed checkpoints.','Normals, fog, shadows and GPU rasterization are not measured.','Triangle estimates include terrain only; trees, avatar and infrastructure also consume the mobile budget.'],
  sampleCount:all.length,omittedEdgeSamples,meshes,routes};
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try {
  const args=process.argv.slice(2);let slug='all',hasSlug=false,output:string|undefined,summary=false;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--summary')summary=true;
   else if(args[i]==='--output'){output=args[++i];if(!output||output.startsWith('--'))throw new Error('--output requires a file');}
   else if(!hasSlug&&(args[i]==='all'||RESORT_SLUGS.includes(args[i]))){slug=args[i];hasSlug=true;}
   else throw new Error(`Unknown argument ${args[i]}`);
  }
  const reports=(slug==='all'?RESORT_SLUGS:[slug]).map(s=>measureResort(s as DropInResortSlug));
  const text=JSON.stringify(summary?reports.map(({routes,...r})=>({...r,routeCount:routes.length})):reports,null,2)+'\n';
  if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,text);}else process.stdout.write(text);
 }catch(error){console.error(String(error));process.exitCode=1;}
}
