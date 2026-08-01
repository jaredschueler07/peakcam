import {PNG} from 'pngjs'; import fs from 'fs'; import {gzipSync,brotliCompressSync} from 'zlib';
const D=Math.PI/180;
const lon2px=(lon,z)=>(lon+180)/360*(1<<z)*256;
const lat2px=(lat,z)=>{const s=Math.sin(lat*D);return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*(1<<z)*256;};
const cache=new Map();
async function tp(z,x,y){const k=`${z}/${x}/${y}`;if(!cache.has(k)){
  const r=await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${k}.png`);
  cache.set(k, r.ok?PNG.sync.read(Buffer.from(await r.arrayBuffer())):null);} return cache.get(k);}
async function s(lat,lon,z){const px=lon2px(lon,z),py=lat2px(lat,z);
  const p=await tp(z,Math.floor(px/256),Math.floor(py/256)); if(!p)return 0;
  const fx=px%256,fy=py%256,x0=Math.min(255,Math.floor(fx)),y0=Math.min(255,Math.floor(fy));
  const x1=Math.min(255,x0+1),y1=Math.min(255,y0+1),ax=fx-x0,ay=fy-y0;
  const g=(x,y)=>{const i=(y*256+x)*4;return p.data[i]*256+p.data[i+1]+p.data[i+2]/256-32768;};
  return (g(x0,y0)*(1-ax)+g(x1,y0)*ax)*(1-ay)+(g(x0,y1)*(1-ax)+g(x1,y1)*ax)*ay;}
const cLat=-32.8420,cLon=-70.1290,sizeM=4096,z=15;
const mLat=111132,mLon=111320*Math.cos(cLat*D);
async function grid(N){const a=new Float64Array(N*N);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){const lat=cLat+(sizeM/2-(j/(N-1))*sizeM)/mLat,lon=cLon+((i/(N-1))*sizeM-sizeM/2)/mLon;a[j*N+i]=await s(lat,lon,z);}return a;}
function png16(a,N,q,mn){const p=new PNG({width:N,height:N,colorType:0,bitDepth:16});
  const b=Buffer.alloc(N*N*2);for(let i=0;i<N*N;i++)b.writeUInt16BE(Math.max(0,Math.min(65535,Math.round((a[i]-mn)/q))),i*2);
  p.data=b;return {png:PNG.sync.write(p,{colorType:0,bitDepth:16,inputColorType:0,deflateLevel:9}).length, raw:b};}
for(const N of [512,768,1024]){
  const a=await grid(N); let mn=1e9,mx=-1e9;for(const v of a){if(v<mn)mn=v;if(v>mx)mx=v;}
  for(const q of [ (mx-mn)/65535, 0.1, 0.25, 0.5, 1.0]){
    if((mx-mn)/q>65535) continue;
    const {png,raw}=png16(a,N,q,mn);
    console.log(`N=${N} (${(sizeM/(N-1)).toFixed(1)} m/px) vq=${q<0.05?'full('+(q*100).toFixed(1)+'cm)':q+'m'}  png16=${(png/1024).toFixed(0)}KB  raw.br=${(brotliCompressSync(raw).length/1024).toFixed(0)}KB  raw.gz=${(gzipSync(raw,{level:9}).length/1024).toFixed(0)}KB`);
  }
  console.log('');
}
