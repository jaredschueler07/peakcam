import {PNG} from 'pngjs';
const lon2px=(lon,z)=>(lon+180)/360*Math.pow(2,z)*256;
const lat2px=(lat,z)=>{const s=Math.sin(lat*Math.PI/180);return (0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*Math.pow(2,z)*256;};
async function tile(z,x,y){
  const u=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const r=await fetch(u); if(!r.ok) throw new Error(u+' '+r.status);
  const buf=Buffer.from(await r.arrayBuffer());
  return {png:PNG.sync.read(buf), bytes:buf.length};
}
async function probe(name,lat,lon,z){
  const px=lon2px(lon,z), py=lat2px(lat,z);
  const tx=Math.floor(px/256), ty=Math.floor(py/256);
  const {png,bytes}=await tile(z,tx,ty);
  const dec=(i)=>png.data[i]*256+png.data[i+1]+png.data[i+2]/256-32768;
  let min=1e9,max=-1e9,fracs=new Set(),vals=[];
  for(let i=0;i<png.width*png.height;i++){const v=dec(i*4);vals.push(v);if(v<min)min=v;if(v>max)max=v;fracs.add(png.data[i*4+2]);}
  const cx=Math.floor(px)%256, cy=Math.floor(py)%256;
  const center=dec((cy*png.width+cx)*4);
  // metres per pixel
  const mpp=156543.03392*Math.cos(lat*Math.PI/180)/Math.pow(2,z)/(png.width/256);
  // roughness: mean abs 2nd difference along a row
  let d2=0,n=0;
  for(let yy=1;yy<png.height-1;yy++)for(let xx=1;xx<png.width-1;xx++){
    const c=dec((yy*png.width+xx)*4),l=dec((yy*png.width+xx-1)*4),r2=dec((yy*png.width+xx+1)*4);
    d2+=Math.abs(c-(l+r2)/2);n++;}
  console.log(`${name} z${z} tile=${tx}/${ty} ${png.width}x${png.height} ${bytes}B mpp=${mpp.toFixed(1)} center=${center.toFixed(2)}m min=${min.toFixed(0)} max=${max.toFixed(0)} distinctBlue=${fracs.size} meanAbs2ndDiff=${(d2/n).toFixed(3)}m`);
}
const sites=[["Portillo",-32.8375,-70.1289],["Breckenridge-Pk8",39.4783,-106.0664],["Heavenly-summit",38.9317,-119.9200]];
for(const z of [12,13,14,15]) for(const [n,la,lo] of sites) await probe(n,la,lo,z);
