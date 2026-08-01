import {PNG} from 'pngjs'; import {fromUrl} from 'geotiff';
const D=Math.PI/180;
const lon2px=(l,z)=>(l+180)/360*(1<<z)*256, lat2px=(a,z)=>{const s=Math.sin(a*D);return(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*(1<<z)*256;};
const cache=new Map();
async function s(lat,lon,z){const px=lon2px(lon,z),py=lat2px(lat,z),tx=Math.floor(px/256),ty=Math.floor(py/256),k=`${z}/${tx}/${ty}`;
 if(!cache.has(k)){const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`);cache.set(k,PNG.sync.read(Buffer.from(await r.arrayBuffer())));}
 const p=cache.get(k),fx=px%256,fy=py%256,x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(255,x0+1),y1=Math.min(255,y0+1),ax=fx-x0,ay=fy-y0;
 const g=(x,y)=>{const i=(y*256+x)*4;return p.data[i]*256+p.data[i+1]+p.data[i+2]/256-32768;};
 return (g(x0,y0)*(1-ax)+g(x1,y0)*ax)*(1-ay)+(g(x0,y1)*(1-ax)+g(x1,y1)*ax)*ay;}
const t=await fromUrl("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S33_00_W071_00_DEM/Copernicus_DSM_COG_10_S33_00_W071_00_DEM.tif");
const img=await t.getImage(),bb=img.getBoundingBox(),W=img.getWidth(),H=img.getHeight();
const lo0=-70.16,lo1=-70.10,la0=-32.86,la1=-32.82;
const x0=Math.round((lo0-bb[0])/(bb[2]-bb[0])*W),x1=Math.round((lo1-bb[0])/(bb[2]-bb[0])*W);
const y0=Math.round((bb[3]-la1)/(bb[3]-bb[1])*H),y1=Math.round((bb[3]-la0)/(bb[3]-bb[1])*H);
const r=await img.readRasters({window:[x0,y0,x1,y1]}); const a=r[0],Wd=r.width,Hd=r.height;
console.log(`Copernicus window ${Wd}x${Hd} over ${((lo1-lo0)*111320*Math.cos(32.84*D)/1000).toFixed(2)}x${((la1-la0)*111.132).toFixed(2)} km`);
// sample terrarium at same grid, compare
let diffs=[],cmin=1e9,cmax=-1e9,tmin=1e9,tmax=-1e9,cr=0,tr=0,n=0;
for(let j=1;j<Hd-1;j++)for(let i=1;i<Wd-1;i++){
 const lon=lo0+(i/(Wd-1))*(lo1-lo0), lat=la1-(j/(Hd-1))*(la1-la0);
 const c=a[j*Wd+i], tv=await s(lat,lon,13);
 diffs.push(c-tv); cmin=Math.min(cmin,c);cmax=Math.max(cmax,c);tmin=Math.min(tmin,tv);tmax=Math.max(tmax,tv);
 cr+=Math.abs(c-(a[j*Wd+i-1]+a[j*Wd+i+1])/2); n++;
}
diffs.sort((p,q)=>p-q);
const mean=diffs.reduce((x,y)=>x+y,0)/diffs.length;
const sd=Math.sqrt(diffs.reduce((x,y)=>x+(y-mean)**2,0)/diffs.length);
console.log(`Copernicus range ${cmin.toFixed(0)}-${cmax.toFixed(0)}m | terrarium(SRTM) range ${tmin.toFixed(0)}-${tmax.toFixed(0)}m`);
console.log(`cop - terrarium: mean=${mean.toFixed(1)}m sd=${sd.toFixed(1)}m p5=${diffs[Math.floor(diffs.length*0.05)].toFixed(0)} p50=${diffs[Math.floor(diffs.length*0.5)].toFixed(0)} p95=${diffs[Math.floor(diffs.length*0.95)].toFixed(0)}`);
console.log(`Copernicus mean|2nd diff| along row = ${(cr/n).toFixed(2)} m (per 30m step)`);
