import { useCallback, useEffect, useRef, useState } from 'react';
import type { LevelData, Vec2, Vec3 } from '../game/types';
import {
  isCrystalEclipsed,
  isGapBridged,
  outlineOf,
  projectBoxShadowToPlane,
  projectOutlineShadowToPlane,
  rampHeightAt,
  sunShadowOffsetPerHeight,
} from '../game/shadowMath';

/* ------------------------------------------------------------------ model */

export type Edge = 'north' | 'south' | 'east' | 'west';
export type Variant = 'terracotta' | 'ochre' | 'slate' | 'trim';

export interface PlatformItem {
  id: string;
  name: string;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  style: 'main' | 'island' | 'pedestal';
  brokenEdges: Edge[];
  /** Optional outline (world space). Present for polygons; rects derive corners on demand. */
  points?: Vec2[];
  /** Yaw in radians about the object centre. Preserved across edits/rotation. */
  yaw?: number;
  /** Elevation of the stone's top surface in world units (default 0). */
  y?: number;
}

export interface BoxItem {
  id: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  variant: Variant;
  castsUmbra: boolean;
  /** Yaw in radians about the part's own centre. */
  yaw?: number;
}

export interface PillarItem {
  id: string;
  label: string;
  parts: BoxItem[];
}

export interface GapItem {
  id: string;
  name: string;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Yaw in radians about the span centre. */
  yaw?: number;
  /** Elevation of the bridging slab plane (default 0). Shadow bridges this span on its own plane. */
  y?: number;
}

export interface CrystalItem {
  id: string;
  x: number;
  z: number;
  radius: number;
  /** Elevation of the crystal pedestal (default 0). */
  y?: number;
}

export interface RampItem {
  id: string;
  name: string;
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Yaw in radians; the ramp ascends along its local +Z axis. */
  yaw: number;
  /** Horizontal length along the ascend axis. */
  length: number;
  /** Horizontal width across the ascend axis. */
  width: number;
  /** Elevation of the low edge (world y). */
  y: number;
  /** Height gained from the low edge to the high edge. */
  rise: number;
}

export interface Doc {
  meta: {
    id: string;
    chapter: number;
    title: string;
    subtitle: string;
    prompt: string;
    hint: string;
  };
  platforms: PlatformItem[];
  pillars: PillarItem[];
  gaps: GapItem[];
  crystals: CrystalItem[];
  /** Slope walkways the sphere can roll up and down between terraces. */
  ramps?: RampItem[];
  start: Vec2;
  goal: Vec2;
  sun: { maxRadius: number; y: number; shadowRatio: number; azimuth: number };
  camera: { ox: number; oy: number; oz: number; lx: number; ly: number; lz: number };
}

export const GRID_SIZES = [0.05, 0.1, 0.25, 0.5, 1] as const;

