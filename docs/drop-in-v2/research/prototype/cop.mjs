import {fromUrl} from 'geotiff';
const U="https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S33_00_W071_00_DEM/Copernicus_DSM_COG_10_S33_00_W071_00_DEM.tif";
const t=await fromUrl(U);
const img=await t.getImage();
console.log("size",img.getWidth(),img.getHeight(),"bbox",img.getBoundingBox().map(v=>v.toFixed(4)).join(","),"res",img.getResolution().map(v=>v.toFixed(6)).join(","),"samples",img.getSamplesPerPixel(),"images",await t.getImageCount());
// window around Portillo -32.8375,-70.1289
const bb=img.getBoundingBox(), W=img.getWidth(), H=img.getHeight();
const px=(lon)=>Math.round((lon-bb[0])/(bb[2]-bb[0])*W), py=(lat)=>Math.round((bb[3]-lat)/(bb[3]-bb[1])*H);
const x0=px(-70.18),x1=px(-70.08),y0=py(-32.79),y1=py(-32.89);
const d=await img.readRasters({window:[x0,y0,x1,y1]});
const a=d[0]; let mn=1e9,mx=-1e9,frac=0;
for(const v of a){if(v<mn)mn=v;if(v>mx)mx=v;if(v%1!==0)frac++;}
console.log(`window ${d.width}x${d.height} min=${mn.toFixed(1)} max=${mx.toFixed(1)} fractionalValues=${frac}/${a.length}`);
