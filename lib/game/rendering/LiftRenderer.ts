import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { liftSpeed, prepareLiftPath, sampleLiftPath, RIDER_DROP_M, type LiftPath } from "../core/lifts";
import type { RealLift, SimulationState, TerrainSampler } from "../core/types";

const sample={x:0,y:0,z:0,heading:0};
const matrix=new THREE.Matrix4(), object=new THREE.Object3D();
function box(x:number,y:number,z:number,w:number,h:number,d:number):THREE.BufferGeometry {
  return new THREE.BoxGeometry(w,h,d).translate(x,y,z);
}
function merge(parts:THREE.BufferGeometry[]):THREE.BufferGeometry {
  const result=mergeGeometries(parts);for(const p of parts)p.dispose();return result;
}
function finishTexture(): THREE.DataTexture {
  const size=32,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,c=(x%8===0?115:215)+((x*13+y*7)%17);
    data[i]=data[i+1]=data[i+2]=c;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.needsUpdate=true;texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
interface Line { lift:RealLift; path:LiftPath; count:number; key:string; static:THREE.Group; cable:Float32Array }
interface Batch { mesh:THREE.InstancedMesh; count:number }
// Six-metre station labels stop being readable beyond this range. Keep the
// terminal/cable geometry under the existing line visibility policy.
export const STATION_LABEL_DISTANCE_M = 350;
/** All moving carriers share instances by type/seat count. Geometry, textures,
 * station names and cables are created once; frame updates allocate nothing. */
export class LiftRenderer {
  private readonly lines:Line[]=[];
  private readonly batches=new Map<string,Batch>();
  private readonly stationLabels: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  private readonly texture=finishTexture();
  private readonly cables: THREE.LineSegments;
  private readonly cablePositions: Float32Array;
  private cablesDirty = true;
  constructor(scene:THREE.Scene, terrain:TerrainSampler){
    const metal=new THREE.MeshStandardMaterial({map:this.texture,color:0x708899,roughness:0.65,metalness:0.5});
    const paint=new THREE.MeshStandardMaterial({map:this.texture,color:0xdc652b,roughness:0.55,metalness:0.2});
    const towerParts:THREE.BufferGeometry[]=[];
    const capacities=new Map<string,number>();
    for(const lift of terrain.realLifts??[]){
      const path=prepareLiftPath(lift, terrain.height), seats=lift.occupancy??2;
      const key=lift.type==='rope_tow'?'shuttle':path.surface?'surface':/gondola|cable_car/.test(lift.type)?'gondola':`chair-${Math.max(1,Math.min(10,seats))}`;
      const count=key==='shuttle'?1:path.surface?Math.ceil(path.lengthM/35):Math.ceil(path.lengthM/28);
      capacities.set(key,(capacities.get(key)??0)+count*2+1);
      const group=new THREE.Group();scene.add(group);
      group.visible=false;
      group.userData.liftId=lift.id;group.userData.name=lift.name;
      group.userData.occupancySource=lift.occupancy==null?'visual-default': 'osm';
      const cable:number[]=[];
      for(const side of [0,3.8])for(let i=1;i<path.points.length;i++){
        for(const at of [i-1,i]){sampleLiftPath(path,path.distances[at],sample,side);cable.push(sample.x,sample.y,sample.z);}
      }
      this.lines.push({lift,path,count,key,static:group,cable:new Float32Array(cable)});
      for(let i=1;i<path.supports.length-1;i++){
        const p=path.supports[i],ground=terrain.height(p.x,p.z),height=Math.max(1,p.y-ground);
        const next=path.supports[i+1],heading=Math.atan2(next.x-p.x,next.z-p.z);
        const x=p.x+Math.cos(heading)*1.9,z=p.z-Math.sin(heading)*1.9;
        towerParts.push(box(x,ground+height/2,z,0.38,height,0.38),new THREE.BoxGeometry(5.2,0.28,0.55).rotateY(heading).translate(x,p.y,z));
      }
      for(const top of [false,true]){
        const d=top?path.lengthM:0;sampleLiftPath(path,d,sample);
        // A cropped source line must not invent a loading terminal at the pack edge.
        if(!lift.stations?.some(p=>Math.hypot(p.x-sample.x,p.z-sample.z)<2))continue;
        const station=new THREE.Group();station.position.set(sample.x,sample.y-RIDER_DROP_M,sample.z);station.rotation.y=sample.heading;
        // Side columns leave the loading/unloading lane clear; textured terminal hood.
        station.add(new THREE.Mesh(merge([box(-3,1.8,0,0.45,3.6,0.45),box(3,1.8,0,0.45,3.6,0.45),box(0,3.8,0,7,0.8,4)]),paint));
        if (typeof document !== "undefined") {
        const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
        const ctx=canvas.getContext('2d')!;ctx.fillStyle='#132c3a';ctx.fillRect(0,0,512,128);ctx.fillStyle='#fff9df';ctx.textAlign='center';ctx.font='bold 32px sans-serif';ctx.fillText(lift.name,256,51,490);ctx.font='22px sans-serif';ctx.fillText(top?'UNLOAD →':'SKI IN TO BOARD',256,95);
        const nameMap=new THREE.CanvasTexture(canvas);nameMap.colorSpace=THREE.SRGBColorSpace;
        const sign=new THREE.Mesh(new THREE.PlaneGeometry(6,1.5),new THREE.MeshBasicMaterial({map:nameMap,side:THREE.DoubleSide}));sign.name="lift-station-label";sign.position.set(0,4.8,-2.1);sign.visible=false;station.add(sign);
        this.stationLabels.push({mesh:sign,x:station.position.x,z:station.position.z});
        }
        group.add(station);
      }
    }
    this.cablePositions=new Float32Array(this.lines.reduce((sum,line)=>sum+line.cable.length,0));
    const cableGeometry=new THREE.BufferGeometry();
    cableGeometry.setAttribute("position",new THREE.BufferAttribute(this.cablePositions,3).setUsage(THREE.DynamicDrawUsage));
    cableGeometry.setDrawRange(0,0);
    this.cables=new THREE.LineSegments(cableGeometry,new THREE.LineBasicMaterial({color:0x3b4853}));
    this.cables.name="lift-cables";this.cables.frustumCulled=false;this.cables.visible=false;scene.add(this.cables);
    if(towerParts.length){const towers=new THREE.Mesh(merge(towerParts),metal);towers.castShadow=true;scene.add(towers);}
    for(const [key,capacity] of capacities){
      let geometry:THREE.BufferGeometry;
      if(key==='shuttle') geometry=merge([box(0,-1.4,0,0.09,2.8,0.09),box(0,-2.8,0,2,0.12,0.12),box(-0.75,-3.05,0,0.09,0.5,0.09),box(0,-3.05,0,0.09,0.5,0.09),box(0.75,-3.05,0,0.09,0.5,0.09)]);
      else if(key==='surface') geometry=merge([box(0,-1.5,0,0.08,3,0.08),box(0,-2.9,0,1.2,0.15,0.3)]);
      else if(key==='gondola') geometry=merge([box(0,-0.7,0,0.12,1.4,0.12),box(0,-2.45,0,2.2,2.1,1.8),box(0,-1.8,-0.92,1.85,0.6,0.08)]);
      else {
        const seats=Number(key.split('-')[1]),width=seats*0.5;
        const parts=[box(0,-1,0,0.09,2,0.09),box(0,-2.2,-0.36,width,0.8,0.13),box(0,-2.1,0.46,width,0.08,0.08)];
        for(let i=0;i<seats;i++)parts.push(box((i-(seats-1)/2)*0.5,-2.6,0,0.46,0.15,0.8));
        geometry=merge(parts);
      }
      const mesh=new THREE.InstancedMesh(geometry,paint,capacity);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=true;mesh.count=0;mesh.visible=false;scene.add(mesh);this.batches.set(key,{mesh,count:0});
    }
  }
  update(state:SimulationState):void {
    for(const label of this.stationLabels){
      const dx=label.x-state.pos.x,dz=label.z-state.pos.z;
      label.mesh.visible=dx*dx+dz*dz<=STATION_LABEL_DISTANCE_M*STATION_LABEL_DISTANCE_M;
    }
    for(const batch of this.batches.values())batch.count=0;
    for(let index=0;index<this.lines.length;index++){
      const line=this.lines[index],batch=this.batches.get(line.key)!;
      let nearby=false;
      for(const p of line.path.supports)if(Math.hypot(p.x-state.pos.x,p.z-state.pos.z)<1200){nearby=true;break;}
      if(line.static.visible!==nearby)this.cablesDirty=true;
      line.static.visible=nearby;if(!nearby && state.liftIndex!==index)continue;
      for(let i=0;i<line.count*2;i++){
        const side=i%2,travel=state.time*liftSpeed(line.lift)+(i>>1)*line.path.lengthM/line.count;
        const phase=line.key==='shuttle' ? line.path.lengthM-Math.abs((travel%(line.path.lengthM*2))-line.path.lengthM) : travel%line.path.lengthM;
        sampleLiftPath(line.path,side?line.path.lengthM-phase:phase,sample,side?3.8:0);
        if(Math.hypot(sample.x-state.pos.x,sample.z-state.pos.z)>850)continue;
        // A loaded carrier occupies the shared uphill cable, no ghost chair through the rider.
        if(!side && state.liftIndex===index && Math.abs(phase-state.liftDistanceM)<5)continue;
        object.position.set(sample.x,sample.y,sample.z);object.rotation.set(0,sample.heading+(side?Math.PI:0),0);object.updateMatrix();batch.mesh.setMatrixAt(batch.count++,object.matrix);
      }
      if(state.liftIndex===index){
        sampleLiftPath(line.path,state.liftDistanceM,sample);object.position.set(sample.x,sample.y,sample.z);object.rotation.set(0,sample.heading,0);object.updateMatrix();matrix.copy(object.matrix);batch.mesh.setMatrixAt(batch.count++,matrix);
      }
    }
    // Exact original segments, compacted only when line eligibility changes.
    // A single shared draw replaces one identical-material draw per lift.
    if(this.cablesDirty){
      let offset=0;
      for(const line of this.lines)if(line.static.visible){this.cablePositions.set(line.cable,offset);offset+=line.cable.length;}
      this.cables.geometry.setDrawRange(0,offset/3);this.cables.visible=offset>0;
      this.cables.geometry.getAttribute("position").needsUpdate=true;this.cablesDirty=false;
    }
    for(const batch of this.batches.values()){batch.mesh.count=batch.count;batch.mesh.visible=batch.count>0;batch.mesh.instanceMatrix.needsUpdate=true;}
  }
}
