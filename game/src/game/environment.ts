import * as THREE from 'three';
import {
  createAnimatedTurfMaterial,
  createAnimatedWaterMaterial,
  createGrassBladeGeometry,
  createWildflowerGeometry,
  createWildflowerMaterial,
  createWindFoliageMaterials,
  createWindGrassMaterial,
  type NatureUniforms,
} from './natureShaders';
import { SanctuaryPalette } from './palettes';
import {
  createGrassTexture,
  createSoftBlobShadowTexture,
  createWaterPatternTexture,
} from './textures';
import { LevelData } from './types';

export interface EnvironmentController {
  update: (tSec: number, dt: number, sunDir: THREE.Vector3) => void;
  triggerSplash: (x: number, z: number) => void;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Box2D {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** The meadow floor sits right where the platform plinths meet the earth. */
export const GROUND_Y = -1.16;

function distPointToBox2D(x: number, z: number, b: Box2D): number {
  const dx = Math.max(b.xMin - x, 0, x - b.xMax);
  const dz = Math.max(b.zMin - z, 0, z - b.zMax);
  return Math.hypot(dx, dz);
}

/**
 * Builds the sunlit nature-reclaimed archaeological sanctuary around the puzzle:
 * - Octagonal sunken courtyard fountain with bubbling spout & animated ripples
 * - Weathered carved blue-grey & cream ruin pillars, broken aqueduct arches, and displaced flagstone paths
 * - GPU wind-animated 3D grass meadow, swaying wildflowers, rustling multi-canopy trees & hanging vines
 * - Animated water channels with caustics, lapping shoreline foam, and real-time shadow reception
 *
 * Every tall structure is placed outside `(H - 1.16) * shadowRatio + 1.5` from playable platforms
 * so it casts rich, physically accurate directional shadows across the meadow and water without
 * ever casting false shadows onto the elevated `y = 0` puzzle stones.
 */
export function buildSanctuaryEnvironment(
  scene: THREE.Scene,
  level: LevelData,
  palette: SanctuaryPalette,
  track: <T extends { dispose: () => void }>(item: T) => T,
  sharedMaterials: {
    stoneTop: THREE.Material;
    stoneSide: THREE.Material;
    stoneDeep: THREE.Material;
    terracotta: THREE.Material;
    ochre: THREE.Material;
    trim: THREE.Material;
  },
  natureUniforms: NatureUniforms,
  quality: 'low' | 'medium' | 'high' = 'high'
): EnvironmentController {
  const rand = mulberry32(level.number * 7919 + 31);
  const env = new THREE.Group();
  scene.add(env);

  const shadowRatio = level.lightBounds.shadowRatio;

  /* ------------------------------------------------------------------ sky */
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 8;
  skyCanvas.height = 256;
  const sCtx = skyCanvas.getContext('2d')!;
  const sGrad = sCtx.createLinearGradient(0, 0, 0, 256);
  sGrad.addColorStop(0.0, palette.skyTop);
  sGrad.addColorStop(0.38, palette.skyMid);
  sGrad.addColorStop(0.58, palette.skyHorizon);
  sGrad.addColorStop(1.0, palette.fogColor);
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 8, 256);
  const skyTex = track(new THREE.CanvasTexture(skyCanvas));
  skyTex.colorSpace = THREE.SRGBColorSpace;
  env.add(
    new THREE.Mesh(
      track(new THREE.SphereGeometry(105, 24, 16)),
      track(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }))
    )
  );

  /* ------------------------------------------------------- bounds & plan */
  const platformBoxes: Box2D[] = level.platforms.map((p) => ({
    xMin: p.xMin,
    xMax: p.xMax,
    zMin: p.zMin,
    zMax: p.zMax,
  }));

  const plan: Box2D = { xMin: Infinity, xMax: -Infinity, zMin: Infinity, zMax: -Infinity };
  for (const p of platformBoxes) {
    plan.xMin = Math.min(plan.xMin, p.xMin);
    plan.xMax = Math.max(plan.xMax, p.xMax);
    plan.zMin = Math.min(plan.zMin, p.zMin);
    plan.zMax = Math.max(plan.zMax, p.zMax);
  }
  const cx = Number.isFinite(plan.xMin) ? (plan.xMin + plan.xMax) * 0.5 : 0;
  const cz = Number.isFinite(plan.zMin) ? (plan.zMin + plan.zMax) * 0.5 : 0;
  const planRadius = Number.isFinite(plan.xMin)
    ? Math.hypot((plan.xMax - plan.xMin) * 0.5, (plan.zMax - plan.zMin) * 0.5)
    : 6;

  const minDistToPlatforms = (x: number, z: number): number => {
    let best = Infinity;
    for (const b of platformBoxes) {
      const d = distPointToBox2D(x, z, b);
      if (d < best) best = d;
    }
    return best;
  };

  /* --------------------------------------------------------------- meadow */
  const grassTex = track(createGrassTexture(palette.grass, palette.grassLight, palette.grassDeep));
  grassTex.repeat.set(16, 16);
  const meadowMat = track(createAnimatedTurfMaterial(grassTex, natureUniforms));
  // Subdivided so the mown contour bands actually breathe with the wind
  const meadowGeo = track(new THREE.PlaneGeometry(204, 204, 84, 84).rotateX(-Math.PI / 2));
  const meadow = new THREE.Mesh(meadowGeo, meadowMat);
  meadow.position.y = GROUND_Y;
  meadow.receiveShadow = true;
  env.add(meadow);

  // Soft ambient-occlusion grounding texture reused under ruins & platform footings
  const aoBlobTex = track(createSoftBlobShadowTexture());
  const aoMat = track(
    new THREE.MeshBasicMaterial({
      map: aoBlobTex,
      color: '#0e3b22',
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    })
  );
  const aoQuadGeo = track(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const addGroundAO = (x: number, z: number, sx: number, sz: number, y = GROUND_Y + 0.015) => {
    const m = new THREE.Mesh(aoQuadGeo, aoMat);
    m.position.set(x, y, z);
    m.scale.set(sx, 1, sz);
    env.add(m);
  };

  /* ----------------------------------------- animated water in broken gaps */
  // Painterly reference water: irregular blue pools separated by crisp white branching veins
  const waterPattern = track(
    createWaterPatternTexture(palette.water, palette.waterDeep, palette.waterFoam)
  );
  waterPattern.repeat.set(1, 1);
  const waterMat = track(createAnimatedWaterMaterial(waterPattern, palette.waterFoam, natureUniforms));
  const basinBedMat = track(
    new THREE.MeshStandardMaterial({
      color: '#346888',
      roughness: 0.95,
      metalness: 0.0,
    })
  );
  const mossMat = track(
    new THREE.MeshStandardMaterial({
      color: palette.moss,
      roughness: 0.92,
      metalness: 0.0,
    })
  );

  const touching = (p: Box2D, g: Box2D) =>
    p.xMax > g.xMin - 0.45 && p.xMin < g.xMax + 0.45 && p.zMax > g.zMin - 0.45 && p.zMin < g.zMax + 0.45;

  const pools: Box2D[] = [];
  for (const gap of level.brokenGaps) {
    const g: Box2D = { xMin: gap.xMin, xMax: gap.xMax, zMin: gap.zMin, zMax: gap.zMax };
    const pool: Box2D = { ...g };
    for (const p of platformBoxes) {
      if (!touching(p, g)) continue;
      const alongX = Math.abs(p.xMax - g.xMin) < 0.45 || Math.abs(p.xMin - g.xMax) < 0.45;
      if (alongX) {
        pool.zMin = Math.min(pool.zMin, p.zMin);
        pool.zMax = Math.max(pool.zMax, p.zMax);
      } else {
        pool.xMin = Math.min(pool.xMin, p.xMin);
        pool.xMax = Math.max(pool.xMax, p.xMax);
      }
    }
    pool.xMin -= 0.42;
    pool.xMax += 0.42;
    pool.zMin -= 0.42;
    pool.zMax += 0.42;
    pools.push(pool);

    const w = pool.xMax - pool.xMin;
    const d = pool.zMax - pool.zMin;
    const px = (pool.xMin + pool.xMax) * 0.5;
    const pz = (pool.zMin + pool.zMax) * 0.5;

    // Stone-bordered sunken canal rim flush with meadow
    const kerbThickness = 0.22;
    const kerbGeoN = track(new THREE.BoxGeometry(w + kerbThickness * 2, 0.16, kerbThickness));
    const kerbGeoE = track(new THREE.BoxGeometry(kerbThickness, 0.16, d));
    const kN = new THREE.Mesh(kerbGeoN, sharedMaterials.stoneSide);
    kN.position.set(px, GROUND_Y + 0.07, pool.zMin - kerbThickness * 0.5);
    kN.receiveShadow = true;
    const kS = new THREE.Mesh(kerbGeoN, sharedMaterials.stoneSide);
    kS.position.set(px, GROUND_Y + 0.07, pool.zMax + kerbThickness * 0.5);
    kS.receiveShadow = true;
    const kW = new THREE.Mesh(kerbGeoE, sharedMaterials.stoneSide);
    kW.position.set(pool.xMin - kerbThickness * 0.5, GROUND_Y + 0.07, pz);
    kW.receiveShadow = true;
    const kE = new THREE.Mesh(kerbGeoE, sharedMaterials.stoneSide);
    kE.position.set(pool.xMax + kerbThickness * 0.5, GROUND_Y + 0.07, pz);
    kE.receiveShadow = true;
    env.add(kN, kS, kW, kE);

    // Submerged stone bed + subdivided animated water surface (receives real shadows!)
    const bed = new THREE.Mesh(track(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2)), basinBedMat);
    bed.position.set(px, GROUND_Y + 0.02, pz);
    env.add(bed);

    const segsX = Math.max(8, Math.min(24, Math.round(w * 3)));
    const segsZ = Math.max(8, Math.min(24, Math.round(d * 3)));
    const waterGeo = track(new THREE.PlaneGeometry(w, d, segsX, segsZ).rotateX(-Math.PI / 2));
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.set(px, GROUND_Y + 0.12, pz);
    waterMesh.receiveShadow = true;
    env.add(waterMesh);
  }

  /* ------------------------------------ platform footings & cliff ivy */
  const foliageDeep = createWindFoliageMaterials('#35843F', natureUniforms, 'deep');
  const foliageMid = createWindFoliageMaterials('#55B248', natureUniforms, 'mid');
  const foliageSun = createWindFoliageMaterials('#86D454', natureUniforms, 'sun');
  track(foliageDeep.material);
  track(foliageDeep.depthMaterial);
  track(foliageMid.material);
  track(foliageMid.depthMaterial);
  track(foliageSun.material);
  track(foliageSun.depthMaterial);

  const leafPuffGeo = track(new THREE.IcosahedronGeometry(1, 1));
  const vineLeafGeo = track(new THREE.DodecahedronGeometry(0.16, 0));

  for (const p of level.platforms) {
    const w = p.xMax - p.xMin;
    const d = p.zMax - p.zMin;
    const px = (p.xMin + p.xMax) * 0.5;
    const pz = (p.zMin + p.zMax) * 0.5;

    addGroundAO(px, pz, w + 1.4, d + 1.4);

    if (p.points && p.points.length >= 3) {
      // polygon footing: the stone's own silhouette, pushed out slightly
      let ox = 0;
      let oz = 0;
      for (const v of p.points) {
        ox += v.x;
        oz += v.z;
      }
      ox /= p.points.length;
      oz /= p.points.length;
      const grown = p.points.map((v) => {
        const dx = v.x - ox;
        const dz = v.z - oz;
        const len = Math.hypot(dx, dz) || 1;
        const k = (len + 0.22) / len;
        return { x: ox + dx * k, z: oz + dz * k };
      });
      const shape = new THREE.Shape();
      shape.moveTo(grown[0].x, -grown[0].z);
      for (let i = 1; i < grown.length; i++) shape.lineTo(grown[i].x, -grown[i].z);
      shape.closePath();
      const geo = track(new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false }));
      geo.rotateX(-Math.PI / 2);
      const foot = new THREE.Mesh(geo, sharedMaterials.stoneDeep);
      foot.position.y = GROUND_Y;
      foot.receiveShadow = true;
      foot.castShadow = true;
      env.add(foot);
    } else {
      const foot = new THREE.Mesh(
        track(new THREE.BoxGeometry(w + 0.46, 0.22, d + 0.46)),
        sharedMaterials.stoneDeep
      );
      foot.position.set(px, GROUND_Y + 0.11, pz);
      foot.receiveShadow = true;
      foot.castShadow = true;
      env.add(foot);
    }

    // Subtle moss cushions & hanging cliff vines tucked below the walking surface (y < -0.18)
    const broken = new Set(p.brokenEdges || []);
    if (!broken.has('south') && w >= 2.4) {
      const vx = px + (rand() - 0.5) * (w * 0.5);
      const vz = p.zMax + 0.04;
      for (let k = 0; k < 4; k++) {
        const vLeaf = new THREE.Mesh(vineLeafGeo, k % 2 === 0 ? foliageMid.material : foliageSun.material);
        vLeaf.customDepthMaterial = k % 2 === 0 ? foliageMid.depthMaterial : foliageSun.depthMaterial;
        vLeaf.position.set(vx + Math.sin(k * 1.4) * 0.09, -0.24 - k * 0.17, vz);
        vLeaf.scale.set(1.1 - k * 0.15, 0.85, 0.7);
        vLeaf.castShadow = true;
        vLeaf.receiveShadow = true;
        env.add(vLeaf);
      }
    }
  }

  /* --------------------------------------------------- placement tracker */
  const occupied: Array<{ x: number; z: number; r: number }> = [];
  const inAnyPoolOrPlatform = (x: number, z: number, padR: number) => {
    for (const b of platformBoxes) {
      if (distPointToBox2D(x, z, b) < padR) return true;
    }
    for (const b of pools) {
      if (distPointToBox2D(x, z, b) < padR) return true;
    }
    return false;
  };

  /**
   * Finds a spot whose physical shadow at `heightAboveGround` can NEVER reach `y = 0` on any platform.
   */
  const findSafeSpot = (
    footprintR: number,
    heightAboveGround: number,
    minOut = 2.0,
    maxOut = 22.0,
    preferFront = false
  ): { x: number; z: number } | null => {
    const yTopAboveZero = Math.max(0, GROUND_Y + heightAboveGround);
    const shadowClearance = yTopAboveZero > 0 ? yTopAboveZero * shadowRatio + 1.55 + footprintR : footprintR + 1.15;
    const reqPlatDist = Math.max(minOut, shadowClearance);

    for (let attempt = 0; attempt < 65; attempt++) {
      const a = preferFront
        ? (rand() - 0.5) * Math.PI * 1.35 + Math.PI * 0.5
        : rand() * Math.PI * 2;
      const radial = planRadius + reqPlatDist * 0.65 + rand() * (maxOut - minOut);
      const x = cx + Math.cos(a) * radial;
      const z = cz + Math.sin(a) * radial;

      if (minDistToPlatforms(x, z) < reqPlatDist) continue;
      if (inAnyPoolOrPlatform(x, z, footprintR + 0.9)) continue;
      if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + footprintR + 1.1)) continue;

      occupied.push({ x, z, r: footprintR });
      return { x, z };
    }
    return null;
  };

  /* --------- 1. Sunken Octagonal Ruin Fountain (Reference Hero Piece!) --- */
  const fountainRipples: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number; maxR: number }> = [];
  const fountainDrops: Array<{ mesh: THREE.Mesh; phase: number; vx: number; vz: number; origin: THREE.Vector3 }> = [];
  let fountainDome: THREE.Mesh | null = null;

  const fountainSpot = findSafeSpot(2.5, 1.02, 2.5, 8.5, true);
  if (fountainSpot) {
    const fg = new THREE.Group();
    fg.position.set(fountainSpot.x, GROUND_Y, fountainSpot.z);
    env.add(fg);

    const octR = 2.05;
    const wallH = 0.62;
    const segLen = 2 * octR * Math.tan(Math.PI / 8) + 0.18;
    const breachedIdx = Math.floor(rand() * 8);

    addGroundAO(fountainSpot.x, fountainSpot.z, 5.2, 5.2);

    // Recessed stone floor & animated octagonal water pool
    const innerWaterGeo = track(new THREE.CircleGeometry(octR - 0.16, 8, Math.PI / 8));
    innerWaterGeo.rotateX(-Math.PI / 2);
    const innerBed = new THREE.Mesh(innerWaterGeo, basinBedMat);
    innerBed.position.y = 0.06;
    fg.add(innerBed);

    const fWaterGeo = track(new THREE.CircleGeometry(octR - 0.14, 24));
    fWaterGeo.rotateX(-Math.PI / 2);
    const fWater = new THREE.Mesh(fWaterGeo, waterMat);
    fWater.position.y = 0.34;
    fWater.receiveShadow = true;
    fg.add(fWater);

    // 8 bevelled cream-stone coping wall segments + moss cushions
    const segBodyGeo = track(new THREE.BoxGeometry(segLen, wallH, 0.42));
    const segCapGeo = track(new THREE.BoxGeometry(segLen + 0.06, 0.12, 0.5));
    for (let s = 0; s < 8; s++) {
      const ang = (s / 8) * Math.PI * 2;
      const segGroup = new THREE.Group();
      segGroup.position.set(Math.sin(ang) * octR, 0, Math.cos(ang) * octR);
      segGroup.rotation.y = ang;

      const hScale = s === breachedIdx ? 0.52 : 0.94 + (rand() - 0.5) * 0.08;
      const body = new THREE.Mesh(segBodyGeo, sharedMaterials.terracotta);
      body.scale.y = hScale;
      body.position.y = (wallH * hScale) * 0.5;
      body.castShadow = true;
      body.receiveShadow = true;
      segGroup.add(body);

      if (s !== breachedIdx) {
        const coping = new THREE.Mesh(segCapGeo, sharedMaterials.stoneTop);
        coping.position.y = wallH * hScale + 0.05;
        coping.castShadow = true;
        coping.receiveShadow = true;
        segGroup.add(coping);

        if (s % 2 === 0) {
          const moss = new THREE.Mesh(
            track(new THREE.BoxGeometry(segLen * (0.35 + rand() * 0.3), 0.05, 0.36)),
            mossMat
          );
          moss.position.set((rand() - 0.5) * 0.3, wallH * hScale + 0.12, 0.04);
          moss.receiveShadow = true;
          segGroup.add(moss);
        }
      } else {
        // Fallen coping stone resting in the grass outside the breached wall
        const fallen = new THREE.Mesh(
          track(new THREE.BoxGeometry(0.68, 0.24, 0.44)),
          sharedMaterials.stoneTop
        );
        fallen.position.set(0.15, 0.12, 0.62);
        fallen.rotation.set(0.18, 0.35, -0.14);
        fallen.castShadow = true;
        fallen.receiveShadow = true;
        segGroup.add(fallen);
      }

      fg.add(segGroup);
    }

    // Central carved fountain plinth + bubbling water spout
    const ped = new THREE.Mesh(track(new THREE.BoxGeometry(0.76, 0.68, 0.76)), sharedMaterials.stoneSide);
    ped.position.y = 0.34;
    ped.castShadow = true;
    ped.receiveShadow = true;
    fg.add(ped);

    const pedCap = new THREE.Mesh(track(new THREE.BoxGeometry(0.86, 0.12, 0.86)), sharedMaterials.trim);
    pedCap.position.y = 0.72;
    pedCap.castShadow = true;
    pedCap.receiveShadow = true;
    fg.add(pedCap);

    const pedMoss = new THREE.Mesh(track(new THREE.BoxGeometry(0.52, 0.05, 0.44)), mossMat);
    pedMoss.position.set(0.1, 0.8, 0.08);
    fg.add(pedMoss);

    // Animated bubbling water dome + droplets + expanding foam rings
    const domeMat = track(
      new THREE.MeshBasicMaterial({
        color: palette.waterFoam,
        transparent: true,
        opacity: 0.86,
      })
    );
    fountainDome = new THREE.Mesh(track(new THREE.SphereGeometry(0.24, 14, 10)), domeMat);
    fountainDome.position.set(fountainSpot.x, GROUND_Y + 0.86, fountainSpot.z);
    env.add(fountainDome);

    const dropGeo = track(new THREE.SphereGeometry(0.048, 8, 6));
    for (let d = 0; d < 10; d++) {
      const dm = new THREE.Mesh(dropGeo, domeMat);
      const a = (d / 10) * Math.PI * 2 + rand() * 0.3;
      const spd = 0.45 + rand() * 0.45;
      env.add(dm);
      fountainDrops.push({
        mesh: dm,
        phase: d / 10,
        vx: Math.cos(a) * spd,
        vz: Math.sin(a) * spd,
        origin: new THREE.Vector3(fountainSpot.x, GROUND_Y + 0.88, fountainSpot.z),
      });
    }

    const fRingGeo = track(new THREE.RingGeometry(0.45, 0.53, 28).rotateX(-Math.PI / 2));
    for (let r = 0; r < 2; r++) {
      const rMat = track(
        new THREE.MeshBasicMaterial({
          color: palette.waterFoam,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        })
      );
      const rMesh = new THREE.Mesh(fRingGeo, rMat);
      rMesh.position.set(fountainSpot.x, GROUND_Y + 0.36, fountainSpot.z);
      env.add(rMesh);
      fountainRipples.push({ mesh: rMesh, mat: rMat, phase: r * 0.5, maxR: 2.8 });
    }
  }

  /* ---- 2. Tall Weathered Square Sanctuary Pillars (Reference Pillars!) -- */
  const buildAncientPillar = (x: number, z: number, totalH: number, fractured: boolean) => {
    const g = new THREE.Group();
    g.position.set(x, GROUND_Y, z);
    g.rotation.y = (rand() - 0.5) * 0.55;
    addGroundAO(x, z, 2.2, 2.2);

    // Stepped cream stone base plinth
    const plinth1 = new THREE.Mesh(track(new THREE.BoxGeometry(1.42, 0.24, 1.42)), sharedMaterials.trim);
    plinth1.position.y = 0.12;
    plinth1.castShadow = true;
    plinth1.receiveShadow = true;
    g.add(plinth1);

    const plinth2 = new THREE.Mesh(track(new THREE.BoxGeometry(1.18, 0.22, 1.18)), sharedMaterials.stoneSide);
    plinth2.position.y = 0.35;
    plinth2.castShadow = true;
    plinth2.receiveShadow = true;
    g.add(plinth2);

    // 3 stacked blue-grey carved stone courses with subtle age shift
    const shaftH = totalH - 0.78;
    const courses = 3;
    const ch = shaftH / courses;
    for (let c = 0; c < courses; c++) {
      const w = 0.98 - c * 0.03;
      const drum = new THREE.Mesh(
        track(new THREE.BoxGeometry(w, ch - 0.02, w)),
        sharedMaterials.terracotta
      );
      drum.position.set((rand() - 0.5) * 0.05, 0.46 + (c + 0.5) * ch, (rand() - 0.5) * 0.05);
      drum.rotation.y = (rand() - 0.5) * 0.06;
      drum.castShadow = true;
      drum.receiveShadow = true;
      g.add(drum);
    }

    const topY = 0.46 + shaftH;
    if (!fractured) {
      // Overhanging cream capital + lush green turf/moss crown (just like reference!)
      const neck = new THREE.Mesh(track(new THREE.BoxGeometry(1.12, 0.12, 1.12)), sharedMaterials.stoneSide);
      neck.position.y = topY + 0.06;
      neck.castShadow = true;
      neck.receiveShadow = true;
      g.add(neck);

      const cap = new THREE.Mesh(track(new THREE.BoxGeometry(1.36, 0.26, 1.36)), sharedMaterials.trim);
      cap.position.y = topY + 0.25;
      cap.castShadow = true;
      cap.receiveShadow = true;
      g.add(cap);

      // Irregular multi-pad moss & grass cap on top of capital
      const m1 = new THREE.Mesh(track(new THREE.BoxGeometry(0.92, 0.09, 0.86)), mossMat);
      m1.position.set(0.14, topY + 0.41, -0.1);
      m1.receiveShadow = true;
      const m2 = new THREE.Mesh(track(new THREE.BoxGeometry(0.58, 0.11, 0.62)), foliageMid.material);
      m2.customDepthMaterial = foliageMid.depthMaterial;
      m2.position.set(-0.22, topY + 0.42, 0.22);
      m2.castShadow = true;
      m2.receiveShadow = true;
      g.add(m1, m2);
    } else {
      // Broken jagged top + fallen capital half-buried in the grass beside it
      const shard = new THREE.Mesh(track(new THREE.BoxGeometry(0.56, 0.34, 0.62)), sharedMaterials.terracotta);
      shard.position.set(-0.16, topY + 0.15, 0.1);
      shard.castShadow = true;
      shard.receiveShadow = true;
      g.add(shard);

      const fallenCap = new THREE.Mesh(track(new THREE.BoxGeometry(1.22, 0.26, 1.22)), sharedMaterials.trim);
      fallenCap.position.set(1.15, 0.16, 0.35);
      fallenCap.rotation.set(0.28, 0.5, -0.22);
      fallenCap.castShadow = true;
      fallenCap.receiveShadow = true;
      g.add(fallenCap);
    }

    // Climbing ivy cluster hugging one corner of the pillar
    for (let iv = 0; iv < 4; iv++) {
      const ivMesh = new THREE.Mesh(vineLeafGeo, iv % 2 === 0 ? foliageDeep.material : foliageMid.material);
      ivMesh.customDepthMaterial = iv % 2 === 0 ? foliageDeep.depthMaterial : foliageMid.depthMaterial;
      ivMesh.position.set(0.5, 0.55 + iv * 0.36, 0.38 - iv * 0.08);
      ivMesh.scale.setScalar(1.15 - iv * 0.12);
      ivMesh.castShadow = true;
      ivMesh.receiveShadow = true;
      g.add(ivMesh);
    }

    env.add(g);
  };

  for (let i = 0; i < 6; i++) {
    const h = 3.1 + rand() * 1.35;
    const spot = findSafeSpot(1.1, h, 3.2, 16.5);
    if (spot) buildAncientPillar(spot.x, spot.z, h, i % 3 === 2);
  }

  /* ---- 3. Ruined Multi-Bay Stone Aqueduct & Broken Colonnades ----------- */
  const buildRuinedAqueduct = (x: number, z: number, yaw: number) => {
    const g = new THREE.Group();
    g.position.set(x, GROUND_Y, z);
    g.rotation.y = yaw;
    addGroundAO(x, z, 6.6, 2.4);

    const pierH = 2.85;
    const span = 2.8;
    const xs = [-span, 0, span * 0.85];

    xs.forEach((px, idx) => {
      const h = idx === 2 ? pierH * 0.58 : pierH;
      const base = new THREE.Mesh(track(new THREE.BoxGeometry(1.08, 0.22, 1.08)), sharedMaterials.trim);
      base.position.set(px, 0.11, 0);
      base.castShadow = true;
      base.receiveShadow = true;
      g.add(base);

      const pier = new THREE.Mesh(track(new THREE.BoxGeometry(0.84, h, 0.84)), sharedMaterials.terracotta);
      pier.position.set(px, 0.22 + h * 0.5, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      g.add(pier);
    });

    // Intact Bay 1 corbelled arch + entablature lintel + broken cantilever toward Bay 2
    const archVoussoirs = 5;
    for (let v = 0; v < archVoussoirs; v++) {
      const t = (v + 0.5) / archVoussoirs;
      const a = Math.PI * (1 - t);
      const ax = -span * 0.5 + Math.cos(a) * (span * 0.42);
      const ay = pierH - 0.35 + Math.sin(a) * 0.62;
      const vBlock = new THREE.Mesh(track(new THREE.BoxGeometry(0.56, 0.32, 0.78)), sharedMaterials.stoneSide);
      vBlock.position.set(ax, ay, 0);
      vBlock.rotation.z = a - Math.PI * 0.5;
      vBlock.castShadow = true;
      vBlock.receiveShadow = true;
      g.add(vBlock);
    }

    const lintel = new THREE.Mesh(track(new THREE.BoxGeometry(span + 1.55, 0.44, 0.96)), sharedMaterials.trim);
    lintel.position.set(-span * 0.32, pierH + 0.48, 0);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    g.add(lintel);

    const turfTop = new THREE.Mesh(track(new THREE.BoxGeometry(span + 1.1, 0.1, 0.78)), mossMat);
    turfTop.position.set(-span * 0.35, pierH + 0.74, 0);
    turfTop.receiveShadow = true;
    g.add(turfTop);

    // Hanging vines swaying beneath the aqueduct arch
    for (let k = 0; k < 5; k++) {
      const vine = new THREE.Mesh(vineLeafGeo, k % 2 === 0 ? foliageMid.material : foliageSun.material);
      vine.customDepthMaterial = k % 2 === 0 ? foliageMid.depthMaterial : foliageSun.depthMaterial;
      vine.position.set(-span * 0.45, pierH + 0.05 - k * 0.22, 0.36);
      vine.scale.setScalar(1.05 - k * 0.13);
      vine.castShadow = true;
      env.updateMatrixWorld();
      g.add(vine);
    }

    // Fallen arch stones resting in the meadow under the collapsed bay
    for (let f = 0; f < 3; f++) {
      const rubble = new THREE.Mesh(
        track(new THREE.BoxGeometry(0.62, 0.34, 0.56)),
        f % 2 === 0 ? sharedMaterials.trim : sharedMaterials.terracotta
      );
      rubble.position.set(span * 0.42 + f * 0.58, 0.16, (rand() - 0.5) * 0.9);
      rubble.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.4);
      rubble.castShadow = true;
      rubble.receiveShadow = true;
      g.add(rubble);
    }

    env.add(g);
  };

  for (let i = 0; i < 2; i++) {
    const spot = findSafeSpot(3.4, 3.85, 6.2, 21.0);
    if (spot) {
      const tangentYaw = Math.atan2(spot.x - cx, spot.z - cz) + Math.PI * 0.5 + (rand() - 0.5) * 0.4;
      buildRuinedAqueduct(spot.x, spot.z, tangentYaw);
    }
  }

  /* ---- 4. Displaced Meadow Flagstones & Low Ruined Parapet Walls -------- */
  const startPlat =
    level.platforms.find(
      (p) => level.start.x >= p.xMin && level.start.x <= p.xMax && level.start.z >= p.zMin && level.start.z <= p.zMax
    ) ?? level.platforms[0];

  const flagstoneCenters: Array<{ x: number; z: number }> = [];
  if (startPlat) {
    const pc = { x: (startPlat.xMin + startPlat.xMax) * 0.5, z: (startPlat.zMin + startPlat.zMax) * 0.5 };
    const gc = level.brokenGaps[0]
      ? {
          x: (level.brokenGaps[0].xMin + level.brokenGaps[0].xMax) * 0.5,
          z: (level.brokenGaps[0].zMin + level.brokenGaps[0].zMax) * 0.5,
        }
      : { x: pc.x + 1, z: pc.z };
    let dx = pc.x - gc.x;
    let dz = pc.z - gc.z;
    if (Math.abs(dx) >= Math.abs(dz)) dz = 0;
    else dx = 0;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const half = dx !== 0 ? (startPlat.xMax - startPlat.xMin) * 0.5 : (startPlat.zMax - startPlat.zMin) * 0.5;

    const slabGeoA = track(new THREE.BoxGeometry(0.92, 0.1, 0.62));
    const slabGeoB = track(new THREE.BoxGeometry(0.58, 0.09, 0.52));

    // Double-row irregular ruin pavement trailing from the approach into the meadow (like bottom-right of ref!)
    for (let row = 0; row < 9; row++) {
      for (const lane of [-0.46, 0.46]) {
        if (rand() < 0.16) continue;
        const along = half + 1.05 + row * 0.86 + (rand() - 0.5) * 0.14;
        const side = lane + Math.sin(row * 0.55) * 0.45 + (rand() - 0.5) * 0.12;
        const x = pc.x + dx * along - dz * side;
        const z = pc.z + dz * along + dx * side;
        if (inAnyPoolOrPlatform(x, z, 0.35)) continue;

        const tile = new THREE.Mesh(
          row % 3 === 1 ? slabGeoB : slabGeoA,
          (row + (lane > 0 ? 1 : 0)) % 2 === 0 ? sharedMaterials.stoneTop : sharedMaterials.stoneSide
        );
        tile.position.set(x, GROUND_Y + 0.05, z);
        tile.rotation.set((rand() - 0.5) * 0.05, Math.atan2(dx, dz) + (rand() - 0.5) * 0.24, (rand() - 0.5) * 0.05);
        tile.receiveShadow = true;
        tile.castShadow = true;
        env.add(tile);
        flagstoneCenters.push({ x, z });
      }
    }

    // Low weathered stone parapet wall flanking one side of the approach (like bottom-left of ref!)
    const wallSpot = findSafeSpot(2.2, 0.72, 2.2, 9.0, true);
    if (wallSpot) {
      const wg = new THREE.Group();
      wg.position.set(wallSpot.x, GROUND_Y, wallSpot.z);
      wg.rotation.y = (rand() - 0.5) * 1.1 + 0.55;
      addGroundAO(wallSpot.x, wallSpot.z, 4.6, 1.3);

      for (let seg = 0; seg < 4; seg++) {
        if (seg === 2) continue; // Deliberate crumbled gap in the old wall
        const sx = (seg - 1.5) * 1.05;
        const sh = 0.54 + (rand() - 0.5) * 0.12;
        const block = new THREE.Mesh(track(new THREE.BoxGeometry(0.98, sh, 0.48)), sharedMaterials.stoneSide);
        block.position.set(sx, sh * 0.5, 0);
        block.castShadow = true;
        block.receiveShadow = true;
        wg.add(block);

        const cap = new THREE.Mesh(track(new THREE.BoxGeometry(1.04, 0.1, 0.54)), sharedMaterials.stoneTop);
        cap.position.set(sx, sh + 0.05, 0);
        cap.castShadow = true;
        cap.receiveShadow = true;
        wg.add(cap);

        if (seg % 2 === 0) {
          const moss = new THREE.Mesh(track(new THREE.BoxGeometry(0.55, 0.05, 0.42)), mossMat);
          moss.position.set(sx + 0.1, sh + 0.11, 0.04);
          moss.receiveShadow = true;
          wg.add(moss);
        }
      }
      env.add(wg);
    }
  }

  /* ---- 5. Sculptural Animated Multi-Canopy Trees & Meadow Shrubs -------- */
  const trunkMat = track(
    new THREE.MeshStandardMaterial({
      color: '#7A5B3E',
      roughness: 0.92,
      metalness: 0.0,
    })
  );

  const swayingTrees: Array<{ group: THREE.Group; phase: number; amp: number }> = [];
  const treeCount = quality === 'low' ? 8 : 14;

  for (let i = 0; i < treeCount; i++) {
    const scale = 0.88 + rand() * 0.62;
    const totalTreeH = 6.35 * scale;
    const spot = findSafeSpot(2.35 * scale, totalTreeH, 7.5, 28.0);
    if (!spot) continue;

    const tg = new THREE.Group();
    tg.position.set(spot.x, GROUND_Y, spot.z);
    tg.scale.setScalar(scale);
    addGroundAO(spot.x, spot.z, 3.6 * scale, 3.6 * scale);

    // Root-flared trunk + two angled boughs
    const trunk = new THREE.Mesh(track(new THREE.CylinderGeometry(0.2, 0.38, 2.3, 7)), trunkMat);
    trunk.position.y = 1.15;
    trunk.rotation.z = (rand() - 0.5) * 0.08;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tg.add(trunk);

    const boughGeo = track(new THREE.CylinderGeometry(0.1, 0.17, 1.25, 6));
    for (const side of [-1, 1]) {
      const bough = new THREE.Mesh(boughGeo, trunkMat);
      bough.position.set(side * 0.36, 2.25, (rand() - 0.5) * 0.25);
      bough.rotation.z = -side * 0.48;
      bough.castShadow = true;
      tg.add(bough);
    }

    // 5 sculpted overlapping foliage puffs with live GPU wind-rustle + shadow casting!
    const crownSpecs: Array<[number, number, number, number, typeof foliageDeep]> = [
      [0, 3.35, 0, 1.48, foliageMid],
      [-0.85, 2.95, 0.35, 1.12, foliageDeep],
      [0.88, 3.05, -0.28, 1.16, foliageMid],
      [-0.25, 3.95, -0.22, 1.08, foliageSun],
      [0.35, 3.72, 0.48, 0.98, foliageSun],
    ];
    for (const [lx, ly, lz, lr, fSet] of crownSpecs) {
      const puff = new THREE.Mesh(leafPuffGeo, fSet.material);
      puff.customDepthMaterial = fSet.depthMaterial;
      puff.position.set(lx, ly, lz);
      puff.scale.set(lr * 1.12, lr * 0.86, lr * 1.06);
      puff.rotation.set(rand(), rand(), rand());
      puff.castShadow = true;
      puff.receiveShadow = true;
      tg.add(puff);
    }

    env.add(tg);
    swayingTrees.push({ group: tg, phase: rand() * Math.PI * 2, amp: 0.016 + rand() * 0.01 });
  }

  // Low rounded meadow shrubs & ruin bushes (H <= 0.95, safe close to ruins & approaches!)
  const shrubCount = quality === 'low' ? 10 : 18;
  for (let s = 0; s < shrubCount; s++) {
    const spot = findSafeSpot(0.75, 0.95, 1.9, 17.5);
    if (!spot) continue;
    const sg = new THREE.Group();
    sg.position.set(spot.x, GROUND_Y, spot.z);
    addGroundAO(spot.x, spot.z, 1.5, 1.5);
    for (let k = 0; k < 3; k++) {
      const fSet = k === 0 ? foliageDeep : k === 1 ? foliageMid : foliageSun;
      const puff = new THREE.Mesh(leafPuffGeo, fSet.material);
      puff.customDepthMaterial = fSet.depthMaterial;
      const r = (0.42 - k * 0.06) * (0.85 + rand() * 0.35);
      puff.position.set((rand() - 0.5) * 0.45, r * 0.72, (rand() - 0.5) * 0.45);
      puff.scale.set(r * 1.25, r * 0.88, r * 1.15);
      puff.castShadow = true;
      puff.receiveShadow = true;
      sg.add(puff);
    }
    env.add(sg);
  }

  /* ---- 6. GPU-Instanced Wind-Animated 3D Grass Meadow & Wildflowers ----- */
  const bladeCount = quality === 'low' ? 3600 : quality === 'medium' ? 9000 : 18000;
  const bladeGeo = track(createGrassBladeGeometry());
  const bladeMat = track(createWindGrassMaterial(palette.grassDeep, palette.grassLight, natureUniforms));
  const grassMesh = new THREE.InstancedMesh(bladeGeo, bladeMat, bladeCount);
  grassMesh.receiveShadow = true;
  grassMesh.castShadow = false; // Keeps play-area shadows crisp & saves mobile fillrate

  const dummy = new THREE.Object3D();
  let placedBlades = 0;

  // Cluster 30% of blades around ruins, platform footings & flagstones for lush grounding, 70% in organic meadow patches
  const anchors = [
    ...occupied.map((o) => ({ x: o.x, z: o.z, spread: o.r + 1.1 })),
    ...flagstoneCenters.map((f) => ({ x: f.x, z: f.z, spread: 0.95 })),
  ];

  for (let i = 0; i < bladeCount * 2 && placedBlades < bladeCount; i++) {
    let gx = 0;
    let gz = 0;
    if (anchors.length > 0 && placedBlades < bladeCount * 0.36) {
      const a = anchors[placedBlades % anchors.length];
      const ang = rand() * Math.PI * 2;
      const rr = a.spread * (0.55 + rand() * 0.85);
      gx = a.x + Math.cos(ang) * rr;
      gz = a.z + Math.sin(ang) * rr;
    } else {
      const ang = rand() * Math.PI * 2;
      const dist = 1.2 + Math.pow(rand(), 0.9) * 26.0;
      gx = cx + Math.cos(ang) * dist;
      gz = cz + Math.sin(ang) * dist;
    }

    if (inAnyPoolOrPlatform(gx, gz, 0.22)) continue;

    const h = 0.13 + rand() * 0.19;
    const w = 0.7 + rand() * 0.42;
    dummy.position.set(gx, GROUND_Y, gz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(placedBlades++, dummy.matrix);
  }
  grassMesh.count = placedBlades;
  grassMesh.instanceMatrix.needsUpdate = true;
  env.add(grassMesh);

  // Swaying 3D Wildflowers (pink, lilac, and cream blossoms matching the reference meadow!)
  const flowerCount = quality === 'low' ? 160 : quality === 'medium' ? 320 : 520;
  const flowerGeo = track(createWildflowerGeometry());
  const flowerMat = track(createWildflowerMaterial(palette.grassDeep, natureUniforms));
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  flowerMesh.receiveShadow = true;

  const blossomPalette = [palette.petal, '#D8A6EA', '#FFF4F8', '#F7B7DC'];
  const fColor = new THREE.Color();
  let placedFlowers = 0;

  for (let i = 0; i < flowerCount * 3 && placedFlowers < flowerCount; i++) {
    // Cluster wildflowers into natural drifts
    const patchSeed = Math.floor(placedFlowers / 8);
    const patchAng = (patchSeed * 2.39996) % (Math.PI * 2);
    const patchDist = 3.5 + ((patchSeed * 1.73) % 24.0);
    const px = cx + Math.cos(patchAng) * patchDist + (rand() - 0.5) * 2.4;
    const pz = cz + Math.sin(patchAng) * patchDist + (rand() - 0.5) * 2.4;

    if (inAnyPoolOrPlatform(px, pz, 0.35)) continue;

    const s = 0.42 + rand() * 0.34;
    dummy.position.set(px, GROUND_Y, pz);
    dummy.rotation.set(0, rand() * Math.PI * 2, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    flowerMesh.setMatrixAt(placedFlowers, dummy.matrix);
    flowerMesh.setColorAt(placedFlowers, fColor.set(blossomPalette[placedFlowers % blossomPalette.length]));
    placedFlowers++;
  }
  flowerMesh.count = placedFlowers;
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  env.add(flowerMesh);

  /* ---- 7. Fluttering Meadow Butterflies --------------------------------- */
  const wingGeo = track(new THREE.PlaneGeometry(0.13, 0.16));
  wingGeo.translate(0.065, 0, 0);
  const butterflyMat = track(
    new THREE.MeshBasicMaterial({
      color: '#FFF5FA',
      side: THREE.DoubleSide,
    })
  );
  const butterflies: Array<{
    root: THREE.Group;
    left: THREE.Mesh;
    right: THREE.Mesh;
    homeX: number;
    homeZ: number;
    phase: number;
  }> = [];

  for (let b = 0; b < 4; b++) {
    const bg = new THREE.Group();
    const lw = new THREE.Mesh(wingGeo, butterflyMat);
    lw.rotation.x = Math.PI * 0.5;
    const rw = new THREE.Mesh(wingGeo, butterflyMat);
    rw.rotation.x = Math.PI * 0.5;
    rw.scale.x = -1;
    bg.add(lw, rw);
    const a = (b / 4) * Math.PI * 2 + 0.6;
    const dist = planRadius + 3.2 + b * 1.4;
    env.add(bg);
    butterflies.push({
      root: bg,
      left: lw,
      right: rw,
      homeX: cx + Math.cos(a) * dist,
      homeZ: cz + Math.sin(a) * dist,
      phase: b * 1.9,
    });
  }

  /* ---- 8. Physical Water Splash FX when Ball Falls into Chasm ----------- */
  const splashRingGeo = track(new THREE.RingGeometry(0.22, 0.3, 28).rotateX(-Math.PI / 2));
  const splashDropGeo = track(new THREE.SphereGeometry(0.055, 8, 6));
  const splashMat = track(
    new THREE.MeshBasicMaterial({
      color: palette.waterFoam,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  );
  const splashRing = new THREE.Mesh(splashRingGeo, splashMat);
  splashRing.visible = false;
  env.add(splashRing);

  const splashDrops: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number }> = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(splashDropGeo, splashMat);
    m.visible = false;
    env.add(m);
    splashDrops.push({ mesh: m, vx: 0, vy: 0, vz: 0 });
  }
  let splashLife = -1;
  const splashOrigin = new THREE.Vector3();

  return {
    triggerSplash(x: number, z: number) {
      // Trigger splash if impact point lies near or inside any water pool
      const nearWater = pools.some((p) => distPointToBox2D(x, z, p) < 0.8);
      if (!nearWater) return;
      splashOrigin.set(x, GROUND_Y + 0.15, z);
      splashLife = 0;
      splashRing.position.copy(splashOrigin);
      splashRing.scale.setScalar(1);
      splashRing.visible = true;
      splashDrops.forEach((d, idx) => {
        const a = (idx / splashDrops.length) * Math.PI * 2 + Math.random() * 0.3;
        const spd = 1.1 + Math.random() * 1.2;
        d.vx = Math.cos(a) * spd;
        d.vz = Math.sin(a) * spd;
        d.vy = 2.8 + Math.random() * 1.6;
        d.mesh.position.copy(splashOrigin);
        d.mesh.visible = true;
      });
    },

    update(tSec: number, dt: number) {
      // Update global wind & water uniforms (animates 3D grass, wildflowers, tree leaves, vines & water!)
      natureUniforms.uTime.value = tSec;
      natureUniforms.uWindStrength.value = 0.85 + Math.sin(tSec * 0.42) * 0.25;

      // Compound gentle tree trunk & bough sway in sync with wind gusts
      for (const tr of swayingTrees) {
        const gust = Math.sin(tSec * 1.25 + tr.phase) * 0.7 + Math.sin(tSec * 2.3 + tr.phase * 1.7) * 0.3;
        tr.group.rotation.z = gust * tr.amp;
        tr.group.rotation.x = Math.cos(tSec * 0.95 + tr.phase) * tr.amp * 0.55;
      }

      // Animate sunken octagonal fountain spout, droplets & expanding concentric foam rings
      if (fountainDome) {
        const pulse = 1.0 + Math.sin(tSec * 6.2) * 0.14;
        fountainDome.scale.set(pulse, 0.85 + Math.cos(tSec * 7.5) * 0.18, pulse);
      }
      for (const fd of fountainDrops) {
        const u = (tSec * 1.35 + fd.phase) % 1;
        const x = fd.origin.x + fd.vx * u;
        const z = fd.origin.z + fd.vz * u;
        const y = fd.origin.y + (1.45 * u - 2.6 * u * u);
        fd.mesh.position.set(x, Math.max(GROUND_Y + 0.34, y), z);
        fd.mesh.scale.setScalar((1 - u * 0.65) * 0.95);
      }
      for (const fr of fountainRipples) {
        const u = (tSec * 0.52 + fr.phase) % 1;
        const s = 0.5 + u * fr.maxR;
        fr.mesh.scale.setScalar(s);
        fr.mat.opacity = (1 - u) * 0.62;
      }

      // Animate fluttering butterflies
      for (const bf of butterflies) {
        const t = tSec * 0.85 + bf.phase;
        const nx = bf.homeX + Math.sin(t * 1.3) * 1.65;
        const nz = bf.homeZ + Math.cos(t * 0.95) * 1.45;
        const dx = Math.cos(t * 1.3) * 1.3 * 1.65;
        const dz = -Math.sin(t * 0.95) * 0.95 * 1.45;
        bf.root.position.set(nx, GROUND_Y + 0.58 + Math.sin(t * 3.1) * 0.22, nz);
        bf.root.rotation.y = Math.atan2(dx, dz);
        const flap = Math.sin(tSec * 17.0 + bf.phase) * 0.85;
        bf.left.rotation.y = flap;
        bf.right.rotation.y = -flap;
      }

      // Animate physical water splash when sphere falls into flooded gap
      if (splashLife >= 0) {
        splashLife += dt;
        const p = splashLife / 0.65;
        if (p >= 1) {
          splashLife = -1;
          splashRing.visible = false;
          for (const d of splashDrops) d.mesh.visible = false;
        } else {
          splashRing.scale.setScalar(1 + p * 3.4);
          splashMat.opacity = (1 - p) * 0.88;
          for (const d of splashDrops) {
            d.vy -= 12.5 * dt;
            d.mesh.position.x += d.vx * dt;
            d.mesh.position.y += d.vy * dt;
            d.mesh.position.z += d.vz * dt;
            d.mesh.scale.setScalar(1 - p * 0.7);
            if (d.mesh.position.y < GROUND_Y + 0.12) d.mesh.visible = false;
          }
        }
      }
    },
  };
}
