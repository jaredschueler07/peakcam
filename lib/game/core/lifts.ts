import type { RealLift, SimulationState, SimulationWorld, Vec3 } from "./types";

export interface LiftPath {
  readonly points: readonly Vec3[];
  readonly distances: readonly number[];
  readonly supports: readonly Vec3[];
  readonly lengthM: number;
  readonly surface: boolean;
}
export interface LiftSample extends Vec3 { heading: number }
const paths = new WeakMap<RealLift, LiftPath>();
const scratch: LiftSample = { x: 0, y: 0, z: 0, heading: 0 };
export const RIDER_DROP_M = 3.4;
export const isSurfaceLift = (lift: RealLift): boolean => /platter|drag_lift|t-bar|j-bar|rope_tow|magic_carpet/.test(lift.type);
/** Fallbacks are engineering defaults, never claimed to be measured OSM values. */
export function liftSpeed(lift: RealLift): number {
  return lift.speedMps && Number.isFinite(lift.speedMps) && lift.speedMps > 0 ? lift.speedMps
    : isSurfaceLift(lift) ? 2.5 : /gondola|cable_car/.test(lift.type) ? 5 : 4.5;
}

/** Initialization only. Tower locations are projected onto the baked line; absent
 * tower data uses explicitly synthetic 90 m supports. Endpoints are loading ramps. */
