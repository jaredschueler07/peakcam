/** Offline OSM network rebake. Reuses committed DEM; never fetches DEM or OSM.
 * Cache refresh is deliberate: save Overpass `out geom` JSON to scripts/data/osm.
 * Run: npx tsx scripts/bake-mountain-network.ts [all|slug] [--verify]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { clipPolylineToBox, rdp, type Pt } from './bake-resort';
import { decodeHeightfield, encodeDelta, sampleHeightBilinear, type TerrainMeta, type TrailsFile, type RawRun, type RawLift, type Heightfield } from '../lib/game/terrain/formats';
import { RESORT_BAKE_CONFIGS, mPerDegLon, M_PER_DEG_LAT, type ResortBakeConfig } from '../lib/game/terrain/resorts';
import { createRealTerrain } from '../lib/game/terrain/real-heightfield';
import { DROP_IN_GAME_PROFILES } from '../lib/game/config/profiles';
import type { DropInResortSlug } from '../lib/game/config/schema';

export interface OsmElement { type: string; id: number; lat?: number; lon?: number; nodes?: number[]; tags?: Record<string,string>; geometry?: {lat:number;lon:number}[] }
export interface OsmSource { osm3s?: { timestamp_osm_base?: string }; elements: OsmElement[] }
export const DEFAULT_WIDTHS: Record<string,number> = { novice: 32, easy: 30, intermediate: 28, advanced: 22, expert: 18, freeride: 24 };
/** Engineering defaults, not claims about the installed machinery. */
export const DEFAULT_SPEEDS: Record<string,number> = { chair_lift: 2.5, gondola: 5, cable_car: 5, mixed_lift: 4, platter: 2, 't-bar': 2, drag_lift: 2, rope_tow: 1.5, magic_carpet: 0.7 };
const rounded = (v:number) => Math.round(v*10)/10;
export function bakeMountainNetwork(cfg: ResortBakeConfig, source: OsmSource, field: Heightfield): TrailsFile {
  const project = (g:{lat:number;lon:number}): Pt => [rounded((g.lon-cfg.center[1])*mPerDegLon(cfg.center[0])),rounded((g.lat-cfg.center[0])*M_PER_DEG_LAT)];
  const elev = (p:Pt) => rounded(sampleHeightBilinear(field,...p));
  const file: TrailsFile = {v:2,center:cfg.center,sizeM:cfg.sizeM,unit:0.1,convention:cfg.convention,runs:[],lifts:[],junctions:[],forests:[],provenance:{source:'OpenStreetMap / Overpass cached out geom; ODbL 1.0',retrievedAt:source.osm3s?.timestamp_osm_base ?? 'unknown',gaps:['Widths without OSM width use difficulty defaults; missing grooming uses difficulty inference.', 'Lift speed without OSM aerialway:speed uses documented type defaults; occupancy remains null when unmapped.', 'Station bounds are 12 m gameplay loading zones around source line endpoints, not surveyed building footprints.', 'Closed piste areas retain their boundary; playable descent follows the shorter high-to-low boundary arc, not a surveyed centreline.', 'Forest multipolygon relations are not included; only closed ways wholly inside the DEM are retained.']}};
  const nodes = new Map(source.elements.filter(e=>e.type==='node').map(e=>[e.id,e]));
  for(const el of [...source.elements].sort((a,b)=>a.id-b.id)) {
    if(el.type!=='way'||!el.geometry||el.geometry.length<2)continue;
    const tags=el.tags??{}, points=el.geometry.map(project), sourceId=`osm:way:${el.id}`;
    if(tags.natural==='wood'||tags.landuse==='forest'){
      if(points.length>3 && points[0][0]===points.at(-1)![0]&&points[0][1]===points.at(-1)![1]&&points.every(p=>p.every(v=>Math.abs(v)<=cfg.sizeM/2)))file.forests!.push({sourceId,points:rdp(points,3).map(([x,y])=>({x,y}))});
      continue;
    }
    const isRun=tags['piste:type']==='downhill';
    if(!isRun && !(tags.aerialway in DEFAULT_SPEEDS)) continue;
    clipPolylineToBox(points,cfg.sizeM/2).forEach((piece,part)=>{
      const simplified=rdp(piece,2);
      if(isRun?elev(simplified[0])<elev(simplified.at(-1)!):elev(simplified[0])>elev(simplified.at(-1)!))simplified.reverse();
      const common={id:`${sourceId}:${part}`,sourceId,n:tags.name??tags['piste:name']??null,p:encodeDelta(simplified.map(([x,y])=>[Math.round(x*10),Math.round(y*10)]))};
      if(isRun){
        const d=tags['piste:difficulty']??null, width=Number.parseFloat(tags['piste:width']??tags.width??'');
        const run:RawRun={...common,d,g:tags['piste:grooming']??(['advanced','expert','freeride'].includes(d??'')?'backcountry':'classic'),widthM:Number.isFinite(width)&&width>0?Math.min(150,width):DEFAULT_WIDTHS[d??'']??28,widthSource:Number.isFinite(width)&&width>0?'osm':'difficulty-default',topElevationM:elev(simplified[0]),bottomElevationM:elev(simplified.at(-1)!)};
        if(tags.gladed==='yes')run.gl=1;
        if(tags.oneway==='yes'||tags['piste:oneway']==='yes')run.o=1;
        file.runs.push(run);
      }else{
        const speed=Number.parseFloat(tags['aerialway:speed']??''), occupancy=Number.parseInt(tags['aerialway:occupancy']??'',10);
        const lift:RawLift={...common,t:tags.aerialway,occupancy:Number.isFinite(occupancy)?occupancy:null,speedMps:Number.isFinite(speed)&&speed>0?speed:DEFAULT_SPEEDS[tags.aerialway],speedSource:Number.isFinite(speed)&&speed>0?'osm':'type-default',towers:[],stations:[simplified[0],simplified.at(-1)!].map(p=>({x:p[0],y:p[1],elevationM:elev(p),radiusM:12}))};
        for(const nodeId of el.nodes??[]){const node=nodes.get(nodeId);if(node?.tags?.aerialway==='pylon'&&node.lat!==undefined&&node.lon!==undefined){const [x,y]=project({lat:node.lat,lon:node.lon});if(Math.abs(x)<=cfg.sizeM/2&&Math.abs(y)<=cfg.sizeM/2)lift.towers!.push({x,y});}}
        file.lifts.push(lift);
      }
    });
  }
  file.runs.sort((a,b)=>(b.topElevationM??0)-(a.topElevationM??0)||(a.id!<b.id!?-1:1));
  // Shared source vertices establish topology. No invented junctions between
  // visually close but grade-separated trails.
  const vertices=new Map<string,{x:number;y:number;runIds:Set<string>}>();
  for(const run of file.runs){let x=0,y=0;for(let i=0;i<run.p.length;i+=2){x+=run.p[i];y+=run.p[i+1];const key=`${x},${y}`,v=vertices.get(key)??{x:x/10,y:y/10,runIds:new Set<string>()};v.runIds.add(run.id!);vertices.set(key,v);}}
  for(const [key,v] of vertices)if(v.runIds.size>1)file.junctions!.push({id:`junction:${key}`,x:v.x,y:v.y,runIds:[...v.runIds].sort()});
  return file;
}

