import * as THREE from "three";

const DETAIL_SIZE = 256;
const POSTER_CREAM = new THREE.Color("#faf4e6");
const POSTER_INK = new THREE.Color("#2a1f14");
const POSTER_FOREST = new THREE.Color("#3c5a3a");
const POSTER_ALPEN = new THREE.Color("#d9552f");
const colorDistance = (a: THREE.Color, b: THREE.Color) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(y + seed, 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

export function buildSnowDetailNormal(seed: number): THREE.DataTexture {
  const heights = new Float32Array(DETAIL_SIZE * DETAIL_SIZE);
  for (let y = 0; y < DETAIL_SIZE; y += 1) for (let x = 0; x < DETAIL_SIZE; x += 1) {
    heights[y * DETAIL_SIZE + x] = valueNoise(x / 9, y / 9, seed) * 0.72 + valueNoise(x / 3, y / 3, seed ^ 0x51f2) * 0.28;
  }
  const data = new Uint8Array(DETAIL_SIZE * DETAIL_SIZE * 4);
  const sample = (x: number, y: number) => heights[((y + DETAIL_SIZE) % DETAIL_SIZE) * DETAIL_SIZE + ((x + DETAIL_SIZE) % DETAIL_SIZE)];
  for (let y = 0; y < DETAIL_SIZE; y += 1) for (let x = 0; x < DETAIL_SIZE; x += 1) {
    const gx = sample(x + 1, y - 1) + 2 * sample(x + 1, y) + sample(x + 1, y + 1) - sample(x - 1, y - 1) - 2 * sample(x - 1, y) - sample(x - 1, y + 1);
    const gy = sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1) - sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1);
    const inverseLength = 1 / Math.hypot(gx * 1.8, gy * 1.8, 1);
    const at = (y * DETAIL_SIZE + x) * 4;
    data[at] = Math.round((gx * 1.8 * inverseLength * 0.5 + 0.5) * 255);
    data[at + 1] = Math.round((gy * 1.8 * inverseLength * 0.5 + 0.5) * 255);
    data[at + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
    data[at + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  return texture;
}

export function buildPosterLut(size = 32): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  const source = new THREE.Color(), graded = new THREE.Color();
  let at = 0;
  for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) {
    source.setRGB(r / (size - 1), g / (size - 1), b / (size - 1)); graded.copy(source);
    const luminance = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722;
    graded.lerp(POSTER_INK, Math.max(0, 0.32 - luminance) * 0.24);
    graded.lerp(POSTER_CREAM, Math.max(0, luminance - 0.72) * 0.16);
    const accentDistance = Math.min(colorDistance(source, POSTER_FOREST), colorDistance(source, POSTER_ALPEN));
    const preserve = Math.max(0, 1 - accentDistance * 3.2);
    graded.lerp(source, preserve * 0.8);
    data[at++] = Math.round(THREE.MathUtils.clamp(graded.r, 0, 1) * 255);
    data[at++] = Math.round(THREE.MathUtils.clamp(graded.g, 0, 1) * 255);
    data[at++] = Math.round(THREE.MathUtils.clamp(graded.b, 0, 1) * 255);
    data[at++] = 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat; texture.type = THREE.UnsignedByteType;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  return texture;
}

export interface SnowUniforms {
  horizon: THREE.IUniform<THREE.Color>;
  glint: THREE.IUniform<number>;
  track: THREE.IUniform<THREE.Vector4>;
}

export function polishSnowMaterial(material: THREE.MeshStandardMaterial, detailNormal: THREE.Texture, uniforms: SnowUniforms): void {
  material.customProgramCacheKey = () => "peakcam-snow-p6-v1";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uSnowDetail: { value: detailNormal }, uSnowHorizon: uniforms.horizon, uSnowGlint: uniforms.glint, uSnowTrack: uniforms.track });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSnowWorldPosition; varying vec3 vSnowWorldNormal;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvSnowWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz; vSnowWorldNormal = normalize(mat3(modelMatrix) * objectNormal);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D uSnowDetail; uniform vec3 uSnowHorizon; uniform float uSnowGlint; uniform vec4 uSnowTrack;
varying vec3 vSnowWorldPosition; varying vec3 vSnowWorldNormal;
float snowHash(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
vec3 snowFlake(vec3 p){ return normalize(vec3(snowHash(p)-.5,snowHash(p+17.3)-.5,snowHash(p+41.7)-.5)); }
float segmentDistance(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a,ba=b-a; return length(pa-ba*clamp(dot(pa,ba)/max(dot(ba,ba),.001),0.,1.)); }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
vec3 snowWeights=pow(abs(normalize(vSnowWorldNormal)),vec3(4.)); snowWeights/=max(dot(snowWeights,vec3(1.)),.001);
float snowDistance=length(vViewPosition); float snowNear=1.-smoothstep(28.,105.,snowDistance);
vec3 snowN1=texture2D(uSnowDetail,vSnowWorldPosition.yz/0.35).xyz*2.-1.;
snowN1=snowN1*snowWeights.x+(texture2D(uSnowDetail,vSnowWorldPosition.xz/0.35).xyz*2.-1.)*snowWeights.y+(texture2D(uSnowDetail,vSnowWorldPosition.xy/0.35).xyz*2.-1.)*snowWeights.z;
vec3 snowN2=texture2D(uSnowDetail,vSnowWorldPosition.yz/3.).xyz*2.-1.;
snowN2=snowN2*snowWeights.x+(texture2D(uSnowDetail,vSnowWorldPosition.xz/3.).xyz*2.-1.)*snowWeights.y+(texture2D(uSnowDetail,vSnowWorldPosition.xy/3.).xyz*2.-1.)*snowWeights.z;
normal=normalize(normal+mat3(viewMatrix)*mix(snowN2,snowN1,snowNear)*mix(.08,.22,snowNear));`)
      .replace("#include <opaque_fragment>", `
vec3 snowN=normalize(vSnowWorldNormal), snowV=normalize(cameraPosition-vSnowWorldPosition), snowL=normalize(vec3(-.46,.62,-.64));
float snowWrap=clamp((dot(snowN,snowL)+.5)/1.5,0.,1.);
float snowRim=pow(1.-clamp(dot(snowN,snowV),0.,1.),3.);
vec3 snowHalf=normalize(snowV+snowL);
float snowG1=pow(max(dot(snowFlake(floor(vSnowWorldPosition*7.)),snowHalf),0.),400.);
float snowG2=pow(max(dot(snowFlake(floor(vSnowWorldPosition*19.)+53.),snowHalf),0.),2000.);
float snowTrack=1.-smoothstep(.24,.62,segmentDistance(vSnowWorldPosition.xz,uSnowTrack.xy,uSnowTrack.zw));
outgoingLight=mix(outgoingLight,vec3(.6588,.7686,.9098),(1.-snowWrap)*.08);
outgoingLight+=diffuseColor.rgb*snowWrap*.04+vec3(.68,.86,.96)*pow(clamp(dot(snowV,-snowL),0.,1.),4.)*.025;
outgoingLight+=uSnowHorizon*snowRim*.055;
outgoingLight+=vec3(step(.72,snowG1)*snowG1+step(.82,snowG2)*snowG2)*uSnowGlint*(1.-snowTrack)*.35;
#include <opaque_fragment>`);
  };
  material.needsUpdate = true;
}
