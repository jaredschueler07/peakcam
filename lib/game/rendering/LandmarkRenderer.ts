import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";
import type { TerrainSampler } from "../core/types";
import baked from "../../../public/game/terrain/landmarks.json";

export const LANDMARK_COORDINATES = {
  "ski-portillo": {
    lake: { x: -351, z: -2172, elevationM: 2849 },
    hotel: { x: baked.hotel.center[0], z: baked.hotel.center[1] },
  },
  heavenly: {
    lake: { x: -1450, z: -2920, elevationM: 1897 },
  },
  breckenridge: {
    townGlow: { x: 2820, z: -420 },
  },
} as const;

type LakeData = typeof baked.lakes[keyof typeof baked.lakes];

/** Small authored textures: no downloaded photo is shipped as an asset. */
function facadeTexture(red:number,green:number,blue:number):THREE.DataTexture {
  const size=32,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(y*size+x)*4,frame=x>=7&&x<=24&&y>=7&&y<=24;
    const glass=x>=9&&x<=22&&y>=9&&y<=22;
    data[at]=glass?49:frame?230:red;data[at+1]=glass?79:frame?228:green;data[at+2]=glass?102:frame?205:blue;data[at+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.25,1/3);texture.needsUpdate=true;return texture;
}
function detailTexture(normal:boolean):THREE.DataTexture {
  const size=32,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const at=(y*size+x)*4,wave=Math.sin(x*.7+y*.4);
    data[at]=normal?128+wave*19:224+wave*9;
    data[at+1]=normal?128+Math.sin(x*.3-y*.8)*19:232+wave*9;
    data[at+2]=normal?253:238+wave*9;data[at+3]=255;
  }
  const texture=new THREE.DataTexture(data,size,size);
  if(!normal)texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(.075,.075);texture.needsUpdate=true;return texture;
}
function polygonShape(points:readonly number[][],cx=0,cz=0):THREE.Shape {
  return new THREE.Shape(points.map(p=>new THREE.Vector2(p[0]-cx,-(p[1]-cz))));
}
function water(data:LakeData,color:number):THREE.Mesh {
  const shape=polygonShape(data.outer);
  for(const hole of data.holes)shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(p[0],-p[1]))));
  const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(-Math.PI/2);
  const material=new THREE.MeshStandardMaterial({color,normalMap:detailTexture(true),normalScale:new THREE.Vector2(.2,.2),roughness:.22,metalness:.14,side:THREE.DoubleSide,fog:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.position.y=data.elevationM;
  mesh.userData.sourceId=data.sourceId;mesh.userData.waterElevationSource=data.elevationSource;
  mesh.userData.farFieldSupported=true;
  // Real lakes extend beyond the streamed DEM tiles and are supported by the
  // baked 30km mesh. Omitting terrainFootprint keeps their real far silhouette.
  return mesh;
}
function hotel(terrain:TerrainSampler):THREE.Group {
  const data=baked.hotel,[cx,cz]=data.center,group=new THREE.Group();
  group.name='portillo-hotel';group.position.set(cx,terrain.height(cx,cz),cz);
  const yellow=new THREE.MeshStandardMaterial({map:facadeTexture(244,186,32),roughness:.85});
  const timber=new THREE.MeshStandardMaterial({map:facadeTexture(121,73,36),roughness:.92});
  const blue=new THREE.MeshStandardMaterial({map:facadeTexture(29,129,161),roughness:.82});
  const roof=new THREE.MeshStandardMaterial({map:detailTexture(false),roughness:.95});
  for(const [points,height,material] of [[data.main,data.mainHeightM,yellow],[data.annex,data.annexHeightM,timber]] as const){
    const geometry=new THREE.ExtrudeGeometry(polygonShape(points,cx,cz),{depth:height,bevelEnabled:false,steps:1});
    geometry.rotateX(-Math.PI/2);
    const wing=new THREE.Mesh(geometry,[roof,material]);wing.castShadow=true;group.add(wing);
  }
  const tower=new THREE.Mesh(new THREE.BoxGeometry(data.tower.width,data.tower.height,data.tower.depth),[blue,blue,roof,roof,blue,blue]);
  const towerUv=tower.geometry.getAttribute("uv") as THREE.BufferAttribute;
  for(let i=0;i<towerUv.count;i++)towerUv.setXY(i,towerUv.getX(i)*data.tower.width,towerUv.getY(i)*data.tower.height);
  tower.position.set(data.tower.x-cx,data.tower.height/2,data.tower.z-cz);tower.castShadow=true;group.add(tower);
  const xs=data.footprint.map(p=>p[0]),zs=data.footprint.map(p=>p[1]);
  group.userData.terrainFootprint={halfX:(Math.max(...xs)-Math.min(...xs))/2,halfZ:(Math.max(...zs)-Math.min(...zs))/2};
  group.userData.sourceId=data.sourceId;group.userData.reference=data.reference;return group;
}

export function createLandmarks(profile: ResortGameProfile, terrain: TerrainSampler): THREE.Group {
  const group = new THREE.Group();
  const coordinates = LANDMARK_COORDINATES[profile.slug];
  group.userData.coordinates = coordinates;
  group.name = `${profile.slug}-landmarks`;
  if (profile.slug === "ski-portillo") {
    const lake = water(baked.lakes["ski-portillo"],0x338f9f);
    lake.name="portillo-lake";
    group.add(lake,hotel(terrain));
  } else if (profile.slug === "heavenly") {
    const lake = water(baked.lakes.heavenly,0x357da3);
    lake.name="heavenly-lake";group.add(lake);
  } else {
    const coordinates = LANDMARK_COORDINATES.breckenridge;
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(480, 90),
      new THREE.MeshBasicMaterial({ color: 0xffc35a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true }),
    );
    glow.name = "breckenridge-town-glow";
    // The billboard is rotated 90° below, so its long local-X axis lies on world Z.
    glow.userData.terrainFootprint = { halfX: 10, halfZ: 240 };
    glow.position.set(coordinates.townGlow.x, terrain.height(coordinates.townGlow.x, coordinates.townGlow.z) + 75, coordinates.townGlow.z);
    glow.rotation.y = -Math.PI / 2;
    group.add(glow);
  }
  return group;
}
