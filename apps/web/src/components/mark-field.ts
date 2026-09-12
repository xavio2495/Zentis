import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  PerspectiveCamera,
  Points,
  Scene,
  Matrix4,
  ShaderMaterial,
  Vector3,
  Vector4,
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

/** The gate: an equilateral triangle standing on its point, the mark inside it. */
const GATE_EDGE = 900;
const GATE_RISING = 260;
/** How readily the gate takes the cursor's green. */
const GATE_STAIN = 0.85;

const STARS_NEAR = 700;
const STARS_FAR = 900;

const vertexShader = `
attribute vec3 aColor;
attribute float aSize;
attribute float aSoft;
attribute float aPhase;
attribute float aRise;
attribute float aStain;
attribute vec3 aScatterDir;
uniform float uScale;
uniform float uTime;
uniform float uMotion;
uniform float uScatter;
uniform float uMinPx;
uniform float uGateBottom;
uniform float uGateHeight;
/** xy: where the cursor is, in this object's own space. z: reach. w: strength. */
uniform vec4 uStain;
/** xyz: the cursor in this object's own space. w: the radius it clears. */
uniform vec4 uDisperse;
uniform float uDisperseAmount;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;

void main() {
  vColor = aColor;
  vSoft = aSoft;
  vec3 p = position + aScatterDir * uScatter;

  // Points with a rise drift up the gate and wrap, fading at both ends so they
  // are never seen to appear or to stop.
  float fade = 1.0;
  if (aRise > 0.0) {
    float y = mod(p.y - uGateBottom + uTime * aRise * uMotion, uGateHeight);
    fade = smoothstep(0.0, 0.08, y / uGateHeight) * (1.0 - smoothstep(0.86, 1.0, y / uGateHeight));
    p.y = uGateBottom + y;
  }

  // The cursor clears a space around itself: anything within its reach is
  // pushed out along the line from its centre, leaving a hollow sphere where it
  // rests. Depth counts toward the distance, or the hollow would be a tube
  // bored through the mark and would read wrong the moment the mark turns.
  if (uDisperseAmount > 0.0) {
    vec3 away = p - uDisperse.xyz;
    float distance = length(away);
    if (distance < uDisperse.w && distance > 0.0001) {
      p += away * ((uDisperse.w / distance - 1.0) * uDisperseAmount);
    }
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.1);
  gl_PointSize = max(aSize * uScale / depth, uMinPx);
  float twinkle = 1.0 - 0.45 * uMotion * (0.5 + 0.5 * sin(uTime * (1.4 + fract(aPhase) * 1.3) + aPhase * 6.283));
  vAlpha = twinkle * fade * smoothstep(0.12, 1.1, depth) * (1.0 - uScatter * 0.55);
  gl_Position = projectionMatrix * mv;

  // The green is the cursor's own light: it falls on what is near it and
  // nothing else.
  if (uStain.w > 0.0) {
    float near = 1.0 - smoothstep(0.0, uStain.z, length(p.xy - uStain.xy));
    vColor = mix(vColor, vec3(0.0, 0.929, 0.392), aStain * uStain.w * near);
  }
}
`;

