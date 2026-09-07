/** Seeded offline forest placement; elevations are preserved unchanged.
 * The immutable, already resampled DEM remains in scripts/data/dem.
 * Tree locations are designed scenery, not surveyed positions.
 */
import { decodeTrails, sampleHeightBilinear, type Heightfield, type TrailsFile } from '../lib/game/terrain/formats';
import { mulberry32 } from '../lib/game/core/rng';
interface Segment { ax:number;ay:number;bx:number;by:number;width:number;groomed:boolean }
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export function bakeMountainDetail(field:Heightfield,network:TrailsFile,seed:number,treeLineElevationM=Infinity):Float32Array {
  const decoded=decodeTrails(network),cell=64;
  const buckets=new Map<string,Segment[]>();
  for(const run of decoded.runs){
    const groomed=!run.gladed&&!['backcountry','mogul','no'].includes(run.grooming??'');
    for(let i=1;i<run.points.length;i++){
      const a=run.points[i-1],b=run.points[i],s={ax:a.x,ay:a.y,bx:b.x,by:b.y,width:(run.widthM??28)/2,groomed};
      const margin=Math.max(s.width+18,s.width*1.2+6);
      for(let x=Math.floor((Math.min(a.x,b.x)-margin)/cell);x<=Math.floor((Math.max(a.x,b.x)+margin)/cell);x++)for(let y=Math.floor((Math.min(a.y,b.y)-margin)/cell);y<=Math.floor((Math.max(a.y,b.y)+margin)/cell);y++){
        const key=`${x},${y}`,bucket=buckets.get(key)??[];bucket.push(s);buckets.set(key,bucket);
      }
    }
  }
  function clearsCorridors(x: number, y: number): boolean {
    for (const segment of buckets.get(`${Math.floor(x/cell)},${Math.floor(y/cell)}`) ?? []) {
      const dx=segment.bx-segment.ax,dy=segment.by-segment.ay;
      const t=clamp(((x-segment.ax)*dx+(y-segment.ay)*dy)/(dx*dx+dy*dy||1),0,1);
      if (Math.hypot(x-segment.ax-dx*t,y-segment.ay-dy*t) < segment.width*1.2+6) return false;
    }
    return true;
  }
  const random=mulberry32(seed);
  const wells:Array<{x:number;y:number;radiusM:number}>=[];
  // Designed 30m planting grid with ±5m jitter inside mapped closed woods. At 4–6m
  // DEM resolution the wells have a 6m radius; individual ski-scale holes are
  // not representable and are deliberately not claimed.
  for(const forest of decoded.forests){
    const p=forest.points;if(p.length<4)continue;
    const xs=p.map(v=>v.x),ys=p.map(v=>v.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const inside=(x:number,y:number)=>{let hit=false;for(let i=0,j=p.length-1;i<p.length;j=i++){if((p[i].y>y)!==(p[j].y>y)&&x<(p[j].x-p[i].x)*(y-p[i].y)/(p[j].y-p[i].y)+p[i].x)hit=!hit;}return hit;};
    for (let y = minY+20; y < maxY; y += 30) {
      for (let x = minX+20; x < maxX; x += 30) {
        const wx = x+(random()-.5)*10, wy = y+(random()-.5)*10;
        // Engineering DEM ceiling, not an inferred species or botanical survey.
        const belowTreeLine = sampleHeightBilinear(field,wx,wy) <= treeLineElevationM;
        if (inside(wx,wy) && belowTreeLine && clearsCorridors(wx,wy)) {
          wells.push({x:Math.round(wx*10)/10,y:Math.round(wy*10)/10,radiusM:6});
        }
      }
    }
  }
  network.detail={version:3,seed,treeLineElevationM:Number.isFinite(treeLineElevationM)?treeLineElevationM:undefined,treeWells:wells,description:'Designed tree placement inside mapped forests; treeWells is a legacy field name, no depressions or other height edits. Trees are not surveyed.'};
  // Trees are scenery placement only. No invented cuts, banks, moguls or wells
  // may alter the source elevations in the real-mountain pack.
  return new Float32Array(field.heights);
}
