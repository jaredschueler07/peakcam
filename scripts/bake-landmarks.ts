/** Offline geometry bake from cached OSM. No network in build/runtime. */
import fs from 'node:fs';
import { brotliDecompressSync, brotliCompressSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { RESORT_BAKE_CONFIGS, M_PER_DEG_LAT, mPerDegLon } from '../lib/game/terrain/resorts';
import { decodeHeightfield, type TerrainMeta } from '../lib/game/terrain/formats';
import { decodeFarField } from '../lib/game/terrain/far-field-format';
import { rdp, type Pt } from './bake-resort';
interface Geo {lat:number;lon:number}
interface Element {type:string;id:number;tags?:Record<string,string>;geometry?:Geo[];members?:{role:string;geometry?:Geo[]}[]}
export const LANDMARK_RADIUS_M=29500;
export function stitchRings(parts:Pt[][]):Pt[][] {
  const pending=parts.map(p=>p.slice()),rings:Pt[][]=[];
  const equal=(a:Pt,b:Pt)=>Math.hypot(a[0]-b[0],a[1]-b[1])<.01;
  while(pending.length){
    const ring=pending.shift()!;
    while(!equal(ring[0],ring.at(-1)!)){
      const at=pending.findIndex(p=>equal(p[0],ring.at(-1)!)||equal(p.at(-1)!,ring.at(-1)!));
      if(at<0)throw new Error('OSM landmark ring is not closed');
      const piece=pending.splice(at,1)[0];if(!equal(piece[0],ring.at(-1)!))piece.reverse();ring.push(...piece.slice(1));
    }
    rings.push(ring);
  }
  return rings;
}
/** Clip a polygon against a convex half-plane, preserving actual shoreline arcs. */
export function clipHalfPlane(points:Pt[],nx:number,nz:number,limit:number):Pt[] {
  const result:Pt[]=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],da=a[0]*nx+a[1]*nz-limit,db=b[0]*nx+b[1]*nz-limit;
    if(da<=0)result.push(a);
    if((da<=0)!==(db<=0)){const t=da/(da-db);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
  }
  return result;
}
export function clipFarField(points:Pt[]):Pt[] {
  let out=points.slice(0,-1);
  for(let i=0;i<48;i++){const angle=i*Math.PI*2/48;out=clipHalfPlane(out,Math.cos(angle),Math.sin(angle),LANDMARK_RADIUS_M*Math.cos(Math.PI/48));}
  return out.length?[...out,out[0]]:[];
}
export function insidePolygon(point:Pt,ring:Pt[]):boolean {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function load(name:string):{osm3s:{timestamp_osm_base:string};elements:Element[]} {
  return JSON.parse(brotliDecompressSync(fs.readFileSync(`scripts/data/landmarks/${name}.json.br`)).toString());
}
function project(slug:string,g:Geo):Pt {
  const center=RESORT_BAKE_CONFIGS[slug].center;
  // Exactly the geographic ENU projection used for the source trail pack;
  // game Z is minus asset northing. Do not mix absolute UTM coordinates here.
  return [Math.round((g.lon-center[1])*mPerDegLon(center[0])*10)/10,Math.round(-(g.lat-center[0])*M_PER_DEG_LAT*10)/10];
}
function lake(slug:string,element:Element,timestamp:string){
  const outerParts=element.geometry?[element.geometry.map(g=>project(slug,g))]:element.members!.filter(m=>m.role==='outer'&&m.geometry).map(m=>m.geometry!.map(g=>project(slug,g)));
  const innerParts=element.members?.filter(m=>m.role==='inner'&&m.geometry).map(m=>m.geometry!.map(g=>project(slug,g)))??[];
  const original=stitchRings(outerParts);if(original.length!==1)throw new Error('Expected one lake exterior');
  const holes=stitchRings(innerParts);
  let epsilon=slug==='heavenly'?35:5,outer=clipFarField(rdp(original[0],epsilon));
  while(outer.length>(slug==='ski-portillo'?80:90)){epsilon*=1.35;outer=clipFarField(rdp(original[0],epsilon));}
  const retainedHoles=holes.map(h=>clipFarField(rdp(h,Math.min(epsilon,10)))).filter(h=>h.length>=4&&insidePolygon(h[0],outer));
  const far=decodeFarField(brotliDecompressSync(fs.readFileSync(`public/game/terrain/${slug}.far.bin.br`)));
  const heights:number[]=[];
  for(const wedge of far.wedges)for(let i=0;i<wedge.positions.length;i+=3){const point:Pt=[wedge.positions[i],wedge.positions[i+2]];if(insidePolygon(point,outer)&&!retainedHoles.some(h=>insidePolygon(point,h)))heights.push(wedge.positions[i+1]);}
  const meta=JSON.parse(fs.readFileSync(`public/game/terrain/${slug}.meta.json`,'utf8')) as TerrainMeta;
  const bytes=brotliDecompressSync(fs.readFileSync(`public/game/terrain/${slug}.height.u16.br`));
  const field=decodeHeightfield(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length) as ArrayBuffer,meta);
  const nearHeights:number[]=[];
  for(let row=0;row<field.height;row+=8)for(let col=0;col<field.width;col+=8){
    const point:Pt=[-field.sizeM/2+col*field.cellSizeM,-field.sizeM/2+row*field.cellSizeM];
    if(insidePolygon(point,outer)&&!retainedHoles.some(h=>insidePolygon(point,h)))nearHeights.push(field.heights[row*field.width+col]);
  }
  // Near-field DEM wins where it contains water, so a lower-resolution distant
  // datum cannot hide the lake under the playable surface (Portillo differs ~20m).
  if(nearHeights.length>=8){heights.length=0;heights.push(...nearHeights);}
  if(!heights.length)throw new Error(`No baked DEM support for ${slug} lake`);
  heights.sort((a,b)=>a-b);
  const elevationM=Math.round((heights[Math.floor(heights.length*.3)]+.45)*10)/10;
  return {name:element.tags!.name,sourceId:`osm:${element.type}:${element.id}`,retrievedAt:timestamp,outer,holes:retainedHoles,elevationM,sourceElevationM:Number(element.tags?.ele)||null,elevationSource:`Baked ${nearHeights.length>=8?'near-field':'far-field'} lake-interior DEM 30th percentile + 0.45 m anti-z-fighting offset; source vertical datum alignment, not surveyed water level.`,radiusM:LANDMARK_RADIUS_M,simplificationM:epsilon};
}
export function bakeLandmarks(verify=false):void {
  const portillo=load('portillo'),tahoe=load('tahoe');
  const hotel=portillo.elements.find(e=>e.id===272711273)!;if(!hotel?.geometry)throw new Error('Hotel OSM footprint missing');
  const footprint=hotel.geometry.map(g=>project('ski-portillo',g));
  const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1]);
  const center:Pt=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...zs)+Math.max(...zs))/2];
  const output={version:1,projection:'local geographic ENU per resorts.ts; gameZ=-assetY',licence:'OpenStreetMap contributors, ODbL 1.0',lakes:{'ski-portillo':lake('ski-portillo',portillo.elements.find(e=>e.id===25749554)!,portillo.osm3s.timestamp_osm_base),heavenly:lake('heavenly',tahoe.elements.find(e=>e.id===1823287)!,tahoe.osm3s.timestamp_osm_base)},hotel:{sourceId:'osm:way:272711273',footprint,center,main:clipHalfPlane(footprint.slice(0,-1),0,1,-744),annex:clipHalfPlane(footprint.slice(0,-1),0,-1,744),mainHeightM:18,annexHeightM:5.5,tower:{x:3,z:-742,width:8,depth:8,height:22},reference:'https://skiportillo.com/en/ski-lodging/skiing-hotel-portillo/',referenceImage:'https://skiportillo.com/wp-content/uploads/2023/12/All-Inclusive-Resort-Hotel-Ski-Portillo.jpg',note:'OSM footprint and location. Six-storey yellow main body, low front annex and blue tower proportions inferred from the official photograph; heights and height split are illustrative, not surveyed. Reference image is not redistributed.'}};
  const data=Buffer.from(JSON.stringify(output));if(brotliCompressSync(data).length>16000)throw new Error('Landmark shared asset exceeds 16 KB brotli');
  for(const slug of Object.keys(RESORT_BAKE_CONFIGS)) {
    const dir='public/game/terrain/';
    const packed=['height.u16.br','trails.json.br','far.bin.br'].reduce((sum,suffix)=>sum+fs.statSync(`${dir}${slug}.${suffix}`).size,0);
    const catalog=brotliCompressSync(fs.readFileSync(`${dir}${slug}.network.json`)).length;
    if(packed+catalog+brotliCompressSync(data).length>1.5*1024*1024)throw new Error(`Shared landmark pushes ${slug} above existing 1.5 MiB pack guard`);
  }
  const filename='public/game/terrain/landmarks.json';
  if(verify){if(!fs.readFileSync(filename).equals(data))throw new Error('Landmark bake differs');}else fs.writeFileSync(filename,data);
  console.log(JSON.stringify({bytes:data.length,brotli:brotliCompressSync(data).length,lakes:Object.fromEntries(Object.entries(output.lakes).map(([s,l])=>[s,{vertices:l.outer.length,elevationM:l.elevationM}]))}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)bakeLandmarks(process.argv.includes('--verify'));
