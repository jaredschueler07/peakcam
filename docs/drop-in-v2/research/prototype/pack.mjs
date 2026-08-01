import fs from 'fs'; import {gzipSync,brotliCompressSync} from 'zlib';
const D=Math.PI/180;
function rdp(pts,eps){ if(pts.length<3)return pts;
 const d=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];const L=dx*dx+dy*dy;if(!L)return Math.hypot(p[0]-a[0],p[1]-a[1]);
  let t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
 let mi=0,md=0;for(let i=1;i<pts.length-1;i++){const dd=d(pts[i],pts[0],pts[pts.length-1]);if(dd>md){md=dd;mi=i;}}
 return md>eps?[...rdp(pts.slice(0,mi+1),eps).slice(0,-1),...rdp(pts.slice(mi),eps)]:[pts[0],pts[pts.length-1]];}
for(const [name,cLat,cLon] of [['portillo',-32.8420,-70.1290],['breck',39.4780,-106.0670],['heavenly',38.9350,-119.9300]]){
 const d=JSON.parse(fs.readFileSync(`${name}_geom.json`)); const S=4096,h=S/2;
 const mLat=111132,mLon=111320*Math.cos(cLat*D);
 const runs=[],lifts=[];
 for(const e of d.elements){ if(!e.geometry)continue;
  const pts=e.geometry.map(g=>[(g.lon-cLon)*mLon,(g.lat-cLat)*mLat]).filter(p=>Math.abs(p[0])<=h&&Math.abs(p[1])<=h);
  if(pts.length<2)continue;
  const t=e.tags, simp=rdp(pts,6);
  const q=simp.map(p=>[Math.round(p[0]*10),Math.round(p[1]*10)]);
  const delta=[q[0]]; for(let i=1;i<q.length;i++)delta.push([q[i][0]-q[i-1][0],q[i][1]-q[i-1][1]]);
  const rec={n:t.name||t['piste:name']||null,p:delta.flat()};
  if(t['piste:type']){rec.d=t['piste:difficulty']||null;if(t['piste:grooming'])rec.g=t['piste:grooming'];if(t.gladed==='yes')rec.gl=1;if(t.oneway==='yes'||t['piste:oneway']==='yes')rec.o=1;runs.push(rec);}
  else {rec.t=t.aerialway;lifts.push(rec);}
 }
 const j=JSON.stringify({v:1,center:[cLat,cLon],sizeM:S,unit:0.1,runs,lifts});
 const nodes=[...runs,...lifts].reduce((a,r)=>a+r.p.length/2,0);
 console.log(`${name}: runs=${runs.length} lifts=${lifts.length} nodes=${nodes} | json=${(j.length/1024).toFixed(1)}KB gz=${(gzipSync(Buffer.from(j),{level:9}).length/1024).toFixed(1)}KB br=${(brotliCompressSync(Buffer.from(j)).length/1024).toFixed(1)}KB`);
 fs.writeFileSync(`${name}_trails.json`,j);
}
