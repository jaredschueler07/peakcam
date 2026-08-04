import {PNG} from 'pngjs'; import {fromUrl} from 'geotiff'; import fs from 'fs';
const D=Math.PI/180;
const lon2px=(lon,z)=>(lon+180)/360*(1<<z)*256;
const lat2px=(lat,z)=>{const s=Math.sin(lat*D);return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*(1<<z)*256;};
const cache=new Map();
async function tp(z,x,y){const k=`${z}/${x}/${y}`;if(!cache.has(k)){
  const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`);
  cache.set(k, r.ok?PNG.sync.read(Buffer.from(await r.arrayBuffer())):null);} return cache.get(k);}
async function sampleTerr(lat,lon,z){const px=lon2px(lon,z),py=lat2px(lat,z);
  const p=await tp(z,Math.floor(px/256),Math.floor(py/256)); if(!p)return 0;
  // bilinear
  const fx=px%256,fy=py%256,x0=Math.min(255,Math.floor(fx)),y0=Math.min(255,Math.floor(fy));
  const x1=Math.min(255,x0+1),y1=Math.min(255,y0+1),ax=fx-x0,ay=fy-y0;
  const g=(x,y)=>{const i=(y*256+x)*4;return p.data[i]*256+p.data[i+1]+p.data[i+2]/256-32768;};
  return (g(x0,y0)*(1-ax)+g(x1,y0)*ax)*(1-ay)+(g(x0,y1)*(1-ax)+g(x1,y1)*ax)*ay;}

async function bake(name,cLat,cLon,sizeM,N,z,copTif){
  const mPerDegLat=111132, mPerDegLon=111320*Math.cos(cLat*D);
  const half=sizeM/2, out=new Float64Array(N*N);
  // prefetch tiles
  for(let j=0;j<N;j+=8)for(let i=0;i<N;i+=8){
    const lat=cLat+(half-(j/(N-1))*sizeM)/mPerDegLat, lon=cLon+((i/(N-1))*sizeM-half)/mPerDegLon;
    await sampleTerr(lat,lon,z);}
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    const lat=cLat+(half-(j/(N-1))*sizeM)/mPerDegLat, lon=cLon+((i/(N-1))*sizeM-half)/mPerDegLon;
    out[j*N+i]=await sampleTerr(lat,lon,z);}
  let mn=1e9,mx=-1e9; for(const v of out){if(v<mn)mn=v;if(v>mx)mx=v;}
  const write=(vals,tag)=>{
    const png=new PNG({width:N,height:N,colorType:0,bitDepth:16,inputHasAlpha:false});
    const b=Buffer.alloc(N*N*2);
    for(let i=0;i<N*N;i++)b.writeUInt16BE(Math.max(0,Math.min(65535,Math.round((vals[i]-mn)/(mx-mn)*65535))),i*2);
    png.data=b; const buf=PNG.sync.write(png,{colorType:0,bitDepth:16,inputColorType:0,deflateLevel:9});
    fs.writeFileSync(`${name}_${tag}.png`,buf); return buf.length;};
  const bytes=write(out,'h16');
  const step=(mx-mn)/65535, mppx=sizeM/(N-1);
  console.log(`${name}: ${N}x${N} over ${sizeM}m  ${mppx.toFixed(2)} m/px | elev ${mn.toFixed(0)}-${mx.toFixed(0)}m (relief ${(mx-mn).toFixed(0)}m) | vert step ${(step*100).toFixed(2)} cm | 16-bit PNG = ${(bytes/1024).toFixed(0)} KB`);
  // also raw + gzip comparison
  const raw=Buffer.alloc(N*N*2); for(let i=0;i<N*N;i++)raw.writeUInt16LE(Math.round((out[i]-mn)/(mx-mn)*65535),i*2);
  const {gzipSync,brotliCompressSync}=await import('zlib');
  console.log(`   raw u16 = ${(raw.length/1024).toFixed(0)} KB | gzip = ${(gzipSync(raw,{level:9}).length/1024).toFixed(0)} KB | brotli = ${(brotliCompressSync(raw).length/1024).toFixed(0)} KB`);
}
await bake('portillo',-32.8420,-70.1290,4096,1024,15);
await bake('breck',39.4780,-106.0670,4096,1024,15);
await bake('heavenly',38.9350,-119.9300,4096,1024,15);
