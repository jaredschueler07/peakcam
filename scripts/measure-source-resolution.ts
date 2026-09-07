/** Local resampling experiment on an original raster; never changes game assets. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { fromFile } from 'geotiff';
import { createGridSample, sampleGridBicubic } from '../lib/game/terrain/bicubic';
import { residualSummary } from './audit-terrain';
import type { Heightfield } from '../lib/game/terrain/formats';

export function compareSourceGrid(source:Float32Array,width:number,height:number,sourceSpacingM:number,spacingM:number){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||source.length!==width*height)throw new Error('Invalid source grid');
 if(!Number.isFinite(sourceSpacingM)||sourceSpacingM<=0||!Number.isFinite(spacingM)||spacingM<sourceSpacingM)throw new Error('Invalid spacing');
 if(source.some(h=>!Number.isFinite(h)||h < -500||h>9000))throw new Error('Missing or invalid source elevations');
 const scale=spacingM/sourceSpacingM,cw=Math.floor((width-1)/scale)+1,ch=Math.floor((height-1)/scale)+1;
 if(cw<6||ch<6)throw new Error('Window too small for requested spacing');
 const sample=(c:number,r:number)=>{
  const c0=Math.min(width-2,Math.floor(c)),r0=Math.min(height-2,Math.floor(r)),u=c-c0,v=r-r0,i=r0*width+c0;
  return source[i]*(1-u)*(1-v)+source[i+1]*u*(1-v)+source[i+width]*(1-u)*v+source[i+width+1]*u*v;
 };
 const heights=new Float32Array(cw*ch);
 for(let r=0;r<ch;r++)for(let c=0;c<cw;c++)heights[r*cw+c]=Math.round(sample(c*scale,r*scale)*10)/10;
 const field:Heightfield={width:cw,height:ch,sizeM:(cw-1)*spacingM,cellSizeM:spacingM,minZ:0,maxZ:9000,heights};
 const scratch=createGridSample(),errors:number[]=[];
 // Interior 3 m-ish probe lattice; no clamped source or extrapolated border values.
 const step=Math.max(1,Math.round(3/sourceSpacingM));
 const margin=Math.ceil(2*scale),lastCol=Math.floor((cw-3)*scale),lastRow=Math.floor((ch-3)*scale);
 for(let r=margin;r<=lastRow;r+=step)for(let c=margin;c<=lastCol;c+=step){
  const h=sampleGridBicubic(field,c/scale,r/scale,scratch).value;
  errors.push(h-source[r*width+c]);
 }
 return {spacingM,coarseGrid:{width:cw,height:ch},...residualSummary(errors)};
}
export async function measureSourceFile(file:string){
 if(fs.statSync(file).size>64*1024*1024)throw new Error('Use a bounded source window no larger than 64 MiB');
 const bytes=fs.readFileSync(file),tiff=await fromFile(file);
 try {
  const image=await tiff.getImage(),[dx,dy,dz]=image.getResolution();
  if(image.getWidth()*image.getHeight()>4_194_304)throw new Error('Use a source window of at most 4,194,304 pixels');
  if(!Number.isFinite(dx)||dx<=0||!Number.isFinite(dy)||dy>=0||Math.abs(dx+dy)>1e-8||dz!==0)throw new Error('Expected north-up square metric pixels');
  const keys=image.getGeoKeys(),epsg=keys?.ProjectedCSTypeGeoKey;
  if(!epsg||keys.ProjLinearUnitsGeoKey!==9001)throw new Error('Explicit projected CRS and metre units required');
  if(image.getFileDirectory().hasTag('ModelTransformation'))throw new Error('Rotated/transformed rasters require explicit normalization');
  if(image.getSamplesPerPixel()!==1)throw new Error('Expected one elevation band');
  const bands=await image.readRasters(),source=Float32Array.from(bands[0] as ArrayLike<number>),nodata=image.getGDALNoData();
  if(nodata!==null&&source.some(h=>h===nodata))throw new Error('Source window contains nodata; do not interpolate unmeasured coverage');
  const width=image.getWidth(),height=image.getHeight();
  return {schemaVersion:1,sourceFile:path.basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),projectedCrs:`EPSG:${epsg}`,bounds:image.getBoundingBox(),width,height,sourceSpacingM:dx,
   reference:'Original raster window in its native horizontal and vertical reference. No transformation between NAD83 and WGS84 is inferred.',
   method:'Local point-sampled bilinear reduction, 0.1 m elevation quantization, then game bicubic reconstruction compared to original raster nodes on an interior probe lattice.',
   limitations:['One local window does not establish whole-resort accuracy or coverage.','Point-sampled reduction is not an exact reproduction of GDAL full-mountain warp filtering.','Residuals measure processing loss against the source, not independent survey accuracy.','Separate spacing cases sample slightly different interior extents to avoid boundary extrapolation.'],
   experiments:[...new Set([dx,1,2,4,6144/1023,8])].filter(s=>s>=dx).map(s=>compareSourceGrid(source,width,height,dx,s))};
 }finally{await tiff.close();}
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const [file,flag,output,...extra]=process.argv.slice(2);
 if(!file||flag!=='--output'||!output||extra.length){console.error('Usage: tsx scripts/measure-source-resolution.ts original-window.tif --output report.json');process.exitCode=1;}
 else measureSourceFile(file).then(report=>{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}).catch(error=>{console.error(String(error));process.exitCode=1;});
}
