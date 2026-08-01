import * as THREE from "three";

export interface AtmosphereUniforms {
  density: THREE.IUniform<number>;
  heightFalloff: THREE.IUniform<number>;
  referenceHeight: THREE.IUniform<number>;
  blue: THREE.IUniform<THREE.Color>;
  warm: THREE.IUniform<THREE.Color>;
  sunDirection: THREE.IUniform<THREE.Vector3>;
}

export function fogExp2Amount(density: number, distance: number): number {
  return 1 - Math.exp(-((density * distance) ** 2));
}

export function heightFogAmount(density: number, distance: number, worldY: number, referenceHeight: number, heightFalloff: number): number {
  const height = Math.exp(-heightFalloff * Math.max(worldY - referenceHeight, 0));
  return 1 - Math.exp(-((density * distance) ** 2) * height);
}

export function addHeightFog(material: THREE.Material, uniforms: AtmosphereUniforms): void {
  if (material.userData.heightFog === false || material.userData.heightFogConfigured === true) return;
  material.userData.heightFogConfigured = true;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    Object.assign(shader.uniforms, { uFogDensity: uniforms.density, uFogHeightFalloff: uniforms.heightFalloff, uFogReferenceHeight: uniforms.referenceHeight, uFogBlue: uniforms.blue, uFogWarm: uniforms.warm, uFogSunDirection: uniforms.sunDirection });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAtmosphereWorldPosition;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvAtmosphereWorldPosition=(modelMatrix*vec4(transformed,1.)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uFogDensity,uFogHeightFalloff,uFogReferenceHeight;uniform vec3 uFogBlue,uFogWarm,uFogSunDirection;varying vec3 vAtmosphereWorldPosition;")
      .replace("#include <fog_fragment>", `
vec3 atmosphereRay=vAtmosphereWorldPosition-cameraPosition;
float atmosphereDistance=length(atmosphereRay);
float atmosphereHeight=exp(-uFogHeightFalloff*max(vAtmosphereWorldPosition.y-uFogReferenceHeight,0.));
float atmosphereFog=1.-exp(-uFogDensity*uFogDensity*atmosphereDistance*atmosphereDistance*atmosphereHeight);
float atmosphereSun=pow(max(dot(normalize(atmosphereRay),normalize(uFogSunDirection)),0.),3.);
gl_FragColor.rgb=mix(gl_FragColor.rgb,mix(uFogBlue,uFogWarm,atmosphereSun),clamp(atmosphereFog,0.,1.));`);
  };
  material.customProgramCacheKey = () => `${previousKey()}|peakcam-height-fog-v1`;
  material.needsUpdate = true;
}