let seq = 0;
export const uid = (p = 'x') => `${p}${(++seq).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
export const round = (v: number, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;
export const snapVal = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v);

export const orbitRadiusOf = (d: Doc) => d.sun.maxRadius * 0.78;

/** Azimuth is a compass bearing: 0 = north (far -z, up the plan), 90 = east. */
export function sunPoint(d: Doc, azimuthDeg = d.sun.azimuth): Vec2 {
  const r = orbitRadiusOf(d);
  const a = (azimuthDeg * Math.PI) / 180;
  return { x: Math.sin(a) * r, z: -Math.cos(a) * r };
}

export function azimuthOf(x: number, z: number): number {
  return ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;
}

export function emptyDoc(): Doc {
  return {
    meta: {
      id: uid('lvl-'),
      chapter: 1,
      title: 'Untitled Study',
      subtitle: 'Shadow exercise',
      prompt: 'Aim the light so a shadow bridges the void, then roll across.',
      hint: '',
    },
    platforms: [
      {
        id: uid('p'),
        name: 'West court',
        xMin: -5.5,
        xMax: -2,
        zMin: -1.8,
        zMax: 1.8,
        style: 'main',
        brokenEdges: ['east'],
      },
      {
        id: uid('p'),
        name: 'East court',
        xMin: 2,
        xMax: 5.5,
        zMin: -1.8,
        zMax: 1.8,
        style: 'main',
        brokenEdges: ['west'],
      },
    ],
    pillars: [
      {
        id: uid('pil'),
        label: 'Obelisk',
        parts: [
          {
            id: uid('b'),
            xMin: -3.1,
            xMax: -2.3,
            yMin: 0,
            yMax: 3.6,
            zMin: -0.65,
            zMax: 0.65,
            variant: 'terracotta',
            castsUmbra: true,
          },
        ],
      },
    ],
    gaps: [
      {
        id: uid('g'),
        name: 'Span A',
        xMin: -2,
        xMax: 2,
        zMin: -0.9,
        zMax: 0.9,
        ax: -3.4,
        az: 0,
        bx: 2.6,
        bz: 0,
      },
    ],
    crystals: [],
    start: { x: -4.4, z: 0 },
    goal: { x: 4.2, z: 0 },
    sun: { maxRadius: 8.8, y: 5.6, shadowRatio: 1.25, azimuth: 245 },
    camera: { ox: 2.2, oy: 17.5, oz: 14.5, lx: 0, ly: 1.25, lz: -0.2 },
  };
}

export function docFromLevel(src: LevelData): Doc {
  return {
    meta: {
      id: src.id || uid('lvl-'),
      chapter: src.number,
      title: src.title,
      subtitle: src.subtitle,
      prompt: src.prompt,
      hint: src.hint,
    },
    platforms: src.platforms.map((p) => ({
      id: p.id || uid('p'),
      name: p.id,
      xMin: p.xMin,
      xMax: p.xMax,
      zMin: p.zMin,
      zMax: p.zMax,
      style: p.style ?? 'main',
      brokenEdges: p.brokenEdges ?? [],
      points: p.points ? p.points.map((v) => ({ x: v.x, z: v.z })) : undefined,
      y: p.y,
    })),
    pillars: src.pillars.map((s) => ({
      id: s.id || uid('pil'),
      label: s.label ?? 'Monolith',
      parts: s.parts.map((b) => ({
        id: uid('b'),
        xMin: b.xMin,
        xMax: b.xMax,
        yMin: b.yMin,
        yMax: b.yMax,
        zMin: b.zMin,
        zMax: b.zMax,
        variant: b.variant ?? 'terracotta',
        castsUmbra: b.castsUmbra !== false,
        yaw: b.yaw,
      })),
    })),
    gaps: src.brokenGaps.map((g) => ({
      id: g.id || uid('g'),
      name: g.id,
      xMin: g.xMin,
      xMax: g.xMax,
      zMin: g.zMin,
      zMax: g.zMax,
      ax: g.anchorA.x,
      az: g.anchorA.z,
      bx: g.anchorB.x,
      bz: g.anchorB.z,
      y: g.y,
    })),
    crystals: (src.sunCrystals ?? []).map((c) => ({
      id: c.id || uid('c'),
      x: c.x,
      z: c.z,
      radius: c.radius,
      y: c.y,
    })),
    ramps: (src.ramps ?? []).map((r) => ({
      id: r.id || uid('r'),
      name: r.id || 'Ramp',
      x: r.x,
      z: r.z,
      yaw: r.yaw,
      length: r.length,
      width: r.width,
      y: r.y,
      rise: r.rise,
    })),
    start: { ...src.start },
    goal: { ...src.goal },
    sun: {
      maxRadius: src.lightBounds.maxRadius,
      y: src.lightBounds.y,
      shadowRatio: src.lightBounds.shadowRatio,
      azimuth: azimuthOf(src.lightInitial.x, src.lightInitial.z),
    },
    camera: {
      ox: src.camera.offset.x,
      oy: src.camera.offset.y,
      oz: src.camera.offset.z,
      lx: src.camera.lookAt.x,
      ly: src.camera.lookAt.y,
      lz: src.camera.lookAt.z,
    },
  };
}

export function toLevelData(doc: Doc): LevelData {
  const sp = sunPoint(doc);
  return {
    id: doc.meta.id,
    number: doc.meta.chapter,
    title: doc.meta.title,
    subtitle: doc.meta.subtitle,
    prompt: doc.meta.prompt,
    hint: doc.meta.hint || 'No note recorded for this chapter.',
    platforms: doc.platforms.map((p) => ({
      id: p.id,
      xMin: round(p.xMin),
      xMax: round(p.xMax),
      zMin: round(p.zMin),
      zMax: round(p.zMax),
      style: p.style,
      brokenEdges: p.brokenEdges.length ? p.brokenEdges : undefined,
      points: p.points && p.points.length >= 3
        ? p.points.map((v) => ({ x: round(v.x), z: round(v.z) }))
        : undefined,
      y: p.y,
    })),
    pillars: doc.pillars.map((s) => ({
      id: s.id,
      label: s.label,
      parts: s.parts.map((b) => ({
        xMin: round(b.xMin),
        xMax: round(b.xMax),
        yMin: round(b.yMin),
        yMax: round(b.yMax),
        zMin: round(b.zMin),
        zMax: round(b.zMax),
        variant: b.variant,
        castsUmbra: b.castsUmbra,
        yaw: b.yaw,
      })),
    })),
    brokenGaps: doc.gaps.map((g) => ({
      id: g.id,
      xMin: round(g.xMin),
      xMax: round(g.xMax),
      zMin: round(g.zMin),
      zMax: round(g.zMax),
      anchorA: { x: round(g.ax), z: round(g.az) },
      anchorB: { x: round(g.bx), z: round(g.bz) },
      y: g.y,
    })),
    ramps: doc.ramps && doc.ramps.length
      ? doc.ramps.map((r) => ({
          id: r.id,
          x: round(r.x),
          z: round(r.z),
          yaw: round(r.yaw),
          length: round(r.length),
          width: round(r.width),
          y: round(r.y),
          rise: round(r.rise),
        }))
      : undefined,
    sunCrystals: doc.crystals.length
      ? doc.crystals.map((c) => ({ id: c.id, x: round(c.x), z: round(c.z), radius: c.radius, y: c.y }))
      : undefined,
    start: { x: round(doc.start.x), z: round(doc.start.z), y: doc.start.y === undefined ? undefined : round(doc.start.y) },
    goal: { x: round(doc.goal.x), z: round(doc.goal.z), y: doc.goal.y === undefined ? undefined : round(doc.goal.y) },
    lightInitial: { x: round(sp.x), y: doc.sun.y, z: round(sp.z) },
    lightBounds: {
      maxRadius: doc.sun.maxRadius,
      y: doc.sun.y,
      shadowRatio: doc.sun.shadowRatio,
    },
    camera: {
      offset: { x: doc.camera.ox, y: doc.camera.oy, z: doc.camera.oz },
      lookAt: { x: doc.camera.lx, y: doc.camera.ly, z: doc.camera.lz },
    },
  };
}

/* ------------------------------------------------------------- geometry */

export interface Rect {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export const norm = (r: Rect): Rect => ({
  xMin: Math.min(r.xMin, r.xMax),
  xMax: Math.max(r.xMin, r.xMax),
  zMin: Math.min(r.zMin, r.zMax),
  zMax: Math.max(r.zMin, r.zMax),
});

export const pad = (r: Rect, p: number): Rect => ({
  xMin: r.xMin - p,
  xMax: r.xMax + p,
  zMin: r.zMin - p,
  zMax: r.zMax + p,
});

/** Outline of a platform: explicit polygon points, or the four rect corners. */
export function platformOutline(p: {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  points?: Vec2[];
}): Vec2[] {
  if (p.points && p.points.length >= 3) return p.points;
  return [
    { x: p.xMin, z: p.zMin },
    { x: p.xMax, z: p.zMin },
    { x: p.xMax, z: p.zMax },
    { x: p.xMin, z: p.zMax },
  ];
}

/** Axis-aligned bounds of any point set. */
export function polyBounds(points: Vec2[]): Rect {
  let xMin = Infinity;
  let xMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of points) {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    zMin = Math.min(zMin, p.z);
    zMax = Math.max(zMax, p.z);
  }
  return { xMin, xMax, zMin, zMax };
}

/** Regular n-gon point ring, rotated so it sits flat and readable on the sheet. */
export function regularPolygon(cx: number, cz: number, radius: number, sides: number, rotation = Math.PI / 2): Vec2[] {
  const n = Math.max(3, Math.min(24, Math.round(sides)));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i / n) * Math.PI * 2;
    out.push({ x: round(cx + Math.cos(a) * radius), z: round(cz + Math.sin(a) * radius) });
  }
  return out;
}

export function pointInPolygon(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a * 0.5);
}

/** Centre used for rotation and scaling for each selection kind. */
export function selectionCenter(doc: Doc, kind: string, id: string): Vec2 | null {
  if (kind === 'platform') {
    const p = doc.platforms.find((v) => v.id === id);
    if (!p) return null;
    const pts = platformOutline(p);
    let x = 0;
    let z = 0;
    for (const v of pts) {
      x += v.x;
      z += v.z;
    }
    return { x: x / pts.length, z: z / pts.length };
  }
  if (kind === 'gap') {
    const g = doc.gaps.find((v) => v.id === id);
    return g ? centerOf(norm(g)) : null;
  }
  if (kind === 'crystal') {
    const c = doc.crystals.find((v) => v.id === id);
    return c ? { x: c.x, z: c.z } : null;
  }
  if (kind === 'ramp') {
    const r = (doc.ramps ?? []).find((v) => v.id === id);
    return r ? { x: r.x, z: r.z } : null;
  }
  if (kind === 'part' || kind === 'pillar') {
    for (const st of doc.pillars) {
      const boxes = kind === 'pillar' ? st.parts : st.parts.filter((b) => b.id === id);
      if (kind === 'pillar' && st.id !== id) continue;
      if (boxes.length === 0) continue;
      let xMin = Infinity;
      let xMax = -Infinity;
      let zMin = Infinity;
      let zMax = -Infinity;
      for (const b of boxes) {
        xMin = Math.min(xMin, b.xMin);
        xMax = Math.max(xMax, b.xMax);
        zMin = Math.min(zMin, b.zMin);
        zMax = Math.max(zMax, b.zMax);
      }
      return { x: (xMin + xMax) / 2, z: (zMin + zMax) / 2 };
    }
  }
  return null;
}

/**
 * Rotates any object in place about its own centre.
 * Platform stones and spans become true rotated outlines; casters gain a
 * per-part yaw that the shadow projector already understands.
 */
export function rotateDocObject(base: Doc, kind: string, id: string, angle: number): Doc {
  const center = selectionCenter(base, kind, id);
  if (!center) return base;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rot = (v: Vec2): Vec2 => ({
    x: center.x + (v.x - center.x) * cos - (v.z - center.z) * sin,
    z: center.z + (v.x - center.x) * sin + (v.z - center.z) * cos,
  });

  if (kind === 'platform') {
    return {
      ...base,
      platforms: base.platforms.map((p) => {
        if (p.id !== id) return p;
        const pts = platformOutline(p).map(rot);
        const bb = polyBounds(pts);
        return { ...p, points: pts, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax, yaw: (p.yaw ?? 0) + angle };
      }),
    };
  }

  if (kind === 'gap') {
    return {
      ...base,
      gaps: base.gaps.map((g) => {
        if (g.id !== id) return g;
        const bb = polyBounds(
          [
            { x: g.xMin, z: g.zMin },
            { x: g.xMax, z: g.zMin },
            { x: g.xMax, z: g.zMax },
            { x: g.xMin, z: g.zMax },
          ].map(rot)
        );
        const a = rot({ x: g.ax, z: g.az });
        const b = rot({ x: g.bx, z: g.bz });
        return { ...g, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax, ax: a.x, az: a.z, bx: b.x, bz: b.z, yaw: (g.yaw ?? 0) + angle };
      }),
    };
  }

  if (kind === 'ramp') {
    return {
      ...base,
      ramps: (base.ramps ?? []).map((r) => (r.id === id ? { ...r, yaw: r.yaw + angle } : r)),
    };
  }

  if (kind === 'part' || kind === 'pillar') {
    return {
      ...base,
      pillars: base.pillars.map((st) => {
        if (kind === 'pillar' ? st.id !== id : !st.parts.some((b) => b.id === id)) return st;
        return {
          ...st,
          parts: st.parts.map((b) => {
            const c = { x: (b.xMin + b.xMax) / 2, z: (b.zMin + b.zMax) / 2 };
            const m = rot(c);
            const w = b.xMax - b.xMin;
            const d = b.zMax - b.zMin;
            return { ...b, xMin: m.x - w / 2, xMax: m.x + w / 2, zMin: m.z - d / 2, zMax: m.z + d / 2, yaw: (b.yaw ?? 0) + angle };
          }),
        };
      }),
    };
  }

  return base;
}

/** Shifts any selectable object by a world-space delta. */
export function moveDocObject(base: Doc, kind: string, id: string, dx: number, dz: number): Doc {
  if (kind === 'platform') {
    return {
      ...base,
      platforms: base.platforms.map((p) => {
        if (p.id !== id) return p;
        return {
          ...p,
          xMin: p.xMin + dx,
          xMax: p.xMax + dx,
          zMin: p.zMin + dz,
          zMax: p.zMax + dz,
          points: p.points ? p.points.map((v) => ({ x: v.x + dx, z: v.z + dz })) : undefined,
        };
      }),
    };
  }
  if (kind === 'gap') {
    return {
      ...base,
      gaps: base.gaps.map((g) =>
        g.id !== id
          ? g
          : {
              ...g,
              xMin: g.xMin + dx,
              xMax: g.xMax + dx,
              zMin: g.zMin + dz,
              zMax: g.zMax + dz,
              ax: g.ax + dx,
              az: g.az + dz,
              bx: g.bx + dx,
              bz: g.bz + dz,
            }
      ),
    };
  }
  if (kind === 'part') {
    return {
      ...base,
      pillars: base.pillars.map((s) => ({
        ...s,
        parts: s.parts.map((b) =>
          b.id !== id ? b : { ...b, xMin: b.xMin + dx, xMax: b.xMax + dx, zMin: b.zMin + dz, zMax: b.zMax + dz }
        ),
      })),
    };
  }
  if (kind === 'pillar') {
    return {
      ...base,
      pillars: base.pillars.map((s) =>
        s.id !== id
          ? s
          : {
              ...s,
              parts: s.parts.map((b) => ({ ...b, xMin: b.xMin + dx, xMax: b.xMax + dx, zMin: b.zMin + dz, zMax: b.zMax + dz })),
            }
      ),
    };
  }
  if (kind === 'crystal') {
    return {
      ...base,
      crystals: base.crystals.map((c) => (c.id === id ? { ...c, x: c.x + dx, z: c.z + dz } : c)),
    };
  }
  if (kind === 'ramp') {
    return {
      ...base,
      ramps: (base.ramps ?? []).map((r) => (r.id === id ? { ...r, x: r.x + dx, z: r.z + dz } : r)),
    };
  }
  if (kind === 'start' || kind === 'goal') {
    return { ...base, [kind]: { x: base[kind].x + dx, z: base[kind].z + dz } } as Doc;
  }
  if (kind === 'sun') {
    const sp = sunPoint(base);
    const nx = sp.x + dx;
    const nz = sp.z + dz;
    if (Math.hypot(nx, nz) < 1e-6) return base;
    return { ...base, sun: { ...base.sun, azimuth: azimuthOf(nx, nz) } };
  }
  return base;
}

export interface OptionalVec3 {
  x: number | null;
  y: number | null;
  z: number | null;
}

export interface ObjectTransform {
  kind: SelectionKind | 'sun';
  id: string;
  name: string;
  kindLabel: string;
  position: Vec3;
  /** Degrees, or null when yaw has no meaning for this object. */
  rotationDeg: number | null;
  /** World-space dimensions. Null cells are not applicable (yet editable objects never fail). */
  size: OptionalVec3;
  canMoveY: boolean;
  canRotate: boolean;
  canScaleX: boolean;
  canScaleY: boolean;
  canScaleZ: boolean;
}

const deg = (rad: number) => ((rad * 180) / Math.PI + 360) % 360;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const centerOfBox = (b: BoxItem): Vec3 => ({ x: (b.xMin + b.xMax) / 2, y: (b.yMin + b.yMax) / 2, z: (b.zMin + b.zMax) / 2 });
const boxSize = (b: BoxItem): Vec3 => ({ x: b.xMax - b.xMin, y: b.yMax - b.yMin, z: b.zMax - b.zMin });
const bboxOfBoxes = (boxes: BoxItem[]) => {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const b of boxes) {
    xMin = Math.min(xMin, b.xMin);
    xMax = Math.max(xMax, b.xMax);
    yMin = Math.min(yMin, b.yMin);
    yMax = Math.max(yMax, b.yMax);
    zMin = Math.min(zMin, b.zMin);
    zMax = Math.max(zMax, b.zMax);
  }
  return { xMin, xMax, yMin, yMax, zMin, zMax };
};
const firstPartYaw = (parts: BoxItem[]) => parts.find((b) => Number.isFinite(b.yaw))?.yaw ?? 0;
const nullMetrics = { size: { x: null, y: null, z: null }, canMoveY: false, canRotate: false, canScaleX: false, canScaleY: false, canScaleZ: false };

/** Everything the transform panel needs to describe a selection in world units/degrees. */
export function transformOf(doc: Doc, kind: string, id: string): ObjectTransform | null {
  if (kind === 'platform') {
    const p = doc.platforms.find((v) => v.id === id);
    if (!p) return null;
    const r = norm(p);
    return {
      kind: 'platform',
      id,
      name: p.name,
      kindLabel: 'Stone',
      position: { x: (r.xMin + r.xMax) / 2, y: p.y ?? 0, z: (r.zMin + r.zMax) / 2 },
      rotationDeg: deg(p.yaw ?? 0),
      size: { x: r.xMax - r.xMin, y: null, z: r.zMax - r.zMin },
      canMoveY: true,
      canRotate: true,
      canScaleX: true,
      canScaleY: false,
      canScaleZ: true,
    };
  }
  if (kind === 'gap') {
    const g = doc.gaps.find((v) => v.id === id);
    if (!g) return null;
    const r = norm(g);
    return {
      kind: 'gap',
      id,
      name: g.name,
      kindLabel: 'Broken span',
      position: { x: (r.xMin + r.xMax) / 2, y: g.y ?? 0, z: (r.zMin + r.zMax) / 2 },
      rotationDeg: deg(g.yaw ?? 0),
      size: { x: r.xMax - r.xMin, y: null, z: r.zMax - r.zMin },
      canMoveY: true,
      canRotate: true,
      canScaleX: true,
      canScaleY: false,
      canScaleZ: true,
    };
  }
  if (kind === 'part' || kind === 'pillar') {
    for (const s of doc.pillars) {
      if (kind === 'pillar' && s.id !== id) continue;
      const parts = kind === 'pillar' ? s.parts : s.parts.filter((b) => b.id === id);
      if (parts.length === 0) continue;
      const bb = bboxOfBoxes(parts);
      return {
        kind,
        id,
        name: kind === 'pillar' ? s.label : `${s.label} block`,
        kindLabel: kind === 'pillar' ? 'Caster' : 'Caster block',
        position: { x: (bb.xMin + bb.xMax) / 2, y: (bb.yMin + bb.yMax) / 2, z: (bb.zMin + bb.zMax) / 2 },
        rotationDeg: deg(firstPartYaw(parts)),
        size: { x: bb.xMax - bb.xMin, y: bb.yMax - bb.yMin, z: bb.zMax - bb.zMin },
        canMoveY: true,
        canRotate: true,
        canScaleX: true,
        canScaleY: true,
        canScaleZ: true,
      };
    }
    return null;
  }
  if (kind === 'crystal') {
    const c = doc.crystals.find((v) => v.id === id);
    if (!c) return null;
    return {
      kind: 'crystal',
      id,
      name: 'Sun crystal',
      kindLabel: 'Crystal',
      position: { x: c.x, y: c.y ?? 0, z: c.z },
      rotationDeg: null,
      size: { x: c.radius * 2, y: c.radius * 2, z: c.radius * 2 },
      canMoveY: true,
      canRotate: false,
      canScaleX: true,
      canScaleY: false,
      canScaleZ: true,
    };
  }
  if (kind === 'start' || kind === 'goal') {
    const p = doc[kind];
    return {
      kind,
      id: kind,
      name: kind === 'start' ? 'Sphere start' : 'Sanctuary goal',
      kindLabel: kind === 'start' ? 'Start' : 'Goal',
      position: { x: p.x, y: p.y ?? 0, z: p.z },
      rotationDeg: null,
      size: { x: null, y: null, z: null },
      canMoveY: true,
      canRotate: false,
      canScaleX: false,
      canScaleY: false,
      canScaleZ: false,
    };
  }
  if (kind === 'ramp') {
    const r = (doc.ramps ?? []).find((v) => v.id === id);
    if (!r) return null;
    return {
      kind: 'ramp',
      id,
      name: r.name,
      kindLabel: 'Walkway ramp',
      position: { x: r.x, y: r.y, z: r.z },
      rotationDeg: deg(r.yaw),
      size: { x: r.length, y: r.rise, z: r.width },
      canMoveY: true,
      canRotate: true,
      canScaleX: true,
      canScaleY: true,
      canScaleZ: true,
    };
  }
  if (kind === 'sun') {
    const sp = sunPoint(doc);
    return {
      kind: 'sun',
      id: 'sun',
      name: 'The light',
      kindLabel: 'Light',
      position: { x: sp.x, y: doc.sun.y, z: sp.z },
      rotationDeg: doc.sun.azimuth,
      ...nullMetrics,
    };
  }
  return null;
}

/** Set the world-space centre of any object. Sun X/Z steer its bearing instead of teleporting it. */
export function setObjectPosition(base: Doc, kind: string, id: string, pos: Partial<Vec3>): Doc {
  const info = transformOf(base, kind, id);
  if (!info) return base;
  let next = base;
  if (pos.x !== undefined || pos.z !== undefined) {
    next = moveDocObject(next, kind, id, (pos.x ?? info.position.x) - info.position.x, (pos.z ?? info.position.z) - info.position.z);
  }
  if (pos.y !== undefined) {
    const dy = pos.y - info.position.y;
    if (Math.abs(dy) > 1e-9) {
      if (kind === 'part' || kind === 'pillar') {
        next = {
          ...next,
          pillars: next.pillars.map((s) =>
            kind === 'pillar' && s.id !== id ? s : { ...s, parts: s.parts.map((b) => (kind === 'part' && b.id !== id ? b : { ...b, yMin: b.yMin + dy, yMax: b.yMax + dy })) }
          ),
        };
      } else if (kind === 'sun') {
        next = { ...next, sun: { ...next.sun, y: pos.y } };
      } else if (kind === 'platform') {
        next = { ...next, platforms: next.platforms.map((p) => (p.id === id ? { ...p, y: pos.y } : p)) };
      } else if (kind === 'gap') {
        next = { ...next, gaps: next.gaps.map((g) => (g.id === id ? { ...g, y: pos.y } : g)) };
      } else if (kind === 'crystal') {
        next = { ...next, crystals: next.crystals.map((c) => (c.id === id ? { ...c, y: pos.y } : c)) };
      } else if (kind === 'start' || kind === 'goal') {
        next = { ...next, [kind]: { ...next[kind], y: pos.y } } as Doc;
      } else if (kind === 'ramp') {
        next = { ...next, ramps: (next.ramps ?? []).map((r) => (r.id === id ? { ...r, y: pos.y ?? r.y } : r)) };
      }
    }
  }
  return next;
}

/** Rotate any object to an absolute yaw, in degrees. The light maps to sun azimuth. */
export function setObjectYaw(base: Doc, kind: string, id: string, yawDeg: number): Doc {
  if (kind === 'sun') return { ...base, sun: { ...base.sun, azimuth: ((yawDeg % 360) + 360) % 360 } };
  const info = transformOf(base, kind, id);
  if (!info || info.rotationDeg === null) return base;
  const delta = rad(yawDeg - info.rotationDeg);
  if (Math.abs(delta) < 1e-12) return base;
  return rotateDocObject(base, kind, id, delta);
}

const scaleBoxAround = (b: BoxItem, center: Vec3, sx: number, sy: number, sz: number): BoxItem => {
  const c = centerOfBox(b);
  const nc = {
    x: center.x + (c.x - center.x) * sx,
    y: center.y + (c.y - center.y) * sy,
    z: center.z + (c.z - center.z) * sz,
  };
  const s = boxSize(b);
  return {
    ...b,
    xMin: nc.x - (s.x * sx) / 2,
    xMax: nc.x + (s.x * sx) / 2,
    yMin: nc.y - (s.y * sy) / 2,
    yMax: nc.y + (s.y * sy) / 2,
    zMin: nc.z - (s.z * sz) / 2,
    zMax: nc.z + (s.z * sz) / 2,
  };
};

/** Set world-space dimensions in place. Platforms/spans scale X/Z; casters scale X/Y/Z; crystals scale radius uniformly. */
export function setObjectSize(base: Doc, kind: string, id: string, size: Partial<Vec3>): Doc {
  const info = transformOf(base, kind, id);
  if (!info) return base;
  const center = info.position;
  const cur = info.size;
  const sx = size.x !== undefined && cur.x ? size.x / cur.x : 1;
  const sz = size.z !== undefined && cur.z ? size.z / cur.z : 1;

  if (kind === 'platform') {
    return {
      ...base,
      platforms: base.platforms.map((p) => {
        if (p.id !== id) return p;
        if (p.points && p.points.length >= 3) {
          const pts = p.points.map((v) => ({ x: center.x + (v.x - center.x) * sx, z: center.z + (v.z - center.z) * sz }));
          const bb = polyBounds(pts);
          return { ...p, points: pts, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax };
        }
        const w = size.x ?? cur.x ?? 0;
        const d = size.z ?? cur.z ?? 0;
        return { ...p, xMin: center.x - w / 2, xMax: center.x + w / 2, zMin: center.z - d / 2, zMax: center.z + d / 2 };
      }),
    };
  }

  if (kind === 'gap') {
    return {
      ...base,
      gaps: base.gaps.map((g) =>
        g.id !== id
          ? g
          : {
              ...g,
              xMin: center.x + (g.xMin - center.x) * sx,
              xMax: center.x + (g.xMax - center.x) * sx,
              zMin: center.z + (g.zMin - center.z) * sz,
              zMax: center.z + (g.zMax - center.z) * sz,
              ax: center.x + (g.ax - center.x) * sx,
              az: center.z + (g.az - center.z) * sz,
              bx: center.x + (g.bx - center.x) * sx,
              bz: center.z + (g.bz - center.z) * sz,
            }
      ),
    };
  }

  if (kind === 'part' || kind === 'pillar') {
    if (kind === 'part') {
      return {
        ...base,
        pillars: base.pillars.map((s) => ({
          ...s,
          parts: s.parts.map((b) => {
            if (b.id !== id) return b;
            const ns = boxSize(b);
            const w = size.x ?? ns.x;
            const h = size.y ?? ns.y;
            const d = size.z ?? ns.z;
            const c = centerOfBox(b);
            return { ...b, xMin: c.x - w / 2, xMax: c.x + w / 2, yMin: c.y - h / 2, yMax: c.y + h / 2, zMin: c.z - d / 2, zMax: c.z + d / 2 };
          }),
        })),
      };
    }
    const cy = center.y;
    const sy = size.y !== undefined && cur.y ? size.y / cur.y : 1;
    return {
      ...base,
      pillars: base.pillars.map((s) =>
        s.id !== id ? s : { ...s, parts: s.parts.map((b) => scaleBoxAround(b, { x: center.x, y: cy, z: center.z }, sx, sy, sz)) }
      ),
    };
  }

  if (kind === 'crystal') {
    const nextDiameter = size.x ?? size.z;
    if (nextDiameter === undefined) return base;
    return {
      ...base,
      crystals: base.crystals.map((c) => (c.id === id ? { ...c, radius: Math.max(0.05, nextDiameter / 2) } : c)),
    };
  }

  if (kind === 'ramp') {
    return {
      ...base,
      ramps: (base.ramps ?? []).map((r) =>
        r.id === id
          ? {
              ...r,
              length: Math.max(0.6, size.x ?? r.length),
              rise: Math.max(0.05, size.y ?? r.rise),
              width: Math.max(0.75, size.z ?? r.width),
            }
          : r
      ),
    };
  }

  return base;
}

/** Deletes any object by kind and id, cleaning up empty caster groups. */
export function deleteDocObject(base: Doc, kind: string, id: string): Doc {
  if (kind === 'platform') return { ...base, platforms: base.platforms.filter((p) => p.id !== id) };
  if (kind === 'gap') return { ...base, gaps: base.gaps.filter((g) => g.id !== id) };
  if (kind === 'crystal') return { ...base, crystals: base.crystals.filter((c) => c.id !== id) };
  if (kind === 'ramp') return { ...base, ramps: (base.ramps ?? []).filter((r) => r.id !== id) };
  if (kind === 'part') {
    return {
      ...base,
      pillars: base.pillars
        .map((s) => ({ ...s, parts: s.parts.filter((b) => b.id !== id) }))
        .filter((s) => s.parts.length > 0),
    };
  }
  if (kind === 'pillar') return { ...base, pillars: base.pillars.filter((s) => s.id !== id) };
  return base;
}

export const centerOf = (r: Rect): Vec2 => ({
  x: (r.xMin + r.xMax) / 2,
  z: (r.zMin + r.zMax) / 2,
});

export const inRect = (x: number, z: number, r: Rect, inflate = 0) =>
  x >= r.xMin - inflate && x <= r.xMax + inflate && z >= r.zMin - inflate && z <= r.zMax + inflate;

export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.xMin < b.xMax + gap && b.xMin < a.xMax + gap && a.zMin < b.zMax + gap && b.zMin < a.zMax + gap;

/** Solid depth of a platform's stone body, measured from its top face down (slab + body + plinth). */
const PLATFORM_BODY_DEPTH = 1.16;

/** Shadow pools cast onto one horizontal plane (y = planeY). */
export function shadowsAtPlane(doc: Doc, azimuthDeg: number, planeY: number): Vec2[][] {
  const light = sunPoint(doc, azimuthDeg);
  const light3 = { x: light.x, y: doc.sun.y, z: light.z };
  const out: Vec2[][] = [];
  for (const s of doc.pillars) {
    for (const b of s.parts) {
      if (!b.castsUmbra) continue;
      const poly = projectBoxShadowToPlane(b, light3, doc.sun.shadowRatio, planeY);
      if (poly.length >= 3) out.push(poly);
    }
  }
  // floating stones throw their own umbra onto every lower plane — usable to
  // bridge spans, smother the sun crystal, and feed the solver/analysis
  for (const p of doc.platforms) {
    const py = p.y ?? 0;
    if (py <= planeY) continue;
    const poly = projectOutlineShadowToPlane(outlineOf(p), py, PLATFORM_BODY_DEPTH, light3, doc.sun.shadowRatio, planeY);
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

export function shadowsAt(doc: Doc, azimuthDeg = doc.sun.azimuth): Vec2[][] {
  return shadowsAtPlane(doc, azimuthDeg, 0);
}

/** Every shadow pool on every plane the level cares about, tagged with its plane height. */
export function shadowSurfacesAt(doc: Doc, azimuthDeg: number): Array<{ poly: Vec2[]; y: number }> {
  const planes = new Set<number>([0]);
  for (const p of doc.platforms) if (p.y) planes.add(p.y);
  for (const g of doc.gaps) if (g.y) planes.add(g.y);
  for (const c of doc.crystals) if (c.y) planes.add(c.y);
  const out: Array<{ poly: Vec2[]; y: number }> = [];
  for (const h of planes) {
    for (const poly of shadowsAtPlane(doc, azimuthDeg, h)) out.push({ poly, y: h });
  }
  return out;
}

export function blockersOf(doc: Doc): Rect[] {
  const list: Rect[] = [];
  for (const s of doc.pillars) {
    for (const b of s.parts) {
      if (b.yMin < 0.65) {
        list.push({ xMin: b.xMin, xMax: b.xMax, zMin: b.zMin, zMax: b.zMax });
      }
    }
  }
  for (const c of doc.crystals) {
    list.push({ xMin: c.x - 0.24, xMax: c.x + 0.24, zMin: c.z - 0.24, zMax: c.z + 0.24 });
  }
  return list;
}

export interface AzimuthState {
  bridged: boolean[];
  eclipsed: boolean;
  reach: boolean;
}

export function stateAt(doc: Doc, azimuthDeg: number, withReach = true): AzimuthState {
  const level = toLevelData(doc);
  const bridged = doc.gaps.map((g) => {
    const gy = g.y ?? 0;
    const planePlatforms = level.platforms.filter((p) => Math.abs((p.y ?? 0) - gy) <= 0.02);
    return isGapBridged(
      {
        id: g.id,
        xMin: g.xMin,
        xMax: g.xMax,
        zMin: g.zMin,
        zMax: g.zMax,
        anchorA: { x: g.ax, z: g.az },
        anchorB: { x: g.bx, z: g.bz },
      },
      planePlatforms,
      shadowsAtPlane(doc, azimuthDeg, gy),
      blockersOf(doc)
    );
  });
  const eclipsed = doc.crystals.some((c) => isCrystalEclipsed({ ...c }, shadowsAtPlane(doc, azimuthDeg, c.y ?? 0)));
  let reach = false;
  if (withReach) {
    const allBridged = doc.gaps.length === 0 || bridged.every(Boolean);
    reach = allBridged && !eclipsed && goalReachable(doc, shadowSurfacesAt(doc, azimuthDeg));
  }
  return { bridged, eclipsed, reach };
}

/** Flood fill across stone + solidified shadow to confirm the goal is genuinely reachable. */
export interface ReachSurface {
  /** Convex shadow pool or platform outline; undefined when `rect` is set. */
  poly?: Vec2[];
  rect?: Rect;
  y: number;
}

/**
 * Height-aware flood fill from the start to the goal across stones, solidified umbra
 * and ramps. Descending between any two heights is always allowed; climbing only works
 * on equal-height stone/shadow or up a ramp the sphere can physically roll onto.
 */
export function goalReachable(doc: Doc, shadowSurfaces: Array<{ poly: Vec2[]; y: number }>, step = 0.34): boolean {
  const surfaces: ReachSurface[] = [
    ...doc.platforms.map((p): ReachSurface =>
      p.points && p.points.length >= 3 ? { poly: p.points, y: p.y ?? 0 } : { rect: norm(p), y: p.y ?? 0 }
    ),
    ...shadowSurfaces.map((s) => ({ poly: s.poly, y: s.y })),
  ];
  const ramps = doc.ramps ?? [];
  const blockers = blockersOf(doc);

  let minX = doc.start.x;
  let maxX = doc.start.x;
  let minZ = doc.start.z;
  let maxZ = doc.start.z;
  const grow = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const p of doc.platforms) {
    const r = norm(p);
    grow(r.xMin, r.zMin);
    grow(r.xMax, r.zMax);
  }
  for (const g of doc.gaps) {
    const r = norm(g);
    grow(r.xMin, r.zMin);
    grow(r.xMax, r.zMax);
  }
  for (const s of shadowSurfaces) for (const p of s.poly) grow(p.x, p.z);
  for (const r of ramps) {
    const hl = r.length * 0.5;
    const hw = r.width * 0.5;
    const f = { x: Math.sin(r.yaw), z: Math.cos(r.yaw) };
    const rr = { x: Math.cos(r.yaw), z: -Math.sin(r.yaw) };
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        grow(r.x + f.x * a * hl + rr.x * b * hw, r.z + f.z * a * hl + rr.z * b * hw);
      }
    }
  }
  minX -= 1;
  maxX += 1;
  minZ -= 1;
  maxZ += 1;

  const cols = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxZ - minZ) / step) + 1;
  if (cols * rows > 20000) return false;

  const contains = (s: ReachSurface, x: number, z: number): boolean =>
    s.poly ? pointInPolygon(x, z, s.poly) : inRect(x, z, s.rect!);

  // layers per cell: surface indices usable at that cell
  const cellLayers: number[][] = new Array(cols * rows);
  const rampCells = new Map<number, Array<{ ramp: number; h: number }>>();

  for (let r = 0; r < rows; r++) {
    const z = minZ + r * step;
    for (let c = 0; c < cols; c++) {
      const x = minX + c * step;
      const idx = r * cols + c;
      let layers: number[] | null = null;
      for (let i = 0; i < surfaces.length; i++) {
        if (!contains(surfaces[i], x, z)) continue;
        const y = surfaces[i].y;
        if (y <= 0.7) {
          let blocked = false;
          for (const b of blockers) {
            if (inRect(x, z, b, 0.26)) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
        }
        if (!layers) layers = [];
        layers.push(i);
      }
      cellLayers[idx] = layers ?? [];

      if (ramps.length > 0) {
        const here: Array<{ ramp: number; h: number }> = [];
        for (let j = 0; j < ramps.length; j++) {
          const h = rampHeightAt(ramps[j], x, z, 0);
          if (h !== null) here.push({ ramp: j, h });
        }
        if (here.length) rampCells.set(idx, here);
      }
    }
  }

  const N = cols * rows;
  const idxOf = (x: number, z: number) => {
    const c = Math.max(0, Math.min(cols - 1, Math.round((x - minX) / step)));
    const r = Math.max(0, Math.min(rows - 1, Math.round((z - minZ) / step)));
    return r * cols + c;
  };
  const si = idxOf(doc.start.x, doc.start.z);
  const gi = idxOf(doc.goal.x, doc.goal.z);
  const startY = doc.start.y ?? 0;
  const goalY = doc.goal.y ?? 0;

  // node codes: surface index i -> code i (i < 256); ramp j -> 256 + j; synthetic ground -> 1023
  const SURF_LIM = 256;
  const RAMP_BASE = 256;
  const SYNTH = 1023;
  const NODE_SPAN = 1024;
  const nodeOf = (cell: number, code: number) => cell * NODE_SPAN + code;

  const heightAt = (cell: number, code: number): number => {
    if (code === SYNTH) return startY;
    if (code < SURF_LIM) return surfaces[code].y;
    const here = rampCells.get(cell);
    if (!here) return NaN;
    const j = code - RAMP_BASE;
    for (const e of here) if (e.ramp === j) return e.h;
    return NaN;
  };

  const visited = new Uint8Array(N * NODE_SPAN);
  const queue: number[] = [];
  let head = 0;
  const push = (cell: number, code: number): boolean => {
    const id = nodeOf(cell, code);
    if (visited[id]) return false;
    visited[id] = 1;
    queue.push(id);
    return true;
  };

  const seed = cellLayers[si];
  if (seed.length === 0) {
    push(si, SYNTH);
  } else {
    for (const i of seed) push(si, i);
  }
  const seedRamp = rampCells.get(si);
  if (seedRamp) for (const e of seedRamp) push(si, RAMP_BASE + e.ramp);

  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;

  while (head < queue.length) {
    const id = queue[head++];
    const cur = Math.floor(id / NODE_SPAN);
    const code = id % NODE_SPAN;
    const h = heightAt(cur, code);
    if (Number.isNaN(h)) continue;

    // goal reached on any node whose height is within win range of the goal terrace
    if (cur === gi && Math.abs(h - goalY) <= 0.8) return true;

    const cr = Math.floor(cur / cols);
    const cc = cur % cols;
    const isRamp = code >= RAMP_BASE && code !== SYNTH;
    const rampCode = isRamp ? code : -1;

    // cells to relax: the cell itself (drop/mount in place) and its 4 neighbours
    const targets: number[] = [cur];
    for (const [dr, dc] of dirs) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      targets.push(nr * cols + nc);
    }

    for (const tcell of targets) {
      const same = tcell === cur;
      // ramp-to-ramp along the same slope, neighbours only
      if (isRamp && !same) {
        const here = rampCells.get(tcell);
        if (here) {
          for (const e of here) {
            if (RAMP_BASE + e.ramp === rampCode) push(tcell, rampCode);
          }
        }
      }
      // surface layers: equal height (walk) or lower (drop) — both directions of travel
      for (const i of cellLayers[tcell]) {
        if (surfaces[i].y <= h + 0.02) push(tcell, i);
      }
      // mounting a ramp requires the ramp to meet this layer height at this cell
      const here = rampCells.get(tcell);
      if (here) {
        for (const e of here) {
          const slope = ramps[e.ramp].length > 1e-6 ? Math.abs(ramps[e.ramp].rise / ramps[e.ramp].length) : 0;
          if (Math.abs(e.h - h) <= 0.02 + step * slope) push(tcell, RAMP_BASE + e.ramp);
        }
      }
    }
  }
  return false;
}

/* ------------------------------------------------------------ analysis */

export interface Band {
  from: number;
  to: number;
}

export interface Analysis {
  step: number;
  perGap: boolean[][];
  eclipse: boolean[];
  reach: boolean[];
  gapBands: Band[][];
  solutionBands: Band[];
  solutions: number;
  ms: number;
}

export const AZ_COUNT = 120;
export const azOfIndex = (i: number) => (i * 360) / AZ_COUNT;

function toBands(flags: boolean[]): Band[] {
  const bands: Band[] = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const span = i - start;
      bands.push({ from: azOfIndex(start), to: azOfIndex(start + span - 1) + 360 / flags.length });
      start = -1;
    }
  }
  if (bands.length > 1) {
    const first = bands[0];
    const last = bands[bands.length - 1];
    if (last.to >= 360 - 1e-6 && first.from <= 1e-6) {
      first.from = last.from - 360;
      bands.pop();
    }
  }
  return bands;
}

/** Chunked so a 120-position sweep never blocks the UI thread. */
export function analyse(
  doc: Doc,
  onProgress?: (pct: number) => void,
  cancelled?: () => boolean
): Promise<Analysis | null> {
  const t0 = performance.now();
  const perGap: boolean[][] = doc.gaps.map(() => new Array(AZ_COUNT).fill(false));
  const eclipse: boolean[] = new Array(AZ_COUNT).fill(false);
  const reach: boolean[] = new Array(AZ_COUNT).fill(false);

  return new Promise((resolve) => {
    let i = 0;
    const chunk = () => {
      if (cancelled?.()) {
        resolve(null);
        return;
      }
      const end = Math.min(AZ_COUNT, i + 6);
      for (; i < end; i++) {
        const az = azOfIndex(i);
        const level = toLevelData(doc);
        const blockers = blockersOf(doc);
        doc.gaps.forEach((g, gi) => {
          const gy = g.y ?? 0;
          const planePlatforms = level.platforms.filter((p) => Math.abs((p.y ?? 0) - gy) <= 0.02);
          perGap[gi][i] = isGapBridged(
            {
              id: g.id,
              xMin: g.xMin,
              xMax: g.xMax,
              zMin: g.zMin,
              zMax: g.zMax,
              anchorA: { x: g.ax, z: g.az },
              anchorB: { x: g.bx, z: g.bz },
            },
            planePlatforms,
            shadowsAtPlane(doc, az, gy),
            blockers
          );
        });
        const ecl = doc.crystals.some((c) => isCrystalEclipsed({ ...c }, shadowsAtPlane(doc, az, c.y ?? 0)));
        eclipse[i] = ecl;
        const all = doc.gaps.length === 0 || perGap.every((row) => row[i]);
        reach[i] = all && !ecl && goalReachable(doc, shadowSurfacesAt(doc, az), 0.4);
      }
      onProgress?.(i / AZ_COUNT);
      if (i >= AZ_COUNT) {
        const solutionFlags = reach;
        resolve({
          step: 360 / AZ_COUNT,
          perGap,
          eclipse,
          reach,
          gapBands: perGap.map(toBands),
          solutionBands: toBands(solutionFlags),
          solutions: solutionFlags.filter(Boolean).length,
          ms: performance.now() - t0,
        });
        return;
      }
      requestAnimationFrame(chunk);
    };
    chunk();
  });
}

/* ---------------------------------------------------------- validation */

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  target?: { kind: SelectionKind; id: string };
}

export type SelectionKind =
  | 'platform'
  | 'pillar'
  | 'part'
  | 'gap'
  | 'anchorA'
  | 'anchorB'
  | 'crystal'
  | 'start'
  | 'goal'
  | 'sun'
  | 'ramp'
  | 'none';

export function boundsOf(doc: Doc): Rect {
  let b: Rect | null = null;
  const grow = (r: Rect) => {
    if (!b) {
      b = { ...r };
      return;
    }
    b.xMin = Math.min(b.xMin, r.xMin);
    b.xMax = Math.max(b.xMax, r.xMax);
    b.zMin = Math.min(b.zMin, r.zMin);
    b.zMax = Math.max(b.zMax, r.zMax);
  };
  doc.platforms.forEach((p) => grow(p.points && p.points.length >= 3 ? polyBounds(p.points) : norm(p)));
  doc.gaps.forEach(grow);
  for (const s of doc.pillars) for (const p of s.parts) grow(p);
  grow({ xMin: doc.start.x - 0.5, xMax: doc.start.x + 0.5, zMin: doc.start.z - 0.5, zMax: doc.start.z + 0.5 });
  grow({ xMin: doc.goal.x - 0.5, xMax: doc.goal.x + 0.5, zMin: doc.goal.z - 0.5, zMax: doc.goal.z + 0.5 });
  return b ?? { xMin: -8, xMax: 8, zMin: -5, zMax: 5 };
}

export function autoCamera(doc: Doc) {
  const b = pad(boundsOf(doc), 1.2);
  const c = centerOf(b);
  const extent = Math.max(b.xMax - b.xMin, (b.zMax - b.zMin) * 1.15);
  const d = Math.max(11, extent * 1.42);
  return {
    ox: round(c.x + extent * 0.17, 2),
    oy: round(d * 1.24, 2),
    oz: round(c.z + d * 1.06, 2),
    lx: round(c.x, 2),
    ly: 1.25,
    lz: round(c.z - 0.2, 2),
  };
}

/**
 * Height a caster needs so its fixed-length shadow covers the far lip of a span.
 * Measured against the gap rectangle (not the anchors, which already stand on stone):
 * the shadow reaches footprint + height × ratio, so the caster's own half-width helps.
 */
export function requiredHeightFor(doc: Doc, rect: Rect, gapIndex = -1): number {
  const ratio = Math.max(0.2, doc.sun.shadowRatio);
  const r = norm(rect);
  const c = centerOf(r);
  const halfSelf = Math.max((r.xMax - r.xMin) / 2, (r.zMax - r.zMin) / 2) * 0.85;
  let need = 0;
  const consider = (t: Vec2) => {
    need = Math.max(need, (Math.hypot(t.x - c.x, t.z - c.z) - halfSelf) / ratio);
  };
  let any = false;
  doc.gaps.forEach((g, i) => {
    if (gapIndex >= 0 && i !== gapIndex) return;
    any = true;
    // reaching the middle of the chasm is enough: stone closes the remaining half
    consider(centerOf(norm(g)));
  });
  if (!any) consider(doc.goal);
  return Math.max(0.6, Math.ceil(need * 20) / 20);
}

export function validate(doc: Doc): Issue[] {
  const issues: Issue[] = [];
  const push = (i: Issue) => issues.push(i);

  if (doc.platforms.length === 0) {
    push({ code: 'no-platforms', severity: 'error', message: 'The level has no stone at all — nothing to stand on.' });
  }
  if (doc.pillars.length === 0) {
    push({ code: 'no-pillars', severity: 'error', message: 'No shadow caster exists, so no gap can ever be bridged.' });
  }
  if (doc.gaps.length === 0) {
    push({ code: 'no-gaps', severity: 'warn', message: 'No broken span defined: the puzzle solves itself by walking.' });
  }

  for (const p of doc.platforms) {
    const r = norm(p);
    const w = r.xMax - r.xMin;
    const d = r.zMax - r.zMin;
    if (w < 0.75 || d < 0.75) {
      push({
        code: 'tiny-platform',
        severity: 'error',
        message: `“${p.name}” is ${w.toFixed(2)} × ${d.toFixed(2)} — narrower than the sphere's footing (0.75).`,
        target: { kind: 'platform', id: p.id },
      });
    }
    if (p.points && p.points.length < 3) {
      push({
        code: 'polygon-degenerate',
        severity: 'error',
        message: `“${p.name}” has only ${p.points.length} outline point(s); a shape needs at least three.`,
        target: { kind: 'platform', id: p.id },
      });
    }
    if (p.points && p.points.length >= 3 && polygonArea(p.points) < 0.55) {
      push({
        code: 'polygon-small',
        severity: 'warn',
        message: `“${p.name}” encloses only ${polygonArea(p.points).toFixed(2)} u² — the sphere may not fit.`,
        target: { kind: 'platform', id: p.id },
      });
    }
    if (p.style === 'pedestal' && p.brokenEdges.length) {
      push({
        code: 'pedestal-teeth',
        severity: 'info',
        message: `“${p.name}” is a pedestal but carries broken edges; teeth are usually hidden there.`,
        target: { kind: 'platform', id: p.id },
      });
    }
    for (const q of doc.platforms) {
      if (q.id <= p.id) continue;
      if (overlaps(r, norm(q), -0.02)) {
        push({
          code: 'overlap-platforms',
          severity: 'warn',
          message: `“${p.name}” and “${q.name}” overlap; the seam will read as one slab.`,
          target: { kind: 'platform', id: p.id },
        });
      }
    }
  }

  const solidPlatforms = doc.platforms.filter((p) => p.style !== 'pedestal');
  const onSurface = (x: number, z: number, y: number) => {
    for (const p of solidPlatforms) {
      if (Math.abs((p.y ?? 0) - y) > 0.35) continue;
      if (p.points && p.points.length >= 3 ? pointInPolygon(x, z, p.points) : inRect(x, z, norm(p))) return true;
    }
    for (const r of doc.ramps ?? []) {
      const h = rampHeightAt(r, x, z, 0.05);
      if (h !== null && Math.abs(h - y) <= 0.35) return true;
    }
    return false;
  };

  if (!onSurface(doc.start.x, doc.start.z, doc.start.y ?? 0)) {
    push({ code: 'start-void', severity: 'error', message: 'The sphere starts over the void and will fall on load.', target: { kind: 'start', id: 'start' } });
  }
  if (!onSurface(doc.goal.x, doc.goal.z, doc.goal.y ?? 0)) {
    push({ code: 'goal-void', severity: 'error', message: 'The goal sits over the void.', target: { kind: 'goal', id: 'goal' } });
  }

  const blockers = blockersOf(doc);
  for (const [label, pt, kind] of [
    ['start', doc.start, 'start'],
    ['goal', doc.goal, 'goal'],
  ] as const) {
    if ((pt.y ?? 0) > 0.7) continue;
    for (const b of blockers) {
      if (inRect(pt.x, pt.z, b, 0.55)) {
        push({ code: `${label}-blocked`, severity: 'error', message: `A caster or crystal blocks the ${label}; the sphere cannot reach it.`, target: { kind, id: label } });
        break;
      }
    }
  }

  for (const r of doc.ramps ?? []) {
    if (!(r.length >= 0.5) || !(r.width >= 0.3)) {
      push({ code: 'ramp-degenerate', severity: 'error', message: 'A ramp with near-zero length or width cannot carry the sphere.', target: { kind: 'ramp', id: r.id } });
    }
    const high = r.y + r.rise;
    const nearHigh = doc.platforms.some((p) => Math.abs((p.y ?? 0) - high) <= 0.15) || (doc.ramps ?? []).some((o) => o.id !== r.id && Math.abs(o.y + o.rise - high) <= 0.15);
    const nearLow = doc.platforms.some((p) => Math.abs((p.y ?? 0) - r.y) <= 0.15) || (doc.ramps ?? []).some((o) => o.id !== r.id && Math.abs(o.y - r.y) <= 0.15);
    if (!nearLow && Math.abs(r.y) > 0.02) {
      push({ code: 'ramp-low-floating', severity: 'warn', message: 'The low end of a ramp should sit on a stone (y matches no platform).', target: { kind: 'ramp', id: r.id } });
    }
    if (!nearHigh) {
      push({ code: 'ramp-high-floating', severity: 'warn', message: 'The high end of a ramp should land on a stone (y + rise matches no platform).', target: { kind: 'ramp', id: r.id } });
    }
  }

  doc.gaps.forEach((g, gi) => {
    const r = norm(g);
    const lenX = r.xMax - r.xMin;
    const lenZ = r.zMax - r.zMin;
    if (Math.max(lenX, lenZ) > doc.sun.shadowRatio * 4.2) {
      push({
        code: 'gap-too-wide',
        severity: 'warn',
        message: `“${g.name}” is ${Math.max(lenX, lenZ).toFixed(1)} units wide; the tallest usable caster is ~4 units, so a fixed-length shadow may not reach.`,
        target: { kind: 'gap', id: g.id },
      });
    }
    // One precise question per span: can any caster here throw a shadow across the far lip?
    let best: { need: number; have: number; label: string } | null = null;
    doc.pillars.forEach((s) => {
      s.parts.forEach((b) => {
        if (!b.castsUmbra) return;
        // Reach is set by the top of the block; an elevated lintel counts, which is
        // exactly how the floating-lintel chapters work.
        const have = round(b.yMax, 2);
        if (have < 0.4) return;
        const need = requiredHeightFor(doc, b, gi);
        if (!best || need < best.need) best = { need, have, label: s.label };
      });
    });
    if (best) {
      const b2 = best as { need: number; have: number; label: string };
      const slack = round(b2.have - b2.need, 2);
      if (slack < -0.9) {
        push({
          code: 'span-unreachable',
          severity: 'warn',
          message: `“${b2.label}” is ${b2.have.toFixed(2)} tall; about ${b2.need.toFixed(2)} would be needed for its shadow to cover “${g.name}”.`,
          target: { kind: 'gap', id: g.id },
        });
      } else if (slack < 0.05) {
        push({
          code: 'span-tight',
          severity: 'info',
          message: `“${g.name}” can be covered by “${b2.label}”, but with only ${Math.max(0, slack).toFixed(2)} units to spare — the window of bearings will be narrow.`,
          target: { kind: 'gap', id: g.id },
        });
      }
    } else if (doc.pillars.length > 0) {
      push({
        code: 'no-shadow-caster',
        severity: 'warn',
        message: `No grounded, shadow-casting block can reach “${g.name}”.`,
        target: { kind: 'gap', id: g.id },
      });
    }
    const aOn = onSurface(g.ax, g.az, g.y ?? 0);
    const bOn = onSurface(g.bx, g.bz, g.y ?? 0);
    if (!aOn || !bOn) {
      push({
        code: 'gap-anchor-off',
        severity: 'error',
        message: `“${g.name}” anchor ${!aOn ? 'A' : 'B'} is not standing on stone, so the span test can never pass.`,
        target: { kind: 'gap', id: g.id },
      });
    }
  });

  for (const c of doc.crystals) {
    const near = onSurface(c.x, c.z, c.y ?? 0);
    if (!near) {
      push({ code: 'crystal-void', severity: 'error', message: 'A sun crystal floats over the void; it must sit on stone.', target: { kind: 'crystal', id: c.id } });
    }
  }

  const b = boundsOf(doc);
  const extent = Math.max(b.xMax - b.xMin, (b.zMax - b.zMin) * 1.15);
  const need = orbitRadiusOf(doc) + 1.5;
  if (Math.max(b.xMax - b.xMin, b.zMax - b.zMin) > need * 2) {
    push({ code: 'sun-orbit', severity: 'info', message: 'The sun orbit ring will fall outside the level bounds; widen the orbit or tighten the plan.' });
  }
  if (doc.camera.oy < extent * 1.2 || doc.camera.oz < extent * 0.85) {
    push({ code: 'camera-tight', severity: 'info', message: 'The stage camera is close enough to crop this plan — Auto-fit framing will pull it back.', target: { kind: 'none', id: 'camera' } });
  }

  if (doc.sun.shadowRatio < 0.7 || doc.sun.shadowRatio > 2.4) {
    push({ code: 'ratio', severity: 'warn', message: `Shadow ratio ${doc.sun.shadowRatio.toFixed(2)} is extreme; 1.0–1.5 keeps bridges and silhouettes readable.` });
  }
  if (Math.abs(doc.sun.y - doc.sun.shadowRatio * 4.48) > 2.2) {
    push({ code: 'sun-y', severity: 'info', message: 'Sun height and shadow ratio disagree slightly, so the orb sits off the true light ray.' });
  }

  return issues;
}

