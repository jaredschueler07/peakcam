/** Reproducible source-fidelity audit; this is not a survey certification. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { localProjection } from './dem/local-projection';
import { createRealTerrain } from '../lib/game/terrain/real-heightfield';
import { DROP_IN_GAME_PROFILES } from '../lib/game/config/profiles';
import { COURSE_VERSION } from '../lib/game/config/versions';
import { RESORT_SLUGS } from '../lib/game/terrain/resorts';
import type { TerrainMeta, TrailsFile } from '../lib/game/terrain/formats';
import type { DropInResortSlug } from '../lib/game/config/schema';

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const finite = z.number().finite();
export const ControlFile = z.object({
  slug: z.enum(['breckenridge','heavenly','ski-portillo']),
  horizontalCrs: z.literal('EPSG:4326'),
  verticalDatum: z.string().min(1),
  source: z.string().min(1),
  surveyDate: z.iso.date(),
  independentOfDem: z.literal(true),
  // Tolerance is an explicit project choice, never inferred from raster spacing.
  toleranceM: finite.positive(),
  checkpoints: z.array(z.object({
    id: z.string().min(1), lat: finite.min(-90).max(90), lon: finite.min(-180).max(180),
    elevationM: finite, uncertaintyM: finite.nonnegative(),
  }).strict()).min(1),
}).strict();
export const SourceManifest = z.object({
  schemaVersion: z.literal(1),
  slug: z.enum(['breckenridge','heavenly','ski-portillo']),
  sourceGridSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceMetaSha256: z.string().regex(/^[a-f0-9]{64}$/),
  verticalDatum: z.string().min(1),
  verticalDatumVerified: z.boolean(),
  datumEvidence: z.string(),
  sourceReference: z.string().url(),
  limitations: z.array(z.string()),
}).strict().refine(v => !v.verticalDatumVerified || v.datumEvidence.trim().length > 0, 'Verified datum requires dataset-specific evidence');

export function residualSummary(errors: readonly number[]) {
  if (!errors.length || errors.some(e => !Number.isFinite(e))) throw new Error('Finite nonempty residuals required');
  const absolute = errors.map(Math.abs).sort((a,b)=>a-b);
  return { count: errors.length, biasM: errors.reduce((s,e)=>s+e,0)/errors.length,
    rmseM: Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),
    p95AbsoluteM: absolute[Math.ceil(absolute.length*.95)-1], maxAbsoluteM: absolute.at(-1)! };
}

export function compareControls(input: unknown, slug: string, sizeM: number,
  projection: ReturnType<typeof localProjection>, height: (x:number,z:number)=>number,
  datum: {verticalDatum:string;verticalDatumVerified:boolean}) {
  const controls = ControlFile.parse(input);
  if (controls.slug !== slug) throw new Error('Checkpoint resort mismatch');
  if (!datum.verticalDatumVerified || controls.verticalDatum !== datum.verticalDatum) throw new Error('Verified, matching vertical datums required; no guessed offset is permitted');
  const ids = new Set<string>(), locations = new Set<string>();
  const rows = controls.checkpoints.map(c => {
    const [x,y] = projection.forward(c.lat,c.lon);
    if (Math.abs(x)>sizeM/2 || Math.abs(y)>sizeM/2) throw new Error(`Checkpoint ${c.id} outside DEM; edge clamping would invalidate comparison`);
    const location = `${c.lat},${c.lon}`;
    if (ids.has(c.id) || locations.has(location)) throw new Error('Duplicate checkpoint');
    ids.add(c.id); locations.add(location);
    const sampledM = height(x,-y);
    if (!Number.isFinite(sampledM)) throw new Error('Nonfinite terrain sample');
    return {...c,x,z:-y,sampledM,residualM:sampledM-c.elevationM};
  });
  const summary = residualSummary(rows.map(r=>r.residualM));
  return { source: controls.source, surveyDate: controls.surveyDate, verticalDatum: controls.verticalDatum,
    toleranceM: controls.toleranceM, summary,
    withinTolerance: rows.every(r=>Math.abs(r.residualM)+r.uncertaintyM<=controls.toleranceM),
    note: 'Vertical checkpoint comparison only. Coverage, survey uncertainty, horizontal accuracy and fitness for purpose require independent review. No certification is issued.', rows };
}

export function auditResort(slug: DropInResortSlug, controls?: unknown) {
  const dir = 'public/game/terrain';
  const sourceMetaBytes = fs.readFileSync(`scripts/data/dem/${slug}.meta.json`);
  const sourceMeta = JSON.parse(sourceMetaBytes.toString()) as TerrainMeta;
  const meta = JSON.parse(fs.readFileSync(`${dir}/${slug}.meta.json`,'utf8')) as TerrainMeta;
  const manifest = SourceManifest.parse(JSON.parse(fs.readFileSync(`scripts/data/dem/${slug}.provenance.json`,'utf8')));
  const source = brotliDecompressSync(fs.readFileSync(`scripts/data/dem/${slug}.height.u16.br`));
  const runtime = brotliDecompressSync(fs.readFileSync(`${dir}/${slug}.height.u16.br`));
  if (manifest.slug !== slug || sha256(source)!==manifest.sourceGridSha256 || sha256(sourceMetaBytes)!==manifest.sourceMetaSha256) throw new Error(`${slug}: immutable source fingerprint mismatch`);
  for (const key of ['grid','sizeM','minZ','quantum','epsg','orientation','center'] as const) {
    if (JSON.stringify(meta[key]) !== JSON.stringify(sourceMeta[key])) throw new Error(`${slug}: decoding metadata changed: ${key}`);
  }
  if (meta.epsg === null || meta.epsg !== localProjection(meta.center).epsg) throw new Error(`${slug}: unsupported or mismatched DEM CRS`);
  const sourceEqual = source.equals(runtime);
  if (!sourceEqual) throw new Error(`${slug}: runtime elevations differ from immutable source grid`);
  const trailsBytes=fs.readFileSync(`${dir}/${slug}.trails.json`);
  const trails = JSON.parse(trailsBytes.toString()) as TrailsFile;
  const terrain = createRealTerrain(runtime.buffer.slice(runtime.byteOffset,runtime.byteOffset+runtime.length) as ArrayBuffer, meta, trails, {profile:DROP_IN_GAME_PROFILES[slug]});
  const projection = localProjection(meta.center,meta.epsg);
  let maxRuntimeOffsetM=0, maxInterpolationOvershootM=0;
  // Deterministic subcell probes, covering the box. Overshoot is reported, not hidden.
  for(let i=0;i<10000;i++) {
    const col=(i*0.61803398875%1)*(meta.grid-1), row=(i*0.41421356237%1)*(meta.grid-1);
    const x=-meta.sizeM/2+col*terrain.field.cellSizeM,z=-meta.sizeM/2+row*terrain.field.cellSizeM;
    const h=terrain.height(x,z);
    maxRuntimeOffsetM=Math.max(maxRuntimeOffsetM,Math.abs(h-terrain.macroHeight(x,z)));
    const c=Math.min(meta.grid-2,Math.floor(col)),r=Math.min(meta.grid-2,Math.floor(row)),n=r*meta.grid+c;
    const neighbors=[terrain.field.heights[n],terrain.field.heights[n+1],terrain.field.heights[n+meta.grid],terrain.field.heights[n+meta.grid+1]];
    maxInterpolationOvershootM=Math.max(maxInterpolationOvershootM,h-Math.max(...neighbors),Math.min(...neighbors)-h);
  }
  if (maxRuntimeOffsetM !== 0 || terrain.realRuns!.some(r=>r.ramps.length)) throw new Error(`${slug}: invented physical relief detected`);
  const checkpoints=controls===undefined?null:compareControls(controls,slug,meta.sizeM,projection,terrain.height,manifest);
  return {
    schemaVersion:1,slug,courseVersion:COURSE_VERSION,accuracyStatus:'not-survey-certified',
    sourceFidelity:{identicalDecodedElevations:sourceEqual,samples:meta.grid*meta.grid,sourceGridSha256:sha256(source),sourceMetaSha256:sha256(sourceMetaBytes),runtimeGridSha256:sha256(runtime),trailsSha256:sha256(trailsBytes),maxRuntimeOffsetM},
    coordinates:{horizontalCrs:`EPSG:${meta.epsg}`,originEastingM:projection.origin[0],originNorthingM:projection.origin[1],verticalDatum:manifest.verticalDatum,verticalDatumVerified:manifest.verticalDatumVerified,datumEvidence:manifest.datumEvidence,verticalTransformApplied:false,verticalScale:1,units:'UTM grid metres; elevations in source vertical datum metres'},
    resolution:{sourceSpacingM:meta.sourceResolutionM,runtimeSpacingM:terrain.field.cellSizeM,quantumM:meta.quantum,quantizationMaxM:meta.quantum/2,subcellProbeCount:10000,maxInterpolationOvershootM},
    checkpoints,
    limitations:[...manifest.limitations,'UTM grid distances have projection scale distortion; no claim of exact ground-distance scale.','Catmull-Rom interpolation and render mesh LOD can deviate from measured ground between samples.','OSM positions, widths, forest planting and landmark dimensions are not independently surveyed.','No snow-depth survey; this represents source ground/surface elevations, not measured current snow.'],
    routes:terrain.realRuns!.map(r=>({id:r.id,name:r.name,lengthM:r.lengthM,topElevationM:r.topElevationM,bottomElevationM:r.bottomElevationM,dropM:r.points[0].y-r.points.at(-1)!.y,startLatLon:projection.inverse(r.points[0].x,-r.points[0].z),finishLatLon:projection.inverse(r.points.at(-1)!.x,-r.points.at(-1)!.z),reference:'Derived from OSM and this DEM; not independent validation'})),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]??'').href) {
  try {
    const args=process.argv.slice(2), controlAt=args.indexOf('--controls'), outputAt=args.indexOf('--output');
    const readOption=(at:number)=>{if(at<0)return undefined;const value=args[at+1];if(!value||value.startsWith('--'))throw new Error('Option requires a filename');return value;};
    const controlPath=readOption(controlAt),output=readOption(outputAt);
    const allowed=new Set<number>();
    const summaryAt=args.indexOf('--summary'); if(summaryAt>=0)allowed.add(summaryAt);
    for (const at of [controlAt,outputAt]) if(at>=0){allowed.add(at);allowed.add(at+1);}
    const positional=args.filter((_,i)=>!allowed.has(i));
    if(positional.length>1 || positional.some(v=>v!=='all'&&!RESORT_SLUGS.includes(v)))throw new Error('Usage: tsx scripts/audit-terrain.ts [all|slug] [--controls file.json] [--output report.json]');
    const selected=positional[0]??'all';
    if(controlPath&&selected==='all')throw new Error('--controls requires one explicit resort');
    const reports=(selected==='all'?RESORT_SLUGS:[selected]).map(slug=>auditResort(slug as DropInResortSlug,controlPath?JSON.parse(fs.readFileSync(controlPath,'utf8')):undefined));
    const result=JSON.stringify(args.includes('--summary')?reports.map(({routes,...report})=>({...report,routeCount:routes.length})):reports,null,2)+'\n';
    if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result);}else process.stdout.write(result);
    if(reports.some(r=>r.checkpoints&&!r.checkpoints.withinTolerance))process.exitCode=1;
  } catch(error) { console.error(String(error)); process.exitCode=1; }
}
