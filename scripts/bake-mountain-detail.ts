/** Seeded offline gameplay relief; output is quantised into the shared DEM.
 * The source DEM remains untouched in scripts/data/dem. These are designed
 * snow/rock features, not a claim of surveyed mogul or tree locations.
 */
import { decodeTrails, sampleHeightBilinear, type Heightfield, type TrailsFile } from '../lib/game/terrain/formats';
import { mulberry32 } from '../lib/game/core/rng';
interface Segment { ax:number;ay:number;bx:number;by:number;width:number;groomed:boolean }
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(v:number)=>{const t=clamp(v,0,1);return t*t*(3-2*t);};
export function bakeMountainDetail(field:Heightfield,network:TrailsFile,seed:number,treeLineElevationM=Infinity):Float32Array {
  const decoded=decodeTrails(network),cell=64,half=field.sizeM/2;
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
  const random=mulberry32(seed),phase=random()*Math.PI*2;
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
  network.detail={version:2,seed,treeLineElevationM:Number.isFinite(treeLineElevationM)?treeLineElevationM:undefined,treeWells:wells,description:'Designed seed-stable corridor cuts/banks, ungroomed mogul relief, convex-ridge lips, steep rock relief and mapped-forest wells baked into the DEM; not surveyed features.'};
  const result=new Float32Array(field.heights),{width,height,heights,cellSizeM:step}=field;
  for(let r=1;r<height-1;r++)for(let c=1;c<width-1;c++){
    const x=-half+c*step,y=half-r*step,index=r*width+c,h=heights[index];
    const gx=(heights[index+1]-heights[index-1])/(2*step),gy=(heights[index-width]-heights[index+width])/(2*step),slope=Math.hypot(gx,gy);
    const convex=(4*h-heights[index-1]-heights[index+1]-heights[index-width]-heights[index+width])/(step*step);
    let distance = Infinity, clearance = Infinity;
    let nearest: Segment | undefined, px = 0, py = 0;
    let groomedInterior = false;
    for (const segment of buckets.get(`${Math.floor(x/cell)},${Math.floor(y/cell)}`) ?? []) {
      const dx = segment.bx-segment.ax, dy = segment.by-segment.ay;
      const t = clamp(((x-segment.ax)*dx+(y-segment.ay)*dy)/(dx*dx+dy*dy || 1),0,1);
      const cx = segment.ax+dx*t, cy = segment.ay+dy*t;
      const d = Math.hypot(x-cx,y-cy), edgeDistance = d-segment.width;
      const insideGroomer = segment.groomed && edgeDistance <= 0;
      // A wide groomer owns its interior even beside a closer, narrower black.
      // Else choose the strongest corridor influence, measured from its edge.
      if ((insideGroomer && !groomedInterior) ||
          (insideGroomer === groomedInterior && edgeDistance < clearance)) {
        groomedInterior = insideGroomer;
        distance = d; clearance = edgeDistance; nearest = segment; px = cx; py = cy;
      }
    }
    const corridor=nearest?smooth((nearest.width+12-distance)/12):0;
    let offset=0;
    if(nearest?.groomed){
      // A shallow cut softens the crossfall without removing DEM morphology.
      const cut=clamp((sampleHeightBilinear(field,px,py)-h)*0.3,-1.2,1.2);
      offset+=cut*corridor;
      offset+=0.95*Math.exp(-Math.pow((distance-nearest.width-3)/5,2));
    }else if(nearest){
      // >= three samples/wavelength avoids pretending the DEM resolves 1m bumps.
      offset+=0.65*Math.sin(x/3.8+phase)*Math.sin(y/4.7-phase)*corridor;
    }
    const off=1-(nearest?.groomed?corridor:0);
    offset+=off*smooth((slope-0.7)/0.4)*0.9*Math.sin(x/7+phase)*Math.sin(y/8);
    offset+=off*smooth((convex-0.006)/0.018)*smooth((0.9-slope)/0.4)*(0.65+0.45*Math.sin(x/13+y/17+phase));
    result[index]=h+offset;
  }
  for(const well of wells){
    const c0=Math.round((well.x+half)/step),r0=Math.round((half-well.y)/step),radius=Math.ceil(well.radiusM/step);
    for(let r=Math.max(1,r0-radius);r<=Math.min(height-2,r0+radius);r++)for(let c=Math.max(1,c0-radius);c<=Math.min(width-2,c0+radius);c++){
      const x=-half+c*step,y=half-r*step,d=Math.hypot(x-well.x,y-well.y);if(d<well.radiusM)result[r*width+c]-=0.55*smooth(1-d/well.radiusM);
    }
  }
  return result;
}
