"use client";
// Hero 3D viewport for the fence studio. Vanilla Three.js (mirrors RoofModel3D):
// build renderer/scene/lights ONCE in an effect keyed on [supported]; a second
// effect pushes spec changes through `applyRef` so the imperative scene mutates
// without tearing down the renderer.
//
// Posts / pickets / rails / caps are each a single InstancedMesh authored at
// unit size and aligned by yaw (rotation.y = atan2(dy,dx) maps a member's local
// +X onto the run in three-space); every member is scaled to the size its
// `build` says (lib/fence/build — the catalog type's own parts, 2026-09-28:
// posts at the type's spacing and face width, its rails at their heights, the
// boards, pickets, bars or mesh it is really infilled with, the cap it ships
// with). Height changes only re-write matrices; material changes only swap the
// shared material; only a change in instance COUNT rebuilds. Gates, chain-link
// infill, and the selected-run highlight are small groups rebuilt on demand
// (few objects). `capture()` returns a PNG data URL.
//
// Looking closer: orbit zooms toward the cursor down to arm's length from a
// post, a double-click re-aims the orbit at what was clicked, and "Walk
// through" (a button, never a bare click — a click used to lock the pointer
// and the cursor seemed gone for good) walks the yard at eye height; a click
// or Esc steps back out.
//
// Ground: with `terrain` (the lot's elevation lattice, local feet) the flat
// plane gives way to a mesh of the real land in the SAME material, and the
// fence stands on it — racked bays follow the grade, stepped bays sit level
// and step at the posts (fenceGeometry decides, from the priced slope class),
// gates hang level, houses sit on their lowest corner, and a run that ends on a
// house wall gets a wall mount instead of a post. Without `terrain` the scene
// is the original flat one.
//
// Buildings are only ever the ones handed in (owner, 2026-09-27: "show a house
// only when I outline it; if I don't, show no buildings"). The invented house
// and neighbour boxes that used to fill an empty lot are gone. The lot line
// (`lots`) is drawn on the land in the map's own lot colour with a stake at
// each corner, so the fence reads against the property line here as it does
// on the photo.
import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { cn } from "@/lib/cn";
import { computeFenceLayout, railRowsFor, type BayClass, type FenceLayout, type GateUnit } from "./fenceGeometry";
import { contourChains, elevationAt, pickTopoInterval, type TopoGridPlan } from "./fenceTopo";
import { makeFenceTextures, makeChainLinkAlpha, type FenceMaterialTextures } from "./fenceTexture";
import { isBuiltinMaterial, MATERIAL_SWATCH, type PathPoint, type GateSpec, type BuildingFootprint } from "./fenceTypes";
import { DEFAULT_FENCE_BUILD, fenceBuildForFamily, type FenceBuild } from "@/lib/fence/build";

// Member authoring: every member is a UNIT box (or cylinder) scaled to the
// build's own dimensions per instance. Horizontal axis is local +X so a single
// rotation.y = yaw aligns every member with its run.
const POST_CAP = 0.25; // the old studio's posts stand this much proud (no build given)
const GATE_POST_MIN = 0.3; // a gate post never renders thinner than this
const BAR_T = 0.12; // gate frame bar thickness
const BAR_D = 0.13;
const DIAMOND_FT = 0.4; // chain-link diamond size for alpha tiling (no build given)
/** Eye height while walking, and how fast a walk and a run go (ft/s). */
const EYE_FT = 5.5;
const WALK_FT_S = 8;
const RUN_FT_S = 22;

const ACCENT = 0x1f7a52; // Pressed Sage (locked accent)

export interface FenceModel3DHandle {
  capture: () => string | null;
}

/** The lot's elevation lattice in the fence's local-feet frame (fenceTopo). */
export interface FenceTerrain3D {
  plan: TopoGridPlan;
  grid: number[][];
}

const NO_MOUNTS: PathPoint[] = [];

interface ViewSpec {
  points: PathPoint[];
  height: number;
  material: string; // MaterialId — built-in key or custom id
  materialColor: string; // resolved swatch/colour (used for custom materials)
  gates: GateSpec[];
  selectedSegment: number | null;
  buildings: BuildingFootprint[]; // real nearby footprints (local feet)
  terrain: FenceTerrain3D | null;
  segClasses: Record<number, BayClass> | null; // priced slope class per segment index
  segSteps: Record<number, number> | null; // priced step count per stepped segment
  wallMounts: PathPoint[]; // run ends that sit on a house wall
  lots: PathPoint[][]; // the lot's rings (local feet)
  lotColor: string; // the map's lot-line colour
  build: FenceBuild | null; // what the fence is built from; null = the look's default
}

const NO_LOTS: PathPoint[][] = [];
const DEFAULT_LOT_COLOR = "#4a9eff";

