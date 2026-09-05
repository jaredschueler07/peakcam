import * as THREE from 'three';
import type { RealJunction, SimulationState, TerrainSampler } from '../core/types';

export const SIGN_POOL_SIZE = 4;
export const ROPE_POOL_SIZE = 96;
const SIGN_RADIUS_M = 220;
interface RopeSpan { run:number; ax:number;ay:number;az:number; bx:number;by:number;bz:number; mx:number;my:number;mz:number }
interface SignSlot { group:THREE.Group; texture:THREE.Texture; context:CanvasRenderingContext2D|null; junction:number }

const EASY = {symbol:'●',color:'#4dc77a'};
const INTERMEDIATE = {symbol:'■',color:'#5cb8ff'};
const ADVANCED = {symbol:'◆',color:'#ffffff'};
const EXPERT = {symbol:'◆◆',color:'#ffffff'};
const UNKNOWN = {symbol:'?',color:'#e6d6b8'};
const EMPTY_JUNCTIONS: readonly RealJunction[] = [];
export function difficultyMarker(difficulty:string|null):{symbol:string;color:string} {
  if (difficulty==='novice'||difficulty==='easy') return EASY;
  if (difficulty==='intermediate') return INTERMEDIATE;
  if (difficulty==='expert'||difficulty==='freeride') return EXPERT;
  if (difficulty==='advanced') return ADVANCED;
  return UNKNOWN;
}

/** Procedural wood and real names, painted only when a pooled sign changes. */
export function paintJunctionSign(ctx:CanvasRenderingContext2D,junction:RealJunction):void {
  ctx.fillStyle='#463322';ctx.fillRect(0,0,512,256);
  for(let y=0;y<256;y+=3){ctx.fillStyle=y%9===0?'#503b28':'#493622';ctx.fillRect(0,y,512,1);}
  ctx.strokeStyle='#bd9a63';ctx.lineWidth=5;ctx.strokeRect(5,5,502,246);
  ctx.textBaseline='middle';ctx.font='bold 28px system-ui, sans-serif';
  ctx.fillStyle='#f6e9d0';ctx.fillText('TRAIL JUNCTION',22,29);
  const count=Math.min(3,junction.choices.length);
  for(let i=0;i<count;i++){
    const choice=junction.choices[i],marker=difficultyMarker(choice.difficulty),y=82+i*62;
    ctx.fillStyle=marker.color;ctx.fillText(marker.symbol,20,y,55);
    ctx.fillStyle='#ffffff';ctx.fillText(choice.name,88,y,402);
  }
}

function woodTexture():THREE.DataTexture {
  const data=new Uint8Array(32*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
    const at=(y*32+x)*4,grain=8*Math.sin(x*3+y*.3);
    data[at]=93+grain;data[at+1]=67+grain;data[at+2]=41+grain;data[at+3]=255;
  }
  const texture=new THREE.DataTexture(data,32,32);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.needsUpdate=true;return texture;
}

/** Terrain-draped course-edge ropes. Open junctions remain traversable. */
export function buildBoundaryRopes(terrain:TerrainSampler):RopeSpan[] {
  const spans:RopeSpan[]=[];
  for(let runIndex=0;runIndex<(terrain.realRuns?.length??0);runIndex++){
    const run=terrain.realRuns![runIndex];
    if(['backcountry','mogul','no'].includes(run.grooming??''))continue;
    for(let i=1;i<run.points.length;i++){
      const a=run.points[i-1],b=run.points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
      if(length<1)continue;
      const pieces=Math.ceil(length/22),rightX=dz/length,rightZ=-dx/length;
      for(let piece=0;piece<pieces;piece++)for(let side=-1;side<=1;side+=2){
        const offset=side*(run.halfWidthM+2),t0=piece/pieces,t1=(piece+1)/pieces;
        const ax=a.x+dx*t0+rightX*offset,az=a.z+dz*t0+rightZ*offset;
        const bx=a.x+dx*t1+rightX*offset,bz=a.z+dz*t1+rightZ*offset;
        const mx=(ax+bx)/2,mz=(az+bz)/2;
        if(terrain.nearbyJunction?.(mx,mz,28)||terrain.nearbyJunction?.(ax,az,28)||terrain.nearbyJunction?.(bx,bz,28))continue;
        const ay=terrain.height(ax,az)+1.1,by=terrain.height(bx,bz)+1.1,my=terrain.height(mx,mz)+.8;
        // Do not suspend giant rope beams across unsurveyed cliff shortcuts.
        if(Math.abs(ay-by)>12||Math.abs(my-(ay+by)/2)>3)continue;
        spans.push({run:runIndex,ax,ay,az,bx,by,bz,mx,my,mz});
      }
    }
  }
  return spans;
}

