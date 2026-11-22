import { useCallback, useEffect, useRef, useState } from 'react';
import type { LevelData, Vec2 } from '../game/types';
import {
  isCrystalEclipsed,
  isGapBridged,
  projectBoxShadowToGround,
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
}

export interface CrystalItem {
  id: string;
  x: number;
  z: number;
  radius: number;
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
    })),
    crystals: (src.sunCrystals ?? []).map((c) => ({
      id: c.id || uid('c'),
      x: c.x,
      z: c.z,
      radius: c.radius,
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
    })),
    sunCrystals: doc.crystals.length
      ? doc.crystals.map((c) => ({ id: c.id, x: round(c.x), z: round(c.z), radius: c.radius }))
      : undefined,
    start: { x: round(doc.start.x), z: round(doc.start.z) },
    goal: { x: round(doc.goal.x), z: round(doc.goal.z) },
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
        return { ...p, points: pts, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax };
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
        return { ...g, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax, ax: a.x, az: a.z, bx: b.x, bz: b.z };
      }),
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

/** Deletes any object by kind and id, cleaning up empty caster groups. */
export function deleteDocObject(base: Doc, kind: string, id: string): Doc {
  if (kind === 'platform') return { ...base, platforms: base.platforms.filter((p) => p.id !== id) };
  if (kind === 'gap') return { ...base, gaps: base.gaps.filter((g) => g.id !== id) };
  if (kind === 'crystal') return { ...base, crystals: base.crystals.filter((c) => c.id !== id) };
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

export function shadowsAt(doc: Doc, azimuthDeg = doc.sun.azimuth): Vec2[][] {
  const light = sunPoint(doc, azimuthDeg);
  const light3 = { x: light.x, y: doc.sun.y, z: light.z };
  const out: Vec2[][] = [];
  for (const s of doc.pillars) {
    for (const b of s.parts) {
      if (!b.castsUmbra) continue;
      const poly = projectBoxShadowToGround(b, light3, doc.sun.shadowRatio);
      if (poly.length >= 3) out.push(poly);
    }
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
  const shadows = shadowsAt(doc, azimuthDeg);
  const bridged = doc.gaps.map((g) =>
    isGapBridged(
      {
        id: g.id,
        xMin: g.xMin,
        xMax: g.xMax,
        zMin: g.zMin,
        zMax: g.zMax,
        anchorA: { x: g.ax, z: g.az },
        anchorB: { x: g.bx, z: g.bz },
      },
      level.platforms,
      shadows,
      blockersOf(doc)
    )
  );
  const eclipsed = doc.crystals.some((c) => isCrystalEclipsed({ ...c }, shadows));
  let reach = false;
  if (withReach) {
    const allBridged = doc.gaps.length === 0 || bridged.every(Boolean);
    reach = allBridged && !eclipsed && goalReachable(doc, shadows);
  }
  return { bridged, eclipsed, reach };
}

/** Flood fill across stone + solidified shadow to confirm the goal is genuinely reachable. */
export function goalReachable(doc: Doc, shadows: Vec2[][], step = 0.34): boolean {
  const rects = [
    ...doc.platforms.map((p) => (p.points && p.points.length >= 3 ? polyBounds(p.points) : norm(p))),
    ...doc.gaps.map(norm),
  ];
  let minX = doc.start.x;
  let maxX = doc.start.x;
  let minZ = doc.start.z;
  let maxZ = doc.start.z;
  for (const r of rects) {
    minX = Math.min(minX, r.xMin);
    maxX = Math.max(maxX, r.xMax);
    minZ = Math.min(minZ, r.zMin);
    maxZ = Math.max(maxZ, r.zMax);
  }
  for (const poly of shadows) {
    for (const p of poly) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  minX -= 1;
  maxX += 1;
  minZ -= 1;
  maxZ += 1;

  const cols = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxZ - minZ) / step) + 1;
  if (cols * rows > 20000) return false;

  const blockers = blockersOf(doc);
  const open = new Uint8Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const z = minZ + r * step;
    for (let c = 0; c < cols; c++) {
      const x = minX + c * step;
      let solid = false;
      for (const p of doc.platforms) {
        if (p.points && p.points.length >= 3) {
          if (pointInPolygon(x, z, p.points)) {
            solid = true;
            break;
          }
        } else if (inRect(x, z, norm(p))) {
          solid = true;
          break;
        }
      }
      if (!solid) {
        for (const poly of shadows) {
          if (pointInConvex(x, z, poly)) {
            solid = true;
            break;
          }
        }
      }
      if (!solid) continue;
      let blocked = false;
      for (const b of blockers) {
        if (inRect(x, z, b, 0.26)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) open[r * cols + c] = 1;
    }
  }

  const idxOf = (x: number, z: number) => {
    const c = Math.max(0, Math.min(cols - 1, Math.round((x - minX) / step)));
    const r = Math.max(0, Math.min(rows - 1, Math.round((z - minZ) / step)));
    return r * cols + c;
  };

  const si = idxOf(doc.start.x, doc.start.z);
  const gi = idxOf(doc.goal.x, doc.goal.z);
  open[si] = 1;
  open[gi] = 1;

  const seen = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  seen[si] = 1;
  queue[tail++] = si;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === gi) return true;
    const cr = Math.floor(cur / cols);
    const cc = cur % cols;
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const ni = nr * cols + nc;
      if (!seen[ni] && open[ni]) {
        seen[ni] = 1;
        queue[tail++] = ni;
      }
    }
  }
  return false;
}