function webglSupported(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export const FenceModel3D = React.forwardRef<
  FenceModel3DHandle,
  {
    points: PathPoint[];
    height: number;
    material: string;
    materialColor: string;
    gates: GateSpec[];
    selectedSegment: number | null;
    buildings: BuildingFootprint[];
    terrain?: FenceTerrain3D | null;
    segClasses?: Record<number, BayClass> | null;
    /** The ticket's step count per stepped segment; drawn as that many equal steps. */
    segSteps?: Record<number, number> | null;
    wallMounts?: PathPoint[];
    /** The lot's rings in the same local-feet frame; drawn on the land. */
    lots?: PathPoint[][];
    /** The lot line's colour — the map's, so the two views agree. */
    lotColor?: string;
    /** What the fence is built from (lib/fence/build). Without it the look's
     *  own default build stands in. */
    build?: FenceBuild | null;
    /** "full": orbit, and "Walk through" walks the yard (pointer lock, WASD).
     *  "orbit": orbit and zoom only — a phone, or a page where walking is not
     *  wanted. */
    controls?: "full" | "orbit";
    active?: boolean;
    className?: string;
  }
>(function FenceModel3D(
  {
    points,
    height,
    material,
    materialColor,
    gates,
    selectedSegment,
    buildings,
    terrain = null,
    segClasses = null,
    segSteps = null,
    wallMounts = NO_MOUNTS,
    lots = NO_LOTS,
    lotColor = DEFAULT_LOT_COLOR,
    build = null,
    controls = "full",
    active = true,
    className,
  },
  ref,
) {
  const mountRef = React.useRef<HTMLDivElement>(null);
  const [supported] = React.useState(webglSupported);
  const rendererRef = React.useRef<THREE.WebGLRenderer | null>(null);
  const [mode, setMode] = React.useState<"orbit" | "fly">("orbit");
  const modeRef = React.useRef<"orbit" | "fly">("orbit");
  React.useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const controlsRef = React.useRef(controls);
  React.useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  React.useImperativeHandle(ref, () => ({
    capture: () => {
      const r = rendererRef.current;
      if (!r) return null;
      try {
        return r.domElement.toDataURL("image/png");
      } catch {
        return null;
      }
    },
  }));

  const applyRef = React.useRef<(s: ViewSpec) => void>(() => {});
  React.useEffect(() => {
    applyRef.current({ points, height, material, materialColor, gates, selectedSegment, buildings, terrain, segClasses, segSteps, wallMounts, lots, lotColor, build });
  }, [points, height, material, materialColor, gates, selectedSegment, buildings, terrain, segClasses, segSteps, wallMounts, lots, lotColor, build]);
  /** Walking is not possible here (the browser refused the pointer lock). */
  const [walkNote, setWalkNote] = React.useState<string | null>(null);
  const walkRef = React.useRef<() => void>(() => {});

  // When the studio hides this panel (Draw view), release pointer-lock/keys so a
  // fly session can't keep driving an invisible scene; on re-show, re-frame if the
  // fence changed size while hidden.
  const activateRef = React.useRef<() => void>(() => {});
  const suspendRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    if (active) activateRef.current();
    else suspendRef.current();
  }, [active]);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !supported) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      return;
    }
    rendererRef.current = renderer;
    const w = mount.clientWidth || 800;
    const h0 = mount.clientHeight || 480;
    renderer.setSize(w, h0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const init = computeFenceLayout(points, gates);
    const span = Math.max(init.bounds.maxX - init.bounds.minX, init.bounds.maxY - init.bounds.minY, 12);

    const camera = new THREE.PerspectiveCamera(50, w / h0, 0.1, span * 40);
    camera.position.set(span * 0.95, span * 0.8, span * 0.95);

    // ── Sky + lighting (warm sun, soft shadows, ACES) ──
    const sky = new Sky();
    sky.scale.setScalar(span * 20);
    scene.add(sky);
    const sun = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(58),
      THREE.MathUtils.degToRad(135),
    );
    const skyMat = sky.material as THREE.ShaderMaterial;
    skyMat.uniforms.sunPosition.value.copy(sun);
    skyMat.uniforms.turbidity.value = 6;
    skyMat.uniforms.rayleigh.value = 1.5;
    skyMat.uniforms.mieCoefficient.value = 0.005;
    skyMat.uniforms.mieDirectionalG.value = 0.8;

    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x8a8468, 0.65));
    const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(span * 1.0, span * 1.7, span * 0.7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera as THREE.OrthographicCamera;
    sc.left = -span * 1.3;
    sc.right = span * 1.3;
    sc.top = span * 1.3;
    sc.bottom = -span * 1.3;
    sc.near = 0.1;
    sc.far = span * 8;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = span * 0.0015;
    scene.add(key);
    scene.add(key.target);

    let envTex: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const skyScene = new THREE.Scene();
      const skyEnv = new Sky();
      skyEnv.scale.setScalar(span * 20);
      const sem = skyEnv.material as THREE.ShaderMaterial;
      sem.uniforms.sunPosition.value.copy(sun);
      sem.uniforms.turbidity.value = 6;
      sem.uniforms.rayleigh.value = 1.5;
      sem.uniforms.mieCoefficient.value = 0.005;
      sem.uniforms.mieDirectionalG.value = 0.8;
      skyScene.add(skyEnv);
      envTex = pmrem.fromScene(skyScene).texture;
      scene.environment = envTex;
      skyEnv.geometry.dispose();
      sem.dispose();
      pmrem.dispose();
    } catch {
      /* environment is optional */
    }

    const groundGeo = new THREE.PlaneGeometry(span * 8, span * 8);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x9fa886,
      roughness: 1,
      metalness: 0,
      // Pushes the land back in depth a touch so the draped contour lines never
      // stitch through it at a distance. No visible effect on the flat plane.
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Terrain: the lattice as land, in the ground's own material ──
    // Heights are true scale (no exaggeration: a contractor reads this) and
    // relative to the fence's lowest point, so the fence sits near y = 0 and
    // the camera framing of the flat scene still fits. Past the lattice the
    // land keeps its edge heights out to the horizon apron.
    let terrainRef: FenceTerrain3D | null = null;
    let zRef = 0;
    const rawGround = (x: number, y: number): number => {
      const t = terrainRef;
      if (!t) return 0;
      const p = t.plan;
      const cxp = Math.min(p.x0 + (p.cols - 1) * p.dx, Math.max(p.x0, x));
      const cyp = Math.min(p.y0 + (p.rows - 1) * p.dy, Math.max(p.y0, y));
      return elevationAt(t.grid, p, { x: cxp, y: cyp }) ?? 0;
    };
    const groundAt = (x: number, y: number) => (terrainRef ? rawGround(x, y) - zRef : 0);
    let terrainMesh: THREE.Mesh | null = null;
    let terrainBuiltFor: { t: FenceTerrain3D; cx: number; cy: number; zRef: number; span: number } | null = null;
    const contourMat = new THREE.LineBasicMaterial({ color: 0x6b7556, transparent: true, opacity: 0.55 });
    const disposeTerrain = () => {
      if (terrainMesh) {
        scene.remove(terrainMesh);
        terrainMesh.traverse((o) => {
          if (o instanceof THREE.LineSegments || o instanceof THREE.Mesh) o.geometry.dispose();
        });
        terrainMesh = null;
      }
    };
    const rebuildTerrain = (cx: number, cy: number, sp: number) => {
      const t = terrainRef;
      if (!t) {
        disposeTerrain();
        terrainBuiltFor = null;
        ground.visible = true;
        return;
      }
      const b = terrainBuiltFor;
      if (b && b.t === t && b.cx === cx && b.cy === cy && b.zRef === zRef && b.span >= sp) return;
      disposeTerrain();
      const p = t.plan;
      const far = Math.max(sp, 60) * 5;
      const axis = (lo: number, step: number, n: number, c: number) => {
        const inner: number[] = [];
        for (let i = 0; i <= (n - 1) * 2; i++) inner.push(lo + (i * step) / 2);
        const hi = lo + (n - 1) * step;
        const out = [c - far, c - far * 0.45, c - far * 0.18].filter((v) => v < lo - step);
        out.push(...inner);
        out.push(...[c + far * 0.18, c + far * 0.45, c + far].filter((v) => v > hi + step));
        return out;
      };
      const xs = axis(p.x0, p.dx, p.cols, cx);
      const ys = axis(p.y0, p.dy, p.rows, cy);
      const nx = xs.length;
      const ny = ys.length;
      const pos = new Float32Array(nx * ny * 3);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = (j * nx + i) * 3;
          pos[k] = xs[i] - cx;
          pos[k + 1] = groundAt(xs[i], ys[j]) - 0.02; // a hair under posts and pickets
          pos[k + 2] = -(ys[j] - cy);
        }
      }
      const idx: number[] = [];
      for (let j = 0; j + 1 < ny; j++) {
        for (let i = 0; i + 1 < nx; i++) {
          const a = j * nx + i;
          idx.push(a, a + 1, a + nx, a + 1, a + 1 + nx, a + nx);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      terrainMesh = new THREE.Mesh(geo, groundMat);
      terrainMesh.receiveShadow = true;
      // Contour lines draped on the land in a darker tone of the ground itself,
      // so the slope reads at a glance without changing the scene's palette.
      let lo = Infinity;
      let hi = -Infinity;
      for (const row of t.grid) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const interval = pickTopoInterval(hi - lo, false);
      if (interval > 0) {
        const verts: number[] = [];
        for (let level = Math.ceil(lo / interval) * interval; level < hi; level += interval) {
          for (const chain of contourChains(t.grid, p, level + 1e-6)) {
            for (let i = 1; i < chain.length; i++) {
              const a = chain[i - 1];
              const c = chain[i];
              verts.push(a.x - cx, groundAt(a.x, a.y) + 0.15, -(a.y - cy), c.x - cx, groundAt(c.x, c.y) + 0.15, -(c.y - cy));
            }
          }
        }
        if (verts.length) {
          const lg = new THREE.BufferGeometry();
          lg.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
          terrainMesh.add(new THREE.LineSegments(lg, contourMat));
        }
      }
      scene.add(terrainMesh);
      ground.visible = false;
      terrainBuiltFor = { t, cx, cy, zRef, span: sp };
    };

    // ── Fence assets: unit members, scaled per instance to the build ──
    const postGeo = new THREE.BoxGeometry(1, 1, 1);
    const postRoundGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    const picketGeo = new THREE.BoxGeometry(1, 1, 1);
    const railGeo = new THREE.BoxGeometry(1, 1, 1);
    // Post caps at unit post width, standing on y = 0.
    const capGeos: Record<FenceBuild["postCap"], THREE.BufferGeometry | null> = {
      flat: new THREE.BoxGeometry(1.3, 0.12, 1.3).translate(0, 0.06, 0),
      pyramid: new THREE.ConeGeometry(0.95, 0.5, 4).rotateY(Math.PI / 4).translate(0, 0.25, 0),
      gothic: new THREE.ConeGeometry(0.62, 1.1, 10).translate(0, 0.55, 0),
      dome: new THREE.SphereGeometry(0.58, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      // The loop cap a chain-link top rail threads through: a ring standing
      // across the run, its axis along the rail.
      loop: new THREE.TorusGeometry(0.62, 0.16, 8, 18).rotateY(Math.PI / 2).translate(0, 0.62, 0),
      none: null,
    };

    // Cache keyed by material id AND the colour it is shown in. Built-in materials get authored textures; custom
    // materials render as a solid MeshStandardMaterial tinted to their swatch colour.
    //
    // The colour of the TYPE picked (2026-11-10). The host hands over the type's own swatch, and the studio says
    // so ("the 3D fence is the colour of the type chip"), but a built-in look ignored it — black vinyl chain link
    // stood up as bare galvanized silver and the wood-look composite as grey. Now chain link and composite take
    // the type's colour, and vinyl's panel texture is tinted by it (white vinyl stays white). Wood keeps its
    // authored grain (the wood types' chips are saturated markers), and ornamental metal its authored black: the
    // aluminum chip's dark slate, lit by the sky, read as blue steel.
    const tintOf = (id: string, color: string): string => {
      if (!isBuiltinMaterial(id) || !/^#[0-9a-f]{6}$/i.test(color || "")) return "";
      if (id === "cedar" || id === "aluminum") return "";
      return color.toLowerCase() === MATERIAL_SWATCH[id].toLowerCase() ? "" : color.toLowerCase();
    };
    const matCache = new Map<string, { mat: THREE.MeshStandardMaterial; tex: FenceMaterialTextures | null }>();
    const getMaterial = (id: string, color: string): THREE.MeshStandardMaterial => {
      const tint = tintOf(id, color);
      const key = isBuiltinMaterial(id) ? id + "|" + tint : id + "|" + (color || "");
      let entry = matCache.get(key);
      if (!entry) {
        if (isBuiltinMaterial(id)) {
          const tex = makeFenceTextures(id);
          // A solid look takes the colour outright; a textured one (vinyl) is multiplied by the colour over its
          // own base, so the texture's seams survive and white stays white.
          let shade: THREE.Color | number = tex.color;
          if (tint && !tex.map) shade = new THREE.Color(tint);
          else if (tint && tex.map) {
            const want = new THREE.Color(tint), base = new THREE.Color(MATERIAL_SWATCH[id]);
            shade = new THREE.Color(Math.min(1, want.r / Math.max(0.05, base.r)), Math.min(1, want.g / Math.max(0.05, base.g)), Math.min(1, want.b / Math.max(0.05, base.b)));
          }
          const mat = new THREE.MeshStandardMaterial({
            map: tex.map ?? undefined,
            bumpMap: tex.bump ?? undefined,
            bumpScale: 0.4,
            color: shade,
            roughness: tex.roughness,
            metalness: tex.metalness,
            envMapIntensity: 0.55,
          });
          entry = { mat, tex };
        } else {
          const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(color || "#8a8f97"),
            roughness: 0.82,
            metalness: 0.05,
            envMapIntensity: 0.5,
          });
          entry = { mat, tex: null };
        }
        matCache.set(key, entry);
      }
      return entry.mat;
    };
    /** What the fence is drawn in: the look and the colour (a type change within one look is a change too). */
    const matKey = (id: string, color: string) => id + "|" + (isBuiltinMaterial(id) ? tintOf(id, color) : color || "");
    const gatePostMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.4 });
    // Gates and doors read in their OWN colours so they stand apart from the fence
    // and from each other: gates a warm bronze, doors a cool slate blue.
    const gateLeafMat = new THREE.MeshStandardMaterial({ color: 0x9a5a2b, roughness: 0.55, metalness: 0.25 });
    const doorLeafMat = new THREE.MeshStandardMaterial({ color: 0x42607f, roughness: 0.5, metalness: 0.2 });
    const chainAlphaBase = makeChainLinkAlpha();

    const fenceGroup = new THREE.Group();
    scene.add(fenceGroup);
    const chainGroup = new THREE.Group();
    const gateGroup = new THREE.Group();
    const mountGroup = new THREE.Group();
    fenceGroup.add(chainGroup, gateGroup, mountGroup);
    const dummy = new THREE.Object3D();

    const highlightGeo = new THREE.BoxGeometry(1, 0.14, 0.14);
    const highlightMat = new THREE.MeshBasicMaterial({ color: ACCENT });
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.visible = false;
    scene.add(highlight);

    let postMesh: THREE.InstancedMesh | null = null;
    let picketMesh: THREE.InstancedMesh | null = null;
    let railMesh: THREE.InstancedMesh | null = null;
    let capMesh: THREE.InstancedMesh | null = null;
    let built: FenceLayout | null = null;
    let builtRows = 0; // rail rows per bay the rail mesh was sized for
    let curMaterial: string | null = null;
    let framed = false;
    // Last geometry-affecting inputs (by reference). selectedSegment is NOT here:
    // a selection change only moves the highlight, never rebuilds geometry.
    let prevPts: PathPoint[] | null = null;
    let prevGates: GateSpec[] | null = null;
    let prevH = -1;
    let prevMat: string | null = null;

    const center = (l: FenceLayout) => ({
      cx: (l.bounds.minX + l.bounds.maxX) / 2,
      cy: (l.bounds.minY + l.bounds.maxY) / 2,
    });

    const disposeInstances = () => {
      for (const m of [postMesh, picketMesh, railMesh, capMesh]) {
        if (m) {
          fenceGroup.remove(m);
          m.dispose();
        }
      }
      postMesh = picketMesh = railMesh = capMesh = null;
    };

    const buildInstances = (l: FenceLayout, m: string, color: string, rows: number) => {
      const mat = getMaterial(m, color);
      const b = l.build;
      postMesh = new THREE.InstancedMesh(b.postProfile === "round" ? postRoundGeo : postGeo, mat, Math.max(1, l.postCount));
      picketMesh = new THREE.InstancedMesh(picketGeo, mat, Math.max(1, l.picketCount));
      railMesh = new THREE.InstancedMesh(railGeo, mat, Math.max(1, l.bayCount * rows));
      const capGeo = capGeos[b.postCap];
      // Loop caps are galvanized fittings on any chain-link colour.
      capMesh = capGeo ? new THREE.InstancedMesh(capGeo, b.postCap === "loop" ? gatePostMat : mat, Math.max(1, l.postCount)) : null;
      for (const mm of [postMesh, picketMesh, railMesh, capMesh]) {
        if (!mm) continue;
        mm.castShadow = true;
        mm.receiveShadow = true;
        fenceGroup.add(mm);
      }
      builtRows = rows;
      curMaterial = matKey(m, color);
    };

    /** Ground-plane point offset ACROSS a run (negative = the outside face). */
    const across = (x: number, y: number, yaw: number, off: number) => ({ x: x - Math.sin(yaw) * off, y: y + Math.cos(yaw) * off });

    const writeMatrices = (l: FenceLayout, fenceH: number, cx: number, cy: number) => {
      if (!postMesh || !picketMesh || !railMesh) return;
      const tx = (x: number) => x - cx;
      const tz = (y: number) => -(y - cy);
      const b = l.build;
      const proud = l.build === DEFAULT_FENCE_BUILD ? POST_CAP : b.postProudFt;

      postMesh.count = l.postCount;
      if (capMesh) capMesh.count = l.postCount;
      for (let i = 0; i < l.postCount; i++) {
        // From the ground under the post to `proud` above the highest panel it
        // carries — at a step that is the taller post.
        const base = l.postBase[i];
        const top = l.postPanel[i] + fenceH + proud;
        const h = Math.max(0.5, top - base);
        const mounted = l.postMount[i] === 1;
        const w = l.postTerminal[i] === 1 ? b.terminalWidthFt : b.postWidthFt;
        const yaw = l.posts[i * 3 + 2];
        dummy.position.set(tx(l.posts[i * 3]), base + h / 2, tz(l.posts[i * 3 + 1]));
        dummy.rotation.set(0, yaw, 0);
        // A wall mount has no post in the ground (see rebuildMounts).
        dummy.scale.set(mounted ? 0.0001 : w, mounted ? 0.0001 : h, mounted ? 0.0001 : w);
        dummy.updateMatrix();
        postMesh.setMatrixAt(i, dummy.matrix);
        if (capMesh) {
          dummy.position.set(tx(l.posts[i * 3]), base + h, tz(l.posts[i * 3 + 1]));
          dummy.scale.set(mounted ? 0.0001 : w, mounted ? 0.0001 : w, mounted ? 0.0001 : w);
          dummy.updateMatrix();
          capMesh.setMatrixAt(i, dummy.matrix);
        }
      }
      postMesh.instanceMatrix.needsUpdate = true;
      postMesh.computeBoundingSphere();
      if (capMesh) {
        capMesh.instanceMatrix.needsUpdate = true;
        capMesh.computeBoundingSphere();
      }

      picketMesh.count = l.picketCount;
      for (let i = 0; i < l.picketCount; i++) {
        const yaw = l.pickets[i * 3 + 2];
        const p = across(l.pickets[i * 3], l.pickets[i * 3 + 1], yaw, l.picketOffset[i]);
        dummy.position.set(tx(p.x), l.picketBase[i] + fenceH / 2, tz(p.y));
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(b.boardWidthFt, fenceH, b.boardDepthFt);
        dummy.updateMatrix();
        picketMesh.setMatrixAt(i, dummy.matrix);
      }
      picketMesh.instanceMatrix.needsUpdate = true;
      picketMesh.computeBoundingSphere();

      // Horizontal members per BAY — the build's rails at their heights, or its
      // stacked boards — pitched with the bay's base line: parallel to the
      // grade on a racked bay, level on a stepped one.
      const rows = railRowsFor(b, fenceH);
      railMesh.count = Math.min(l.bayCount * rows.length, l.bayCount * builtRows);
      dummy.rotation.order = "YZX";
      for (let i = 0; i < l.bayCount; i++) {
        const o = i * 7;
        const x0 = l.bays[o];
        const y0 = l.bays[o + 1];
        const z0 = l.bays[o + 2];
        const x1 = l.bays[o + 3];
        const y1 = l.bays[o + 4];
        const z1 = l.bays[o + 5];
        const plan = Math.hypot(x1 - x0, y1 - y0);
        const dz = z1 - z0;
        const yaw = Math.atan2(y1 - y0, x1 - x0);
        const pitch = Math.atan2(dz, plan);
        const len = Math.hypot(plan, dz);
        for (let k = 0; k < rows.length && k < builtRows; k++) {
          const row = rows[k];
          const p = across((x0 + x1) / 2, (y0 + y1) / 2, yaw, row.z);
          dummy.position.set(tx(p.x), (z0 + z1) / 2 + row.off, tz(p.y));
          dummy.rotation.set(0, yaw, pitch);
          dummy.scale.set(len, row.h, row.d);
          dummy.updateMatrix();
          railMesh.setMatrixAt(i * builtRows + k, dummy.matrix);
        }
      }
      dummy.rotation.order = "XYZ";
      railMesh.instanceMatrix.needsUpdate = true;
      railMesh.computeBoundingSphere();
    };

    // Recursively dispose every Mesh geometry (+ optional UNIQUE material/alphaMap)
    // under a group, then empty it. Shared/cached materials must NOT be disposed.
    const clearGroup = (g: THREE.Group, disposeMaterials: boolean) => {
      g.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          if (disposeMaterials) {
            const m = obj.material as THREE.MeshStandardMaterial;
            m?.alphaMap?.dispose();
            m?.dispose();
          }
        }
      });
      while (g.children.length) g.remove(g.children[0]);
    };

    // ── Dressing: a few trees round the yard, and nothing else invented. No
    // building is ever made up here (owner, 2026-09-27) — a house appears only
    // as the footprint it was drawn as (rebuildBuildings). A tree never stands
    // on the fence, in or against a house, or on the lot line: each one tries a
    // few spots near its seeded place and keeps the first clear one. Placed
    // from a fixed seed, so the same yard always gets the same trees.
    const sceneryGroup = new THREE.Group();
    scene.add(sceneryGroup);
    const houseWallMat = new THREE.MeshStandardMaterial({ color: 0xd8cdba, roughness: 0.85 });
    const houseRoofMat = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.8 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x4d7a46, roughness: 1, flatShading: true });
    const neighborWallMat = new THREE.MeshStandardMaterial({ color: 0xc7c0b4, roughness: 0.9 });
    const sceneryMats = [houseWallMat, houseRoofMat, trunkMat, foliageMat, neighborWallMat];

    const mulberry32 = (seed: number) => () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const addTree = (x: number, z: number, s: number) => {
      const gy = sceneGround(x, z);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.4 * s, 3.2 * s, 6), trunkMat);
      trunk.position.set(x, gy + 1.6 * s, z);
      trunk.castShadow = true;
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 * s, 0), foliageMat);
      canopy.position.set(x, gy + 4.0 * s, z);
      canopy.castShadow = true;
      sceneryGroup.add(trunk, canopy);
    };

    /** Plan distance from (px, py) to the segment a–b. */
    const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    const inRing = (px: number, py: number, ring: PathPoint[]) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i];
        const b = ring[j];
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    /** A canopy of radius `r` at plan (px, py) touches nothing real. */
    const treeClear = (px: number, py: number, r: number, spec: ViewSpec) => {
      const pts = spec.points;
      for (let i = 0; i + 1 < pts.length; i++) {
        const b = pts[i + 1];
        if (b.gap) continue;
        if (segDist(px, py, pts[i].x, pts[i].y, b.x, b.y) < r + 2) return false;
      }
      for (const b of spec.buildings) {
        const ring = b.ring;
        if (ring.length < 3) continue;
        if (inRing(px, py, ring)) return false;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const c = ring[(i + 1) % ring.length];
          if (segDist(px, py, a.x, a.y, c.x, c.y) < r + 3) return false;
        }
      }
      for (const ring of spec.lots) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const c = ring[(i + 1) % ring.length];
          if (segDist(px, py, a.x, a.y, c.x, c.y) < r + 1) return false;
        }
      }
      return true;
    };

    // Scenery is authored around the scene origin (the fence's centre); the
    // land under a scene point is the ground at that plan point.
    let sceneCx = 0;
    let sceneCy = 0;
    const sceneGround = (x: number, z: number) => groundAt(x + sceneCx, sceneCy - z);
    let sceneryKey: unknown[] = [];
    const buildScenery = (l: FenceLayout, spec: ViewSpec) => {
      clearGroup(sceneryGroup, false); // dispose geometries, keep shared materials
      const w = Math.max(6, l.bounds.maxX - l.bounds.minX);
      const d = Math.max(6, l.bounds.maxY - l.bounds.minY);
      const span = Math.max(w, d);
      const rnd = mulberry32(1337);
      const trees = 6;
      for (let i = 0; i < trees; i++) {
        const ang0 = (i / trees) * Math.PI * 2 + rnd() * 0.7;
        const r0 = span * (0.62 + rnd() * 0.2);
        const s = 0.8 + rnd() * 0.7;
        const canopy = 1.8 * s;
        // Up to six tries per tree: a little further round and further out.
        for (let k = 0; k < 6; k++) {
          const ang = ang0 + k * 0.33;
          const r = r0 + k * span * 0.12;
          const dx = Math.cos(ang) * r;
          const dy = Math.sin(ang) * r;
          if (treeClear(sceneCx + dx, sceneCy + dy, canopy, spec)) {
            addTree(dx, -dy, s);
            break;
          }
        }
      }
    };
    const syncScenery = (l: FenceLayout, spec: ViewSpec) => {
      sceneCx = (l.bounds.minX + l.bounds.maxX) / 2;
      sceneCy = (l.bounds.minY + l.bounds.maxY) / 2;
      // Everything a tree reads: the yard's size and centre, the land, and
      // the fence, houses and lot line it has to keep clear of.
      const key = [sceneCx, sceneCy, l.bounds.maxX - l.bounds.minX, l.bounds.maxY - l.bounds.minY, terrainRef, zRef, spec.points, spec.buildings, spec.lots];
      if (key.length === sceneryKey.length && key.every((v, i) => v === sceneryKey[i])) return;
      sceneryKey = key;
      buildScenery(l, spec);
    };

    // ── The lot line: a flat band on the land in the map's lot colour, with a
    // stake at each real corner (a turn sharper than 28°, the map's own rule
    // for a corner square). It follows the ground, so on a slope it lies on
    // the hill rather than cutting through it. Unlit, so it reads the same
    // colour as the line on the photo.
    const lotGroup = new THREE.Group();
    scene.add(lotGroup);
    // Not tone-mapped: the band shows the map's exact lot colour, where the
    // scene's filmic curve would grey it.
    const lotMat = new THREE.MeshBasicMaterial({
      color: DEFAULT_LOT_COLOR,
      toneMapped: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const stakeMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8 });
    const stakeCapMat = new THREE.MeshBasicMaterial({ color: DEFAULT_LOT_COLOR, toneMapped: false });
    const LOT_CORNER_DEG = 28;
    /** Farthest lot vertex from the scene centre — the land has to reach it. */
    let lotReach = 0;
    let lotKey: unknown[] = [];
    const openRing = (ring: PathPoint[]) =>
      ring.length > 3 && Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].y - ring[ring.length - 1].y) < 0.05
        ? ring.slice(0, -1)
        : ring;
    const rebuildLots = (lots: PathPoint[][], color: string, cx: number, cy: number, sp: number) => {
      const key = [lots, color, cx, cy, terrainRef, zRef];
      if (key.every((v, i) => v === lotKey[i])) return;
      lotKey = key;
      clearGroup(lotGroup, false);
      lotMat.color.set(color || DEFAULT_LOT_COLOR);
      stakeCapMat.color.set(color || DEFAULT_LOT_COLOR);
      lotReach = 0;
      // Wide enough to read from the framing distance, never a road stripe.
      const half = Math.min(1.1, Math.max(0.35, sp * 0.0045));
      const pos: number[] = [];
      const idx: number[] = [];
      let base = 0;
      for (const raw of lots) {
        const ring = openRing(raw);
        if (ring.length < 2) continue;
        for (const q of ring) lotReach = Math.max(lotReach, Math.hypot(q.x - cx, q.y - cy));
        const n = ring.length;
        const closed = n >= 3;
        for (let e = 0; e < (closed ? n : n - 1); e++) {
          const a = ring[e];
          const b = ring[(e + 1) % n];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.05) continue;
          const ux = (b.x - a.x) / len;
          const uy = (b.y - a.y) / len;
          // Each band runs `half` past both ends so corners close without a notch.
          const steps = Math.max(1, Math.ceil((len + 2 * half) / 3));
          for (let k = 0; k <= steps; k++) {
            const t = -half + ((len + 2 * half) * k) / steps;
            const px = a.x + ux * t;
            const py = a.y + uy * t;
            const gy = groundAt(px, py) + 0.05;
            pos.push(px - uy * half - cx, gy, -(py + ux * half - cy), px + uy * half - cx, gy, -(py - ux * half - cy));
            if (k > 0) {
              const v = base + k * 2;
              idx.push(v - 2, v - 1, v, v - 1, v + 1, v);
            }
          }
          base += (steps + 1) * 2;
        }
        if (!closed) continue;
        for (let i = 0; i < n; i++) {
          const p0 = ring[(i - 1 + n) % n];
          const p1 = ring[i];
          const p2 = ring[(i + 1) % n];
          const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
          let turn = Math.abs(a2 - a1);
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          if ((turn * 180) / Math.PI < LOT_CORNER_DEG) continue;
          const gy = groundAt(p1.x, p1.y);
          const stake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 0.3), stakeMat);
          stake.position.set(p1.x - cx, gy + 0.75, -(p1.y - cy));
          stake.castShadow = true;
          const cap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.42), stakeCapMat);
          cap.position.set(p1.x - cx, gy + 1.5, -(p1.y - cy));
          lotGroup.add(stake, cap);
        }
      }
      if (idx.length) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        const band = new THREE.Mesh(geo, lotMat);
        band.renderOrder = 1;
        lotGroup.add(band);
      }
    };

    // ── Real building footprints: honest extruded prisms in the same local-feet
    // frame as the fence (same cx/cy recentre), so drawn-fence-to-wall distances
    // read true. Flat top + thin darker cap — accurate footprint/height, no
    // invented styling. Rebuilt when the footprint set or the scene centre moves.
    const buildingsGroup = new THREE.Group();
    scene.add(buildingsGroup);
    const ROOF_CAP_FT = 0.6;
    let builtBuildings: BuildingFootprint[] | null = null;
    let builtBCx = 0;
    let builtBCy = 0;
    let builtBTerrain: FenceTerrain3D | null = null;
    let builtBZRef = 0;
    const rebuildBuildings = (bs: BuildingFootprint[], cx: number, cy: number) => {
      clearGroup(buildingsGroup, false);
      for (const b of bs) {
        if (b.ring.length < 3) continue;
        // On a slope the house is founded at its LOWEST corner and carries its
        // full height above the MIDDLE of the ground it covers: the downhill
        // side shows foundation wall (a daylight basement), the uphill side is
        // cut into the hill. Topping it over the highest corner turned a house
        // on a steep lot into a tower.
        let gLo = Infinity;
        let gHi = -Infinity;
        for (const p of b.ring) {
          const gv = groundAt(p.x, p.y);
          if (gv < gLo) gLo = gv;
          if (gv > gHi) gHi = gv;
        }
        if (!Number.isFinite(gLo)) {
          gLo = 0;
          gHi = 0;
        }
        const shape = new THREE.Shape();
        b.ring.forEach((p, i) => {
          // rotateX(-π/2) maps shape (x, y) → scene (x, −z), so shape-y = y − cy
          // yields scene z = −(y − cy), matching the fence transform exactly.
          if (i === 0) shape.moveTo(p.x - cx, p.y - cy);
          else shape.lineTo(p.x - cx, p.y - cy);
        });
        shape.closePath();
        const wallH = Math.max(6, b.heightFt - ROOF_CAP_FT) + (gHi - gLo) / 2;
        const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: wallH, bevelEnabled: false });
        wallGeo.rotateX(-Math.PI / 2);
        const wall = new THREE.Mesh(wallGeo, b.role === "subject" ? houseWallMat : neighborWallMat);
        wall.position.y = gLo;
        wall.castShadow = true;
        wall.receiveShadow = true;
        const capGeo = new THREE.ExtrudeGeometry(shape, { depth: ROOF_CAP_FT, bevelEnabled: false });
        capGeo.rotateX(-Math.PI / 2);
        const cap = new THREE.Mesh(capGeo, houseRoofMat);
        cap.position.y = gLo + wallH;
        cap.castShadow = true;
        buildingsGroup.add(wall, cap);
      }
      builtBuildings = bs;
      builtBCx = cx;
      builtBCy = cy;
      builtBTerrain = terrainRef;
      builtBZRef = zRef;
    };

    const addBox = (
      parent: THREE.Object3D,
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      px: number,
      py: number,
      pz: number,
    ) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(px, py, pz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    const rebuildGates = (l: FenceLayout, fenceH: number, cx: number, cy: number) => {
      // Geometries are unique per build (dispose them); materials are shared.
      clearGroup(gateGroup, false);
      const postH = fenceH + Math.max(POST_CAP, l.build.postProudFt);
      const postW = Math.max(GATE_POST_MIN, l.build.terminalWidthFt);
      for (const gu of l.gateUnits) {
        buildOpening(gu, fenceH, postH, postW, cx, cy);
      }
    };

    // A framed rectangular leaf (top/bottom rails, two stiles, diagonal brace),
    // centred at the leaf-group origin. Local x = along run, y = up, z = depth.
    const framedLeaf = (W: number, H: number, leafMat: THREE.Material) => {
      const g = new THREE.Group();
      addBox(g, new THREE.BoxGeometry(W, BAR_T, BAR_D), leafMat, 0, H / 2 - BAR_T / 2, 0);
      addBox(g, new THREE.BoxGeometry(W, BAR_T, BAR_D), leafMat, 0, -H / 2 + BAR_T / 2, 0);
      addBox(g, new THREE.BoxGeometry(BAR_T, H, BAR_D), leafMat, -W / 2 + BAR_T / 2, 0, 0);
      addBox(g, new THREE.BoxGeometry(BAR_T, H, BAR_D), leafMat, W / 2 - BAR_T / 2, 0, 0);
      const diagLen = Math.hypot(W, H) * 0.96;
      const brace = addBox(g, new THREE.BoxGeometry(diagLen, BAR_T, BAR_D * 0.8), leafMat, 0, 0, 0);
      brace.rotation.z = Math.atan2(H, W);
      return g;
    };

    const buildGateLeaf = (W: number, H: number, variant: GateUnit["variant"], leafMat: THREE.Material) => {
      if (variant === "double") {
        const g = new THREE.Group();
        const lw = W * 0.43;
        const lh = H * 0.84;
        const a = framedLeaf(lw, lh, leafMat);
        a.position.x = -W * 0.22;
        const b = framedLeaf(lw, lh, leafMat);
        b.position.x = W * 0.22;
        g.add(a, b);
        return g;
      }
      if (variant === "triple") {
        // Three equal leaves across the span (wide drive-through gates).
        const g = new THREE.Group();
        const lw = W * 0.29;
        const lh = H * 0.84;
        for (const off of [-W * 0.31, 0, W * 0.31]) {
          const leaf = framedLeaf(lw, lh, leafMat);
          leaf.position.x = off;
          g.add(leaf);
        }
        return g;
      }
      if (variant === "arched") {
        const g = new THREE.Group();
        const lw = W * 0.86;
        const lh = H * 0.78;
        g.add(framedLeaf(lw, lh, leafMat));
        const peakY = lh / 2 - BAR_T / 2;
        const rise = H * 0.16;
        const span = lw / 2;
        const barLen = Math.hypot(span, rise) * 1.04;
        const left = addBox(g, new THREE.BoxGeometry(barLen, BAR_T, BAR_D), leafMat, -span / 2, peakY + rise / 2, 0);
        left.rotation.z = Math.atan2(rise, span);
        const right = addBox(g, new THREE.BoxGeometry(barLen, BAR_T, BAR_D), leafMat, span / 2, peakY + rise / 2, 0);
        right.rotation.z = -Math.atan2(rise, span);
        return g;
      }
      return framedLeaf(W * 0.86, H * 0.84, leafMat); // single
    };

    const buildDoorLeaf = (W: number, H: number, variant: GateUnit["variant"], leafMat: THREE.Material) => {
      if (variant === "slatted") {
        const g = new THREE.Group();
        const lw = W * 0.9;
        const lh = H * 0.9;
        g.add(framedLeaf(lw, lh, leafMat));
        const slats = 6;
        for (let k = 1; k < slats; k++) {
          const y = -lh / 2 + (lh * k) / slats;
          addBox(g, new THREE.BoxGeometry(lw - BAR_T * 2, BAR_T * 0.7, BAR_D * 0.7), leafMat, 0, y, 0);
        }
        return g;
      }
      const g = new THREE.Group(); // solid slab
      addBox(g, new THREE.BoxGeometry(W * 0.9, H * 0.9, BAR_D * 1.6), leafMat, 0, 0, 0);
      return g;
    };

    const buildOpening = (gu: GateUnit, fenceH: number, postH: number, postW: number, cx: number, cy: number) => {
      const leafMat = gu.kind === "door" ? doorLeafMat : gateLeafMat;
      const cos = Math.cos(gu.yaw);
      const sin = Math.sin(gu.yaw);
      const half = gu.widthFt / 2;
      const tx = (x: number) => x - cx;
      const tz = (y: number) => -(y - cy);

      // Two heavier posts at the opening edges (own geometry per build), at
      // the build's terminal-post width.
      for (const sEdge of [-half, half]) {
        const px = gu.x + cos * sEdge;
        const py = gu.y + sin * sEdge;
        // Gate posts stand on the ground at each edge and reach the level leaf.
        const gy = groundAt(px, py);
        const h = Math.max(0.5, gu.base + postH - gy);
        const geo = new THREE.BoxGeometry(postW, h, postW);
        const mesh = addBox(gateGroup, geo, gatePostMat, tx(px), gy + h / 2, tz(py));
        mesh.rotation.y = gu.yaw;
      }

      const leaf =
        gu.kind === "door"
          ? buildDoorLeaf(gu.widthFt, fenceH, gu.variant, leafMat)
          : buildGateLeaf(gu.widthFt, fenceH, gu.variant, leafMat);
      leaf.position.set(tx(gu.x), gu.base + fenceH / 2, tz(gu.y));
      leaf.rotation.y = gu.yaw;
      gateGroup.add(leaf);
    };

    const rebuildChain = (l: FenceLayout, fenceH: number, isMesh: boolean, cx: number, cy: number, meshColor = "") => {
      clearGroup(chainGroup, true);
      if (!isMesh || l.bayCount === 0) return;
      const tx = (x: number) => x - cx;
      const tz = (y: number) => -(y - cy);
      // The build's own diamond (2" on residential fabric); the old studio's
      // coarser tiling without a build.
      const diamond = l.build === DEFAULT_FENCE_BUILD ? DIAMOND_FT : Math.max(0.08, l.build.meshDiamondFt ?? DIAMOND_FT);
      // One mesh for the whole fence: a quad per bay from its base line up by
      // the fence height — a parallelogram on a racked bay, a rectangle on a
      // stepped one. The diamond tiling lives in the UVs (units of the diamond),
      // so every bay shares one material and one alpha map.
      const pos = new Float32Array(l.bayCount * 4 * 3);
      const uv = new Float32Array(l.bayCount * 4 * 2);
      const idx: number[] = [];
      for (let i = 0; i < l.bayCount; i++) {
        const o = i * 7;
        const x0 = tx(l.bays[o]);
        const zz0 = tz(l.bays[o + 1]);
        const b0 = l.bays[o + 2];
        const x1 = tx(l.bays[o + 3]);
        const zz1 = tz(l.bays[o + 4]);
        const b1 = l.bays[o + 5];
        const len = Math.hypot(x1 - x0, zz1 - zz0) / diamond;
        const hh = fenceH / diamond;
        const v = i * 4;
        pos.set([x0, b0, zz0, x1, b1, zz1, x1, b1 + fenceH, zz1, x0, b0 + fenceH, zz0], v * 3);
        uv.set([0, 0, len, 0, len, hh, 0, hh], v * 2);
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const alpha = chainAlphaBase.clone();
      alpha.needsUpdate = true;
      alpha.wrapS = THREE.RepeatWrapping;
      alpha.wrapT = THREE.RepeatWrapping;
      const mat = new THREE.MeshStandardMaterial({
        // Galvanized wire reads light; a coated mesh (black vinyl) is the type's own dark colour.
        color: meshColor ? new THREE.Color(meshColor) : 0xb8bcc0,
        metalness: 0.55,
        roughness: 0.5,
        alphaMap: alpha,
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        envMapIntensity: 0.6,
      });
      chainGroup.add(new THREE.Mesh(geo, mat));
    };

    // A run that ends ON a house wall is fixed to the wall, not set in the
    // ground: a ledger board flush to the wall carrying the rails on two
    // brackets. Positions come from the layout's end posts flagged `postMount`.
    const rebuildMounts = (l: FenceLayout, fenceH: number, m: string, color: string, cx: number, cy: number) => {
      clearGroup(mountGroup, false);
      const boardMat = getMaterial(m, color);
      // A bracket per rail the build carries (a chain-link tension wire gets none).
      const rows = railRowsFor(l.build, fenceH).filter((r) => r.h >= 0.05);
      for (let i = 0; i < l.postCount; i++) {
        if (l.postMount[i] !== 1) continue;
        const x = l.posts[i * 3] - cx;
        const z = -(l.posts[i * 3 + 1] - cy);
        const yaw = l.posts[i * 3 + 2];
        const base = l.postPanel[i];
        const board = addBox(mountGroup, new THREE.BoxGeometry(0.62, fenceH + 0.2, 0.12), boardMat, x, base + (fenceH + 0.2) / 2, z);
        board.rotation.y = yaw + Math.PI / 2; // flat against a wall the fence meets square
        for (const row of rows) {
          const br = addBox(mountGroup, new THREE.BoxGeometry(0.42, Math.max(0.14, row.h), 0.34), gatePostMat, x, base + row.off, z);
          br.rotation.y = yaw;
        }
      }
    };

    const applyVisibility = (isMesh: boolean) => {
      if (picketMesh) picketMesh.visible = !isMesh;
      chainGroup.visible = isMesh;
    };

    const updateHighlight = (pts: PathPoint[], sel: number | null, fenceH: number, cx: number, cy: number) => {
      if (sel == null || sel < 0 || sel >= pts.length - 1 || pts[sel + 1].gap) {
        highlight.visible = false;
        return;
      }
      const a = pts[sel];
      const b = pts[sel + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) {
        highlight.visible = false;
        return;
      }
      highlight.visible = true;
      highlight.position.set((a.x + dx / 2) - cx, groundAt(a.x + dx / 2, a.y + dy / 2) + fenceH + 0.45, -((a.y + dy / 2) - cy));
      highlight.rotation.set(0, Math.atan2(dy, dx), 0);
      highlight.scale.set(len, 1, 1);
    };

    // Resize the whole view envelope to a span so a fence larger than the seed
    // path isn't clipped (shadow frustum, sky, ground, far plane, zoom limits).
    let worldSpan = span;
    let lastFramedSpan = span;
    const layoutSpan = (l: FenceLayout) =>
      Math.max(l.bounds.maxX - l.bounds.minX, l.bounds.maxY - l.bounds.minY, 10);
    /** How far the lot reaches from the scene centre (0 without a lot). */
    const reachOf = (lots: PathPoint[][], cx: number, cy: number) => {
      let r = 0;
      for (const ring of lots) for (const q of ring) r = Math.max(r, Math.hypot(q.x - cx, q.y - cy));
      return r;
    };
    const applyWorldScale = (sp: number) => {
      camera.far = sp * 40;
      camera.updateProjectionMatrix();
      sky.scale.setScalar(sp * 20);
      key.position.set(sp * 1.0, sp * 1.7, sp * 0.7);
      const shadowCam = key.shadow.camera as THREE.OrthographicCamera;
      shadowCam.left = -sp * 1.3;
      shadowCam.right = sp * 1.3;
      shadowCam.top = sp * 1.3;
      shadowCam.bottom = -sp * 1.3;
      shadowCam.far = sp * 8;
      shadowCam.updateProjectionMatrix();
      key.shadow.normalBias = sp * 0.0015;
      ground.scale.setScalar(Math.max(sp, lotReach * 0.6) / span);
      // Close enough to read a post cap, however big the lot.
      orbit.minDistance = 1.5;
      orbit.maxDistance = sp * 12;
      worldSpan = sp;
    };

    const frameCamera = (l: FenceLayout) => {
      const sp = layoutSpan(l);
      applyWorldScale(sp);
      lastFramedSpan = sp;
      const { cx, cy } = center(l);
      const gy = groundAt(cx, cy);
      // On a hillside the default 3/4 spot can be INSIDE the hill: lift the
      // camera clear of the land under it (and of the land between).
      let clear = gy + sp * 0.8;
      for (let k = 1; k <= 4; k++) {
        const f = k / 4;
        clear = Math.max(clear, groundAt(cx + sp * 0.95 * f, cy - sp * 0.95 * f) + sp * 0.35 + 4);
      }
      camera.position.set(sp * 0.95, clear, sp * 0.95);
      camera.updateProjectionMatrix();
      orbit.target.set(0, gy + 2, 0);
      orbit.update();
    };

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 1.5;
    orbit.maxDistance = span * 12;
    orbit.maxPolarAngle = Math.PI * 0.495;
    // The wheel zooms toward what the cursor is on — a post, a gate — rather
    // than the centre of the yard.
    orbit.zoomToCursor = true;
    orbit.target.set(0, 2, 0);
    orbit.update();

    // A double-click re-aims the orbit at what was clicked (fence, house, land):
    // the wheel then zooms in on THAT, and a drag circles it.
    const caster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onDblClick = (e: MouseEvent) => {
      if (modeRef.current !== "orbit") return;
      const r = renderer.domElement.getBoundingClientRect();
      if (!r.width || !r.height) return;
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      caster.setFromCamera(ndc, camera);
      const hits = caster.intersectObjects([fenceGroup, buildingsGroup, ...(terrainMesh ? [terrainMesh] : [ground])], true);
      const hit = hits.find((h) => h.object.visible);
      if (!hit) return;
      orbit.target.copy(hit.point);
      orbit.update();
    };
    renderer.domElement.addEventListener("dblclick", onDblClick);

    // Walking: "Walk through" locks the pointer — WASD to move, Q/E (or
    // Space/Shift) up·down, mouse to look, a click or Esc to step back out to
    // orbit. Never a bare click: a click that locked the pointer left people
    // with no cursor and no idea how to get it back (owner, 2026-09-28).
    const plc = new PointerLockControls(camera, renderer.domElement);
    plc.enabled = false;
    plc.minPolarAngle = Math.PI * 0.04;
    plc.maxPolarAngle = Math.PI * 0.96;
    plc.pointerSpeed = 0.9;
    const keys = new Set<string>();
    const onLock = () => {
      orbit.enabled = false;
      plc.enabled = true;
      modeRef.current = "fly";
      setMode("fly");
      setWalkNote(null);
    };
    const onUnlock = () => {
      plc.enabled = false;
      orbit.enabled = true;
      keys.clear();
      modeRef.current = "orbit";
      setMode("orbit");
      const dir = new THREE.Vector3();
      plc.getDirection(dir);
      dir.y = 0; // flatten so the orbit handoff respects the horizon clamp (no snap)
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      orbit.target.copy(camera.position).addScaledVector(dir, worldSpan * 0.3);
      orbit.update();
    };
    plc.addEventListener("lock", onLock);
    plc.addEventListener("unlock", onUnlock);
    const onLockError = () => {
      setWalkNote("Walking is not available in this browser — drag to orbit, scroll to zoom");
    };
    renderer.domElement.ownerDocument.addEventListener("pointerlockerror", onLockError);
    // Start a walk: drop to eye height where the orbit stands, facing what it
    // was looking at, then lock the pointer.
    const startWalk = () => {
      if (modeRef.current !== "orbit" || controlsRef.current !== "full") return;
      const bc = built ? center(built) : { cx: 0, cy: 0 };
      const eye = groundAt(camera.position.x + bc.cx, bc.cy - camera.position.z) + EYE_FT;
      const t = orbit.target;
      const dx = t.x - camera.position.x;
      const dz = t.z - camera.position.z;
      // Stand a stride back from the target along the line of sight, at eye
      // height; when the orbit is over the target, step back along -z.
      const flat = Math.hypot(dx, dz);
      if (flat > 6) {
        const k = (flat - 6) / flat;
        camera.position.x += dx * k;
        camera.position.z += dz * k;
      }
      camera.position.y = groundAt(camera.position.x + bc.cx, bc.cy - camera.position.z) + EYE_FT;
      camera.lookAt(t.x, Math.min(t.y, eye), t.z);
      try {
        plc.lock();
      } catch {
        onLockError();
      }
    };
    walkRef.current = startWalk;
    // While walking, a click is the way out for a hand that is on the mouse.
    const onCanvasClick = () => {
      if (modeRef.current === "fly" && plc.isLocked) plc.unlock();
    };
    renderer.domElement.addEventListener("click", onCanvasClick);
    const onKeyDown = (e: KeyboardEvent) => {
      if (modeRef.current !== "fly") return;
      if (e.code === "Space") e.preventDefault();
      if (e.code === "Escape") {
        plc.unlock();
        return;
      }
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    let prevTerrain: FenceTerrain3D | null = null;
    let prevClasses: Record<number, BayClass> | null = null;
    let prevSteps: Record<number, number> | null = null;
    let prevMounts: PathPoint[] | null = null;
    let prevBuild: FenceBuild | null = null;
    let prevMatKey: string | null = null;
    const applySpec = (next: ViewSpec) => {
      const geoChanged =
        next.points !== prevPts ||
        next.gates !== prevGates ||
        next.height !== prevH ||
        next.material !== prevMat ||
        matKey(next.material, next.materialColor) !== prevMatKey ||
        next.terrain !== prevTerrain ||
        next.segClasses !== prevClasses ||
        next.segSteps !== prevSteps ||
        next.wallMounts !== prevMounts ||
        next.build !== prevBuild;

      if (geoChanged) {
        // Where the ground under the scene centre sat BEFORE this change — the
        // camera rides any shift of it (a moved low point, land arriving
        // after the first framing) instead of ending up under the hill.
        const before = built && framed ? center(built) : null;
        const groundBefore = before ? groundAt(before.cx, before.cy) : 0;
        // The land first: the datum is the fence's lowest ground, so the fence
        // stays near y = 0 wherever the lot sits above sea level.
        terrainRef = next.terrain && next.points.length >= 2 ? next.terrain : null;
        if (terrainRef) {
          let lo = Infinity;
          for (const pt of next.points) lo = Math.min(lo, rawGround(pt.x, pt.y));
          zRef = Number.isFinite(lo) ? lo : 0;
        } else {
          zRef = 0;
        }
        const classes = next.segClasses;
        // The parts: the host's build, else the look's own (a chain-link look
        // is mesh on round posts even when no type is known); the old studio's
        // privacy run for a custom material.
        const build = next.build ?? (isBuiltinMaterial(next.material) ? fenceBuildForFamily(next.material, next.height) : DEFAULT_FENCE_BUILD);
        const l = computeFenceLayout(next.points, next.gates, {
          groundAt: terrainRef ? groundAt : undefined,
          segClass: classes ? (i: number) => classes[i] : undefined,
          segSteps: next.segSteps ? (i: number) => next.segSteps?.[i] : undefined,
          wallMounts: next.wallMounts,
          build,
        });
        const { cx, cy } = center(l);
        const rows = Math.max(1, railRowsFor(build, next.height).length);
        const countsChanged =
          !built ||
          !postMesh ||
          built.postCount !== l.postCount ||
          built.picketCount !== l.picketCount ||
          built.bayCount !== l.bayCount ||
          builtRows !== rows ||
          built.build.postProfile !== build.postProfile ||
          built.build.postCap !== build.postCap;
        if (countsChanged) {
          disposeInstances();
          buildInstances(l, next.material, next.materialColor, rows);
        } else if (matKey(next.material, next.materialColor) !== curMaterial) {
          const mat = getMaterial(next.material, next.materialColor);
          if (postMesh) postMesh.material = mat;
          if (picketMesh) picketMesh.material = mat;
          if (railMesh) railMesh.material = mat;
          if (capMesh && build.postCap !== "loop") capMesh.material = mat;
          curMaterial = matKey(next.material, next.materialColor);
        }
        const isMesh = build.infill === "mesh";
        writeMatrices(l, next.height, cx, cy);
        applyVisibility(isMesh);
        rebuildGates(l, next.height, cx, cy);
        // The wire takes a coated (dark) type's colour; a light chip is galvanized and keeps the bright wire.
        const wire = next.material === "chain-link" ? tintOf("chain-link", next.materialColor) : "";
        rebuildChain(l, next.height, isMesh, cx, cy, wire && new THREE.Color(wire).getHSL({ h: 0, s: 0, l: 0 }).l < 0.45 ? wire : "");
        rebuildMounts(l, next.height, next.material, next.materialColor, cx, cy);
        rebuildTerrain(cx, cy, Math.max(worldSpan, layoutSpan(l), reachOf(next.lots, cx, cy)));
        built = l;
        prevPts = next.points;
        prevGates = next.gates;
        prevH = next.height;
        prevMat = next.material;
        prevMatKey = matKey(next.material, next.materialColor);
        prevTerrain = next.terrain;
        prevClasses = next.segClasses;
        prevSteps = next.segSteps;
        prevMounts = next.wallMounts;
        prevBuild = next.build;
        if (!framed) {
          frameCamera(l);
          framed = true;
        } else {
          // Keep the view envelope (shadows/ground/zoom) in step as the fence grows.
          const sp = layoutSpan(l);
          if (sp > worldSpan * 1.05 || sp < worldSpan * 0.6) applyWorldScale(sp);
          if (before) {
            const shift = groundAt(cx, cy) - groundBefore;
            if (Math.abs(shift) > 1e-3) {
              camera.position.y += shift;
              orbit.target.y += shift;
              orbit.update();
            }
          }
        }
      }

      // Highlight is cheap and depends on selection — always refresh it.
      if (built) {
        const { cx, cy } = center(built);
        // Real buildings follow the same recentre as the fence: rebuild when the
        // footprint set changes OR the scene centre moved (fence redrawn).
        if (
          next.buildings !== builtBuildings ||
          cx !== builtBCx ||
          cy !== builtBCy ||
          terrainRef !== builtBTerrain ||
          zRef !== builtBZRef
        ) {
          rebuildBuildings(next.buildings, cx, cy);
        }
        // The lot line, and land and ground wide enough to carry it (a lot can
        // reach well past the fence, and it can land after the fence did).
        const reach = reachOf(next.lots, cx, cy);
        if (terrainRef && reach > 0) rebuildTerrain(cx, cy, Math.max(worldSpan, layoutSpan(built), reach));
        rebuildLots(next.lots, next.lotColor, cx, cy, layoutSpan(built));
        ground.scale.setScalar(Math.max(worldSpan, lotReach * 0.6) / span);
        // Trees last: they keep clear of the fence, the houses and the lot line.
        syncScenery(built, next);
        updateHighlight(next.points, next.selectedSegment, next.height, cx, cy);
      }
    };

    applySpec({ points, height, material, materialColor, gates, selectedSegment, buildings, terrain, segClasses, segSteps, wallMounts, lots, lotColor, build });
    applyRef.current = applySpec;

    activateRef.current = () => {
      if (!built) return;
      const sp = layoutSpan(built);
      // Re-frame only when the fence size changed meaningfully since last framing,
      // so toggling back to 3D without edits keeps the user's camera.
      if (Math.abs(sp - lastFramedSpan) > lastFramedSpan * 0.12) frameCamera(built);
    };
    suspendRef.current = () => {
      keys.clear();
      if (document.pointerLockElement === renderer.domElement) plc.unlock();
    };

    let raf = 0;
    let prev = performance.now();
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;
      if (modeRef.current === "fly" && plc.isLocked) {
        // A walking pace, so a post can be looked at; Shift runs.
        const v = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? RUN_FT_S : WALK_FT_S) * dt;
        if (keys.has("KeyW") || keys.has("ArrowUp")) plc.moveForward(v);
        if (keys.has("KeyS") || keys.has("ArrowDown")) plc.moveForward(-v);
        if (keys.has("KeyD") || keys.has("ArrowRight")) plc.moveRight(v);
        if (keys.has("KeyA") || keys.has("ArrowLeft")) plc.moveRight(-v);
        let dy = 0;
        if (keys.has("KeyE") || keys.has("Space")) dy += v;
        if (keys.has("KeyQ") || keys.has("KeyC")) dy -= v;
        const bc = built ? center(built) : { cx: 0, cy: 0 };
        const floor = groundAt(camera.position.x + bc.cx, bc.cy - camera.position.z) + 1.2;
        camera.position.y = Math.max(camera.position.y + dy, terrainRef ? floor : Math.max(floor, span * 0.02));
      } else if (modeRef.current === "orbit") {
        orbit.update();
        // Orbiting never dives under the land.
        if (terrainRef && built) {
          const bc = center(built);
          const floor = groundAt(camera.position.x + bc.cx, bc.cy - camera.position.z) + 2;
          if (camera.position.y < floor) {
            // Swing up onto the floor at the SAME distance from the target and
            // re-aim — raising y alone lengthened the orbit every damped frame
            // and rendered off-target.
            const t = orbit.target;
            const dx = camera.position.x - t.x;
            const dz = camera.position.z - t.z;
            const dist = Math.hypot(dx, camera.position.y - t.y, dz);
            const up = floor - t.y;
            const flat = Math.hypot(dx, dz);
            if (up < dist && flat > 1e-6) {
              const k = Math.sqrt(dist * dist - up * up) / flat;
              camera.position.x = t.x + dx * k;
              camera.position.z = t.z + dz * k;
            }
            camera.position.y = floor;
            camera.lookAt(t);
          }
        }
      }
      renderer.render(scene, camera);
    };
    animate(prev);

    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth || w;
      const nh = mount.clientHeight || h0;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      orbit.dispose();
      plc.removeEventListener("lock", onLock);
      plc.removeEventListener("unlock", onUnlock);
      renderer.domElement.ownerDocument.removeEventListener("pointerlockerror", onLockError);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      renderer.domElement.removeEventListener("click", onCanvasClick);
      walkRef.current = () => {};
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      if (document.pointerLockElement === renderer.domElement) plc.unlock();
      plc.dispose();
      disposeInstances();
      clearGroup(gateGroup, false);
      clearGroup(mountGroup, false);
      clearGroup(chainGroup, true);
      disposeTerrain();
      contourMat.dispose();
      clearGroup(sceneryGroup, false);
      clearGroup(buildingsGroup, false);
      clearGroup(lotGroup, false);
      for (const m of sceneryMats) m.dispose();
      lotMat.dispose();
      stakeMat.dispose();
      stakeCapMat.dispose();
      postGeo.dispose();
      postRoundGeo.dispose();
      picketGeo.dispose();
      railGeo.dispose();
      for (const g of Object.values(capGeos)) g?.dispose();
      highlightGeo.dispose();
      highlightMat.dispose();
      gatePostMat.dispose();
      gateLeafMat.dispose();
      doorLeafMat.dispose();
      chainAlphaBase.dispose();
      for (const { mat, tex } of matCache.values()) {
        mat.dispose();
        tex?.dispose();
      }
      matCache.clear();
      groundGeo.dispose();
      groundMat.dispose();
      scene.environment = null;
      envTex?.dispose();
      (sky.material as THREE.Material).dispose();
      sky.geometry.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      rendererRef.current = null;
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [supported]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) {
    return (
      <div
        className={cn(
          "grid place-items-center text-[12px] text-[color:var(--ink-faint)] bg-[color:var(--paper)]",
          className,
        )}
      >
        3D view unavailable (WebGL not supported)
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div ref={mountRef} className="absolute inset-0" />
      {/* `data-fm3d` on the two overlays is a STYLE HOOK, not behaviour — one
          stable selector each so a host with its own design system (the
          blueprint Fence studio) can re-skin them. The utility classes stay the
          default look for every other host. */}
      <div className="absolute left-3 top-3 pointer-events-none">
        <span
          data-fm3d="badge"
          className="inline-flex items-center gap-1.5 rounded-full bg-white/85 backdrop-blur hairline px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] font-medium text-[color:var(--ink-soft)]"
        >
          <span data-fm3d="dot" className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
          Live · 3D
        </span>
      </div>
      {mode === "orbit" ? (
        <div className="absolute inset-x-0 bottom-3 flex justify-center items-center gap-2 pointer-events-none">
          <span
            data-fm3d="hint"
            className="rounded-full bg-white/85 backdrop-blur hairline px-3 py-1 text-[11px] text-[color:var(--ink-muted)]"
          >
            {walkNote ?? (controls === "full" ? "Drag to orbit · scroll to zoom in on a post · double-click to look at a spot" : "Drag to look around · pinch or scroll to zoom")}
          </span>
          {controls === "full" ? (
            <button
              type="button"
              data-fm3d="walk"
              className="pointer-events-auto rounded-full bg-[color:var(--accent)] text-white px-3 py-1 text-[11px] font-medium shadow-[var(--shadow-sm)]"
              onClick={() => walkRef.current()}
            >
              Walk through
            </button>
          ) : null}
        </div>
      ) : (
        <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none">
          <span
            data-fm3d="hint-on"
            className="rounded-full bg-[color:var(--accent)] text-white px-3 py-1 text-[11px] shadow-[var(--shadow-sm)]"
          >
            Walking · move the mouse to look · W A S D to move, Shift to run, Q/E down·up · click or Esc to stop
          </span>
        </div>
      )}
    </div>
  );
});
