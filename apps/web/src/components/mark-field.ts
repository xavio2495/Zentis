import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from "three";
import { BAR, sampleMark } from "@/lib/mark-geometry";
import { CAMERA_Z, FOV_DEGREES, fieldState } from "@/lib/field-state";

/**
 * The field: a doorway, the mark, and the light behind both.
 *
 * Three clouds share one shader. The doorway is a standing rectangle the reader
 * comes through on the first screen. The mark is the logo — two chains in
 * near-white and the connector between them in the accent, because the
 * connector is the claim. The starfield is the room it all happens in.
 *
 * Scroll drives one computation, kept in field-state so it can be tested
 * without a canvas; everything here only applies what it returns.
 */

const COUNT = 6000;
const MARK_SCALE = 9;
const ACCENT = [0x00 / 255, 0xed / 255, 0x64 / 255] as const;

/** The doorway, in world units: tall and narrow, the mark suspended inside it. */
const DOOR_FRAME = 900;
const DOOR_RISING = 260;
const DOOR_FOOT = 80;
const DOOR_ASPECT = 2.6;

const STARS_NEAR = 700;
const STARS_FAR = 900;

const vertexShader = `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
attribute float aRise;
attribute vec3 aScatterDir;
uniform float uScale;
uniform float uTime;
uniform float uMotion;
uniform float uScatter;
uniform float uMinPx;
uniform float uDoorBottom;
uniform float uDoorHeight;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vec3 p = position + aScatterDir * uScatter;

  // Points with a rise drift up the doorway and wrap, fading at both ends so
  // they are never seen to appear or to stop.
  float fade = 1.0;
  if (aRise > 0.0) {
    float y = mod(p.y - uDoorBottom + uTime * aRise * uMotion, uDoorHeight);
    fade = smoothstep(0.0, 0.08, y / uDoorHeight) * (1.0 - smoothstep(0.86, 1.0, y / uDoorHeight));
    p.y = uDoorBottom + y;
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.1);
  gl_PointSize = max(aSize * uScale / depth, uMinPx);
  float twinkle = 1.0 - 0.45 * uMotion * (0.5 + 0.5 * sin(uTime * (1.4 + fract(aPhase) * 1.3) + aPhase * 6.283));
  vAlpha = twinkle * fade * smoothstep(0.12, 1.1, depth) * (1.0 - uScatter * 0.55);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 q = gl_PointCoord - vec2(0.5);
  float d2 = dot(q, q) * 4.0;
  if (d2 >= 1.0) discard;
  float falloff = 1.0 - d2;
  float a = min(1.0, falloff * 1.9) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

interface Cloud {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  phases: Float32Array;
  rise: Float32Array;
  scatter: Float32Array;
}

function emptyCloud(count: number): Cloud {
  return {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    phases: new Float32Array(count),
    rise: new Float32Array(count),
    scatter: new Float32Array(count * 3),
  };
}

function toGeometry(cloud: Cloud): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(cloud.positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(cloud.colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(cloud.sizes, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(cloud.phases, 1));
  geometry.setAttribute("aRise", new BufferAttribute(cloud.rise, 1));
  geometry.setAttribute("aScatterDir", new BufferAttribute(cloud.scatter, 3));
  return geometry;
}

function makeMaterial(reduced: boolean, door: { bottom: number; height: number }) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader,
    fragmentShader,
    uniforms: {
      uOpacity: { value: 0 },
      uScale: { value: 1 },
      uTime: { value: 0 },
      uMotion: { value: reduced ? 0 : 1 },
      uScatter: { value: 0 },
      uMinPx: { value: 1.2 },
      uDoorBottom: { value: door.bottom },
      uDoorHeight: { value: door.height },
    },
  });
}

/** The mark itself, sampled from the logo's three shapes. */
function buildMark(): Cloud {
  const cloud = emptyCloud(COUNT);
  const { positions, roles } = sampleMark({
    count: COUNT,
    outlineShare: 0.26,
    depthJitter: 0.09,
    seed: 1,
  });

  for (let i = 0; i < COUNT; i++) {
    cloud.positions[i * 3] = positions[i * 3] * MARK_SCALE;
    cloud.positions[i * 3 + 1] = positions[i * 3 + 1] * MARK_SCALE;
    cloud.positions[i * 3 + 2] = positions[i * 3 + 2] * MARK_SCALE;

    if (roles[i] === BAR) {
      // the chains: light, with a little variance so the field has grain
      const shade = 0.78 + Math.random() * 0.22;
      cloud.colors[i * 3] = shade;
      cloud.colors[i * 3 + 1] = shade;
      cloud.colors[i * 3 + 2] = shade;
    } else {
      cloud.colors[i * 3] = ACCENT[0];
      cloud.colors[i * 3 + 1] = ACCENT[1];
      cloud.colors[i * 3 + 2] = ACCENT[2];
    }

    cloud.sizes[i] = 0.055 + Math.random() * 0.075;
    cloud.phases[i] = Math.random() * 6.283;

    // outward direction for the scatter at the end of the page
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const reach = 4 + Math.random() * 7;
    cloud.scatter[i * 3] = Math.sin(phi) * Math.cos(theta) * reach;
    cloud.scatter[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * reach;
    cloud.scatter[i * 3 + 2] = Math.cos(phi) * reach;
  }
  return cloud;
}

/**
 * The doorway: a rectangle drawn in points, walked by perimeter so the frame is
 * evenly lit, with a scatter of rising points inside it and a few at its foot.
 */
function buildDoor(height: number): Cloud {
  const total = DOOR_FRAME + DOOR_RISING + DOOR_FOOT;
  const cloud = emptyCloud(total);
  const halfHeight = height / 2;
  const halfWidth = height / DOOR_ASPECT / 2;
  const perimeter = 4 * halfWidth + 4 * halfHeight;
  const depth = halfWidth * 0.5;

  const light = (i: number, warm: number) => {
    cloud.colors[i * 3] = warm;
    cloud.colors[i * 3 + 1] = warm;
    cloud.colors[i * 3 + 2] = warm * 0.98;
  };

  let n = 0;
  for (let i = 0; i < DOOR_FRAME; i++, n++) {
    // walk the rectangle by arc length: right edge, top, left edge, bottom
    let along = ((i + Math.random() * 0.8) / DOOR_FRAME) * perimeter;
    let x: number;
    let y: number;
    if (along < 2 * halfHeight) {
      x = halfWidth;
      y = -halfHeight + along;
    } else if ((along -= 2 * halfHeight) < 2 * halfWidth) {
      x = halfWidth - along;
      y = halfHeight;
    } else if ((along -= 2 * halfWidth) < 2 * halfHeight) {
      x = -halfWidth;
      y = halfHeight - along;
    } else {
      x = -halfWidth + (along - 2 * halfHeight);
      y = -halfHeight;
    }

    // a soft spray either side of the line, so the frame is drawn rather than ruled
    const spread = (Math.random() * 2 - 1) * Math.abs(Math.random()) * halfWidth * 0.1;
    cloud.positions[n * 3] = x + (Math.abs(x) === halfWidth ? spread : 0) + (Math.random() - 0.5) * 0.02;
    cloud.positions[n * 3 + 1] = y + (Math.abs(y) === halfHeight ? spread : 0);
    cloud.positions[n * 3 + 2] = (Math.random() * 2 - 1) * depth;
    light(n, 0.82 + Math.random() * 0.18);
    cloud.sizes[n] = 0.05 + Math.random() * 0.08;
    cloud.phases[n] = Math.random() * 6.283;
  }

  for (let i = 0; i < DOOR_RISING; i++, n++) {
    cloud.positions[n * 3] = (Math.random() * 2 - 1) * (halfWidth - 0.08);
    cloud.positions[n * 3 + 1] = -halfHeight + Math.random() * height;
    cloud.positions[n * 3 + 2] = (Math.random() * 2 - 1) * depth * 1.6;
    light(n, 0.6 + Math.random() * 0.25);
    cloud.sizes[n] = 0.045 + Math.random() * 0.06;
    cloud.phases[n] = Math.random() * 6.283;
    cloud.rise[n] = 0.1 + Math.random() * 0.2;
  }

  for (let i = 0; i < DOOR_FOOT; i++, n++) {
    cloud.positions[n * 3] = (Math.random() * 2 - 1) * halfWidth * (0.6 + Math.random() * 1.2);
    cloud.positions[n * 3 + 1] = -halfHeight - 0.06 - Math.random() * 0.55;
    cloud.positions[n * 3 + 2] = (Math.random() * 2 - 1) * 1.2;
    light(n, 0.45 + Math.random() * 0.3);
    cloud.sizes[n] = 0.05 + Math.random() * 0.07;
    cloud.phases[n] = Math.random() * 6.283;
  }

  return cloud;
}

/** A shell of distant light, flattened a little and pushed behind the camera plane. */
function buildStars(count: number, near: number, far: number): Cloud {
  const cloud = emptyCloud(count);
  for (let i = 0; i < count; i++) {
    const radius = near + Math.random() * (far - near);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    cloud.positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    cloud.positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta) * 0.7;
    cloud.positions[i * 3 + 2] = -Math.abs(radius * Math.cos(phi)) * 0.6 - 4;

    // mostly cold light, with the occasional accented one
    const accented = Math.random() < 0.035;
    const shade = 0.45 + Math.random() * 0.35;
    cloud.colors[i * 3] = accented ? ACCENT[0] : shade;
    cloud.colors[i * 3 + 1] = accented ? ACCENT[1] : shade;
    cloud.colors[i * 3 + 2] = accented ? ACCENT[2] : shade;

    cloud.sizes[i] = 0.09 + Math.random() * 0.2;
    cloud.phases[i] = Math.random() * 6.283;
  }
  return cloud;
}

/** Builds the field into `host`. Returns a teardown. */
export function mountMarkField(host: HTMLElement): () => void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    throw new Error("no webgl");
  }
  if (!renderer.getContext()) throw new Error("no webgl");

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEGREES, innerWidth / innerHeight, 0.1, 300);
  camera.position.z = CAMERA_Z;

  // The doorway is sized against what the camera can see, so it frames the
  // wordmark at any viewport rather than at one.
  const visibleHeight = 2 * Math.tan((FOV_DEGREES / 2) * (Math.PI / 180)) * CAMERA_Z;
  const doorHeight = visibleHeight * 0.62;
  const door = { bottom: -doorHeight / 2, height: doorHeight };

  const markMaterial = makeMaterial(reduced, door);
  const doorMaterial = makeMaterial(reduced, door);
  const starMaterial = makeMaterial(reduced, door);

  const markGeometry = toGeometry(buildMark());
  const doorGeometry = toGeometry(buildDoor(doorHeight));
  const nearGeometry = toGeometry(buildStars(STARS_NEAR, 25, 80));
  const farGeometry = toGeometry(buildStars(STARS_FAR, 30, 90));

  const mark = new Points(markGeometry, markMaterial);
  mark.frustumCulled = false;
  const group = new Group();
  group.add(mark);

  const doorPoints = new Points(doorGeometry, doorMaterial);
  doorPoints.frustumCulled = false;
  const doorGroup = new Group();
  doorGroup.add(doorPoints);

  const near = new Points(nearGeometry, starMaterial);
  const far = new Points(farGeometry, starMaterial);
  near.frustumCulled = false;
  far.frustumCulled = false;

  scene.add(group, doorGroup, near, far);

  const setScale = () => {
    const scale = renderer.domElement.height * 0.5;
    markMaterial.uniforms.uScale.value = scale;
    doorMaterial.uniforms.uScale.value = scale;
    starMaterial.uniforms.uScale.value = scale;
  };

  const resize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    setScale();
  };
  setScale();
  addEventListener("resize", resize);

  let raf = 0;
  const start = performance.now();

  const frame = (now: number) => {
    const time = (now - start) / 1000;

    // Where everything stands, and how brightly, is computed apart from here so
    // the rule that the mark never sits on the text can be held to by test.
    const state = fieldState({
      scrollY,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      docHeight: document.documentElement.scrollHeight,
    });

    group.position.x = state.positionX;
    group.position.z = state.positionZ;
    group.scale.setScalar(state.scale);
    group.rotation.y = state.rotationY + (reduced ? 0 : time * 0.06);
    group.rotation.x = state.rotationX;

    markMaterial.uniforms.uOpacity.value = state.opacity;
    markMaterial.uniforms.uScatter.value = state.scatter;
    markMaterial.uniforms.uTime.value = time;

    doorGroup.scale.setScalar(state.doorScale);
    doorMaterial.uniforms.uOpacity.value = state.doorOpacity;
    doorMaterial.uniforms.uTime.value = time;
    doorPoints.visible = state.doorOpacity > 0.002;

    starMaterial.uniforms.uOpacity.value = state.starfieldOpacity;
    starMaterial.uniforms.uTime.value = time;
    near.rotation.y = reduced ? 0 : time * 0.006;
    far.rotation.y = reduced ? 0 : -time * 0.004;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    host.removeChild(renderer.domElement);
    for (const geometry of [markGeometry, doorGeometry, nearGeometry, farGeometry]) {
      geometry.dispose();
    }
    for (const material of [markMaterial, doorMaterial, starMaterial]) material.dispose();
    renderer.dispose();
  };
}