export function prepareLiftPath(lift: RealLift, height?: (x: number, z: number) => number): LiftPath {
  const cached = paths.get(lift); if (cached) return cached;
  const source = lift.points[0].y > lift.points[lift.points.length - 1].y ? [...lift.points].reverse() : lift.points;
  const cumulative = [0];
  for (let i = 1; i < source.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(source[i].x-source[i-1].x, source[i].y-source[i-1].y, source[i].z-source[i-1].z));
  const total = cumulative[cumulative.length-1];
  function sample(d: number): Vec3 {
    let i=1; while(i<cumulative.length-1 && cumulative[i]<d) i++;
    const a=source[i-1], b=source[i], t=(d-cumulative[i-1])/(cumulative[i]-cumulative[i-1]||1);
    return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
  }
  const anchors=[0,total];
  if(lift.towers?.length) for(const tower of lift.towers) {
    let nearest=Infinity, at=0;
    for(let i=1;i<source.length;i++) {
      const a=source[i-1],b=source[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((tower.x-a.x)*dx+(tower.z-a.z)*dz)/(dx*dx+dz*dz||1)));
      const error=Math.hypot(tower.x-a.x-t*dx,tower.z-a.z-t*dz);
      if(error<nearest){nearest=error;at=cumulative[i-1]+t*(cumulative[i]-cumulative[i-1]);}
    }
    if(at>1 && at<total-1) anchors.push(at);
  } else for(let d=90;d<total;d+=90) anchors.push(d);
  // Baked bends also support a cable: a cable cannot turn at an unsupported vertex.
  for(let i=1;i<cumulative.length-1;i++) anchors.push(cumulative[i]);
  anchors.sort((a,b)=>a-b);
  const unique=anchors.filter((d,i)=>i===0 || d-anchors[i-1]>0.1);
  const surface=isSurfaceLift(lift), supports=unique.map((d,i)=>{
    const p=sample(d); p.y+=surface || i===0 || i===unique.length-1 ? RIDER_DROP_M : 15.5; return p;
  });
  if (height) {
    for (let i=0;i<supports.length;i++) {
      const p=supports[i];p.y=height(p.x,p.z)+(surface || i===0 || i===supports.length-1?RIDER_DROP_M:15.5);
    }
    // Unknown tower heights are engineering clearance defaults. Raise supports,
    // never bend the cable through terrain, while retaining ground-level terminals.
    if (!surface) for (let i=1;i<supports.length;i++) {
      const a=supports[i-1],b=supports[i],span=Math.hypot(b.x-a.x,b.z-a.z),sag=Math.min(2.2,span*0.018);
      let raise=0;
      for(let j=1;j<50;j++) {
        const t=j/50,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
        const cable=a.y+(b.y-a.y)*t-sag*(Math.cosh(0.5)-Math.cosh(t-0.5))/(Math.cosh(0.5)-1);
        const weight=(i>1?1-t:0)+(i<supports.length-1?t:0);
        const clearance=Math.min(2,Math.min(unique[i-1]+t*(unique[i]-unique[i-1]),total-unique[i-1]-t*(unique[i]-unique[i-1]))*0.15);
        if(weight>0)raise=Math.max(raise,(height(x,z)+RIDER_DROP_M+clearance-cable)/weight);
      }
      if(raise>0){if(i>1)a.y+=raise;if(i<supports.length-1)b.y+=raise;}
    }
  }
  const points:Vec3[]=[], distances:number[]=[];
  for(let i=1;i<supports.length;i++) {
    const a=supports[i-1], b=supports[i], span=Math.hypot(b.x-a.x,b.z-a.z), n=Math.max(1,Math.ceil((unique[i]-unique[i-1])/2));
    // Small-sag engineering catenary, exact cosh profile normalized to zero at supports.
    const sag=surface ? 0 : Math.min(2.2,span*0.018), halfCosh=Math.cosh(0.5)-1;
    for(let j=i===1?0:1;j<=n;j++) {
      const t=j/n, ground=sample(unique[i-1]+t*(unique[i]-unique[i-1]));
      const p={x:a.x+(b.x-a.x)*t,y:surface?(height?height(ground.x,ground.z):ground.y)+RIDER_DROP_M:a.y+(b.y-a.y)*t-sag*(Math.cosh(0.5)-Math.cosh(t-0.5))/halfCosh,z:a.z+(b.z-a.z)*t};
      const prev=points[points.length-1]; distances.push(prev?distances[distances.length-1]+Math.hypot(p.x-prev.x,p.y-prev.y,p.z-prev.z):0);points.push(p);
    }
  }
  const path={points,distances,supports,lengthM:distances[distances.length-1],surface};paths.set(lift,path);return path;
}
/** No allocation; linear interpolation of the same two-metre cable used by the renderer. */
export function sampleLiftPath(path: LiftPath, distance: number, out: LiftSample, side=0): LiftSample {
  const d=Math.max(0,Math.min(path.lengthM,distance));let lo=1,hi=path.distances.length-1;
  while(lo<hi){const mid=(lo+hi)>>>1;if(path.distances[mid]<d)lo=mid+1;else hi=mid;}
  const a=path.points[lo-1],b=path.points[lo],t=(d-path.distances[lo-1])/(path.distances[lo]-path.distances[lo-1]||1);
  out.heading=Math.atan2(b.x-a.x,b.z-a.z);out.x=a.x+(b.x-a.x)*t+Math.cos(out.heading)*side;
  out.y=a.y+(b.y-a.y)*t;out.z=a.z+(b.z-a.z)*t-Math.sin(out.heading)*side;return out;
}
export function stepRealLifts(s: SimulationState, dt: number, world: SimulationWorld): boolean {
  if(world.terrain.kind!=="real")return false;
  // Real terrain never falls through to the legacy accelerated teleport lap.
  if(!world.config.allowLifts){s.liftIndex=-1;s.liftRide=0;return false;}
  s.liftCooldown=Math.max(0,s.liftCooldown-dt);
  const lifts=world.terrain.realLifts;
  if(!lifts)return false;
  if(s.liftIndex<0 && s.onGround && s.crash<=0 && s.liftCooldown<=0 && Math.hypot(s.vel.x,s.vel.z)<=10) {
    for(let i=0;i<lifts.length;i++){
      const lift=lifts[i],path=paths.get(lift);
      if(!path || lift.complete===false || lift.stations?.length!==2)continue;
      const p=path.points[0],radius=Math.min(12,lift.stations?.[0]?.radiusM??7);
      if(Math.hypot(s.pos.x-p.x,s.pos.z-p.z)<=radius && Math.abs(s.pos.y-(p.y-RIDER_DROP_M))<3){
        s.liftIndex=i;s.liftDistanceM=0;s.liftProgress=0;break;
      }
    }
  }
  if(s.liftIndex<0){s.liftRide=0;return false;}
  const lift=lifts[s.liftIndex],path=paths.get(lift);
  if(!path){s.liftIndex=-1;s.liftRide=0;return false;}
  s.liftDistanceM=Math.min(path.lengthM,s.liftDistanceM+liftSpeed(lift)*dt);
  s.liftProgress=s.liftDistanceM/path.lengthM;s.liftRide=(path.lengthM-s.liftDistanceM)/liftSpeed(lift);
  const p=sampleLiftPath(path,s.liftDistanceM,scratch);
  s.pos.x=p.x;s.pos.y=p.y-RIDER_DROP_M;s.pos.z=p.z;s.yaw=p.heading;
  s.vel.x=0;s.vel.y=0;s.vel.z=0;s.onGround=path.surface;s.carve=0;s.edgeAngle=0;s.lean=0;s.crouch=0;s.airTime=0;s.crash=0;
  s.prevX=s.pos.x;s.prevZ=s.pos.z;
  if(s.liftDistanceM>=path.lengthM){
    s.liftIndex=-1;s.liftRide=0;s.liftCooldown=5;s.onGround=true;s.invuln=2;
    s.pos.y=world.terrain.height(s.pos.x,s.pos.z);
    // Release onto this lift's actual upper terminal with forward momentum.
    s.vel.x=Math.sin(s.yaw)*3;s.vel.z=Math.cos(s.yaw)*3;
    s.events.liftFinished=true;s.finished=false;
  }
  return true;
}