function pointInConvex(x: number, z: number, poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < -1e-6) return false;
  }
  return true;
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
        const shadows = shadowsAt(doc, az);
        const level = toLevelData(doc);
        const blockers = blockersOf(doc);
        doc.gaps.forEach((g, gi) => {
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
            level.platforms,
            shadows,
            blockers
          );
        });
        const ecl = doc.crystals.some((c) => isCrystalEclipsed({ ...c }, shadows));
        eclipse[i] = ecl;
        const all = doc.gaps.length === 0 || perGap.every((row) => row[i]);
        reach[i] = all && !ecl && goalReachable(doc, shadows, 0.4);
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
  const onStone = (x: number, z: number) =>
    solidPlatforms.some((p) =>
      p.points && p.points.length >= 3 ? pointInPolygon(x, z, p.points) : inRect(x, z, norm(p))
    );

  if (!onStone(doc.start.x, doc.start.z)) {
    push({ code: 'start-void', severity: 'error', message: 'The sphere starts over the void and will fall on load.', target: { kind: 'start', id: 'start' } });
  }
  if (!onStone(doc.goal.x, doc.goal.z)) {
    push({ code: 'goal-void', severity: 'error', message: 'The goal sits over the void.', target: { kind: 'goal', id: 'goal' } });
  }

  const blockers = blockersOf(doc);
  for (const [label, pt, kind] of [
    ['start', doc.start, 'start'],
    ['goal', doc.goal, 'goal'],
  ] as const) {
    for (const b of blockers) {
      if (inRect(pt.x, pt.z, b, 0.55)) {
        push({ code: `${label}-blocked`, severity: 'error', message: `A caster or crystal blocks the ${label}; the sphere cannot reach it.`, target: { kind, id: label } });
        break;
      }
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
    const aOn = onStone(g.ax, g.az);
    const bOn = onStone(g.bx, g.bz);
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
    const near = onStone(c.x, c.z);
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
    })),
    sunCrystals: lvl.sunCrystals?.length
      ? lvl.sunCrystals.map((c): Node => ({ id: q(c.id), x: n(c.x), z: n(c.z), radius: n(c.radius) }))
      : undefined,
    start: { x: n(lvl.start.x), z: n(lvl.start.z) },
    goal: { x: n(lvl.goal.x), z: n(lvl.goal.z) },
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
