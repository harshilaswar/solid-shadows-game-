/**
 * Block data for the 3D Forge.
 *
 * The game itself is already three-dimensional (stones have a top height, caster
 * boxes have yMin/yMax, ramps have rise, markers have y). This module keeps a
 * small Minecraft-like block list and translates it into those native level
 * objects, so anything built in the block editor can be played and exported
 * like a level authored on the 2D sheet.
 */
import type { BoxItem, CrystalItem, Doc, GapItem, PillarItem, PlatformItem, Variant } from './doc';
import { uid } from './doc';
import type { RampItem } from './doc';
import type { Vec2 } from '../game/types';

export type BlockKind =
  | 'stone'
  | 'terracotta'
  | 'ochre'
  | 'slate'
  | 'trim'
  | 'ramp'
  | 'crystal'
  | 'start'
  | 'goal'
  | 'gap';

/** Solid blocks occupy a cell; markers can sit on top of a solid block. */
export type BlockLayer = 'solid' | 'mark';

export interface Voxel {
  id: string;
  kind: BlockKind;
  layer: BlockLayer;
  /** Integer cell coordinates. The block base is (x * cell, y * cell, z * cell). */
  x: number;
  y: number;
  z: number;
  /** Quarter turns about Y; ramps ascend along local +Z at rotation 0. */
  rot: number;
}

export interface BlockDef {
  kind: BlockKind;
  name: string;
  caption: string;
  color: string;
  edge: string;
  key: string;
  layer: BlockLayer;
}

export const BLOCKS: BlockDef[] = [
  { kind: 'stone', name: 'Stone floor', caption: 'walkable slab', color: '#c3b496', edge: '#6d6555', key: '1', layer: 'solid' },
  { kind: 'terracotta', name: 'Terracotta', caption: 'shadow caster', color: '#b86b51', edge: '#6d3a2c', key: '2', layer: 'solid' },
  { kind: 'ochre', name: 'Ochre stone', caption: 'shadow caster', color: '#d5a44e', edge: '#7a5a25', key: '3', layer: 'solid' },
  { kind: 'slate', name: 'Slate', caption: 'shadow caster', color: '#667d87', edge: '#34434b', key: '4', layer: 'solid' },
  { kind: 'trim', name: 'Trim', caption: 'decorative, no shadow', color: '#e2d4b5', edge: '#8e8168', key: '5', layer: 'solid' },
  { kind: 'ramp', name: 'Ramp', caption: 'walkable slope', color: '#c49463', edge: '#6c4b2e', key: '6', layer: 'solid' },
  { kind: 'crystal', name: 'Sun crystal', caption: 'must stay sunlit', color: '#76d7e5', edge: '#2f7886', key: '7', layer: 'mark' },
  { kind: 'start', name: 'Start', caption: 'ball spawn', color: '#79d3a5', edge: '#2e7251', key: '8', layer: 'mark' },
  { kind: 'goal', name: 'Goal', caption: 'exit portal', color: '#f0d080', edge: '#8a6b24', key: '9', layer: 'mark' },
  { kind: 'gap', name: 'Bridge gap', caption: 'needs a shadow span', color: '#d97567', edge: '#85362d', key: '0', layer: 'mark' },
];

export const blockDef = (kind: BlockKind): BlockDef => BLOCKS.find((b) => b.kind === kind) ?? BLOCKS[0];

export const voxelKey = (v: Pick<Voxel, 'layer' | 'x' | 'y' | 'z'>) => `${v.layer}:${v.x},${v.y},${v.z}`;

export const makeVoxel = (kind: BlockKind, x: number, y: number, z: number, rot = 0): Voxel => ({
  id: uid('blk'),
  kind,
  layer: blockDef(kind).layer,
  x,
  y,
  z,
  rot: ((rot % 4) + 4) % 4,
});

/* --------------------------------------------------------------- doc -> blocks */