/** Four physical wood signs and a fixed rope/post instance pool on both backends. */
export class TrailSigns {
  readonly group=new THREE.Group();
  private readonly signs:SignSlot[]=[];
  private readonly spans:RopeSpan[];
  private readonly wood=woodTexture();
  private readonly poleGeometry=new THREE.CylinderGeometry(.1,.15,3.4,6);
  private readonly faceGeometry=new THREE.PlaneGeometry(6.2,3.1);
  private readonly poleMaterial=new THREE.MeshStandardMaterial({map:this.wood,roughness:.95});
  private readonly ropeGeometry=new THREE.CylinderGeometry(.045,.045,1,4);
  private readonly ropeMaterial=new THREE.MeshStandardMaterial({map:this.wood,color:0xf9aa46,roughness:.85});
  private readonly postGeometry=new THREE.CylinderGeometry(.06,.08,1.2,5);
  private readonly ropes=new THREE.InstancedMesh(this.ropeGeometry,this.ropeMaterial,ROPE_POOL_SIZE*2);
  private readonly posts=new THREE.InstancedMesh(this.postGeometry,this.poleMaterial,ROPE_POOL_SIZE*2);
  private readonly signIds=new Int32Array(SIGN_POOL_SIZE);
  private readonly signDistances=new Float64Array(SIGN_POOL_SIZE);
  private readonly ropeIds=new Int32Array(ROPE_POOL_SIZE);
  private readonly ropeDistances=new Float64Array(ROPE_POOL_SIZE);
  private readonly matrix=new THREE.Matrix4();
  private readonly position=new THREE.Vector3();
  private readonly scale=new THREE.Vector3();
  private readonly direction=new THREE.Vector3();
  private readonly rotation=new THREE.Quaternion();
  private readonly up=new THREE.Vector3(0,1,0);
  private lastX=Infinity;private lastZ=Infinity;private lastRun=-1;