/* --------------------------------------------------------- serialising */

/**
 * Serialise a chapter back into the shape `src/game/levels.ts` expects.
 * A structural printer builds the literal from nested records, so braces and
 * commas can never drift out of alignment.
 */
export function toTS(doc: Doc): string {
  const lvl = toLevelData(doc);
  const n = (v: number) => String(round(v, 3));
  const q = (v: string) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  type Node = string | number | undefined | Node[] | { [k: string]: Node };

  const inlineVec = (v: Node): v is { x: Node; z: Node; y?: Node } =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && 'x' in v && 'z' in v && Object.keys(v).length <= 3;

  const emit = (node: Node, ind: number): string => {
    const pad = '  '.repeat(ind);
    if (typeof node === 'number') return n(node);
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) {
      const items = node.filter((v) => v !== undefined) as Exclude<Node, undefined>[];
      if (items.length === 0) return '[]';
      if (items.every((v) => typeof v === 'number' || typeof v === 'string')) {
        return `[${items.map((v) => (typeof v === 'number' ? n(v) : v)).join(', ')}]`;
      }
      return `[\n${items.map((v) => `${'  '.repeat(ind + 1)}${emit(v, ind + 1)},`).join('\n')}\n${pad}]`;
    }
    if (node === null || typeof node !== 'object') return 'undefined';
    const entries = Object.entries(node).filter(([, v]) => v !== undefined) as Array<[string, Exclude<Node, undefined>]>;
    if (inlineVec(node)) {
      return `{ ${entries.map(([k, v]) => `${k}: ${typeof v === 'number' ? n(v) : v}`).join(', ')} }`;
    }
    return `{\n${entries.map(([k, v]) => `${'  '.repeat(ind + 1)}${k}: ${emit(v, ind + 1)},`).join('\n')}\n${pad}}`;
  };

  const box = (b: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
    variant?: string;
    castsUmbra?: boolean;
    yaw?: number;
  }): Node => ({
    xMin: n(b.xMin),
    xMax: n(b.xMax),
    yMin: n(b.yMin),
    yMax: n(b.yMax),
    zMin: n(b.zMin),
    zMax: n(b.zMax),
    variant: b.variant ? `'${b.variant}'` : undefined,
    castsUmbra: b.castsUmbra === false ? 'false' : undefined,
    yaw: b.yaw ? n(b.yaw) : undefined,
  });

  const root: Node = {
    id: q(lvl.id),
    number: lvl.number,
    title: q(lvl.title),
    subtitle: q(lvl.subtitle),
    prompt: q(lvl.prompt),
    hint: q(lvl.hint),
    platforms: lvl.platforms.map((p): Node => ({
      id: q(p.id),
      xMin: n(p.xMin),
      xMax: n(p.xMax),
      zMin: n(p.zMin),
      zMax: n(p.zMax),
      style: `'${p.style ?? 'main'}'`,
      y: p.y !== undefined ? n(p.y) : undefined,
      brokenEdges: p.brokenEdges?.length ? p.brokenEdges.map((e) => `'${e}'`) : undefined,
      points: p.points?.length
        ? (`[${p.points.map((v) => `{ x: ${n(v.x)}, z: ${n(v.z)} }`).join(', ')}]` as unknown as string)
        : undefined,
    })),
    pillars: lvl.pillars.map((s): Node => ({
      id: q(s.id),
      label: q(s.label ?? 'Monolith'),
      parts: s.parts.map((b) => box(b)),
    })),
    brokenGaps: lvl.brokenGaps.map((g): Node => ({
      id: q(g.id),
      xMin: n(g.xMin),
      xMax: n(g.xMax),
      zMin: n(g.zMin),
      zMax: n(g.zMax),
      anchorA: { x: n(g.anchorA.x), z: n(g.anchorA.z) },
      anchorB: { x: n(g.anchorB.x), z: n(g.anchorB.z) },
      y: g.y !== undefined ? n(g.y) : undefined,
    })),
    ramps: lvl.ramps?.length
      ? lvl.ramps.map((r): Node => ({ id: q(r.id), x: n(r.x), z: n(r.z), yaw: n(r.yaw), length: n(r.length), width: n(r.width), y: n(r.y), rise: n(r.rise) }))
      : undefined,
    sunCrystals: lvl.sunCrystals?.length
      ? lvl.sunCrystals.map((c): Node => ({ id: q(c.id), x: n(c.x), z: n(c.z), radius: n(c.radius), y: c.y !== undefined ? n(c.y) : undefined }))
      : undefined,
    start: { x: n(lvl.start.x), z: n(lvl.start.z), y: lvl.start.y !== undefined ? n(lvl.start.y) : undefined },
    goal: { x: n(lvl.goal.x), z: n(lvl.goal.z), y: lvl.goal.y !== undefined ? n(lvl.goal.y) : undefined },
    lightInitial: { x: n(lvl.lightInitial.x), y: n(lvl.lightInitial.y), z: n(lvl.lightInitial.z) },
    lightBounds: {
      maxRadius: n(lvl.lightBounds.maxRadius),
      y: n(lvl.lightBounds.y),
      shadowRatio: n(lvl.lightBounds.shadowRatio),
    },
    camera: {
      offset: { x: n(lvl.camera.offset.x), y: n(lvl.camera.offset.y), z: n(lvl.camera.offset.z) },
      lookAt: { x: n(lvl.camera.lookAt.x), y: n(lvl.camera.lookAt.y), z: n(lvl.camera.lookAt.z) },
    },
  };

  // emitted so that nested lines already match a LEVELS array entry; only the
  // opening brace needs the extra indent, and a trailing comma pastes it straight in
  return `  ${emit(root, 1)},`;
}