const MAX_CELLS = 24000;

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Import a level as blocks. Irregular shapes are voxelised on the chosen cell size. */
export function docToVoxels(doc: Doc, cell: number): Voxel[] {
  const out: Voxel[] = [];
  let budget = MAX_CELLS;
  const ix = (v: number) => Math.round(v / cell);

  const fill = (kind: BlockKind, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    for (let y = y0; y < y1 && budget > 0; y++) {
      for (let z = z0; z < z1 && budget > 0; z++) {
        for (let x = x0; x < x1 && budget > 0; x++) {
          out.push(makeVoxel(kind, x, y, z));
          budget--;
        }
      }
    }
  };

  for (const p of doc.platforms) {
    const top = p.y ?? 0;
    const y = ix(top) - 1;
    if (p.points && p.points.length >= 3) {
      const xs = p.points.map((v) => ix(v.x));
      const zs = p.points.map((v) => ix(v.z));
      for (let z = Math.min(...zs); z < Math.max(...zs) && budget > 0; z++) {
        for (let x = Math.min(...xs); x < Math.max(...xs) && budget > 0; x++) {
          if (pointInPolygon({ x: (x + 0.5) * cell, z: (z + 0.5) * cell }, p.points)) {
            out.push(makeVoxel('stone', x, y, z));
            budget--;
          }
        }
      }
    } else {
      fill('stone', ix(p.xMin), ix(p.xMax), y, y + 1, ix(p.zMin), ix(p.zMax));
    }
  }

  for (const pillar of doc.pillars) {
    for (const b of pillar.parts) {
      const x0 = ix(b.xMin);
      const z0 = ix(b.zMin);
      const y0 = ix(b.yMin);
      const nx = Math.max(1, ix(b.xMax) - x0);
      const nz = Math.max(1, ix(b.zMax) - z0);
      const ny = Math.max(1, ix(b.yMax) - y0);
      const kind: BlockKind = b.variant === 'trim' && b.castsUmbra === false ? 'trim' : (b.variant as BlockKind);
      fill(BLOCKS.some((k) => k.kind === kind) ? kind : 'terracotta', x0, x0 + nx, y0, y0 + ny, z0, z0 + nz);
    }
  }

  for (const r of doc.ramps ?? []) {
    const rot = Math.round(r.yaw / (Math.PI / 2));
    out.push(makeVoxel('ramp', Math.round(r.x / cell - 0.5), ix(r.y), Math.round(r.z / cell - 0.5), rot));
  }

  const marker = (kind: BlockKind, x: number, z: number, y: number | undefined) => {
    out.push(makeVoxel(kind, Math.round(x / cell - 0.5), Math.round((y ?? 0) / cell) - 1, Math.round(z / cell - 0.5)));
  };
  for (const c of doc.crystals) marker('crystal', c.x, c.z, c.y);
  marker('start', doc.start.x, doc.start.z, doc.start.y);
  marker('goal', doc.goal.x, doc.goal.z, doc.goal.y);
  for (const g of doc.gaps) {
    const x0 = ix(g.xMin);
    const x1 = Math.max(x0 + 1, ix(g.xMax));
    const z0 = ix(g.zMin);
    const z1 = Math.max(z0 + 1, ix(g.zMax));
    const y = Math.round((g.y ?? 0) / cell) - 1;
    for (let z = z0; z < z1 && budget > 0; z++) {
      for (let x = x0; x < x1 && budget > 0; x++) {
        out.push(makeVoxel('gap', x, y, z));
        budget--;
      }
    }
  }
  return out;
}

/* --------------------------------------------------------------- blocks -> doc */

/** Greedy 2D rectangle packing for walkable slabs. */
function mergeRects(cells: Set<string>): Array<{ x: number; z: number; w: number; d: number }> {
  const rects: Array<{ x: number; z: number; w: number; d: number }> = [];
  const has = (x: number, z: number) => cells.has(`${x},${z}`);
  while (cells.size) {
    const first = cells.values().next().value as string;
    const [x, z] = first.split(',').map(Number);
    let w = 1;
    while (has(x + w, z)) w++;
    let d = 1;
    outer: while (true) {
      for (let i = 0; i < w; i++) if (!has(x + i, z + d)) break outer;
      d++;
    }
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) cells.delete(`${x + dx},${z + dz}`);
    rects.push({ x, z, w, d });
  }
  return rects;
}

/** Greedy 3D cuboid packing keeps caster counts low even for large walls. */
function mergeBoxes(cells: Set<string>): Array<{ x: number; y: number; z: number; w: number; h: number; d: number }> {
  const boxes: Array<{ x: number; y: number; z: number; w: number; h: number; d: number }> = [];
  const has = (x: number, y: number, z: number) => cells.has(`${x},${y},${z}`);
  while (cells.size) {
    const [x, y, z] = (cells.values().next().value as string).split(',').map(Number);
    let w = 1;
    while (has(x + w, y, z)) w++;
    let h = 1;
    outerH: while (true) {
      for (let i = 0; i < w; i++) if (!has(x + i, y + h, z)) break outerH;
      h++;
    }
    let d = 1;
    outerD: while (true) {
      for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) if (!has(x + ix, y + iy, z + d)) break outerD;
      d++;
    }
    for (let dz = 0; dz < d; dz++)
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) cells.delete(`${x + dx},${y + dy},${z + dz}`);
    boxes.push({ x, y, z, w, h, d });
  }
  return boxes;
}