  constructor(private readonly terrain:TerrainSampler){
    this.group.name='real-trail-junction-signs';this.spans=buildBoundaryRopes(terrain);
    for(let i=0;i<SIGN_POOL_SIZE;i++){
      const canvas=typeof document==='undefined'?null:document.createElement('canvas');
      if(canvas){canvas.width=512;canvas.height=256;}
      const context=canvas?.getContext('2d')??null;
      const texture=context?new THREE.CanvasTexture(canvas!):this.wood;
      texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.MeshStandardMaterial({map:texture,roughness:.9,emissive:0xffffff,emissiveMap:texture,emissiveIntensity:.16});
      const group=new THREE.Group(),post=new THREE.Mesh(this.poleGeometry,this.poleMaterial);
      post.position.y=1.7;group.add(post);
      const front=new THREE.Mesh(this.faceGeometry,material),back=new THREE.Mesh(this.faceGeometry,material);
      front.position.set(0,3,.09);back.position.set(0,3,-.09);back.rotation.y=Math.PI;
      group.add(front,back);group.visible=false;
      this.group.add(group);this.signs.push({group,texture,context,junction:-1});
    }
    this.ropes.count=this.posts.count=0;this.ropes.frustumCulled=this.posts.frustumCulled=false;
    this.ropes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.posts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.ropes,this.posts);
  }

  update(state:SimulationState):void {
    const x=state.pos.x,z=state.pos.z;
    if((x-this.lastX)**2+(z-this.lastZ)**2<64&&state.selectedTrail===this.lastRun)return;
    this.lastX=x;this.lastZ=z;this.lastRun=state.selectedTrail;
    this.signIds.fill(-1);this.signDistances.fill(SIGN_RADIUS_M*SIGN_RADIUS_M);
    const junctions=this.terrain.junctions??EMPTY_JUNCTIONS;
    for(let i=0;i<junctions.length;i++){
      const j=junctions[i],d=(j.x-x)**2+(j.z-z)**2;
      this.insertNearest(i,d,this.signIds,this.signDistances);
    }
    for(let i=0;i<this.signs.length;i++){
      const slot=this.signs[i],index=this.signIds[i];slot.group.visible=index>=0;
      if(index<0)continue;
      const junction=junctions[index],side=junction.halfWidthM+4;
      const sx=junction.x+Math.cos(junction.heading)*side-Math.sin(junction.heading)*12;
      const sz=junction.z-Math.sin(junction.heading)*side-Math.cos(junction.heading)*12;
      slot.group.position.set(sx,this.terrain.height(sx,sz),sz);slot.group.rotation.y=junction.heading+Math.PI;
      if(slot.junction!==index){
        slot.junction=index;
        if(slot.context){paintJunctionSign(slot.context,junction);slot.texture.needsUpdate=true;}
      }
    }
    this.ropeIds.fill(-1);this.ropeDistances.fill(180*180);
    for(let i=0;i<this.spans.length;i++){
      const span=this.spans[i];if(span.run!==state.selectedTrail)continue;
      this.insertNearest(i,(span.mx-x)**2+(span.mz-z)**2,this.ropeIds,this.ropeDistances);
    }
    let count=0;
    for(let i=0;i<this.ropeIds.length;i++){
      const index=this.ropeIds[i];if(index<0)break;
      const span=this.spans[index];
      this.ropePart(count,span.ax,span.ay,span.az,span.mx,span.my,span.mz);
      this.ropePart(count+1,span.mx,span.my,span.mz,span.bx,span.by,span.bz);
      this.post(count,span.ax,span.ay-.5,span.az);this.post(count+1,span.bx,span.by-.5,span.bz);count+=2;
    }
    this.ropes.count=this.posts.count=count;
    this.ropes.instanceMatrix.needsUpdate=this.posts.instanceMatrix.needsUpdate=true;
  }

  private insertNearest(index:number,distance:number,ids:Int32Array,distances:Float64Array):void {
    for(let at=0;at<ids.length;at++)if(distance<distances[at]){
      for(let j=ids.length-1;j>at;j--){ids[j]=ids[j-1];distances[j]=distances[j-1];}
      ids[at]=index;distances[at]=distance;break;
    }
  }
  private ropePart(index:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number):void {
    this.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);
    this.direction.set(bx-ax,by-ay,bz-az);const length=this.direction.length();
    this.direction.multiplyScalar(1/(length||1));this.rotation.setFromUnitVectors(this.up,this.direction);this.scale.set(1,length,1);
    this.matrix.compose(this.position,this.rotation,this.scale);this.ropes.setMatrixAt(index,this.matrix);
  }
  private post(index:number,x:number,y:number,z:number):void {
    this.position.set(x,y,z);this.rotation.identity();this.scale.set(1,1,1);
    this.matrix.compose(this.position,this.rotation,this.scale);this.posts.setMatrixAt(index,this.matrix);
  }
  dispose():void {
    this.group.removeFromParent();
    for(const sign of this.signs){
      const material=(sign.group.children[1] as THREE.Mesh).material as THREE.Material;material.dispose();
      if(sign.texture!==this.wood)sign.texture.dispose();
    }
    this.wood.dispose();this.poleGeometry.dispose();this.faceGeometry.dispose();this.poleMaterial.dispose();
    this.ropeGeometry.dispose();this.ropeMaterial.dispose();this.postGeometry.dispose();this.ropes.dispose();this.posts.dispose();
    this.group.clear();
  }
}
