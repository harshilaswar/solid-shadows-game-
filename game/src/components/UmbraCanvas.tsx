import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  buildSanctuaryEnvironment,
  GROUND_Y,
  type EnvironmentController,
} from '../game/environment';
import { createNatureUniforms, createPhysicalUmbraMaterial } from '../game/natureShaders';
import { SANCTUARY_PALETTES } from '../game/palettes';
import {
  distanceToConvexPolygon,
  distanceToPolygon,
  distanceToRamp,
  distanceToRect,
  isCrystalEclipsed,
  isGapBridged,
  outlineOf,
  projectBoxShadowToPlane,
  projectOutlineShadowToPlane,
  rampHeightAt,
  resolveCircleRectCollision,
  resolveCircleRotRectCollision,
  sunShadowOffsetPerHeight,
  traceUmbraSilhouette,
} from '../game/shadowMath';
import { sound } from '../game/sound';
import {
  createCeramicSphereTexture,
  createGlowTexture,
  createMasonryTextures,
  createMonolithTextures,
  createSoftBlobShadowTexture,
  createTravertineTextures,
} from '../game/textures';
import { LevelData, Rect2D, Vec2, Vec3 } from '../game/types';

export interface LiveStatus {
  bridgedCount: number;
  totalGaps: number;
  eclipsed: boolean;
  hasCrystals: boolean;
  onShadow: boolean;
  isDraggingSun: boolean;
  sunAzimuthDeg: number;
  /** Signed camera orbit angle in degrees (0 = the authored 3/4 view). */
  viewAzimuthDeg: number;
  /** True while a two-finger / right-drag orbit gesture is active. */
  isRotatingView: boolean;
}

export interface GameSettings {
  quality: 'low' | 'medium' | 'high';
  shadowOpacity: number;
  cameraDrift: boolean;
  dustMotes: boolean;
}

interface UmbraCanvasProps {
  level: LevelData;
  settings: GameSettings;
  resetSignal: number;
  resetLightSignal: number;
  /** Increment to ease the orbit back to the authored 3/4 view. */
  resetViewSignal?: number;
  virtualInputRef: React.MutableRefObject<{ x: number; y: number }>;
  isPausedOverlay: boolean;
  onLevelComplete: (elapsedSeconds: number) => void;
  onStatusChange: (status: LiveStatus) => void;
  onFirstInteract?: () => void;
}

const BALL_RADIUS = 0.32;

/** Solid depth of a platform's stone body, measured from its top face down (slab + body + plinth). */
const PLATFORM_BODY_DEPTH = 1.16;

interface SupportHit {
  height: number;
  dist: number;
  source: 'platform' | 'shadow' | 'ramp';
  onShadow: boolean;
  rampYaw?: number;
  rampSlope?: number;
}

interface SupportEvaluation {
  best: SupportHit | null;
  /** Flat/ramp surfaces above the ball's feet — these behave as walls. */
  walls: SupportHit[];
}

/** 2D containment platforms need (footprint test shared by spawn & support). */
const footprintDist = (shape: { xMin: number; xMax: number; zMin: number; zMax: number; points?: Vec2[] }, x: number, z: number): number =>
  shape.points && shape.points.length >= 3 ? distanceToPolygon({ x, z }, shape.points) : distanceToRect({ x, z }, shape);

/**
 * Finds every surface containing (x, z) — stone tops, solidified shadow bridges on their own
 * planes, and ramps — and sorts them into what the ball can stand on right now (at or below
 * its feet, highest first) and what must block it as a wall (above its feet).
 */
const evaluateSupport = (
  x: number,
  z: number,
  bottom: number,
  platforms: LevelData['platforms'],
  gaps: LevelData['brokenGaps'],
  ramps: LevelData['ramps'] | undefined,
  bridged: boolean[],
  shadowsByPlane: Map<number, Vec2[][]>,
  forgiveness = 0.14
): SupportEvaluation => {
  const hits: SupportHit[] = [];
  for (const p of platforms) {
    const d = footprintDist(p, x, z);
    if (d <= forgiveness) {
      hits.push({ height: p.y ?? 0, dist: Math.max(0, d), source: 'platform', onShadow: false });
    }
  }
  gaps.forEach((g, i) => {
    if (!bridged[i]) return;
    const gy = g.y ?? 0;
    for (const poly of shadowsByPlane.get(gy) ?? []) {
      const d = distanceToConvexPolygon({ x, z }, poly);
      if (d <= forgiveness) {
        hits.push({ height: gy, dist: Math.max(0, d), source: 'shadow', onShadow: true });
      }
    }
  });
  for (const r of ramps ?? []) {
    if (rampHeightAt(r, x, z, forgiveness) === null) continue;
    hits.push({
      height: rampHeightAt(r, x, z, forgiveness) as number,
      dist: Math.max(0, distanceToRamp(r, { x, z })),
      source: 'ramp',
      onShadow: false,
      rampYaw: r.yaw,
      rampSlope: r.length > 1e-6 ? r.rise / r.length : 0,
    });
  }
  const sourceRank = (s: SupportHit) => (s.source === 'platform' ? 0 : s.source === 'ramp' ? 1 : 2);
  const below = hits.filter((c) => c.height <= bottom + 0.02);
  below.sort((a, b) => b.height - a.height || sourceRank(a) - sourceRank(b));
  const walls = hits.filter((c) => c.height > bottom + 0.02 && c.source !== 'shadow');
  return { best: below[0] ?? null, walls };
};

/** Highest walkable surface at/near a point — used for spawn & respawn placement. */
const spawnSurfaceHeight = (
  x: number,
  z: number,
  platforms: LevelData['platforms'],
  ramps: LevelData['ramps'] | undefined,
  fallbackY: number
): number => {
  let best: number | null = null;
  for (const p of platforms) {
    if (footprintDist(p, x, z) <= 0.14) {
      const py = p.y ?? 0;
      if (best === null || py > best) best = py;
    }
  }
  for (const r of ramps ?? []) {
    const h = rampHeightAt(r, x, z, 0.14);
    if (h !== null && (best === null || h > best)) best = h;
  }
  return best ?? fallbackY;
};

