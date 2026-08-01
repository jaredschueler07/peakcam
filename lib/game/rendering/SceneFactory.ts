import * as THREE from "three";
import type { ResortGameProfile } from "../config/schema";

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  skier: THREE.Group;
}

export function createScene(profile: ResortGameProfile, aspect: number): GameScene {
  const weather = profile.weather[0];
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(weather.hor);
  scene.fog = new THREE.FogExp2(weather.fogCol, weather.fog);
  const camera = new THREE.PerspectiveCamera(64, aspect, 0.4, 2600);
  scene.add(new THREE.HemisphereLight(weather.hor, 0x718199, weather.hemi));
  const sun = new THREE.DirectionalLight(0xfff1d6, weather.sun);
  sun.position.set(-80, 120, -70);
  scene.add(sun);

  const skier = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: profile.accent, roughness: 0.72 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1f3322, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), bodyMaterial);
  body.position.y = 1.2;
  const skis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 2.4), darkMaterial);
  skis.position.y = 0.12;
  skier.add(body, skis);
  scene.add(skier);
  return { scene, camera, skier };
}