export function runBake(slug:string,verify=false):void{
  const cfg=RESORT_BAKE_CONFIGS[slug];if(!cfg)throw new Error(`Unknown resort ${slug}`);
  const dir=path.resolve('public/game/terrain'), sourceBytes=fs.readFileSync(`scripts/data/osm/${slug}.json.br`), source=JSON.parse(brotliDecompressSync(sourceBytes).toString()) as OsmSource;
  const meta=JSON.parse(fs.readFileSync(`${dir}/${slug}.meta.json`,'utf8')) as TerrainMeta;
  const bytes=brotliDecompressSync(fs.readFileSync(`${dir}/${slug}.height.u16.br`));
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  const network=bakeMountainNetwork(cfg,source,decodeHeightfield(buffer,meta));
  const terrain=createRealTerrain(buffer,meta,network,{profile:DROP_IN_GAME_PROFILES[slug as DropInResortSlug]});
  const catalog={version:3,slug,sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),runs:terrain.realRuns!.map((r,index)=>({index,id:r.id,name:r.name,difficulty:r.difficulty,sourceIndex:r.sourceIndex,topElevationM:rounded(r.points[0].y),bottomElevationM:rounded(r.points.at(-1)!.y),lengthM:rounded(r.lengthM),widthM:r.halfWidthM*2})),lifts:network.lifts.map(l=>({id:l.id,name:l.n,type:l.t})),gaps:network.provenance!.gaps};
  const json=Buffer.from(JSON.stringify(network));const output=new Map<string,Buffer>([[`${slug}.trails.json`,json],[`${slug}.trails.json.br`,brotliCompressSync(json,{params:{[constants.BROTLI_PARAM_QUALITY]:11}})],[`${slug}.network.json`,Buffer.from(JSON.stringify(catalog))]]);
  const packSize = fs.statSync(`${dir}/${slug}.height.u16.br`).size + fs.statSync(`${dir}/${slug}.far.bin.br`).size + output.get(`${slug}.trails.json.br`)!.length + brotliCompressSync(output.get(`${slug}.network.json`)!).length;
  if (packSize > 1.5 * 1024 * 1024) throw new Error(`Terrain budget exceeded: ${packSize}`);
  for(const [name,data]of output){if(verify){if(!fs.readFileSync(`${dir}/${name}`).equals(data))throw new Error(`Non-reproducible ${name}`);}else fs.writeFileSync(`${dir}/${name}`,data);}
  console.log(`${slug}: ${catalog.runs.length} selectable pieces, ${network.runs.length} runs, ${network.lifts.length} lifts, ${network.junctions!.length} junctions, ${network.forests!.length} forest polygons`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){for(const slug of process.argv[2]&&process.argv[2]!=='all'?[process.argv[2]]:Object.keys(RESORT_BAKE_CONFIGS))runBake(slug,process.argv.includes('--verify'));}