export const UmbraCanvas: React.FC<UmbraCanvasProps> = ({
  level,
  settings,
  resetSignal,
  resetLightSignal,
  resetViewSignal = 0,
  virtualInputRef,
  isPausedOverlay,
  onLevelComplete,
  onStatusChange,
  onFirstInteract,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onLevelComplete, onStatusChange, onFirstInteract });
  callbacksRef.current = { onLevelComplete, onStatusChange, onFirstInteract };

  const isPausedRef = useRef(isPausedOverlay);
  isPausedRef.current = isPausedOverlay;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);

  // Camera orbit state. Kept in a ref so gestures and the animation loop share
  // one value without remounting WebGL on every frame.
  const viewRef = useRef({
    yaw: 0,
    pitch: 0,
    zoom: 1,
    targetYaw: 0,
    targetPitch: 0,
    targetZoom: 1,
    rotating: false,
  });

  const simRef = useRef<{
    ballPos: THREE.Vector3;
    ballVel: Vec2;
    ballVy: number;
    splashed: boolean;
    ballQuat: THREE.Quaternion;
    lastSafePos: Vec2;
    falling: boolean;
    fallTimer: number;
    won: boolean;
    winTimer: number;
    startTime: number;
    lightPos: Vec3;
    lightTarget: Vec3;
    lightDirty: boolean;
    shadows: Vec2[][];
    shadowsByPlane: Map<number, Vec2[][]>;
    bridgedFlags: boolean[];
    eclipsed: boolean;
    draggingPlane: 'none' | 'sky' | 'ground';
    dragOffset: Vec2;
    hoveringSun: boolean;
  }>({
    ballPos: new THREE.Vector3(level.start.x, spawnSurfaceHeight(level.start.x, level.start.z, level.platforms, level.ramps, level.start.y ?? 0) + BALL_RADIUS, level.start.z),
    ballVel: { x: 0, z: 0 },
    ballVy: 0,
    splashed: false,
    ballQuat: new THREE.Quaternion(),
    lastSafePos: { x: level.start.x, z: level.start.z, y: spawnSurfaceHeight(level.start.x, level.start.z, level.platforms, level.ramps, level.start.y ?? 0) },
    falling: false,
    fallTimer: 0,
    won: false,
    winTimer: 0,
    startTime: performance.now(),
    lightPos: { ...level.lightInitial },
    lightTarget: { ...level.lightInitial },
    lightDirty: true,
    shadows: [],
    shadowsByPlane: new Map(),
    bridgedFlags: [],
    eclipsed: false,
    draggingPlane: 'none',
    dragOffset: { x: 0, z: 0 },
    hoveringSun: false,
  });

  // Reset ball to level start when resetSignal increments
  useEffect(() => {
    const s = simRef.current;
    s.ballPos.set(level.start.x, spawnSurfaceHeight(level.start.x, level.start.z, level.platforms, level.ramps, level.start.y ?? 0) + BALL_RADIUS + 0.42, level.start.z);
    s.ballVel = { x: 0, z: 0 };
    s.ballVy = 0;
    s.splashed = false;
    s.ballQuat.identity();
    s.lastSafePos = { x: level.start.x, z: level.start.z, y: spawnSurfaceHeight(level.start.x, level.start.z, level.platforms, level.ramps, level.start.y ?? 0) };
    s.falling = false;
    s.fallTimer = 0;
    s.won = false;
    s.winTimer = 0;
  }, [resetSignal, level]);

  useEffect(() => {
    const v = viewRef.current;
    v.targetYaw = 0;
    v.targetPitch = 0;
    v.targetZoom = 1;
  }, [resetViewSignal]);

  // Reset sun orbit direction when resetLightSignal increments
  useEffect(() => {
    const s = simRef.current;
    const r = Math.hypot(level.lightInitial.x, level.lightInitial.z) || 1;
    const orbitR = level.lightBounds.maxRadius * 0.78;
    s.lightPos = {
      x: (level.lightInitial.x / r) * orbitR,
      y: level.lightBounds.y,
      z: (level.lightInitial.z / r) * orbitR,
    };
    s.lightTarget = { ...s.lightPos };
    s.lightDirty = true;
  }, [resetLightSignal, level]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const palette = SANCTUARY_PALETTES[(level.number - 1) % SANCTUARY_PALETTES.length];
    const shadowRatio = level.lightBounds.shadowRatio;
    const orbitRadius = level.lightBounds.maxRadius * 0.78;

    const v = viewRef.current;
    v.yaw = 0;
    v.pitch = 0;
    v.zoom = 1;
    v.targetYaw = 0;
    v.targetPitch = 0;
    v.targetZoom = 1;
    v.rotating = false;

    const sim = simRef.current;
    sim.ballPos.set(level.start.x, spawnSurfaceHeight(level.start.x, level.start.z, level.platforms, level.ramps, level.start.y ?? 0) + BALL_RADIUS + 0.42, level.start.z);
    sim.ballVel = { x: 0, z: 0 };
    sim.ballVy = 0;
    sim.splashed = false;
    sim.ballQuat.identity();
    sim.lastSafePos = { x: level.start.x, z: level.start.z, y: spawnSurfaceHeight(level.start.x, level.start.z, level.platforms, level.ramps, level.start.y ?? 0) };
    sim.falling = false;
    sim.fallTimer = 0;
    sim.won = false;
    sim.winTimer = 0;
    sim.startTime = performance.now();
    {
      const r = Math.hypot(level.lightInitial.x, level.lightInitial.z) || 1;
      sim.lightPos = {
        x: (level.lightInitial.x / r) * orbitRadius,
        y: level.lightBounds.y,
        z: (level.lightInitial.z / r) * orbitRadius,
      };
      sim.lightTarget = { ...sim.lightPos };
    }
    sim.lightDirty = true;
    sim.shadows = [];
    sim.shadowsByPlane = new Map();
    sim.bridgedFlags = level.brokenGaps.map(() => false);
    sim.eclipsed = false;
    sim.draggingPlane = 'none';
    sim.hoveringSun = false;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(palette.fogColor, 0.0098);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 145);
    const baseLookAt = new THREE.Vector3(
      level.camera.lookAt.x,
      level.camera.lookAt.y,
      level.camera.lookAt.z
    );
    const baseCamPos = new THREE.Vector3(
      level.camera.lookAt.x + level.camera.offset.x,
      level.camera.lookAt.y + level.camera.offset.y,
      level.camera.lookAt.z + level.camera.offset.z
    );
    camera.position.copy(baseCamPos);
    camera.lookAt(baseLookAt);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    const q0 = settingsRef.current.quality;
    const ratioCap = q0 === 'low' ? 1 : q0 === 'medium' ? 1.5 : 2;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, ratioCap));
    rendererRef.current = renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setClearColor(palette.fogColor);
    renderer.toneMappingExposure = 1.06;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const natureUniforms = createNatureUniforms();

    // -------------------------------------------------------------------------
    // Physically Realistic Sunlit Nature Lighting Rig
    // Cool cyan-emerald sky fill + warm golden parallel sunlight naturally yields
    // rich forest-green shadows on grass, slate-blue shadows on cream stone, & cobalt shadows on water.
    // -------------------------------------------------------------------------
    const hemiLight = new THREE.HemisphereLight('#5CBCE2', palette.hemiGround, 1.12);
    scene.add(hemiLight);

    const rimFill = new THREE.DirectionalLight(palette.bounceLight, 0.24);
    rimFill.position.set(-12, 16, -14);
    scene.add(rimFill);

    const sunLight = new THREE.DirectionalLight(palette.sunLightColor, 2.75);
    const sunTarget = new THREE.Object3D();
    sunTarget.position.set(level.camera.lookAt.x, 0, level.camera.lookAt.z);
    scene.add(sunTarget);
    sunLight.target = sunTarget;
    const currentSunDir = new THREE.Vector3();

    const placeSunLight = () => {
      const horiz = Math.hypot(sim.lightPos.x, sim.lightPos.z) || 1;
      const ux = sim.lightPos.x / horiz;
      const uz = sim.lightPos.z / horiz;
      currentSunDir.set(ux * shadowRatio, 1.0, uz * shadowRatio).normalize();
      sunLight.position.copy(sunTarget.position).addScaledVector(currentSunDir, 42);
    };
    placeSunLight();

    sunLight.castShadow = true;
    sunLightRef.current = sunLight;
    const shadowRes = q0 === 'low' ? 1024 : q0 === 'medium' ? 2048 : 4096;
    sunLight.shadow.mapSize.width = shadowRes;
    sunLight.shadow.mapSize.height = shadowRes;
    const shadowExtent = Math.max(28, level.lightBounds.maxRadius * 2.75);
    sunLight.shadow.camera.near = 2;
    sunLight.shadow.camera.far = 108;
    sunLight.shadow.camera.left = -shadowExtent;
    sunLight.shadow.camera.right = shadowExtent;
    sunLight.shadow.camera.top = shadowExtent;
    sunLight.shadow.camera.bottom = -shadowExtent;
    sunLight.shadow.bias = -0.00035;
    sunLight.shadow.normalBias = 0.022;
    sunLight.shadow.radius = q0 === 'low' ? 1.4 : 2.3;
    scene.add(sunLight);

    // -------------------------------------------------------------------------
    // Tactile Architectural Materials
    // -------------------------------------------------------------------------
    const travertinePair = createTravertineTextures(palette.stoneTop);
    track(travertinePair.map);
    track(travertinePair.bumpMap);

    const masonryPair = createMasonryTextures(palette.stoneSide);
    track(masonryPair.map);
    track(masonryPair.bumpMap);

    const deepMasonryPair = createMasonryTextures(palette.stoneDeep);
    track(deepMasonryPair.map);
    track(deepMasonryPair.bumpMap);

    const terraPair = createMonolithTextures(palette.terracotta, 4129);
    track(terraPair.map);
    track(terraPair.bumpMap);

    const ochrePair = createMonolithTextures(palette.ochre, 6203);
    track(ochrePair.map);
    track(ochrePair.bumpMap);

    const slatePair = createMonolithTextures(palette.slate, 9011);
    track(slatePair.map);
    track(slatePair.bumpMap);

    const matStoneTopBase = track(
      new THREE.MeshStandardMaterial({
        map: travertinePair.map,
        bumpMap: travertinePair.bumpMap,
        bumpScale: 0.018,
        roughness: 0.78,
        metalness: 0.02,
      })
    );
    const matStoneSide = track(
      new THREE.MeshStandardMaterial({
        map: masonryPair.map,
        bumpMap: masonryPair.bumpMap,
        bumpScale: 0.024,
        roughness: 0.86,
        metalness: 0.02,
      })
    );
    const matStoneDeep = track(
      new THREE.MeshStandardMaterial({
        map: deepMasonryPair.map,
        bumpMap: deepMasonryPair.bumpMap,
        bumpScale: 0.022,
        roughness: 0.9,
        metalness: 0.02,
      })
    );
    const matBrass = track(
      new THREE.MeshStandardMaterial({
        color: palette.accent,
        roughness: 0.36,
        metalness: 0.68,
      })
    );
    const matInlayLine = track(
      new THREE.LineBasicMaterial({
        color: palette.stoneDeep,
        transparent: true,
        opacity: 0.7,
      })
    );

    const pillarMaterials = {
      terracotta: track(
        new THREE.MeshStandardMaterial({
          map: terraPair.map,
          bumpMap: terraPair.bumpMap,
          bumpScale: 0.022,
          roughness: 0.66,
          metalness: 0.04,
        })
      ),
      ochre: track(
        new THREE.MeshStandardMaterial({
          map: ochrePair.map,
          bumpMap: ochrePair.bumpMap,
          bumpScale: 0.022,
          roughness: 0.68,
          metalness: 0.04,
        })
      ),
      slate: track(
        new THREE.MeshStandardMaterial({
          map: slatePair.map,
          bumpMap: slatePair.bumpMap,
          bumpScale: 0.022,
          roughness: 0.6,
          metalness: 0.08,
        })
      ),
      trim: track(
        new THREE.MeshStandardMaterial({
          color: palette.trim,
          bumpMap: travertinePair.bumpMap,
          bumpScale: 0.012,
          roughness: 0.6,
          metalness: 0.04,
        })
      ),
    };

    // -------------------------------------------------------------------------
    // Abandoned Architecture in Nature + Animated Grass, Trees, Vines & Water
    // -------------------------------------------------------------------------
    let environment: EnvironmentController = {
      update: () => undefined,
      triggerSplash: () => undefined,
    };
    try {
      environment = buildSanctuaryEnvironment(
        scene,
        level,
        palette,
        track,
        {
          stoneTop: matStoneTopBase,
          stoneSide: matStoneSide,
          stoneDeep: matStoneDeep,
          terracotta: pillarMaterials.terracotta,
          ochre: pillarMaterials.ochre,
          trim: pillarMaterials.trim,
        },
        natureUniforms,
        q0
      );
    } catch (err) {
      console.error('Environment failed to build; continuing without it', err);
    }

    // -------------------------------------------------------------------------
    // Build Handcrafted Platforms + Brass Inlays + Fractured Stone Edges
    // -------------------------------------------------------------------------
    const levelGroup = new THREE.Group();
    scene.add(levelGroup);

    const cornerDiamondGeo = track(new THREE.PlaneGeometry(0.13, 0.13));
    cornerDiamondGeo.rotateX(-Math.PI / 2);
    cornerDiamondGeo.rotateY(Math.PI / 4);

    const pillarMossMat = track(
      new THREE.MeshStandardMaterial({
        color: palette.moss,
        roughness: 0.92,
        metalness: 0.0,
      })
    );

    /** Builds an extruded slab from a world-space outline, matching the shadow-slab convention. */
    const slabFromOutline = (
      pts: Vec2[],
      depth: number,
      material: THREE.Material | THREE.Material[],
      yTop: number,
      castShadow = false,
      parent: THREE.Group | THREE.Scene = levelGroup
    ) => {
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].x, -pts[0].z);
      for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k].x, -pts[k].z);
      shape.closePath();
      const geo = track(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }));
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = yTop - depth;
      mesh.receiveShadow = true;
      mesh.castShadow = castShadow;
      parent.add(mesh);
      return mesh;
    };

    const shrinkOutline = (pts: Vec2[], amount: number): Vec2[] => {
      let cx = 0;
      let cz = 0;
      for (const q of pts) {
        cx += q.x;
        cz += q.z;
      }
      cx /= pts.length;
      cz /= pts.length;
      return pts.map((q) => {
        const dx = q.x - cx;
        const dz = q.z - cz;
        const len = Math.hypot(dx, dz) || 1;
        const k = Math.max(0.2, (len - amount) / len);
        return { x: cx + dx * k, z: cz + dz * k };
      });
    };

    for (const plat of level.platforms) {
      const platY = plat.y ?? 0;
      const platGroup = new THREE.Group();
      platGroup.position.y = platY;
      levelGroup.add(platGroup);
      const w = plat.xMax - plat.xMin;
      const d = plat.zMax - plat.zMin;
      const cx = (plat.xMin + plat.xMax) * 0.5;
      const cz = (plat.zMin + plat.zMax) * 0.5;
      const outline: Vec2[] = plat.points && plat.points.length >= 3 ? plat.points : [];

      const platMap = track(travertinePair.map.clone());
      platMap.repeat.set(Math.max(1, w * 0.45), Math.max(1, d * 0.45));
      platMap.needsUpdate = true;
      const platBump = track(travertinePair.bumpMap.clone());
      platBump.repeat.set(Math.max(1, w * 0.45), Math.max(1, d * 0.45));
      platBump.needsUpdate = true;

      const platTopMat = track(
        new THREE.MeshStandardMaterial({
          map: platMap,
          bumpMap: platBump,
          bumpScale: 0.016,
          roughness: 0.76,
          metalness: 0.02,
        })
      );

      if (outline.length >= 3) {
        // --- polygon stone: top slab, stepped cliff body, plinth, inlay, fractured spurs
        slabFromOutline(outline, 0.14, platTopMat, 0, true, platGroup);
        slabFromOutline(shrinkOutline(outline, 0.06), 0.58, matStoneSide, -0.14, false, platGroup);
        slabFromOutline(shrinkOutline(outline, 0.2), 0.44, matStoneDeep, -0.72, false, platGroup);
        // Elevated lodestones float — no support cliff rooted in the chasm. Never-root platY stays the same at ground level.
        if (Math.abs(platY) <= 0.02) {
          slabFromOutline(shrinkOutline(outline, 0.34), 1.2, matStoneDeep, -1.16, false, platGroup);
        }

        // inset inlay copied inward from every edge midpoint
        const inset = shrinkOutline(outline, 0.22);
        const pts = inset.map((q) => new THREE.Vector3(q.x, 0.004, q.z));
        const loopGeo = track(new THREE.BufferGeometry().setFromPoints(pts));
        const loop = new THREE.LineLoop(loopGeo, matInlayLine);
        platGroup.add(loop);

        if ((plat.brokenEdges || []).length > 0) {
          // small fractured spurs sitting on the outline's corners
          outline.forEach((q, idx) => {
            if (idx % 2 !== 0) return;
            const spur = new THREE.Mesh(
              track(new THREE.BoxGeometry(0.16, 0.1, 0.16)),
              idx % 4 === 0 ? matStoneTopBase : matStoneSide
            );
            spur.position.set(q.x, -0.05, q.z);
            spur.rotation.y = idx * 0.7;
            spur.receiveShadow = true;
            platGroup.add(spur);
          });
        }
      } else {
        // --- rectangular stone (original path)
        const topGeo = track(new THREE.BoxGeometry(w, 0.14, d));
        const topMesh = new THREE.Mesh(topGeo, platTopMat);
        topMesh.position.set(cx, -0.07, cz);
        topMesh.receiveShadow = true;
        topMesh.castShadow = true;
        platGroup.add(topMesh);

        const bodyGeo = track(new THREE.BoxGeometry(Math.max(0.2, w - 0.1), 0.58, Math.max(0.2, d - 0.1)));
        const bodyMesh = new THREE.Mesh(bodyGeo, matStoneSide);
        bodyMesh.position.set(cx, -0.43, cz);
        bodyMesh.receiveShadow = true;
        bodyMesh.castShadow = true;
        platGroup.add(bodyMesh);

        const plinthGeo = track(new THREE.BoxGeometry(Math.max(0.2, w - 0.34), 0.44, Math.max(0.2, d - 0.34)));
        const plinthMesh = new THREE.Mesh(plinthGeo, matStoneDeep);
        plinthMesh.position.set(cx, -0.94, cz);
        plinthMesh.receiveShadow = true;
        plinthMesh.castShadow = true;
        platGroup.add(plinthMesh);

        // Elevated lodestones float — a cliff only roots stones sitting on the court floor
        if (Math.abs(platY) <= 0.02) {
          const cliffH = 1.2;
          const cliffGeo = track(new THREE.BoxGeometry(Math.max(0.2, w - 0.6), cliffH, Math.max(0.2, d - 0.6)));
          const cliffMesh = new THREE.Mesh(cliffGeo, matStoneDeep);
          cliffMesh.position.set(cx, -1.16 - cliffH * 0.5 + 0.0, cz);
          cliffMesh.receiveShadow = true;
          cliffMesh.castShadow = true;
          platGroup.add(cliffMesh);
        }

        if (w > 1.2 && d > 1.2) {
          const inset = 0.2;
          const pts = [
            new THREE.Vector3(plat.xMin + inset, 0.004, plat.zMin + inset),
            new THREE.Vector3(plat.xMax - inset, 0.004, plat.zMin + inset),
            new THREE.Vector3(plat.xMax - inset, 0.004, plat.zMax - inset),
            new THREE.Vector3(plat.xMin + inset, 0.004, plat.zMax - inset),
          ];
          const loopGeo = track(new THREE.BufferGeometry().setFromPoints(pts));
          const loop = new THREE.LineLoop(loopGeo, matInlayLine);
          platGroup.add(loop);

          for (const p of pts) {
            const dia = new THREE.Mesh(cornerDiamondGeo, matBrass);
            dia.position.set(p.x, 0.005, p.z);
            platGroup.add(dia);
          }
        }

        for (const edge of plat.brokenEdges || []) {
          const count = 5;
          for (let i = 0; i < count; i++) {
            const frac = (i + 0.5) / count - 0.5;
            const jut = 0.13 + ((i * 7 + 2) % 4) * 0.05;
            const toothThick = 0.11 + (i % 2) * 0.06;
            const toothDrop = -0.03 - (i % 3) * 0.04;

            if (edge === 'east' || edge === 'west') {
              const span = Math.min(d * 0.78, 2.25);
              const tz = cz + frac * span;
              const tx = edge === 'east' ? plat.xMax + jut * 0.5 - 0.02 : plat.xMin - jut * 0.5 + 0.02;
              const tGeo = track(new THREE.BoxGeometry(jut, toothThick, (span / count) * 0.78));
              const tMesh = new THREE.Mesh(tGeo, i % 2 === 0 ? matStoneTopBase : matStoneSide);
              tMesh.position.set(tx, toothDrop - toothThick * 0.5, tz);
              tMesh.rotation.z = (edge === 'east' ? -1 : 1) * (0.04 + (i % 3) * 0.03);
              tMesh.receiveShadow = true;
              tMesh.castShadow = true;
              platGroup.add(tMesh);
            } else {
              const span = Math.min(w * 0.78, 2.25);
              const tx = cx + frac * span;
              const tz = edge === 'south' ? plat.zMax + jut * 0.5 - 0.02 : plat.zMin - jut * 0.5 + 0.02;
              const tGeo = track(new THREE.BoxGeometry((span / count) * 0.78, toothThick, jut));
              const tMesh = new THREE.Mesh(tGeo, i % 2 === 0 ? matStoneTopBase : matStoneSide);
              tMesh.position.set(tx, toothDrop - toothThick * 0.5, tz);
              tMesh.rotation.x = (edge === 'south' ? 1 : -1) * (0.04 + (i % 3) * 0.03);
              tMesh.receiveShadow = true;
              tMesh.castShadow = true;
              platGroup.add(tMesh);
            }
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Slope Walkways — terraced stair ramps the sphere rolls up and down
    // -------------------------------------------------------------------------
    const rampMat = track(
      new THREE.MeshStandardMaterial({
        color: palette.stoneTop,
        roughness: 0.82,
        metalness: 0.02,
        flatShading: true,
        side: THREE.DoubleSide,
      })
    );
    const stepLineMat = track(
      new THREE.LineBasicMaterial({ color: palette.stoneDeep, transparent: true, opacity: 0.6 })
    );

    for (const ramp of level.ramps ?? []) {
      const f = { x: Math.sin(ramp.yaw), z: Math.cos(ramp.yaw) };
      const r = { x: Math.cos(ramp.yaw), z: -Math.sin(ramp.yaw) };
      const hl = ramp.length * 0.5;
      const hw = ramp.width * 0.5;
      const yBottom = -2.36;
      const yLow = ramp.y;
      const yHigh = ramp.y + ramp.rise;

      const vert = (t: number, w: number, y: number) =>
        new THREE.Vector3(ramp.x + f.x * t + r.x * w, y, ramp.z + f.z * t + r.z * w);
      const A = (t: number, w: number, y: number) => vert(t, w, y);
      const quad = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, p4: THREE.Vector3) => {
        rampPos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
      };
      const rampPos: number[] = [];
      // top slope
      quad(A(-hl, -hw, yLow), A(hl, -hw, yHigh), A(hl, hw, yHigh), A(-hl, hw, yLow));
      // underside
      quad(A(-hl, hw, yBottom), A(hl, hw, yBottom), A(hl, -hw, yBottom), A(-hl, -hw, yBottom));
      // low vertical face
      quad(A(-hl, -hw, yBottom), A(-hl, hw, yBottom), A(-hl, hw, yLow), A(-hl, -hw, yLow));
      // high vertical face
      quad(A(hl, -hw, yHigh), A(hl, hw, yHigh), A(hl, hw, yBottom), A(hl, -hw, yBottom));
      // side walls (full cross-section)
      quad(A(-hl, -hw, yBottom), A(-hl, -hw, yLow), A(hl, -hw, yHigh), A(hl, -hw, yBottom));
      quad(A(-hl, hw, yBottom), A(hl, hw, yBottom), A(hl, hw, yHigh), A(-hl, hw, yLow));

      const rampGeo = new THREE.BufferGeometry();
      rampGeo.setAttribute('position', new THREE.Float32BufferAttribute(rampPos, 3));
      rampGeo.computeVertexNormals();
      track(rampGeo);
      const rampMesh = new THREE.Mesh(rampGeo, rampMat);
      rampMesh.castShadow = true;
      rampMesh.receiveShadow = true;
      levelGroup.add(rampMesh);

      // stair nosing lines across the treads — sells the "terraced stairs" read
      const stepCount = Math.max(2, Math.min(9, Math.round(Math.abs(ramp.rise) / 0.3)));
      const stepPts: THREE.Vector3[] = [];
      for (let s = 1; s < stepCount; s++) {
        const t = -hl + (s / stepCount) * ramp.length;
        const y = yLow + (s / stepCount) * ramp.rise + 0.006;
        stepPts.push(vert(t, -hw, y), vert(t, hw, y));
      }
      if (stepPts.length > 0) {
        const stepGeo = new THREE.BufferGeometry().setFromPoints(stepPts);
        track(stepGeo);
        levelGroup.add(new THREE.LineSegments(stepGeo, stepLineMat));
      }
    }

    // -------------------------------------------------------------------------
    // Delicate Architectural Chasm Blueprint Markings
    // -------------------------------------------------------------------------
    const gapVisuals: Array<{
      lineMat: THREE.LineDashedMaterial;
      glowMesh: THREE.Mesh;
      glowMat: THREE.MeshBasicMaterial;
    }> = [];

    for (const gap of level.brokenGaps) {
      const gapY = gap.y ?? 0;
      const pts = [
        new THREE.Vector3(gap.xMin + 0.06, gapY + 0.002, gap.zMin + 0.06),
        new THREE.Vector3(gap.xMax - 0.06, gapY + 0.002, gap.zMin + 0.06),
        new THREE.Vector3(gap.xMax - 0.06, gapY + 0.002, gap.zMax - 0.06),
        new THREE.Vector3(gap.xMin + 0.06, gapY + 0.002, gap.zMax - 0.06),
        new THREE.Vector3(gap.xMin + 0.06, gapY + 0.002, gap.zMin + 0.06),
      ];
      const lineGeo = track(new THREE.BufferGeometry().setFromPoints(pts));
      const lineMat = track(
        new THREE.LineDashedMaterial({
          color: palette.stoneDeep,
          dashSize: 0.2,
          gapSize: 0.2,
          transparent: true,
          opacity: 0.45,
        })
      );
      const dashedLine = new THREE.Line(lineGeo, lineMat);
      dashedLine.computeLineDistances();
      levelGroup.add(dashedLine);

      const gw = gap.xMax - gap.xMin;
      const gd = gap.zMax - gap.zMin;
      const glowGeo = track(new THREE.PlaneGeometry(gw, gd));
      glowGeo.rotateX(-Math.PI / 2);
      const glowMat = track(
        new THREE.MeshBasicMaterial({
          color: palette.stoneSide,
          transparent: true,
          opacity: 0.03,
          depthWrite: false,
        })
      );
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set((gap.xMin + gap.xMax) * 0.5, gapY - 0.01, (gap.zMin + gap.zMax) * 0.5);
      levelGroup.add(glowMesh);

      gapVisuals.push({ lineMat, glowMesh, glowMat });
    }

    // -------------------------------------------------------------------------
    // Shadow-Casting Monoliths & Archways (with Contact AO & Moss Capitals)
    // -------------------------------------------------------------------------
    const groundBlockers: Rect2D[] = [];
    const pillarTopTargets: Vec3[] = [];

    const sigilRingGeo = track(new THREE.RingGeometry(0.16, 0.21, 24));
    const sigilDotGeo = track(new THREE.CircleGeometry(0.06, 16));
    const blobTex = track(createSoftBlobShadowTexture());
    const pillarAoMat = track(
      new THREE.MeshBasicMaterial({
        map: blobTex,
        color: '#163824',
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    );
    const pillarAoGeo = track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));

    for (const structure of level.pillars) {
      let maxY = 0;
      let avgX = 0;
      let avgZ = 0;
      for (const box of structure.parts) {
        const bw = box.xMax - box.xMin;
        const bh = box.yMax - box.yMin;
        const bd = box.zMax - box.zMin;
        const cx = (box.xMin + box.xMax) * 0.5;
        const cy = (box.yMin + box.yMax) * 0.5;
        const cz = (box.zMin + box.zMax) * 0.5;

        const geo = track(new THREE.BoxGeometry(bw, bh, bd));
        const mat = pillarMaterials[box.variant || 'terracotta'];
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, cy, cz);
        if (box.yaw) mesh.rotation.y = box.yaw;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        levelGroup.add(mesh);

        if (box.yMin === 0) {
          const aoSkirt = new THREE.Mesh(pillarAoGeo, pillarAoMat);
          aoSkirt.position.set(cx, 0.005, cz);
          aoSkirt.scale.set(bw + 0.85, 1, bd + 0.85);
          levelGroup.add(aoSkirt);

          const baseGeo = track(new THREE.BoxGeometry(bw + 0.12, 0.11, bd + 0.12));
          const baseMesh = new THREE.Mesh(baseGeo, pillarMaterials.trim);
          baseMesh.position.set(cx, 0.055, cz);
          baseMesh.receiveShadow = true;
          levelGroup.add(baseMesh);

          const brassBandGeo = track(new THREE.BoxGeometry(bw + 0.04, 0.035, bd + 0.04));
          const brassBand = new THREE.Mesh(brassBandGeo, matBrass);
          brassBand.position.set(cx, 0.13, cz);
          levelGroup.add(brassBand);
        }

        // Moss turf cushion perched on overhanging capitals (does not alter puzzle shadow math)
        if (box.variant === 'trim' && box.yMax > 1.5) {
          const mossPad = new THREE.Mesh(
            track(new THREE.BoxGeometry(bw * 0.58, 0.055, bd * 0.52)),
            pillarMossMat
          );
          mossPad.position.set(cx + bw * 0.14, box.yMax + 0.026, cz - bd * 0.12);
          mossPad.receiveShadow = true;
          levelGroup.add(mossPad);
        }

        if (box.variant !== 'trim' && bh >= 2.2) {
          const medY = box.yMin + bh * 0.62;
          if (bw >= 0.65) {
            for (const dirZ of [1, -1]) {
              const ring = new THREE.Mesh(sigilRingGeo, matBrass);
              ring.position.set(cx, medY, cz + dirZ * (bd * 0.5 + 0.008));
              if (dirZ < 0) ring.rotation.y = Math.PI;
              levelGroup.add(ring);

              const dot = new THREE.Mesh(sigilDotGeo, matBrass);
              dot.position.set(cx, medY, cz + dirZ * (bd * 0.5 + 0.009));
              if (dirZ < 0) dot.rotation.y = Math.PI;
              levelGroup.add(dot);
            }
          }
          const crownBand = new THREE.Mesh(
            track(new THREE.BoxGeometry(bw + 0.03, 0.045, bd + 0.03)),
            matBrass
          );
          crownBand.position.set(cx, box.yMax - 0.36, cz);
          levelGroup.add(crownBand);
        }

        if (box.yMin > 0.5 && box.variant !== 'trim') {
          const keyGeo = track(new THREE.BoxGeometry(bw + 0.06, 0.32, 0.34));
          const keystone = new THREE.Mesh(keyGeo, pillarMaterials.trim);
          keystone.position.set(cx, box.yMin + 0.14, cz);
          levelGroup.add(keystone);
        }

        if (box.yMin < 0.65) {
          // A rotated footprint's true extent is wider than its un-rotated box,
          // so the collision rect is inflated to the rotated bounding box.
          const yaw = box.yaw ?? 0;
          const c = Math.abs(Math.cos(yaw));
          const sn = Math.abs(Math.sin(yaw));
          const halfW = (bw * c + bd * sn) / 2;
          const halfD = (bw * sn + bd * c) / 2;
          groundBlockers.push({
            xMin: cx - halfW,
            xMax: cx + halfW,
            zMin: cz - halfD,
            zMax: cz + halfD,
          });
        }

        if (box.yMax >= maxY) {
          maxY = box.yMax;
          avgX = cx;
          avgZ = cz;
        }
      }
      pillarTopTargets.push({ x: avgX, y: maxY, z: avgZ });
    }

    // -------------------------------------------------------------------------
    // Solar Crystals
    // -------------------------------------------------------------------------
    const crystalVisuals: Array<{
      gem: THREE.Mesh;
      gemMat: THREE.MeshStandardMaterial;
      halo: THREE.Mesh;
      auraMat: THREE.MeshBasicMaterial;
      ringMat: THREE.MeshBasicMaterial;
      x: number;
      z: number;
      y: number;
    }> = [];

    for (const crys of level.sunCrystals || []) {
      const crysY = crys.y ?? 0;
      const pedBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.32, 0.38, 0.12, 8)), pillarMaterials.trim);
      pedBase.position.set(crys.x, crysY + 0.06, crys.z);
      pedBase.receiveShadow = true;
      levelGroup.add(pedBase);

      const pedCol = new THREE.Mesh(track(new THREE.CylinderGeometry(0.22, 0.28, 0.18, 8)), matBrass);
      pedCol.position.set(crys.x, crysY + 0.2, crys.z);
      pedCol.castShadow = true;
      levelGroup.add(pedCol);

      groundBlockers.push({
        xMin: crys.x - 0.24,
        xMax: crys.x + 0.24,
        zMin: crys.z - 0.24,
        zMax: crys.z + 0.24,
      });

      const gemGeo = track(new THREE.OctahedronGeometry(0.26, 0));
      gemGeo.scale(0.88, 1.35, 0.88);
      const gemMat = track(
        new THREE.MeshStandardMaterial({
          color: palette.accentPale,
          emissive: palette.accent,
          emissiveIntensity: 0.5,
          roughness: 0.22,
          metalness: 0.2,
        })
      );
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.set(crys.x, crysY + 0.7, crys.z);
      gem.castShadow = true;
      levelGroup.add(gem);

      const halo = new THREE.Mesh(track(new THREE.TorusGeometry(0.36, 0.018, 10, 32)), matBrass);
      halo.position.set(crys.x, crysY + 0.7, crys.z);
      levelGroup.add(halo);

      const auraGeo = track(new THREE.SphereGeometry(0.48, 18, 18));
      const auraMat = track(
        new THREE.MeshBasicMaterial({
          color: palette.accentPale,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        })
      );
      const aura = new THREE.Mesh(auraGeo, auraMat);
      aura.position.set(crys.x, crysY + 0.7, crys.z);
      levelGroup.add(aura);

      const ringGeo = track(new THREE.RingGeometry(0.4, 0.45, 32));
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = track(
        new THREE.MeshBasicMaterial({
          color: palette.accent,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
        })
      );
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(crys.x, crysY + 0.012, crys.z);
      levelGroup.add(ring);

      crystalVisuals.push({ gem, gemMat, halo, auraMat, ringMat, x: crys.x, z: crys.z, y: crysY });
    }

    // -------------------------------------------------------------------------
    // Start Compass Medallion & Ornate Goal Astrolabe Sanctuary
    // -------------------------------------------------------------------------
    const startOuter = new THREE.Mesh(
      track(new THREE.RingGeometry(0.37, 0.42, 36)).rotateX(-Math.PI / 2),
      track(
        new THREE.MeshBasicMaterial({
          color: palette.stoneDeep,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
        })
      )
    );
    startOuter.position.set(level.start.x, (level.start.y ?? 0) + 0.011, level.start.z);
    levelGroup.add(startOuter);

    const startInner = new THREE.Mesh(
      track(new THREE.RingGeometry(0.18, 0.21, 24)).rotateX(-Math.PI / 2),
      track(
        new THREE.MeshBasicMaterial({
          color: palette.stoneDeep,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
        })
      )
    );
    startInner.position.set(level.start.x, (level.start.y ?? 0) + 0.011, level.start.z);
    levelGroup.add(startInner);

    const goalGroup = new THREE.Group();
    goalGroup.position.set(level.goal.x, level.goal.y ?? 0, level.goal.z);
    levelGroup.add(goalGroup);

    const goalFloorMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
      })
    );
    const goalFloorOuter = new THREE.Mesh(
      track(new THREE.RingGeometry(0.56, 0.65, 44)).rotateX(-Math.PI / 2),
      goalFloorMat
    );
    goalFloorOuter.position.y = 0.012;
    goalGroup.add(goalFloorOuter);

    const goalFloorMid = new THREE.Mesh(
      track(new THREE.RingGeometry(0.38, 0.41, 36)).rotateX(-Math.PI / 2),
      goalFloorMat
    );
    goalFloorMid.position.y = 0.012;
    goalGroup.add(goalFloorMid);

    const tickGeo = track(new THREE.PlaneGeometry(0.03, 0.14));
    tickGeo.rotateX(-Math.PI / 2);
    for (let t = 0; t < 8; t++) {
      const ang = (t / 8) * Math.PI * 2;
      const tick = new THREE.Mesh(tickGeo, goalFloorMat);
      tick.position.set(Math.sin(ang) * 0.49, 0.013, Math.cos(ang) * 0.49);
      tick.rotation.y = ang;
      goalGroup.add(tick);
    }

    const goalInnerMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.accentPale,
        transparent: true,
        opacity: 0.34,
      })
    );
    const goalFloorInner = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.36, 32)).rotateX(-Math.PI / 2),
      goalInnerMat
    );
    goalFloorInner.position.y = 0.011;
    goalGroup.add(goalFloorInner);

    const beamMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.accentPale,
        transparent: true,
        opacity: 0.09,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const goalBeam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.32, 0.44, 1.55, 24, 1, true)), beamMat);
    goalBeam.position.y = 0.78;
    goalGroup.add(goalBeam);

    const goalBeaconMat = track(
      new THREE.MeshStandardMaterial({
        color: palette.accentPale,
        emissive: palette.accent,
        emissiveIntensity: 0.45,
        roughness: 0.32,
        metalness: 0.45,
      })
    );
    const goalTorus = new THREE.Mesh(track(new THREE.TorusGeometry(0.42, 0.028, 12, 40)), goalBeaconMat);
    goalTorus.position.y = 0.62;
    goalGroup.add(goalTorus);

    const goalTorus2 = new THREE.Mesh(track(new THREE.TorusGeometry(0.3, 0.02, 10, 32)), goalBeaconMat);
    goalTorus2.position.y = 0.62;
    goalGroup.add(goalTorus2);

    const goalCore = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.15, 0)), goalBeaconMat);
    goalCore.position.y = 0.62;
    goalGroup.add(goalCore);

    const lotusGroup = new THREE.Group();
    goalGroup.add(lotusGroup);
    const lotusMat = track(
      new THREE.MeshStandardMaterial({
        color: palette.slate,
        emissive: '#22231F',
        roughness: 0.5,
        metalness: 0.3,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
      })
    );
    const petalGeo = track(new THREE.ConeGeometry(0.24, 0.85, 4));
    const lotusPetals: THREE.Group[] = [];
    for (let p = 0; p < 6; p++) {
      const pivot = new THREE.Group();
      const ang = (p / 6) * Math.PI * 2;
      pivot.position.set(Math.sin(ang) * 0.62, 0.02, Math.cos(ang) * 0.62);
      pivot.rotation.y = ang;
      const blade = new THREE.Mesh(petalGeo, lotusMat);
      blade.scale.set(1.0, 1.0, 0.25);
      blade.position.y = 0.42;
      pivot.add(blade);
      lotusGroup.add(pivot);
      lotusPetals.push(pivot);
    }

    // -------------------------------------------------------------------------
    // Dynamic Solidified Umbra Shadow Group (Physical Translucent Shader + Single Merged Rim)
    // -------------------------------------------------------------------------
    const umbraGroup = new THREE.Group();
    scene.add(umbraGroup);

    const umbraSlabMat = track(
      createPhysicalUmbraMaterial(
        palette.shadowGreen,
        palette.accentPale,
        settingsRef.current.shadowOpacity,
        natureUniforms
      )
    );
    const umbraRimMat = track(
      new THREE.MeshBasicMaterial({
        color: '#0E4A28',
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    let dynamicUmbraGeos: THREE.BufferGeometry[] = [];
    const clearDynamicUmbra = () => {
      while (umbraGroup.children.length > 0) {
        umbraGroup.remove(umbraGroup.children[0]);
      }
      for (const g of dynamicUmbraGeos) {
        g.dispose();
      }
      dynamicUmbraGeos = [];
    };

    // -------------------------------------------------------------------------
    // Brass Astronomical Sundial Track (Fixed Orbit — Direction Only)
    // -------------------------------------------------------------------------
    const trackGroup = new THREE.Group();
    trackGroup.position.y = -0.02;
    scene.add(trackGroup);

    const ringOuterMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.stoneDeep,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
      })
    );
    const arenaBoundRing = new THREE.Mesh(
      track(new THREE.RingGeometry(orbitRadius - 0.038, orbitRadius + 0.038, 120)).rotateX(-Math.PI / 2),
      ringOuterMat
    );
    trackGroup.add(arenaBoundRing);

    const innerHairline = new THREE.Mesh(
      track(new THREE.RingGeometry(orbitRadius - 0.24, orbitRadius - 0.225, 120)).rotateX(-Math.PI / 2),
      track(
        new THREE.MeshBasicMaterial({
          color: palette.stoneDeep,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
        })
      )
    );
    trackGroup.add(innerHairline);

    const majorTickGeo = track(new THREE.PlaneGeometry(0.06, 0.36)).rotateX(-Math.PI / 2);
    const minorTickGeo = track(new THREE.PlaneGeometry(0.03, 0.18)).rotateX(-Math.PI / 2);
    const compassTickMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
      })
    );
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const isCardinal = i % 6 === 0;
      const isHour = i % 2 === 0;
      if (!isHour && !isCardinal) continue;
      const tick = new THREE.Mesh(isCardinal ? majorTickGeo : minorTickGeo, compassTickMat);
      const rad = orbitRadius + (isCardinal ? 0.06 : -0.02);
      tick.position.set(Math.sin(ang) * rad, 0.004, Math.cos(ang) * rad);
      tick.rotation.y = ang;
      trackGroup.add(tick);
    }

    // Wind-drifted 3D tumbling blossom petals floating gently across the sunlit ruins
    const moteCount = 56;
    const airbornePetalGeo = track(new THREE.PlaneGeometry(0.15, 0.095));
    const airbornePetalMat = track(
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.88,
      })
    );
    const dustMotes = new THREE.InstancedMesh(airbornePetalGeo, airbornePetalMat, moteCount);
    const petalSeeds: Array<{ x: number; y: number; z: number; spd: number; phase: number }> = [];
    const petalPalette = [palette.petal, '#D9A8EA', '#FFF4F8', palette.petal];
    const petalDummy = new THREE.Object3D();
    const petalCol = new THREE.Color();
    for (let i = 0; i < moteCount; i++) {
      const seed = {
        x: (Math.random() - 0.5) * 24,
        y: 0.35 + Math.random() * 5.2,
        z: (Math.random() - 0.5) * 22,
        spd: 0.42 + Math.random() * 0.52,
        phase: Math.random() * Math.PI * 2,
      };
      petalSeeds.push(seed);
      petalDummy.position.set(seed.x, seed.y, seed.z);
      petalDummy.updateMatrix();
      dustMotes.setMatrixAt(i, petalDummy.matrix);
      dustMotes.setColorAt(i, petalCol.set(petalPalette[i % petalPalette.length]));
    }
    if (dustMotes.instanceColor) dustMotes.instanceColor.needsUpdate = true;
    scene.add(dustMotes);

    // -------------------------------------------------------------------------
    // Celestial Sun Astrolabe Orb + Ground Reticle + Parallel Sun Rays
    // -------------------------------------------------------------------------
    const sunOrbGroup = new THREE.Group();
    scene.add(sunOrbGroup);

    const sunCoreMat = track(
      new THREE.MeshStandardMaterial({
        color: '#FFF6DE',
        emissive: palette.accent,
        emissiveIntensity: 0.9,
        roughness: 0.28,
      })
    );
    const sunCore = new THREE.Mesh(track(new THREE.SphereGeometry(0.4, 32, 32)), sunCoreMat);
    sunOrbGroup.add(sunCore);

    const glowTex = track(createGlowTexture());
    const sunGlowMat = track(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: '#FFEBC2',
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    const sunGlow = new THREE.Sprite(sunGlowMat);
    sunGlow.scale.setScalar(3.4);
    sunOrbGroup.add(sunGlow);

    const gimbalMat = track(
      new THREE.MeshStandardMaterial({
        color: palette.accent,
        emissive: palette.accent,
        emissiveIntensity: 0.18,
        roughness: 0.34,
        metalness: 0.7,
      })
    );
    const gimbal1 = new THREE.Mesh(track(new THREE.TorusGeometry(0.64, 0.025, 12, 48)), gimbalMat);
    gimbal1.rotation.x = Math.PI / 2.4;
    sunOrbGroup.add(gimbal1);

    const gimbal2 = new THREE.Mesh(track(new THREE.TorusGeometry(0.8, 0.018, 12, 48)), gimbalMat);
    gimbal2.rotation.y = Math.PI / 3;
    gimbal2.rotation.x = Math.PI / 5;
    sunOrbGroup.add(gimbal2);

    const sunReticleGroup = new THREE.Group();
    scene.add(sunReticleGroup);

    const retMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
      })
    );
    const retOuter = new THREE.Mesh(
      track(new THREE.RingGeometry(0.52, 0.6, 36)).rotateX(-Math.PI / 2),
      retMat
    );
    retOuter.position.y = 0.016;
    sunReticleGroup.add(retOuter);

    const retCenter = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.13, 20)).rotateX(-Math.PI / 2),
      retMat
    );
    retCenter.position.y = 0.016;
    sunReticleGroup.add(retCenter);

    const pointerShape = new THREE.Shape();
    pointerShape.moveTo(0, 0.85);
    pointerShape.lineTo(-0.14, 0.56);
    pointerShape.lineTo(0.14, 0.56);
    pointerShape.closePath();
    const pointerGeo = track(new THREE.ShapeGeometry(pointerShape));
    pointerGeo.rotateX(-Math.PI / 2);
    const retPointer = new THREE.Mesh(pointerGeo, retMat);
    retPointer.position.y = 0.017;
    sunReticleGroup.add(retPointer);

    const plumbGeo = track(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)])
    );
    const plumbMat = track(
      new THREE.LineDashedMaterial({
        color: palette.stoneDeep,
        dashSize: 0.24,
        gapSize: 0.2,
        transparent: true,
        opacity: 0.4,
      })
    );
    const plumbLine = new THREE.Line(plumbGeo, plumbMat);
    scene.add(plumbLine);

    const sightLines: THREE.Line[] = [];
    const sightMat = track(
      new THREE.LineBasicMaterial({
        color: palette.accent,
        transparent: true,
        opacity: 0.22,
      })
    );
    for (let i = 0; i < pillarTopTargets.length; i++) {
      const sGeo = track(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()])
      );
      const sLine = new THREE.Line(sGeo, sightMat);
      scene.add(sLine);
      sightLines.push(sLine);
    }

    // -------------------------------------------------------------------------
    // Glazed Ceramic Player Sphere + Dual Physical Shadow Grounding
    // -------------------------------------------------------------------------
    const ballRoot = new THREE.Group();
    ballRoot.position.copy(sim.ballPos);
    scene.add(ballRoot);

    const ballVisual = new THREE.Group();
    ballRoot.add(ballVisual);

    const ballTex = track(createCeramicSphereTexture());
    const sphereMat = track(
      new THREE.MeshPhysicalMaterial({
        map: ballTex,
        roughness: 0.36,
        metalness: 0.04,
        clearcoat: 0.65,
        clearcoatRoughness: 0.28,
      })
    );
    const sphereMesh = new THREE.Mesh(track(new THREE.SphereGeometry(BALL_RADIUS, 36, 36)), sphereMat);
    sphereMesh.castShadow = true;
    sphereMesh.receiveShadow = true;
    ballVisual.add(sphereMesh);

    const bandGeo = track(new THREE.TorusGeometry(BALL_RADIUS * 0.996, 0.017, 12, 40));
    const bandMat = track(
      new THREE.MeshStandardMaterial({
        color: palette.accentPale,
        emissive: palette.accent,
        emissiveIntensity: 0.1,
        roughness: 0.34,
        metalness: 0.6,
      })
    );
    const band1 = new THREE.Mesh(bandGeo, bandMat);
    ballVisual.add(band1);
    const band2 = new THREE.Mesh(bandGeo, bandMat);
    band2.rotation.y = Math.PI / 2;
    ballVisual.add(band2);

    // 1) Tight ambient-occlusion contact patch directly under the sphere
    const ballShadowRingMat = track(
      new THREE.MeshBasicMaterial({
        map: blobTex,
        color: '#0D3620',
        transparent: true,
        opacity: 0.56,
        depthWrite: false,
      })
    );
    const ballContactRing = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.88, 0.88)).rotateX(-Math.PI / 2),
      ballShadowRingMat
    );
    ballContactRing.position.set(sim.ballPos.x, 0.013, sim.ballPos.z);
    scene.add(ballContactRing);

    // 2) Directional sun-projected ellipse (ensures ball casts a crisp shadow even on translucent umbra bridges!)
    const ballSunShadowMat = track(
      new THREE.MeshBasicMaterial({
        map: blobTex,
        color: '#103C24',
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      })
    );
    const ballSunShadow = new THREE.Mesh(
      track(new THREE.PlaneGeometry(0.82, 1.18)).rotateX(-Math.PI / 2),
      ballSunShadowMat
    );
    ballSunShadow.position.set(sim.ballPos.x, 0.012, sim.ballPos.z);
    scene.add(ballSunShadow);

    // -------------------------------------------------------------------------
    // Tactile Rolling Trail Particles
    // -------------------------------------------------------------------------
    const trailMax = 28;
    const trailGeo = track(new THREE.SphereGeometry(0.055, 8, 8));
    const trailItems: Array<{
      mesh: THREE.Mesh;
      mat: THREE.MeshBasicMaterial;
      life: number;
      maxLife: number;
      vy: number;
    }> = [];
    for (let i = 0; i < trailMax; i++) {
      const m = track(
        new THREE.MeshBasicMaterial({
          color: '#C9B99E',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      const mesh = new THREE.Mesh(trailGeo, m);
      mesh.visible = false;
      scene.add(mesh);
      trailItems.push({ mesh, mat: m, life: 0, maxLife: 0.55, vy: 0.25 });
    }
    let trailCursor = 0;
    let trailSpawnAccum = 0;

    const spawnTrailPuff = (x: number, z: number, onShadow: boolean, y = 0.06) => {
      const item = trailItems[trailCursor];
      trailCursor = (trailCursor + 1) % trailMax;
      item.life = 0.001;
      item.maxLife = onShadow ? 0.65 : 0.42;
      item.vy = onShadow ? 0.48 : 0.22;
      item.mat.color.set(onShadow ? palette.accentPale : palette.stoneSide);
      item.mesh.position.set(
        x + (Math.random() - 0.5) * 0.14,
        y,
        z + (Math.random() - 0.5) * 0.14
      );
      item.mesh.scale.setScalar(onShadow ? 1.15 : 0.85);
      item.mesh.visible = true;
    };

    // -------------------------------------------------------------------------
    // Dynamic Umbra Shadow Rebuilder & Connectivity Check
    // -------------------------------------------------------------------------
    let bridgePending = false;
    let lastBridgeEval = 0;
    let sunEngaged = false;
    let targetBridgedGlow = 0;

    function evaluateBridges(playCues: boolean) {
      bridgePending = false;
      lastBridgeEval = performance.now();
      const prevBridged = sim.bridgedFlags;
      const nextBridged = level.brokenGaps.map((gap) => {
        const gy = gap.y ?? 0;
        const planePlatforms = level.platforms.filter((p) => Math.abs((p.y ?? 0) - gy) <= 0.02);
        return isGapBridged(gap, planePlatforms, sim.shadowsByPlane.get(gy) ?? [], groundBlockers);
      });
      sim.bridgedFlags = nextBridged;

      if (playCues && nextBridged.some((val, idx) => val && !prevBridged[idx])) {
        sound.playBridgeAligned();
      }

      const anyBridged = nextBridged.some(Boolean);
      targetBridgedGlow = anyBridged ? 1 : 0;
      umbraRimMat.color.set(anyBridged ? palette.accentPale : '#0E4A28');
      umbraRimMat.opacity = anyBridged ? 0.95 : 0.72;

      nextBridged.forEach((bridged, idx) => {
        const gv = gapVisuals[idx];
        if (!gv) return;
        gv.lineMat.color.set(bridged ? palette.accent : palette.stoneDeep);
        gv.lineMat.opacity = bridged ? 0.95 : 0.42;
        gv.glowMat.color.set(bridged ? palette.accentPale : palette.stoneSide);
        gv.glowMat.opacity = bridged ? 0.1 : 0.022;
      });
    }

    const rebuildShadows = (playCues: boolean, evalBridges = true) => {
      clearDynamicUmbra();

      const planeYs = new Set<number>([0]);
      for (const p of level.platforms) if (p.y) planeYs.add(p.y);
      for (const g of level.brokenGaps) if (g.y) planeYs.add(g.y);
      for (const c of level.sunCrystals ?? []) if (c.y) planeYs.add(c.y);

      const shadowsByPlane = new Map<number, Vec2[][]>();
      for (const h of planeYs) {
        const planePolys: Vec2[][] = [];
        for (const structure of level.pillars) {
          for (const box of structure.parts) {
            const poly = projectBoxShadowToPlane(box, sim.lightPos, shadowRatio, h);
            if (poly.length >= 3) planePolys.push(poly);
          }
        }
        // floating stones throw their own umbra: usable to bridge spans, smother the
        // sun crystal, and (across a bridged gap) to stand on — same rules as casters
        for (const plat of level.platforms) {
          const platY = plat.y ?? 0;
          if (platY <= h) continue;
          const poly = projectOutlineShadowToPlane(outlineOf(plat), platY, PLATFORM_BODY_DEPTH, sim.lightPos, shadowRatio, h);
          if (poly.length >= 3) planePolys.push(poly);
        }
        shadowsByPlane.set(h, planePolys);
      }
      sim.shadowsByPlane = shadowsByPlane;
      sim.shadows = shadowsByPlane.get(0) ?? [];

      const ribPositions: number[] = [];
      const ribIndices: number[] = [];
      for (const [planeY, polys] of shadowsByPlane) {
        const silhouette = traceUmbraSilhouette(polys);
        const drawn = silhouette.length > 0 ? silhouette : polys;
        for (const loop of drawn) {
        const shape = new THREE.Shape();
        shape.moveTo(loop[0].x, -loop[0].z);
        for (let i = 1; i < loop.length; i++) shape.lineTo(loop[i].x, -loop[i].z);
        shape.closePath();

        const extGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.045, bevelEnabled: false });
        extGeo.rotateX(-Math.PI / 2);
        dynamicUmbraGeos.push(extGeo);
        const slab = new THREE.Mesh(extGeo, umbraSlabMat);
        slab.position.y = planeY - 0.04;
        slab.receiveShadow = false;
        umbraGroup.add(slab);

        const n = loop.length;
        let area = 0;
        for (let i = 0; i < n; i++) {
          const a = loop[i];
          const b = loop[(i + 1) % n];
          area += a.x * b.z - b.x * a.z;
        }
        const wind = area >= 0 ? 1 : -1;
        const ring: Array<[number, number]> = [];
        for (let i = 0; i < n; i++) {
          const prev = loop[(i - 1 + n) % n];
          const curr = loop[i];
          const next = loop[(i + 1) % n];
          const ax = curr.x - prev.x;
          const az = curr.z - prev.z;
          const bx = next.x - curr.x;
          const bz = next.z - curr.z;
          const al = Math.hypot(ax, az) || 1;
          const bl = Math.hypot(bx, bz) || 1;
          const n1x = (az / al) * wind;
          const n1z = (-ax / al) * wind;
          const n2x = (bz / bl) * wind;
          const n2z = (-bx / bl) * wind;
          let mx = n1x + n2x;
          let mz = n1z + n2z;
          const ml = Math.hypot(mx, mz) || 1;
          mx /= ml;
          mz /= ml;
          const grip = Math.min(1.8, 1 / Math.max(0.42, n1x * mx + n1z * mz));
          const w = 0.042 + Math.sin(i * 1.7 + loop[0].x) * 0.006;
          ring.push([curr.x + mx * w * grip, curr.z + mz * w * grip]);
          ring.push([curr.x - mx * w * grip, curr.z - mz * w * grip]);
        }
        for (let i = 0; i < n; i++) {
          const o = i * 2;
          const p = ((i + 1) % n) * 2;
          const base = ribPositions.length / 3;
          ribPositions.push(ring[o][0], planeY + 0.012, ring[o][1], ring[o + 1][0], planeY + 0.012, ring[o + 1][1]);
          ribPositions.push(ring[p][0], planeY + 0.012, ring[p][1], ring[p + 1][0], planeY + 0.012, ring[p + 1][1]);
          ribIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        }
      }

      if (ribPositions.length > 0) {
        const ribGeo = new THREE.BufferGeometry();
        ribGeo.setAttribute('position', new THREE.Float32BufferAttribute(ribPositions, 3));
        ribGeo.setIndex(ribIndices);
        dynamicUmbraGeos.push(ribGeo);
        const rib = new THREE.Mesh(ribGeo, umbraRimMat);
        rib.name = 'umbra-silhouette';
        umbraGroup.add(rib);
      }

      const prevEclipsed = sim.eclipsed;
      const nextEclipsed = (level.sunCrystals || []).some((c) =>
        isCrystalEclipsed(c, shadowsByPlane.get(c.y ?? 0) ?? [])
      );
      sim.eclipsed = nextEclipsed;
      if (playCues && (level.sunCrystals?.length || 0) > 0 && prevEclipsed !== nextEclipsed) {
        sound.playEclipseState(nextEclipsed);
      }

      if (evalBridges) {
        evaluateBridges(playCues);
      } else {
        bridgePending = true;
      }

      placeSunLight();
      sunOrbGroup.position.set(sim.lightPos.x, sim.lightPos.y, sim.lightPos.z);
      sunReticleGroup.position.set(sim.lightPos.x, 0, sim.lightPos.z);
      retPointer.rotation.y = Math.atan2(sim.lightPos.x, sim.lightPos.z);

      const plumbPositions = plumbLine.geometry.attributes.position as THREE.BufferAttribute;
      plumbPositions.setXYZ(0, sim.lightPos.x, sim.lightPos.y - 0.5, sim.lightPos.z);
      plumbPositions.setXYZ(1, sim.lightPos.x, 0.03, sim.lightPos.z);
      plumbPositions.needsUpdate = true;
      plumbLine.computeLineDistances();

      pillarTopTargets.forEach((t, idx) => {
        const sLine = sightLines[idx];
        if (!sLine) return;
        const attr = sLine.geometry.attributes.position as THREE.BufferAttribute;
        const off = sunShadowOffsetPerHeight(sim.lightPos, shadowRatio);
        const upstream = 2.1;
        attr.setXYZ(0, t.x - off.x * upstream, t.y + upstream, t.z - off.z * upstream);
        attr.setXYZ(1, t.x + off.x * t.y, 0.02, t.z + off.z * t.y);
        attr.needsUpdate = true;
        sLine.geometry.computeBoundingSphere();
      });
    };

    rebuildShadows(false);

    // -------------------------------------------------------------------------
    // Input Handling
    // -------------------------------------------------------------------------
    const keys = new Set<string>();
    const handleKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      if (
        [
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'KeyI',
          'KeyJ',
          'KeyK',
          'KeyL',
        ].includes(code)
      ) {
        sound.wake();
        callbacksRef.current.onFirstInteract?.();
        keys.add(code);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const raycaster = new THREE.Raycaster();
    const pointerNDC = new THREE.Vector2();
    const skyPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -level.lightBounds.y);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    const updateNDC = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
    };

    const clampLightPos = (nx: number, nz: number) => {
      const r = Math.hypot(nx, nz);
      if (r < 1e-4) {
        sim.lightTarget.x = 0;
        sim.lightTarget.z = orbitRadius;
      } else {
        sim.lightTarget.x = (nx / r) * orbitRadius;
        sim.lightTarget.z = (nz / r) * orbitRadius;
      }
      sim.lightTarget.y = level.lightBounds.y;
    };

    // ---------------------------------------------------------------------
    // Camera orbit gestures.
    // Touch: two fingers drag / twist / pinch. Mouse: right-button drag,
    // Shift+drag, Ctrl+drag, or two buttons held. Trackpad: two-finger
    // horizontal swipe and pinch. All ease toward their target each frame.
    // ---------------------------------------------------------------------
    const domEl = renderer.domElement;
    type PointerSample = { x: number; y: number; type: string; button: number };
    const activePointers = new Map<number, PointerSample>();
    let suppressSunDrag = false;
    let mouseOrbitId: number | null = null;
    let mouseOrbitLast = { x: 0, y: 0 };
    let touchGesture: {
      ids: [number, number];
      cx: number;
      cy: number;
      angle: number;
      distance: number;
    } | null = null;
    let viewTickAccum = 0;

    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

    const rotateView = (dYaw: number, dPitch: number, quiet = false) => {
      const v = viewRef.current;
      v.targetYaw += dYaw;
      v.targetPitch = clamp(v.targetPitch + dPitch, -0.19, 0.24);
      v.rotating = true;
      if (!quiet) {
        viewTickAccum += Math.abs(dYaw);
        if (viewTickAccum > 0.11) {
          viewTickAccum = 0;
          sound.playSunTick();
        }
      }
    };

    const zoomView = (factor: number) => {
      const v = viewRef.current;
      v.targetZoom = clamp(v.targetZoom / factor, 0.72, 1.44);
    };

    const releaseSunDrag = () => {
      sim.draggingPlane = 'none';
      sim.lightTarget.x = sim.lightPos.x;
      sim.lightTarget.z = sim.lightPos.z;
      sim.hoveringSun = false;
    };

    // Keep the exact same two fingers for the whole gesture so a third finger
    // or an early lift can never swap the pair and cause a rotation jump.
    const touchEntries = () =>
      [...activePointers.entries()].filter(([, p]) => p.type === 'touch');
    const gesturePoints = (): PointerSample[] => {
      if (!touchGesture) return [];
      const a = activePointers.get(touchGesture.ids[0]);
      const b = activePointers.get(touchGesture.ids[1]);
      return a && b ? [a, b] : [];
    };

    const startTouchGesture = () => {
      const entries = touchEntries();
      if (entries.length < 2) return;
      const pts: PointerSample[] = [entries[0][1], entries[1][1]];
      releaseSunDrag();
      suppressSunDrag = true;
      touchGesture = {
        ids: [entries[0][0], entries[1][0]],
        cx: (pts[0].x + pts[1].x) * 0.5,
        cy: (pts[0].y + pts[1].y) * 0.5,
        angle: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
        distance: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
      };
      viewRef.current.rotating = true;
      domEl.style.cursor = 'grabbing';
      sound.playUiClick();
    };

    const updateTouchGesture = () => {
      if (!touchGesture) return;
      const pts = gesturePoints();
      if (pts.length < 2) return;
      const cx = (pts[0].x + pts[1].x) * 0.5;
      const cy = (pts[0].y + pts[1].y) * 0.5;
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const distance = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

      // Two-finger twist rotates the world; a shared two-finger drag also orbits it.
      let dAngle = angle - touchGesture.angle;
      while (dAngle > Math.PI) dAngle -= Math.PI * 2;
      while (dAngle < -Math.PI) dAngle += Math.PI * 2;
      const dx = cx - touchGesture.cx;
      const dy = cy - touchGesture.cy;
      rotateView(dx * 0.0062 + dAngle * 0.92, dy * 0.0024);

      if (touchGesture.distance > 12 && distance > 12) {
        zoomView(distance / touchGesture.distance);
      }
      touchGesture.cx = cx;
      touchGesture.cy = cy;
      touchGesture.angle = angle;
      touchGesture.distance = distance;
    };

    const startMouseOrbit = (e: PointerEvent) => {
      releaseSunDrag();
      suppressSunDrag = true;
      mouseOrbitId = e.pointerId;
      mouseOrbitLast = { x: e.clientX, y: e.clientY };
      viewRef.current.rotating = true;
      try {
        domEl.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional */
      }
      domEl.style.cursor = 'grabbing';
      e.preventDefault();
    };

    const handlePointerDown = (e: PointerEvent) => {
      const isMouse = e.pointerType === 'mouse';
      activePointers.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        type: e.pointerType,
        button: e.button,
      });

      const wantsMouseOrbit =
        isMouse &&
        (e.button === 2 ||
          e.shiftKey ||
          e.ctrlKey ||
          (e.buttons & 3) === 3 ||
          activePointers.size >= 2);
      if (wantsMouseOrbit) {
        startMouseOrbit(e);
        return;
      }
      if (isMouse && e.button !== 0) return;
      if (suppressSunDrag || touchGesture || mouseOrbitId !== null) return;

      // Second touch takes over: cancel the light drag the first finger began.
      if (e.pointerType === 'touch' && touchEntries().length >= 2) {
        startTouchGesture();
        return;
      }

      sound.wake();
      callbacksRef.current.onFirstInteract?.();
      updateNDC(e.clientX, e.clientY);

      if (raycaster.ray.intersectPlane(skyPlane, hitPoint)) {
        const distSky = Math.hypot(hitPoint.x - sim.lightPos.x, hitPoint.z - sim.lightPos.z);
        if (distSky <= 1.8) {
          sim.draggingPlane = 'sky';
          sim.dragOffset = { x: sim.lightPos.x - hitPoint.x, z: sim.lightPos.z - hitPoint.z };
          domEl.setPointerCapture(e.pointerId);
          domEl.style.cursor = 'grabbing';
          return;
        }
      }

      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        const distGround = Math.hypot(hitPoint.x - sim.lightPos.x, hitPoint.z - sim.lightPos.z);
        if (distGround <= 1.6) {
          sim.draggingPlane = 'ground';
          sim.dragOffset = { x: sim.lightPos.x - hitPoint.x, z: sim.lightPos.z - hitPoint.z };
          domEl.setPointerCapture(e.pointerId);
          domEl.style.cursor = 'grabbing';
          return;
        }
      }

      if (raycaster.ray.intersectPlane(skyPlane, hitPoint)) {
        sim.draggingPlane = 'sky';
        sim.dragOffset = { x: sim.lightPos.x - hitPoint.x, z: sim.lightPos.z - hitPoint.z };
        domEl.setPointerCapture(e.pointerId);
        domEl.style.cursor = 'grabbing';
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      const sample = activePointers.get(e.pointerId);
      if (sample) {
        sample.x = e.clientX;
        sample.y = e.clientY;
      }

      if (mouseOrbitId === e.pointerId) {
        const dx = e.clientX - mouseOrbitLast.x;
        const dy = e.clientY - mouseOrbitLast.y;
        mouseOrbitLast = { x: e.clientX, y: e.clientY };
        rotateView(dx * 0.0062, dy * 0.0026);
        return;
      }
      if (touchGesture) {
        updateTouchGesture();
        return;
      }
      if (suppressSunDrag) return;

      updateNDC(e.clientX, e.clientY);

      if (sim.draggingPlane === 'sky') {
        if (raycaster.ray.intersectPlane(skyPlane, hitPoint)) {
          clampLightPos(hitPoint.x + sim.dragOffset.x, hitPoint.z + sim.dragOffset.z);
          sound.playSunTick();
        }
        return;
      }

      if (sim.draggingPlane === 'ground') {
        if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
          clampLightPos(hitPoint.x + sim.dragOffset.x, hitPoint.z + sim.dragOffset.z);
          sound.playSunTick();
        }
        return;
      }

      let hovered = false;
      if (raycaster.ray.intersectPlane(skyPlane, hitPoint)) {
        if (Math.hypot(hitPoint.x - sim.lightPos.x, hitPoint.z - sim.lightPos.z) <= 1.7) {
          hovered = true;
        }
      }
      if (!hovered && raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        if (Math.hypot(hitPoint.x - sim.lightPos.x, hitPoint.z - sim.lightPos.z) <= 1.5) {
          hovered = true;
        }
      }
      sim.hoveringSun = hovered;
      domEl.style.cursor = hovered ? 'grab' : 'default';
    };

    const handlePointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);

      if (mouseOrbitId === e.pointerId) {
        mouseOrbitId = null;
        viewRef.current.rotating = false;
        try {
          domEl.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (touchGesture && gesturePoints().length < 2) {
        touchGesture = null;
        viewRef.current.rotating = false;
      }
      if (activePointers.size === 0) {
        suppressSunDrag = false;
        viewRef.current.rotating = false;
      }

      if (sim.draggingPlane !== 'none') {
        sim.draggingPlane = 'none';
        try {
          domEl.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      domEl.style.cursor = sim.hoveringSun ? 'grab' : 'default';
    };

    const handleWheel = (e: WheelEvent) => {
      // Ctrl+wheel is the browser pinch-zoom gesture on trackpads.
      if (e.ctrlKey) {
        zoomView(Math.exp(-e.deltaY * 0.0016));
        e.preventDefault();
        return;
      }
      // A horizontal two-finger trackpad swipe rotates the world.
      if (Math.abs(e.deltaX) > 0.4 && Math.abs(e.deltaX) >= Math.abs(e.deltaY) * 0.65) {
        rotateView(e.deltaX * 0.0034, 0, true);
        viewRef.current.rotating = false;
        e.preventDefault();
      } else if (e.shiftKey && Math.abs(e.deltaY) > 0.4) {
        rotateView(e.deltaY * 0.0034, 0, true);
        viewRef.current.rotating = false;
        e.preventDefault();
      }
    };

    const preventContextMenu = (e: Event) => e.preventDefault();
    const handleDoubleClick = () => {
      const v = viewRef.current;
      v.targetYaw = 0;
      v.targetPitch = 0;
      v.targetZoom = 1;
      sound.playUiClick();
    };

    domEl.addEventListener('pointerdown', handlePointerDown);
    domEl.addEventListener('pointermove', handlePointerMove);
    domEl.addEventListener('pointerup', handlePointerUp);
    domEl.addEventListener('pointercancel', handlePointerUp);
    domEl.addEventListener('lostpointercapture', handlePointerUp);
    domEl.addEventListener('wheel', handleWheel, { passive: false });
    domEl.addEventListener('contextmenu', preventContextMenu);
    domEl.addEventListener('dblclick', handleDoubleClick);

    let portraitFactor = 1.0;
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      portraitFactor = w < h ? Math.min(1.42, (h / w) * 0.72) : 1.0;
      camera.position.set(
        baseLookAt.x + level.camera.offset.x * portraitFactor,
        baseLookAt.y + level.camera.offset.y * portraitFactor,
        baseLookAt.z + level.camera.offset.z * portraitFactor
      );
      camera.lookAt(baseLookAt);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    const camForward = new THREE.Vector3();
    const camRight = new THREE.Vector3();
    const tmpScale = new THREE.Vector3();

    let prevShadowOff = sunShadowOffsetPerHeight(sim.lightPos, shadowRatio);
    let lastStatusPush = 0;
    let prevTime = performance.now();
    let rafId = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min(0.04, (now - prevTime) / 1000);
      prevTime = now;
      const tSec = now * 0.001;

      const live = settingsRef.current;
      const drift = live.cameraDrift ? 1 : 0;

      // Ease the orbit toward the gesture target, then rotate the authored 3/4
      // camera offset around the level's look-at point. Movement input is derived
      // from the live camera afterwards, so WASD still follows the rotated view.
      const v = viewRef.current;
      const viewEase = 1 - Math.exp(-10 * dt);
      v.yaw += (v.targetYaw - v.yaw) * viewEase;
      v.pitch += (v.targetPitch - v.pitch) * viewEase;
      v.zoom += (v.targetZoom - v.zoom) * viewEase;

      const cosYaw = Math.cos(v.yaw);
      const sinYaw = Math.sin(v.yaw);
      const orbitScale = portraitFactor * v.zoom * (1 - v.pitch * 0.28);
      const ox = level.camera.offset.x * orbitScale;
      const oz = level.camera.offset.z * orbitScale;
      const rx = ox * cosYaw - oz * sinYaw;
      const rz = ox * sinYaw + oz * cosYaw;

      camera.position.set(
        baseLookAt.x + rx + Math.sin(tSec * 0.24) * 0.16 * drift,
        baseLookAt.y +
          level.camera.offset.y * portraitFactor * v.zoom +
          v.pitch * 9.5 * portraitFactor +
          Math.cos(tSec * 0.19) * 0.09 * drift,
        baseLookAt.z + rz
      );
      camera.lookAt(baseLookAt);

      camera.getWorldDirection(camForward);
      camForward.y = 0;
      if (camForward.lengthSq() < 1e-5) camForward.set(0, 0, -1);
      camForward.normalize();
      camRight.set(-camForward.z, 0, camForward.x);

      let orbitSpin = 0;
      if (keys.has('KeyJ') || keys.has('KeyI')) orbitSpin -= 1;
      if (keys.has('KeyL') || keys.has('KeyK')) orbitSpin += 1;
      if (orbitSpin !== 0) {
        const currentAng = Math.atan2(sim.lightTarget.z, sim.lightTarget.x);
        const nextAng = currentAng + orbitSpin * 1.35 * dt;
        clampLightPos(Math.cos(nextAng) * orbitRadius, Math.sin(nextAng) * orbitRadius);
        sound.playSunTick();
      }

      // Weighted sun azimuth easing + shadow sweep delta tracking
      const easeK = 1 - Math.exp(-13 * dt);
      const tdx = sim.lightTarget.x - sim.lightPos.x;
      const tdz = sim.lightTarget.z - sim.lightPos.z;
      if (Math.abs(tdx) > 0.0012 || Math.abs(tdz) > 0.0012) {
        sim.lightPos.x += tdx * easeK;
        sim.lightPos.z += tdz * easeK;
        sim.lightDirty = true;
      }

      const nextShadowOff = sunShadowOffsetPerHeight(sim.lightPos, shadowRatio);
      const shadowSweepVx = (nextShadowOff.x - prevShadowOff.x) * 2.2;
      const shadowSweepVz = (nextShadowOff.z - prevShadowOff.z) * 2.2;
      prevShadowOff = nextShadowOff;

      if (sim.lightDirty) {
        sim.lightDirty = false;
        rebuildShadows(true, now - lastBridgeEval > 80);
      } else if (bridgePending && now - lastBridgeEval > 40) {
        evaluateBridges(true);
      }

      const engaged = sim.draggingPlane !== 'none' || orbitSpin !== 0;
      if (engaged !== sunEngaged) {
        sunEngaged = engaged;
        sound.setSunEngagement(engaged ? 1 : 0);
      }

      // Animate natural surroundings (3D grass waves, rustling trees, water caustics, fountain, butterflies)
      environment.update(tSec, dt, currentSunDir);

      // Animate wind-drifted 3D tumbling blossom petals
      dustMotes.visible = live.dustMotes;
      if (live.dustMotes) {
        for (let i = 0; i < moteCount; i++) {
          const s = petalSeeds[i];
          const px = ((s.x + tSec * s.spd * 0.88 + 12) % 24) - 12 + level.camera.lookAt.x;
          const pz = ((s.z + tSec * s.spd * 0.45 + 11) % 22) - 11 + level.camera.lookAt.z;
          const py = s.y + Math.sin(tSec * 1.4 + s.phase) * 0.35;
          petalDummy.position.set(px, py, pz);
          petalDummy.rotation.set(
            tSec * 1.6 + s.phase,
            tSec * 1.1 + s.phase * 0.7,
            Math.sin(tSec * 2.1 + s.phase) * 0.8
          );
          petalDummy.updateMatrix();
          dustMotes.setMatrixAt(i, petalDummy.matrix);
        }
        dustMotes.instanceMatrix.needsUpdate = true;
      }

      // Live physical umbra shader uniforms
      const curOp = umbraSlabMat.uniforms.uOpacity.value as number;
      if (Math.abs(curOp - live.shadowOpacity) > 0.002) {
        umbraSlabMat.uniforms.uOpacity.value = curOp + (live.shadowOpacity - curOp) * Math.min(1, dt * 9);
      }
      natureUniforms.uBridgedGlow.value +=
        (targetBridgedGlow - natureUniforms.uBridgedGlow.value) * Math.min(1, dt * 6);

      // Animate the light astrolabe
      const activeSun = sim.draggingPlane !== 'none' || sim.hoveringSun;
      const targetScale = activeSun ? 1.07 : 1.0 + Math.sin(tSec * 1.3) * 0.014;
      sunOrbGroup.scale.lerp(tmpScale.set(targetScale, targetScale, targetScale), 0.12);
      gimbal1.rotation.z += dt * (activeSun ? 0.85 : 0.2);
      gimbal2.rotation.x -= dt * (activeSun ? 0.6 : 0.14);
      retOuter.rotation.z -= dt * 0.16;
      retMat.opacity += ((activeSun ? 0.92 : 0.55) - retMat.opacity) * Math.min(1, dt * 8);
      ringOuterMat.opacity += ((activeSun ? 0.58 : 0.3) - ringOuterMat.opacity) * Math.min(1, dt * 8);
      sunGlowMat.opacity = 0.26 + Math.sin(tSec * 1.05) * 0.035 + (activeSun ? 0.1 : 0);
      sunCoreMat.emissiveIntensity = 0.85 + (activeSun ? 0.28 : Math.sin(tSec * 1.5) * 0.05);

      for (const cv of crystalVisuals) {
        cv.gem.rotation.y += dt * (sim.eclipsed ? 0.35 : 1.7);
        cv.gem.position.y = cv.y + 0.7 + Math.sin(tSec * 2.6) * 0.05;
        cv.halo.rotation.x = Math.PI / 2 + Math.sin(tSec * 1.4) * 0.4;
        cv.halo.rotation.y += dt * (sim.eclipsed ? 0.3 : 1.3);
        cv.gemMat.color.set(sim.eclipsed ? palette.neutral : palette.accentPale);
        cv.gemMat.emissive.set(sim.eclipsed ? palette.slate : palette.accent);
        cv.gemMat.emissiveIntensity = sim.eclipsed ? 0.12 : 0.5;
        cv.auraMat.opacity = sim.eclipsed ? 0.02 : 0.15 + Math.sin(tSec * 2.1) * 0.035;
        cv.ringMat.color.set(sim.eclipsed ? palette.neutral : palette.accent);
      }

      goalTorus.rotation.y += dt * 1.25;
      goalTorus.rotation.x = Math.sin(tSec * 1.5) * 0.35;
      goalTorus2.rotation.y -= dt * 1.65;
      goalTorus2.rotation.z = Math.cos(tSec * 1.3) * 0.4;
      goalCore.rotation.y -= dt * 2.0;
      goalCore.position.y = 0.62 + Math.sin(tSec * 2.9) * 0.055;

      const targetLotusOp = sim.eclipsed ? 0.92 : 0.0;
      lotusMat.opacity += (targetLotusOp - lotusMat.opacity) * Math.min(1, dt * 8);
      const targetPetalTilt = sim.eclipsed ? -0.44 : 1.05;
      const targetLotusY = sim.eclipsed ? 0.0 : -0.45;
      lotusGroup.position.y += (targetLotusY - lotusGroup.position.y) * Math.min(1, dt * 8);
      for (const pivot of lotusPetals) {
        pivot.rotation.x += (targetPetalTilt - pivot.rotation.x) * Math.min(1, dt * 8);
      }

      goalBeaconMat.color.set(sim.eclipsed ? palette.neutral : palette.accentPale);
      goalBeaconMat.emissive.set(sim.eclipsed ? palette.slate : palette.accent);
      goalFloorMat.color.set(sim.eclipsed ? palette.neutral : palette.accent);
      beamMat.opacity = sim.eclipsed ? 0.0 : 0.12 + Math.sin(tSec * 2.4) * 0.03;

      for (const item of trailItems) {
        if (item.life <= 0) continue;
        item.life += dt;
        const p = item.life / item.maxLife;
        if (p >= 1) {
          item.life = 0;
          item.mesh.visible = false;
        } else {
          item.mesh.position.y += item.vy * dt;
          item.mesh.scale.setScalar((1 - p * 0.7) * 0.95);
          item.mat.opacity = (1 - p) * 0.45;
        }
      }

      // -----------------------------------------------------------------------
      // Physical Sphere & Shadow Interaction
      // -----------------------------------------------------------------------
      const supportOf = (ev: SupportEvaluation) => ({
        supported: !!ev.best,
        onPlatform: ev.best?.source === 'platform',
        onShadow: ev.best?.onShadow ?? false,
        minDist: ev.best?.dist ?? Infinity,
        height: ev.best?.height ?? 0,
      });
      let supportEval = evaluateSupport(
        sim.ballPos.x,
        sim.ballPos.z,
        sim.ballPos.y - BALL_RADIUS,
        level.platforms,
        level.brokenGaps,
        level.ramps,
        sim.bridgedFlags,
        sim.shadowsByPlane,
        0.14
      );
      let supportState = supportOf(supportEval);

      if (sim.won) {
        sim.winTimer += dt;
        const k = Math.min(1, sim.winTimer / 0.65);
        sim.ballPos.x += (level.goal.x - sim.ballPos.x) * 0.16;
        sim.ballPos.z += (level.goal.z - sim.ballPos.z) * 0.16;
        sim.ballPos.y = (level.goal.y ?? 0) + BALL_RADIUS + Math.sin(k * Math.PI) * 0.6 + k * 0.28;
        const shrink = Math.max(0.01, 1 - k * 0.85);
        ballRoot.scale.setScalar(shrink);
        ballVisual.rotation.y += dt * 10;
        ballContactRing.visible = false;
        ballSunShadow.visible = false;
        sound.updateRolling(0, false, true);
      } else if (sim.falling) {
        // Real gravitational freefall into the flooded sanctuary canal below
        sim.fallTimer += dt;
        sim.ballVy -= 17.5 * dt;
        sim.ballPos.x += sim.ballVel.x * dt;
        sim.ballPos.z += sim.ballVel.z * dt;
        sim.ballPos.y += sim.ballVy * dt;

        // Continue natural momentum spin in midair
        const airMoved = Math.hypot(sim.ballVel.x * dt, sim.ballVel.z * dt);
        if (airMoved > 1e-5) {
          const rollAxis = new THREE.Vector3(sim.ballVel.z, 0, -sim.ballVel.x).normalize();
          const dq = new THREE.Quaternion().setFromAxisAngle(rollAxis, airMoved / BALL_RADIUS);
          sim.ballQuat.premultiply(dq).normalize();
          ballVisual.quaternion.copy(sim.ballQuat);
        }

        // Land on any terrace / bridge / ramp below the falling sphere (drop-down is allowed)
        const landEval = evaluateSupport(
          sim.ballPos.x,
          sim.ballPos.z,
          sim.ballPos.y - BALL_RADIUS,
          level.platforms,
          level.brokenGaps,
          level.ramps,
          sim.bridgedFlags,
          sim.shadowsByPlane,
          0.14
        );
        if (landEval.best && sim.ballVy <= 0) {
          sim.ballPos.y = landEval.best.height + BALL_RADIUS;
          sim.falling = false;
          sim.fallTimer = 0;
          sim.splashed = false;
          sim.ballVy = 0;
        }

        // Trigger physical water splash & sound when crossing the water plane
        if (!sim.splashed && sim.ballPos.y <= GROUND_Y + 0.34) {
          sim.splashed = true;
          environment.triggerSplash(sim.ballPos.x, sim.ballPos.z);
          sound.playWaterSplash();
        }

        const fadeScale = Math.max(0.05, 1 - Math.max(0, sim.fallTimer - 0.15) * 1.9);
        ballRoot.scale.setScalar(fadeScale);
        ballContactRing.visible = false;
        ballSunShadow.visible = false;
        sound.updateRolling(0, false, true);

        if (sim.fallTimer >= 0.62) {
          sim.falling = false;
          sim.fallTimer = 0;
          sim.splashed = false;
          sim.ballPos.set(sim.lastSafePos.x, (sim.lastSafePos.y ?? 0) + BALL_RADIUS + 0.45, sim.lastSafePos.z);
          sim.ballVel = { x: 0, z: 0 };
          sim.ballVy = 0;
          ballRoot.scale.setScalar(1);
          sound.playRespawn();
        }
      } else {
        ballRoot.scale.setScalar(1);

        // Physical vertical settle — ramps are glued to the grade; flat stones micro-bounce
        const standTarget = (supportState.supported ? supportState.height : 0) + BALL_RADIUS;
        const onRamp = supportEval.best?.source === 'ramp';
        if (onRamp) {
          sim.ballPos.y += (standTarget - sim.ballPos.y) * Math.min(1, dt * 13);
          sim.ballVy = 0;
        } else if (sim.ballPos.y > standTarget || Math.abs(sim.ballVy) > 0.01) {
          sim.ballVy -= 18.0 * dt;
          sim.ballPos.y += sim.ballVy * dt;
          if (sim.ballPos.y <= standTarget) {
            sim.ballPos.y = standTarget;
            if (sim.ballVy < -0.75) {
              sim.ballVy = -sim.ballVy * 0.24;
            } else {
              sim.ballVy = 0;
            }
          }
        }

        // Viscous moving-shadow coupling: if resting on solidified shadow while the sun turns,
        // the sweeping shadow gently tugs the sphere along with it!
        if (supportState.onShadow && !supportState.onPlatform && dt > 1e-4) {
          sim.ballVel.x += Math.max(-0.55, Math.min(0.55, shadowSweepVx * 0.28));
          sim.ballVel.z += Math.max(-0.55, Math.min(0.55, shadowSweepVz * 0.28));
        }

        let inX = virtualInputRef.current.x;
        let inY = virtualInputRef.current.y;
        if (!isPausedRef.current) {
          if (keys.has('KeyA') || keys.has('ArrowLeft')) inX -= 1;
          if (keys.has('KeyD') || keys.has('ArrowRight')) inX += 1;
          if (keys.has('KeyW') || keys.has('ArrowUp')) inY += 1;
          if (keys.has('KeyS') || keys.has('ArrowDown')) inY -= 1;
        }

        const inLen = Math.hypot(inX, inY);
        if (inLen > 0.01) {
          const nx = inX / Math.max(1, inLen);
          const ny = inY / Math.max(1, inLen);
          const accel = 18.5;
          const ax = (camRight.x * nx + camForward.x * ny) * accel;
          const az = (camRight.z * nx + camForward.z * ny) * accel;
          sim.ballVel.x += ax * dt;
          sim.ballVel.z += az * dt;
        }

        // Gravity gently pulls the sphere downhill on walkway slopes
        if (onRamp && supportEval.best?.rampYaw !== undefined) {
          const pull = 3.1 * (supportEval.best.rampSlope ?? 0);
          sim.ballVel.x += -Math.sin(supportEval.best.rampYaw) * pull * dt;
          sim.ballVel.z += -Math.cos(supportEval.best.rampYaw) * pull * dt;
        }

        // Slightly smoother glass-like glide on solidified shadow vs. mossy stone traction
        const dragRate = supportState.onShadow ? 5.6 : 6.2;
        const damping = Math.exp(-dragRate * dt);
        sim.ballVel.x *= damping;
        sim.ballVel.z *= damping;

        const maxSpeed = 4.35;
        const speed = Math.hypot(sim.ballVel.x, sim.ballVel.z);
        if (speed > maxSpeed) {
          sim.ballVel.x = (sim.ballVel.x / speed) * maxSpeed;
          sim.ballVel.z = (sim.ballVel.z / speed) * maxSpeed;
        }

        const prevX = sim.ballPos.x;
        const prevZ = sim.ballPos.z;
        let nextX = prevX + sim.ballVel.x * dt;
        let nextZ = prevZ + sim.ballVel.z * dt;
        let nextVx = sim.ballVel.x;
        let nextVz = sim.ballVel.z;

        let hitSomething = false;
        for (const rect of groundBlockers) {
          const col = resolveCircleRectCollision(nextX, nextZ, nextVx, nextVz, BALL_RADIUS, rect);
          if (col.hit) {
            nextX = col.x;
            nextZ = col.z;
            nextVx = col.vx;
            nextVz = col.vz;
            hitSomething = true;
          }
        }

        // Cliff faces of raised stones are walls; so is any ramp body above the sphere's feet
        const feetY = sim.ballPos.y - BALL_RADIUS;
        for (const plat of level.platforms) {
          const py = plat.y ?? 0;
          if (py <= feetY + 0.02) continue;
          const col = resolveCircleRectCollision(nextX, nextZ, nextVx, nextVz, BALL_RADIUS, plat);
          if (col.hit) {
            nextX = col.x;
            nextZ = col.z;
            nextVx = col.vx;
            nextVz = col.vz;
            hitSomething = true;
          }
        }
        for (const ramp of level.ramps ?? []) {
          const hHere = rampHeightAt(ramp, nextX, nextZ, BALL_RADIUS);
          if (hHere === null || hHere <= feetY + 0.02) continue;
          const col = resolveCircleRotRectCollision(
            nextX,
            nextZ,
            nextVx,
            nextVz,
            BALL_RADIUS,
            { x: ramp.x, z: ramp.z },
            ramp.length * 0.5,
            ramp.width * 0.5,
            ramp.yaw
          );
          if (col.hit) {
            nextX = col.x;
            nextZ = col.z;
            nextVx = col.vx;
            nextVz = col.vz;
            hitSomething = true;
          }
        }

        if (sim.eclipsed) {
          const gdx = nextX - level.goal.x;
          const gdz = nextZ - level.goal.z;
          const gDist = Math.hypot(gdx, gdz);
          const lockRad = 0.66 + BALL_RADIUS;
          const heightOK = Math.abs(sim.ballPos.y - BALL_RADIUS - (level.goal.y ?? 0)) < 1.2;
          if (heightOK && gDist < lockRad && gDist > 1e-5) {
            const nx = gdx / gDist;
            const nz = gdz / gDist;
            nextX = level.goal.x + nx * lockRad;
            nextZ = level.goal.z + nz * lockRad;
            const vn = nextVx * nx + nextVz * nz;
            if (vn < 0) {
              nextVx -= 1.3 * vn * nx;
              nextVz -= 1.3 * vn * nz;
            }
            hitSomething = true;
          }
        }

        if (hitSomething && speed > 0.7) {
          sound.playBump(speed / maxSpeed);
        }

        sim.ballPos.x = nextX;
        sim.ballPos.z = nextZ;
        sim.ballVel.x = nextVx;
        sim.ballVel.z = nextVz;

        const dx = nextX - prevX;
        const dz = nextZ - prevZ;
        const moved = Math.hypot(dx, dz);
        if (moved > 1e-5) {
          const rollAxis = new THREE.Vector3(dz, 0, -dx).normalize();
          const rollAngle = moved / BALL_RADIUS;
          const dq = new THREE.Quaternion().setFromAxisAngle(rollAxis, rollAngle);
          sim.ballQuat.premultiply(dq).normalize();
          ballVisual.quaternion.copy(sim.ballQuat);
        }

        supportEval = evaluateSupport(
          sim.ballPos.x,
          sim.ballPos.z,
          sim.ballPos.y - BALL_RADIUS,
          level.platforms,
          level.brokenGaps,
          level.ramps,
          sim.bridgedFlags,
          sim.shadowsByPlane,
          0.14
        );
        supportState = supportOf(supportEval);

        if (!supportState.supported) {
          sim.falling = true;
          sim.fallTimer = 0;
          sim.splashed = false;
          sim.ballVy = -0.8;
          sound.playFall();
          sound.updateRolling(0, false, true);
        } else {
          // Subtle physical ledge dip when balanced right on the outer bevel of a stone/shadow edge
          if (supportState.minDist > 0.04 && sim.ballPos.y <= supportState.height + BALL_RADIUS + 0.01) {
            const lipFrac = (supportState.minDist - 0.04) / 0.1;
            sim.ballPos.y = BALL_RADIUS - lipFrac * lipFrac * 0.045;
          }

          const liftFade = Math.max(0.25, 1 - (sim.ballPos.y - supportState.height - BALL_RADIUS) * 1.4);
          ballContactRing.visible = true;
          ballContactRing.position.set(sim.ballPos.x, supportState.height + 0.013, sim.ballPos.z);
          ballShadowRingMat.opacity = 0.56 * liftFade;

          // Project the sphere's directional sun shadow along the exact parallel sun ray!
          ballSunShadow.visible = true;
          const centerH = Math.max(BALL_RADIUS, sim.ballPos.y - supportState.height);
          const projX = sim.ballPos.x + nextShadowOff.x * (centerH * 0.65);
          const projZ = sim.ballPos.z + nextShadowOff.z * (centerH * 0.65);
          ballSunShadow.position.set(projX, supportState.height + 0.011, projZ);
          ballSunShadow.rotation.y = Math.atan2(nextShadowOff.x, nextShadowOff.z);
          ballSunShadowMat.opacity = (supportState.onShadow ? 0.42 : 0.22) * liftFade;

          const speedNorm = Math.min(1, speed / maxSpeed);
          sound.updateRolling(speedNorm, supportState.onShadow, sim.ballPos.y > supportState.height + BALL_RADIUS + 0.05);

          if (moved > 0.008) {
            trailSpawnAccum += moved;
            const spacing = supportState.onShadow ? 0.14 : 0.24;
            if (trailSpawnAccum >= spacing) {
              trailSpawnAccum = 0;
              spawnTrailPuff(sim.ballPos.x, sim.ballPos.z, supportState.onShadow, supportState.height + 0.06);
            }
          }

          for (const plat of level.platforms) {
            if (plat.style === 'pedestal') continue;
            const margin = 0.42;
            if (
              sim.ballPos.x >= plat.xMin + margin &&
              sim.ballPos.x <= plat.xMax - margin &&
              sim.ballPos.z >= plat.zMin + margin &&
              sim.ballPos.z <= plat.zMax - margin
            ) {
              sim.lastSafePos = { x: sim.ballPos.x, z: sim.ballPos.z, y: supportState.height };
              break;
            }
          }

          if (!sim.eclipsed) {
            const goalDist = Math.hypot(sim.ballPos.x - level.goal.x, sim.ballPos.z - level.goal.z);
            const goalTerrace = Math.abs(sim.ballPos.y - BALL_RADIUS - (level.goal.y ?? 0)) < 0.8;
            if (goalDist <= 0.52 && goalTerrace) {
              sim.won = true;
              sim.winTimer = 0;
              sound.playVictory();
              sound.updateRolling(0, false, true);
              const elapsed = (performance.now() - sim.startTime) / 1000;
              setTimeout(() => {
                callbacksRef.current.onLevelComplete(elapsed);
              }, 520);
            }
          }
        }
      }

      // Feed live ball contact position to solidified shadow ripple shader
      natureUniforms.uBallWorld.value.copy(sim.ballPos);
      const targetOnShadow = !sim.falling && !sim.won && supportState.onShadow ? 1 : 0;
      natureUniforms.uBallOnShadow.value +=
        (targetOnShadow - natureUniforms.uBallOnShadow.value) * Math.min(1, dt * 10);

      ballRoot.position.copy(sim.ballPos);

      if (now - lastStatusPush > 90) {
        lastStatusPush = now;
        const az =
          ((Math.atan2(sim.lightPos.x, -sim.lightPos.z) * 180) / Math.PI + 360) % 360;
        callbacksRef.current.onStatusChange({
          bridgedCount: sim.bridgedFlags.filter(Boolean).length,
          totalGaps: level.brokenGaps.length,
          eclipsed: sim.eclipsed,
          hasCrystals: (level.sunCrystals?.length || 0) > 0,
          onShadow: supportState.onShadow,
          isDraggingSun: sim.draggingPlane !== 'none',
          sunAzimuthDeg: Math.round(az),
          viewAzimuthDeg: Math.round((((v.yaw * 180) / Math.PI + 180) % 360 + 360) % 360 - 180),
          isRotatingView: v.rotating,
        });
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      sound.updateRolling(0, false, true);
      sound.setSunEngagement(0);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      domEl.removeEventListener('pointerdown', handlePointerDown);
      domEl.removeEventListener('pointermove', handlePointerMove);
      domEl.removeEventListener('pointerup', handlePointerUp);
      domEl.removeEventListener('pointercancel', handlePointerUp);
      domEl.removeEventListener('lostpointercapture', handlePointerUp);
      domEl.removeEventListener('wheel', handleWheel);
      domEl.removeEventListener('contextmenu', preventContextMenu);
      domEl.removeEventListener('dblclick', handleDoubleClick);
      clearDynamicUmbra();
      for (const item of disposables) {
        item.dispose();
      }
      rendererRef.current = null;
      sunLightRef.current = null;
      renderer.dispose();
    };
  }, [level, virtualInputRef]);

  // Render-scale & shadow-map quality updates in place without tearing down the scene
  useEffect(() => {
    const r = rendererRef.current;
    const l = sunLightRef.current;
    if (!r) return;
    const q = settings.quality;
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    r.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    if (l) {
      const res = q === 'low' ? 1024 : q === 'medium' ? 2048 : 4096;
      if (l.shadow.mapSize.width !== res) {
        l.shadow.mapSize.set(res, res);
        l.shadow.map?.dispose();
        l.shadow.map = null;
      }
      l.shadow.radius = q === 'low' ? 1.4 : 2.3;
    }
  }, [settings.quality]);

  return <div ref={containerRef} className="w-full h-full touch-none select-none" />;
};