const fragmentShader = `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vSoft;

void main() {
  vec2 q = gl_PointCoord - vec2(0.5);
  float d2 = dot(q, q) * 4.0;
  if (d2 >= 1.0) discard;
  float inv = 1.0 - d2;

  // A tight point and a soft one, mixed per particle: most are pinpricks, a few
  // are out of focus, which is what stops the field reading as confetti.
  float tight = min(1.0, inv * 1.9);
  float soft = inv * inv;
  float a = mix(tight, soft * 0.55, vSoft) * vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

interface Cloud {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  softness: Float32Array;
  phases: Float32Array;
  rise: Float32Array;
  stain: Float32Array;
  scatter: Float32Array;
}

/**
 * How big a point is and how far out of focus. Most are small and sharp; a few
 * are large and soft, and those are what give the field its depth.
 */
function focus(): { size: number; soft: number } {
  const roll = Math.random();
  if (roll < 0.68) return { size: 0.05 + Math.random() * 0.05, soft: 0.1 };
  if (roll < 0.92) return { size: 0.11 + Math.random() * 0.09, soft: 0.45 };
  return { size: 0.22 + Math.random() * 0.26, soft: 1 };
}

function emptyCloud(count: number): Cloud {
  return {
    positions: new Float32Array(count * 3),
    colors: new Float32Array(count * 3),
    sizes: new Float32Array(count),
    softness: new Float32Array(count),
    phases: new Float32Array(count),
    rise: new Float32Array(count),
    stain: new Float32Array(count),
    scatter: new Float32Array(count * 3),
  };
}

function toGeometry(cloud: Cloud): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(cloud.positions, 3));
  geometry.setAttribute("aColor", new BufferAttribute(cloud.colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(cloud.sizes, 1));
  geometry.setAttribute("aSoft", new BufferAttribute(cloud.softness, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(cloud.phases, 1));
  geometry.setAttribute("aRise", new BufferAttribute(cloud.rise, 1));
  geometry.setAttribute("aStain", new BufferAttribute(cloud.stain, 1));
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
      uGateBottom: { value: door.bottom },
      uGateHeight: { value: door.height },
      uStain: { value: new Vector4(0, 0, 1, 0) },
      uDisperse: { value: new Vector4(0, 0, 0, 1) },
      uDisperseAmount: { value: 0 },
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

    // All of it is light. The green is the cursor's, and falls only where the
    // cursor is — the connector simply takes it more readily than the chains.
    const shade = 0.78 + Math.random() * 0.22;
    cloud.colors[i * 3] = shade;
    cloud.colors[i * 3 + 1] = shade;
    cloud.colors[i * 3 + 2] = shade;
    cloud.stain[i] = roles[i] === BAR ? 0.7 : 1;

    const spot = focus();
    cloud.sizes[i] = spot.size;
    cloud.softness[i] = spot.soft;
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
  const total = GATE_EDGE + GATE_RISING;
  const cloud = emptyCloud(total);

  const half = gate.side / 2;
  const corners = [
    { x: -half, y: gate.topY },
    { x: half, y: gate.topY },
    { x: 0, y: gate.apexY },
  ];
  const depth = gate.side * 0.05;

  const light = (i: number) => {
    const shade = 0.72 + Math.random() * 0.28;
    cloud.colors[i * 3] = shade;
    cloud.colors[i * 3 + 1] = shade;
    cloud.colors[i * 3 + 2] = shade * 0.99;
    cloud.stain[i] = GATE_STAIN;
    const spot = focus();
    cloud.sizes[i] = spot.size;
    cloud.softness[i] = spot.soft;
    cloud.phases[i] = Math.random() * 6.283;
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
    cloud.rise[n] = 0.1 + Math.random() * 0.2;
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

    const shade = 0.45 + Math.random() * 0.35;
    cloud.colors[i * 3] = shade;
    cloud.colors[i * 3 + 1] = shade;
    cloud.colors[i * 3 + 2] = shade;

    // further out, more of them are out of focus — that is what reads as depth
    const spot = focus();
    const blurred = Math.random() < 0.4;
    cloud.sizes[i] = spot.size * (blurred ? 1.7 : 0.9);
    cloud.softness[i] = blurred ? 1 : spot.soft;
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
  let disperse = 0;
  const cursorLocal = new Vector3();
  const inverseRotation = new Matrix4();
  const start = performance.now();

  // How far the cursor's light reaches across the gate, and — in the mark's own
  // units — how far its light reaches into the mark and how big a space it
  // clears there. The hole is a fraction of the mark, not the whole of it.
  const STAIN_REACH = gate.side * 0.34;
  const MARK_LIGHT = 2.4;
  const MARK_CLEARS = 1.15;

  let previous = start;
  const frame = (now: number) => {
    const time = (now - start) / 1000;
    // Time-based rather than per-frame, so easing takes the same wall-clock
    // time whatever rate the display or the tab is running at.
    const delta = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    const settle = (rate: number) => 1 - Math.exp(-rate * delta);

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
    const lead = settle(6);
    followX += (state.markOffsetX - followX) * lead;
    followY += (state.markOffsetY - followY) * lead;

    group.position.x = state.positionX + followX;
    group.position.y = followY;
    group.position.z = state.positionZ;
    group.scale.setScalar(state.scale);
    group.rotation.y = state.rotationY + (reduced ? 0 : time * 0.06);
    group.rotation.x = state.rotationX;

    markMaterial.uniforms.uOpacity.value = state.opacity;
    markMaterial.uniforms.uScatter.value = state.scatter;
    markMaterial.uniforms.uTime.value = time;

    // The cursor's light, and the space it clears, both carried into the mark's
    // own space — through its position, its scale and its rotation — so they
    // stay with it wherever it has turned to.
    const wants = state.pointerPresent && state.opacity > 0.02 ? 1 : 0;
    disperse += (wants - disperse) * settle(wants > disperse ? 9 : 4);

    inverseRotation.makeRotationFromEuler(group.rotation).invert();
    cursorLocal
      .set(state.pointerWorldX, state.pointerWorldY, group.position.z)
      .sub(group.position)
      .divideScalar(Math.max(state.scale, 1e-4))
      .applyMatrix4(inverseRotation);

    markMaterial.uniforms.uStain.value.set(cursorLocal.x, cursorLocal.y, MARK_LIGHT, disperse);
    // the hollow the cursor clears is a sphere about that point, not a tube
    markMaterial.uniforms.uDisperse.value.set(
      cursorLocal.x,
      cursorLocal.y,
      cursorLocal.z,
      MARK_CLEARS,
    );
    markMaterial.uniforms.uDisperseAmount.value = disperse;

    doorGroup.scale.setScalar(state.doorScale);
    doorMaterial.uniforms.uOpacity.value = state.doorOpacity;
    doorMaterial.uniforms.uTime.value = time;
    doorMaterial.uniforms.uStain.value.set(
      state.pointerWorldX / state.doorScale,
      state.pointerWorldY / state.doorScale,
      STAIN_REACH / state.doorScale,
      disperse,
    );
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
