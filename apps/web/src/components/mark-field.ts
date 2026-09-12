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
import { CAMERA_Z, FOV_DEGREES, fieldState, gateShape } from "@/lib/field-state";

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

/** The gate: an equilateral triangle standing on its point, the mark inside it. */
const GATE_EDGE = 900;
const GATE_RISING = 260;
const GATE_FOOT = 80;
/** One point in five is accented; the rest are light. */
const GATE_ACCENT_SHARE = 0.2;

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
 * The gate: an equilateral triangle standing on its point, drawn in points.
 * The edges are walked by length so the frame is evenly lit, with a scatter of
 * rising points inside it and a few gathered at the point it stands on.
 */
function buildGate(): Cloud {
  const gate = gateShape();
  const total = GATE_EDGE + GATE_RISING + GATE_FOOT;
  const cloud = emptyCloud(total);

  const half = gate.side / 2;
  const corners = [
    { x: -half, y: gate.topY },
    { x: half, y: gate.topY },
    { x: 0, y: gate.apexY },
  ];
  const depth = gate.side * 0.05;

  // Four points in five are light; the fifth is the accent, scattered through
  // the frame rather than gathered anywhere.
  const light = (i: number) => {
    if (Math.random() < GATE_ACCENT_SHARE) {
      cloud.colors[i * 3] = ACCENT[0];
      cloud.colors[i * 3 + 1] = ACCENT[1];
      cloud.colors[i * 3 + 2] = ACCENT[2];
      return;
    }
    const shade = 0.78 + Math.random() * 0.22;
    cloud.colors[i * 3] = shade;
    cloud.colors[i * 3 + 1] = shade;
    cloud.colors[i * 3 + 2] = shade * 0.99;
  };

  /** Is a point inside the triangle? Same crossing test the mark uses. */
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
      const a = corners[i];
      const b = corners[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };

  const edges = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  const perimeter = edges.reduce((sum, e) => sum + e.length, 0);

  let n = 0;
  for (let i = 0; i < GATE_EDGE; i++, n++) {
    let along = ((i + Math.random() * 0.8) / GATE_EDGE) * perimeter;
    let edge = edges[edges.length - 1];
    for (const candidate of edges) {
      if (along <= candidate.length) {
        edge = candidate;
        break;
      }
      along -= candidate.length;
    }
    const t = along / edge.length;
    // a soft spray either side of the line, so the frame is drawn rather than ruled
    const nx = -(edge.b.y - edge.a.y) / edge.length;
    const ny = (edge.b.x - edge.a.x) / edge.length;
    const spread = (Math.random() * 2 - 1) * Math.abs(Math.random()) * gate.side * 0.014;

    cloud.positions[n * 3] = edge.a.x + (edge.b.x - edge.a.x) * t + nx * spread;
    cloud.positions[n * 3 + 1] = edge.a.y + (edge.b.y - edge.a.y) * t + ny * spread;
    cloud.positions[n * 3 + 2] = (Math.random() * 2 - 1) * depth;
    light(n);
    cloud.sizes[n] = 0.05 + Math.random() * 0.08;
    cloud.phases[n] = Math.random() * 6.283;
  }

  for (let i = 0; i < GATE_RISING; i++, n++) {
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 48; attempt++) {
      x = (Math.random() * 2 - 1) * half;
      y = gate.apexY + Math.random() * gate.height;
      if (inside(x, y)) break;
    }
    cloud.positions[n * 3] = x;
    cloud.positions[n * 3 + 1] = y;
    cloud.positions[n * 3 + 2] = (Math.random() * 2 - 1) * depth * 1.6;
    light(n);
    cloud.sizes[n] = 0.045 + Math.random() * 0.06;
    cloud.phases[n] = Math.random() * 6.283;
    cloud.rise[n] = 0.1 + Math.random() * 0.2;
  }

  // gathered at the point it stands on
  for (let i = 0; i < GATE_FOOT; i++, n++) {
    cloud.positions[n * 3] = (Math.random() * 2 - 1) * gate.side * 0.08;
    cloud.positions[n * 3 + 1] = gate.apexY - 0.06 - Math.random() * 0.5;
    cloud.positions[n * 3 + 2] = (Math.random() * 2 - 1) * 1.2;
    light(n);
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

  // The gate is sized against what the camera can see, so it frames the
  // wordmark at any viewport rather than at one.
  const gate = gateShape();
  const door = { bottom: gate.apexY, height: gate.height };

  const markMaterial = makeMaterial(reduced, door);
  const doorMaterial = makeMaterial(reduced, door);
  const starMaterial = makeMaterial(reduced, door);

  const markGeometry = toGeometry(buildMark());
  const doorGeometry = toGeometry(buildGate());
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

  // The cursor leads the mark around inside the gate. Held in NDC; the clamp
  // that keeps it inside the triangle lives in field-state.
  let pointer: { x: number; y: number } | undefined;
  const onPointerMove = (event: PointerEvent) => {
    pointer = {
      x: (event.clientX / innerWidth) * 2 - 1,
      y: -(event.clientY / innerHeight) * 2 + 1,
    };
  };
  const onPointerLeave = () => {
    pointer = undefined;
  };
  if (!reduced && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    addEventListener("pointermove", onPointerMove, { passive: true });
    addEventListener("pointerleave", onPointerLeave);
  }

  let raf = 0;
  let followX = 0;
  let followY = 0;
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
      pointer,
    });

    // eased toward the cursor rather than pinned to it, so the mark is led
    // rather than dragged
    followX += (state.markOffsetX - followX) * 0.05;
    followY += (state.markOffsetY - followY) * 0.05;

    group.position.x = state.positionX + followX;
    group.position.y = followY;
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
    removeEventListener("pointermove", onPointerMove);
    removeEventListener("pointerleave", onPointerLeave);
    host.removeChild(renderer.domElement);
    for (const geometry of [markGeometry, doorGeometry, nearGeometry, farGeometry]) {
      geometry.dispose();
    }
    for (const material of [markMaterial, doorMaterial, starMaterial]) material.dispose();
    renderer.dispose();
  };
}
