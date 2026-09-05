import type { RealJunction } from '../core/types';
import type { NetworkJunction } from './formats';
import type { DrapedRun } from './real-heightfield';

/** Source topology converted once into readable multi-name game junctions. */
export function buildJunctions(
  source: readonly NetworkJunction[], runs: readonly DrapedRun[],
  height: (x:number,z:number)=>number,
): RealJunction[] {
  const byId = new Map(runs.filter(run=>run.id).map(run=>[run.id!,run]));
  const output: RealJunction[] = [];
  for (const junction of source) {
    const choices: RealJunction['choices'][number][] = [];
    const names = new Set<string>();
    let heading = 0, halfWidthM = 14, bestElevation = -Infinity;
    for (const id of junction.runIds) {
      const run = byId.get(id);
      if (!run?.name || names.has(run.name)) continue;
      names.add(run.name);
      choices.push({id,name:run.name,difficulty:run.difficulty});
      for (let i=1;i<run.points.length;i++) {
        const a=run.points[i-1],b=run.points[i];
        const dx=b.x-a.x,dz=b.z-a.z;
        const t=Math.max(0,Math.min(1,((junction.x-a.x)*dx+(-junction.y-a.z)*dz)/(dx*dx+dz*dz||1)));
        if (Math.hypot(junction.x-a.x-dx*t,-junction.y-a.z-dz*t)>4) continue;
        const upstream=a.y>=b.y?a:b,downstream=a.y>=b.y?b:a;
        if (upstream.y>bestElevation) {
          bestElevation=upstream.y;
          heading=Math.atan2(downstream.x-upstream.x,downstream.z-upstream.z);
          halfWidthM=run.halfWidthM;
        }
      }
    }
    if (choices.length<2) continue;
    output.push({id:junction.id,x:junction.x,y:height(junction.x,-junction.y),z:-junction.y,heading,halfWidthM,choices});
  }
  return output;
}

/** Returns a retained junction, never allocates. Coordinates are game x/z. */
export function nearestJunction(junctions: readonly RealJunction[],x:number,z:number,radiusM=65):RealJunction|null {
  let best:RealJunction|null=null,bestSq=radiusM*radiusM;
  for (let i=0;i<junctions.length;i++) {
    const j=junctions[i],d=(x-j.x)*(x-j.x)+(z-j.z)*(z-j.z);
    if (d<bestSq) {bestSq=d;best=j;}
  }
  return best;
}
