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

/**
 * The mark, built out of points and flown through.
 *
 * The cloud is the logo: two bars in near-white and the connector between them
 * in the accent, because the connector is the claim. Scroll drives one number —
 * how far through the traverse the reader is — and everything else reads off it.
 */

const COUNT = 6000;
const MARK_SCALE = 9;
const ACCENT = [0x00 / 255, 0xed / 255, 0x64 / 255] as const;

const vertexShader = `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
attribute vec3 aScatterDir;
uniform float uScale;
uniform float uTime;
uniform float uMotion;
uniform float uScatter;
uniform float uMinPx;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vColor = aColor;
  vec3 p = position + aScatterDir * uScatter;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.1);
  gl_PointSize = max(aSize * uScale / depth, uMinPx);
  float twinkle = 1.0 - 0.45 * uMotion * (0.5 + 0.5 * sin(uTime * (1.4 + fract(aPhase) * 1.3) + aPhase * 6.283));
  vAlpha = twinkle * smoothstep(0.12, 1.1, depth) * (1.0 - uScatter * 0.55);
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

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
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
  const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300);
  camera.position.z = 16;

  const { positions, roles } = sampleMark({
    count: COUNT,
    outlineShare: 0.26,
    depthJitter: 0.09,
    seed: 1,
  });

  const xyz = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const sizes = new Float32Array(COUNT);
  const phases = new Float32Array(COUNT);
  const scatter = new Float32Array(COUNT * 3);

  for (let i = 0; i < COUNT; i++) {
    xyz[i * 3] = positions[i * 3] * MARK_SCALE;
    xyz[i * 3 + 1] = positions[i * 3 + 1] * MARK_SCALE;
    xyz[i * 3 + 2] = positions[i * 3 + 2] * MARK_SCALE;

    if (roles[i] === BAR) {
      // the two chains: light, with a little variance so the field has grain
      const shade = 0.78 + Math.random() * 0.22;
      colors[i * 3] = shade;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade;
    } else {
      colors[i * 3] = ACCENT[0];
      colors[i * 3 + 1] = ACCENT[1];
      colors[i * 3 + 2] = ACCENT[2];
    }

    sizes[i] = 0.055 + Math.random() * 0.075;
    phases[i] = Math.random() * 6.283;

    // outward direction for the scatter at the end of the page
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const reach = 4 + Math.random() * 7;
    scatter[i * 3] = Math.sin(phi) * Math.cos(theta) * reach;
    scatter[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * reach;
    scatter[i * 3 + 2] = Math.cos(phi) * reach;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(xyz, 3));
  geometry.setAttribute("aColor", new BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new BufferAttribute(phases, 1));
  geometry.setAttribute("aScatterDir", new BufferAttribute(scatter, 3));

  const material = new ShaderMaterial({
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
    },
  });

  const mark = new Points(geometry, material);
  mark.frustumCulled = false;
  const group = new Group();
  group.add(mark);
  scene.add(group);

  const setScale = () => {
    material.uniforms.uScale.value = renderer.domElement.height * 0.5;
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
    const viewport = innerHeight;
    const scrolled = scrollY;

    // One number: how far the reader is through hero plus traverse.
    const traverse = clamp(scrolled / (viewport * 2.2), 0, 1);
    const eased = easeOut(traverse);

    // The field comes toward the reader and opens out of the wordmark.
    group.position.z = -34 + 34 * eased;
    group.scale.setScalar(0.22 + 0.78 * eased);

    // Past the traverse it turns slowly, by scroll and, unless the reader asked
    // otherwise, a little by itself.
    const past = clamp((scrolled - viewport * 2.2) / (viewport * 0.8), 0, 1);
    group.rotation.y = past * Math.PI * 0.9 + (reduced ? 0 : time * 0.06);
    group.rotation.x = past * 0.2;

    // Once there are words on screen the mark yields to them: it moves off the
    // centre line on a wide viewport, and gives up most of its light either way.
    group.position.x = (innerWidth < 768 ? 0 : 6.8) * past;
    material.uniforms.uOpacity.value = (0.25 + 0.75 * eased) * (1 - 0.72 * past);

    // The scatter, over the last screen of the document.
    const docEnd = document.documentElement.scrollHeight - viewport;
    const outro = clamp((scrolled - (docEnd - viewport * 1.1)) / (viewport * 1.1), 0, 1);
    material.uniforms.uScatter.value = easeOut(outro);
    material.uniforms.uTime.value = time;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    host.removeChild(renderer.domElement);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
  };
}
