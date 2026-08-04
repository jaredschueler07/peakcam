import {PNG} from 'pngjs'; import {fromUrl} from 'geotiff';
const lon2px=(lon,z)=>(lon+180)/360*Math.pow(2,z)*256;
const lat2px=(lat,z)=>{const s=Math.sin(lat*Math.PI/180);return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*Math.pow(2,z)*256;};
const cache=new Map();
async function terr(lat,lon,z){
  const px=lon2px(lon,z),py=lat2px(lat,z),tx=Math.floor(px/256),ty=Math.floor(py/256),k=`${z}/${tx}/${ty}`;
  if(!cache.has(k)){const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`);cache.set(k,PNG.sync.read(Buffer.from(await r.arrayBuffer())));}
  const p=cache.get(k),xx=Math.floor(px)%256,yy=Math.floor(py)%256,i=(yy*256+xx)*4;
  return p.data[i]*256+p.data[i+1]+p.data[i+2]/256-32768;
}
async function copSampler(tif){
  const t=await fromUrl(tif), img=await t.getImage(), bb=img.getBoundingBox(), W=img.getWidth(), H=img.getHeight();
  return async (lat,lon)=>{const x=Math.round((lon-bb[0])/(bb[2]-bb[0])*W),y=Math.round((bb[3]-lat)/(bb[3]-bb[1])*H);
    const d=await img.readRasters({window:[x,y,x+1,y+1]}); return d[0][0];};
}
async function transect(name,a,b,tif,z){
  const cop=await copSampler(tif); const N=64; const T=[],C=[];
  for(let i=0;i<=N;i++){const f=i/N,la=a[0]+(b[0]-a[0])*f,lo=a[1]+(b[1]-a[1])*f;
    T.push(await terr(la,lo,z)); C.push(await cop(la,lo));}
  const stat=(v)=>{let d2=0;for(let i=1;i<v.length-1;i++)d2+=Math.abs(v[i]-(v[i-1]+v[i+1])/2);
    return `top=${v[0].toFixed(0)} bot=${v[v.length-1].toFixed(0)} drop=${(v[0]-v[v.length-1]).toFixed(0)}m rough=${(d2/(v.length-2)).toFixed(2)}`;}
  let bias=0;for(let i=0;i<=N;i++)bias+=C[i]-T[i];
  console.log(`\n${name} (z${z}, ${N+1} samples)`);
  console.log(`  terrarium : ${stat(T)}`);
  console.log(`  copernicus: ${stat(C)}`);
  console.log(`  mean(cop - terrarium) = ${(bias/(N+1)).toFixed(1)} m`);
}
// Breck: Imperial Express summit -> Peak 8 base
await transect("Breckenridge Peak8 descent",[39.4646,-106.0700],[39.4830,-106.0680],
  "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N39_00_W107_00_DEM/Copernicus_DSM_COG_10_N39_00_W107_00_DEM.tif",14);
// Heavenly: Sky Express top -> California Lodge
await transect("Heavenly Gunbarrel descent",[38.9310,-119.9260],[38.9560,-119.9410],
  "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N38_00_W120_00_DEM/Copernicus_DSM_COG_10_N38_00_W120_00_DEM.tif",14);
// Portillo: Roca Jack top -> hotel
await transect("Portillo Roca Jack descent",[-32.8480,-70.1330],[-32.8380,-70.1290],
  "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S33_00_W071_00_DEM/Copernicus_DSM_COG_10_S33_00_W071_00_DEM.tif",14);