export function download(name: string, text: string, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 400);
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'level';

/* ------------------------------------------------------------- history */

interface HistoryState {
  past: Doc[];
  present: Doc;
  future: Doc[];
}

export function useDoc(initial: Doc) {
  const [h, setH] = useState<HistoryState>({ past: [], present: initial, future: [] });
  const pending = useRef<Doc | null>(null);
  const docRef = useRef(h.present);
  docRef.current = h.present;

  /** `label` documents the intent at the call site; history stores full snapshots. */
  const commit = useCallback((next: Doc, _label?: string) => {
    setH((s) =>
      JSON.stringify(s.present) === JSON.stringify(next)
        ? s
        : { past: [...s.past.slice(-59), s.present], present: next, future: [] }
    );
  }, []);

  /** Live update during a drag: no history entry. Call endEdit() when released. */
  const live = useCallback((updater: (d: Doc) => Doc) => {
    setH((s) => ({ ...s, present: updater(s.present) }));
  }, []);

  const beginEdit = useCallback(() => {
    pending.current = docRef.current;
  }, []);

  const endEdit = useCallback(() => {
    const before = pending.current;
    pending.current = null;
    if (!before) return;
    setH((s) =>
      JSON.stringify(before) === JSON.stringify(s.present) ? s : { past: [...s.past.slice(-59), before], present: s.present, future: [] }
    );
  }, []);

  const update = useCallback(
    (updater: (d: Doc) => Doc) => {
      setH((s) => {
        const next = updater(s.present);
        if (next === s.present) return s;
        return { past: [...s.past.slice(-59), s.present], present: next, future: [] };
      });
    },
    []
  );

  const undo = useCallback(() => {
    setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future].slice(0, 60) } : s));
  }, []);

  const redo = useCallback(() => {
    setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  const replace = useCallback((d: Doc) => {
    setH((s) => ({ past: [...s.past.slice(-59), s.present], present: d, future: [] }));
  }, []);

  return {
    doc: h.present,
    commit,
    live,
    beginEdit,
    endEdit,
    update,
    replace,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}

export type DocApi = ReturnType<typeof useDoc>;

/* ------------------------------------------------------- local storage */

const STORE = 'umbra.forge.v1';

/** The sheet currently open in the editor; the game writes it to open a specific level. */
export const SESSION_KEY = 'umbra.forge.session';

export interface SavedDoc {
  id: string;
  savedAt: number;
  doc: Doc;
}

export function loadSaved(): SavedDoc[] {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAll(list: SavedDoc[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* storage full or blocked */
  }
}

export function useAutosave(doc: Doc, enabled: boolean) {
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setDirty(true);
    const t = window.setTimeout(() => {
      const list = loadSaved();
      const entry: SavedDoc = { id: doc.meta.id, savedAt: Date.now(), doc };
      const idx = list.findIndex((l) => l.id === doc.meta.id);
      if (idx >= 0) list[idx] = entry;
      else list.unshift(entry);
      saveAll(list);
      setDirty(false);
      setSavedAt(Date.now());
    }, 900);
    return () => window.clearTimeout(t);
  }, [doc, enabled]);

  return { dirty, savedAt };
}

export { sunShadowOffsetPerHeight };