const VARIANTS: BlockKind[] = ['terracotta', 'ochre', 'slate', 'trim'];

/** Convert the block list into a playable level, preserving the level's sun/camera/meta. */
export function voxelsToDoc(base: Doc, voxels: Voxel[], cell: number): Doc {
  const solids = voxels.filter((v) => v.layer === 'solid');

  const platforms: PlatformItem[] = [];
  const byHeight = new Map<number, Set<string>>();
  for (const v of solids) {
    if (v.kind !== 'stone') continue;
    if (!byHeight.has(v.y)) byHeight.set(v.y, new Set());
    byHeight.get(v.y)!.add(`${v.x},${v.z}`);
  }
  for (const [y, cells] of byHeight) {
    for (const r of mergeRects(cells)) {
      platforms.push({
        id: uid('p'),
        name: `Block platform ${y >= 0 ? '+' : ''}${((y + 1) * cell).toFixed(1)}`,
        xMin: r.x * cell,
        xMax: (r.x + r.w) * cell,
        zMin: r.z * cell,
        zMax: (r.z + r.d) * cell,
        style: 'main',
        brokenEdges: [],
        y: (y + 1) * cell,
      });
    }
  }

  const pillars: PillarItem[] = [];
  for (const kind of VARIANTS) {
    const cells = new Set(solids.filter((v) => v.kind === kind).map((v) => `${v.x},${v.y},${v.z}`));
    if (!cells.size) continue;
    const parts: BoxItem[] = mergeBoxes(cells).map((b) => ({
      id: uid('b'),
      xMin: b.x * cell,
      xMax: (b.x + b.w) * cell,
      yMin: b.y * cell,
      yMax: (b.y + b.h) * cell,
      zMin: b.z * cell,
      zMax: (b.z + b.d) * cell,
      variant: kind as Variant,
      castsUmbra: kind !== 'trim',
    }));
    pillars.push({ id: uid('pil'), label: kind === 'trim' ? 'Trimwork' : `${kind} caster`, parts });
  }

  const ramps: RampItem[] = solids
    .filter((v) => v.kind === 'ramp')
    .map((v) => ({
      id: uid('r'),
      name: 'Block ramp',
      x: (v.x + 0.5) * cell,
      z: (v.z + 0.5) * cell,
      yaw: v.rot * (Math.PI / 2),
      length: cell,
      width: cell,
      y: v.y * cell,
      rise: cell,
    }));

  const crystals: CrystalItem[] = [];
  let start = base.start;
  let goal = base.goal;
  for (const v of voxels) {
    if (v.layer !== 'mark') continue;
    const cx = (v.x + 0.5) * cell;
    const cz = (v.z + 0.5) * cell;
    const top = (v.y + 1) * cell;
    if (v.kind === 'crystal') crystals.push({ id: uid('c'), x: cx, z: cz, y: top, radius: Math.max(0.16, cell * 0.36) });
    if (v.kind === 'start') start = { x: cx, z: cz, y: top };
    if (v.kind === 'goal') goal = { x: cx, z: cz, y: top };
  }

  // Adjacent gap markers become one span, just like adjacent stones become one slab.
  const gaps: GapItem[] = [];
  const gapsByHeight = new Map<number, Set<string>>();
  for (const v of voxels) {
    if (v.kind !== 'gap') continue;
    if (!gapsByHeight.has(v.y)) gapsByHeight.set(v.y, new Set());
    gapsByHeight.get(v.y)!.add(`${v.x},${v.z}`);
  }
  for (const [y, cells] of gapsByHeight) {
    for (const r of mergeRects(cells)) {
      const zMid = (r.z + r.d / 2) * cell;
      gaps.push({
        id: uid('g'),
        name: 'Bridge gap',
        xMin: r.x * cell,
        xMax: (r.x + r.w) * cell,
        zMin: r.z * cell,
        zMax: (r.z + r.d) * cell,
        ax: r.x * cell,
        az: zMid,
        bx: (r.x + r.w) * cell,
        bz: zMid,
        y: (y + 1) * cell,
      });
    }
  }

  return { ...base, platforms, pillars, gaps, crystals, ramps, start, goal };
}

/** Identity of the playable geometry — used to know when another view changed the level. */
export function shapeKey(doc: Doc): string {
  return JSON.stringify([doc.platforms, doc.pillars, doc.gaps, doc.crystals, doc.ramps, doc.start, doc.goal]);
}
