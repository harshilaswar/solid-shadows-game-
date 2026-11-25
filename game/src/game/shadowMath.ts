import { Box3D, BrokenGapHint, Rect2D, SunCrystal, Vec2, Vec3 } from './types';

/** Anything the player can stand on: an axis-aligned rect, or a rect plus an outline. */
export interface ShapeLike extends Rect2D {
  points?: Vec2[];
}

export function centroidOf(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

export function rotateAround(points: Vec2[], center: Vec2, angle: number): Vec2[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => ({
    x: center.x + (p.x - center.x) * c - (p.z - center.z) * s,
    z: center.z + (p.x - center.x) * s + (p.z - center.z) * c,
  }));
}

/** Four corners of a rect, in screen-plan winding. */
export function rectCorners(r: Rect2D): Vec2[] {
  return [
    { x: r.xMin, z: r.zMin },
    { x: r.xMax, z: r.zMin },
    { x: r.xMax, z: r.zMax },
    { x: r.xMin, z: r.zMax },
  ];
}

/** The outline used for drawing and collision. Falls back to the bounding rect. */
export function outlineOf(shape: ShapeLike): Vec2[] {
  return shape.points && shape.points.length >= 3 ? shape.points : rectCorners(shape);
}

/** Distance from a point to a polygon outline; 0 when inside (any winding). */
export function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (poly.length < 3) return Infinity;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  if (inside) return 0;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distPointToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < min) min = d;
  }
  return min;
}

function cross2D(o: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
}

/**
 * Computes the 2D Convex Hull in (x, z) space using Monotone Chain.
 * Returned vertices satisfy cross2D(poly[i], poly[i+1], interiorPoint) >= 0.
 */
export function convexHull2D(points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points.slice();

  const sorted = points
    .slice()
    .sort((a, b) => (Math.abs(a.x - b.x) > 1e-7 ? a.x - b.x : a.z - b.z));

  const unique: Vec2[] = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1e-5) {
      unique.push(p);
    }
  }

  if (unique.length <= 2) return unique;

  const lower: Vec2[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-8) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Vec2[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-8) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export const DEFAULT_SHADOW_RATIO = 1.25;

/**
 * Returns the horizontal ground displacement per unit of height for a sun infinitely far away
 * at a FIXED elevation. Only the azimuth (horizontal direction of the Sun Orb) matters:
 * the shadow length per unit height is constant, so moving the sun can never stretch a shadow.
 */
export function sunShadowOffsetPerHeight(light: Vec3, ratio = DEFAULT_SHADOW_RATIO): Vec2 {
  const horizontal = Math.hypot(light.x, light.z);
  if (horizontal < 1e-5) {
    // Sun directly overhead — fall back to a fixed southward direction to keep shadows legible
    return { x: 0, z: ratio };
  }
  return {
    x: -(light.x / horizontal) * ratio,
    z: -(light.z / horizontal) * ratio,
  };
}

/**
 * Projects a 3D axis-aligned box onto an arbitrary horizontal plane (y = planeY) using
 * parallel (directional) sunlight. Directly grounded stones live on planeY = 0; raised
 * terraces and spans collect their own, shorter shadow pools on their own planes.
 * Parts of the box below the receiving plane cast nothing onto it.
 */
export function projectBoxShadowToPlane(
  box: Box3D,
  light: Vec3,
  ratio = DEFAULT_SHADOW_RATIO,
  planeY = 0
): Vec2[] {
  if (box.castsUmbra === false) return [];
  const off = sunShadowOffsetPerHeight(light, ratio);

  if (box.yMax <= planeY) return [];

  // Sweep the footprint from the receiving plane up through the box's top edge.
  const offsets = new Set<number>([0]);
  if (box.yMin > planeY) offsets.add(box.yMin - planeY);
  offsets.add(box.yMax - planeY);

  // Footprint corners, honouring an optional yaw about the box centre.
  const cx = (box.xMin + box.xMax) * 0.5;
  const cz = (box.zMin + box.zMax) * 0.5;
  let footprint = rectCorners(box);
  if (box.yaw) footprint = rotateAround(footprint, { x: cx, z: cz }, box.yaw);

  const projected: Vec2[] = [];
  for (const h of offsets) {
    for (const v of footprint) {
      projected.push({
        x: v.x + off.x * h,
        z: v.z + off.z * h,
      });
    }
  }

  return convexHull2D(projected);
}

/**
 * Projects a flat horizontal outline (top face at `topY`, solid body extending `bodyHeight` down)
 * onto a horizontal plane (y = planeY) using parallel (directional) sunlight. Floating stones
 * cast their umbra onto the court and onto lower terraces exactly the same way caster blocks do,
 * so a suspended slab can bridge a span or smother a sun crystal when swung into the light.
 * Parts of the body below the receiving plane cast nothing onto it.
 */
export function projectOutlineShadowToPlane(
  outline: Vec2[],
  topY: number,
  bodyHeight: number,
  light: Vec3,
  ratio = DEFAULT_SHADOW_RATIO,
  planeY = 0
): Vec2[] {
  if (outline.length < 3) return [];
  if (topY <= planeY) return [];

  const bottomY = topY - Math.max(0.01, bodyHeight);
  const off = sunShadowOffsetPerHeight(light, ratio);

  const offsets = new Set<number>([0]);
  if (bottomY > planeY) offsets.add(bottomY - planeY);
  offsets.add(topY - planeY);

  const projected: Vec2[] = [];
  for (const h of offsets) {
    for (const v of outline) {
      projected.push({ x: v.x + off.x * h, z: v.z + off.z * h });
    }
  }
  return convexHull2D(projected);
}

/**
 * Projects a 3D axis-aligned box onto the y = 0 ground plane using parallel (directional) sunlight.
 * Because rays are parallel, the shadow keeps the exact footprint width of the pillar and a
 * constant length for a given sun elevation — it is simply swept along the sun direction.
 */
export function projectBoxShadowToGround(
  box: Box3D,
  light: Vec3,
  ratio = DEFAULT_SHADOW_RATIO
): Vec2[] {
  return projectBoxShadowToPlane(box, light, ratio, 0);
}

function distPointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-10) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projZ = a.z + t * dz;
  return Math.hypot(p.x - projX, p.z - projZ);
}

/**
 * Returns 0 if p is inside or on the boundary of convex polygon `poly`,
 * otherwise the Euclidean distance from p to the nearest edge of `poly`.
 */
export function distanceToConvexPolygon(p: Vec2, poly: Vec2[]): number {
  if (poly.length < 3) return Infinity;

  let inside = true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (cross2D(a, b, p) < -1e-6) {
      inside = false;
      break;
    }
  }
  if (inside) return 0;

  let minDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const d = distPointToSegment(p, a, b);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function distanceToRect(p: Vec2, rect: Rect2D): number {
  const dx = Math.max(rect.xMin - p.x, 0, p.x - rect.xMax);
  const dz = Math.max(rect.zMin - p.z, 0, p.z - rect.zMax);
  return Math.hypot(dx, dz);
}

export interface SupportResult {
  supported: boolean;
  onPlatform: boolean;
  onShadow: boolean;
  minDist: number;
}

/**
 * Determines whether a ball contact point (x, z) is supported by any solid stone platform
 * or any solidified umbra shadow polygon on the y = 0 traversal plane.
 */
export function checkPointSupport(
  x: number,
  z: number,
  platforms: ShapeLike[],
  shadows: Vec2[][],
  edgeForgiveness = 0.13
): SupportResult {
  const p = { x, z };
  let minPlatformDist = Infinity;
  for (const plat of platforms) {
    const d = plat.points && plat.points.length >= 3 ? distanceToPolygon(p, plat.points) : distanceToRect(p, plat);
    if (d < minPlatformDist) minPlatformDist = d;
    if (d === 0) break;
  }

  let minShadowDist = Infinity;
  for (const poly of shadows) {
    const d = distanceToConvexPolygon(p, poly);
    if (d < minShadowDist) minShadowDist = d;
    if (d === 0) break;
  }

  const onPlatform = minPlatformDist <= edgeForgiveness;
  const onShadow = minShadowDist <= edgeForgiveness;
  const minDist = Math.min(minPlatformDist, minShadowDist);

  return {
    supported: minDist <= edgeForgiveness,
    onPlatform,
    onShadow: !onPlatform && onShadow,
    minDist,
  };
}

/**
 * Resolves 2D circle-vs-AABB collision in the XZ plane for ground-level pillars and obstacles.
 */
export function resolveCircleRectCollision(
  bx: number,
  bz: number,
  vx: number,
  vz: number,
  radius: number,
  rect: Rect2D
): { x: number; z: number; vx: number; vz: number; hit: boolean } {
  const closestX = Math.max(rect.xMin, Math.min(bx, rect.xMax));
  const closestZ = Math.max(rect.zMin, Math.min(bz, rect.zMax));

  let dx = bx - closestX;
  let dz = bz - closestZ;
  const distSq = dx * dx + dz * dz;

  if (distSq >= radius * radius) {
    return { x: bx, z: bz, vx, vz, hit: false };
  }

  let nx = 0;
  let nz = 0;
  let penetration = 0;

  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    nx = dx / dist;
    nz = dz / dist;
    penetration = radius - dist;
  } else {
    // Center is inside rect; push out along shallowest axis
    const leftPen = bx - rect.xMin;
    const rightPen = rect.xMax - bx;
    const topPen = bz - rect.zMin;
    const botPen = rect.zMax - bz;
    const minPen = Math.min(leftPen, rightPen, topPen, botPen);
    if (minPen === leftPen) {
      nx = -1;
      penetration = leftPen + radius;
    } else if (minPen === rightPen) {
      nx = 1;
      penetration = rightPen + radius;
    } else if (minPen === topPen) {
      nz = -1;
      penetration = topPen + radius;
    } else {
      nz = 1;
      penetration = botPen + radius;
    }
  }

  const outX = bx + nx * penetration;
  const outZ = bz + nz * penetration;

  // Dampen inward normal velocity with gentle bounce while keeping smooth tangential slide
  const vn = vx * nx + vz * nz;
  let outVx = vx;
  let outVz = vz;
  if (vn < 0) {
    outVx -= 1.2 * vn * nx;
    outVz -= 1.2 * vn * nz;
  }

  return { x: outX, z: outZ, vx: outVx, vz: outVz, hit: true };
}

/**
 * Checks whether a broken gap between anchorA and anchorB is continuously walkable
 * via platforms + cast umbra shadows using a lightweight local 2D grid BFS.
 */
export function isGapBridged(
  gap: BrokenGapHint,
  platforms: ShapeLike[],
  shadows: Vec2[][],
  groundBlockers: Rect2D[] = []
): boolean {
  const minX = Math.min(gap.xMin, gap.anchorA.x, gap.anchorB.x) - 1.1;
  const maxX = Math.max(gap.xMax, gap.anchorA.x, gap.anchorB.x) + 1.1;
  const minZ = Math.min(gap.zMin, gap.anchorA.z, gap.anchorB.z) - 1.1;
  const maxZ = Math.max(gap.zMax, gap.anchorA.z, gap.anchorB.z) + 1.1;

  // Grid step + forgiveness tuned so the max crossable crack (~0.27) matches the ball physics (2 × 0.14)
  const step = 0.15;
  const cols = Math.max(2, Math.ceil((maxX - minX) / step) + 1);
  const rows = Math.max(2, Math.ceil((maxZ - minZ) / step) + 1);

  const toIdx = (x: number, z: number) => {
    const c = Math.max(0, Math.min(cols - 1, Math.round((x - minX) / step)));
    const r = Math.max(0, Math.min(rows - 1, Math.round((z - minZ) / step)));
    return r * cols + c;
  };

  const passable = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const z = minZ + r * step;
    for (let c = 0; c < cols; c++) {
      const x = minX + c * step;
      if (!checkPointSupport(x, z, platforms, shadows, 0.06).supported) continue;

      let blocked = false;
      for (const b of groundBlockers) {
        if (distanceToRect({ x, z }, b) < 0.26) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        passable[r * cols + c] = 1;
      }
    }
  }

  const startIdx = toIdx(gap.anchorA.x, gap.anchorA.z);
  const goalIdx = toIdx(gap.anchorB.x, gap.anchorB.z);
  passable[startIdx] = 1;
  passable[goalIdx] = 1;

  const visited = new Uint8Array(cols * rows);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;

  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  while (head < tail) {
    const cur = queue[head++];
    if (cur === goalIdx) return true;
    const cr = Math.floor(cur / cols);
    const cc = cur % cols;

    for (const [dr, dc] of dirs) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (!visited[nIdx] && passable[nIdx]) {
        // Prevent squeezing diagonally across a single corner crack
        if (dr !== 0 && dc !== 0) {
          if (!passable[cr * cols + nc] && !passable[nr * cols + cc]) continue;
        }
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  return false;
}

/**
 * Checks whether a SunCrystal is eclipsed (covered) by any cast shadow polygon.
 */
/**
 * Outer silhouette of every cast shadow, merged into one closed contour per
 * connected mass. Overlapping pillars share a single covered line instead of
 * a stroke per object.
 */
export function traceUmbraSilhouette(polys: Vec2[][], cell = 0.16): Vec2[][] {
  if (polys.length === 0) return [];

  const bounds = polys.map((poly) => {
    let xMin = Infinity;
    let xMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const p of poly) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.z < zMin) zMin = p.z;
      if (p.z > zMax) zMax = p.z;
    }
    return { xMin, xMax, zMin, zMax };
  });

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const b of bounds) {
    if (b.xMin < minX) minX = b.xMin;
    if (b.xMax > maxX) maxX = b.xMax;
    if (b.zMin < minZ) minZ = b.zMin;
    if (b.zMax > maxZ) maxZ = b.zMax;
  }

  const pad = cell * 2;
  minX -= pad;
  maxX += pad;
  minZ -= pad;
  maxZ += pad;

  let step = cell;
  let cols = Math.ceil((maxX - minX) / step) + 1;
  let rows = Math.ceil((maxZ - minZ) / step) + 1;
  while (cols * rows > 42000 && step < 0.42) {
    step *= 1.25;
    cols = Math.ceil((maxX - minX) / step) + 1;
    rows = Math.ceil((maxZ - minZ) / step) + 1;
  }

  const grid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const z = minZ + r * step;
    for (let c = 0; c < cols; c++) {
      const x = minX + c * step;
      for (let i = 0; i < polys.length; i++) {
        const b = bounds[i];
        if (x < b.xMin || x > b.xMax || z < b.zMin || z > b.zMax) continue;
        if (distanceToConvexPolygon({ x, z }, polys[i]) === 0) {
          grid[r * cols + c] = 1;
          break;
        }
      }
    }
  }

  // edge ids on each grid square: 0 bottom, 1 right, 2 top, 3 left
  const segs: number[][] = [
    [],
    [3, 0],
    [0, 1],
    [3, 1],
    [1, 2],
    [3, 2, 0, 1],
    [0, 2],
    [3, 2],
    [2, 3],
    [0, 2],
    [0, 3, 1, 2],
    [1, 2],
    [3, 1],
    [0, 1],
    [3, 0],
    [],
  ];

  const mid = (c: number, r: number, edge: number): Vec2 => {
    const x = minX + c * step;
    const z = minZ + r * step;
    if (edge === 0) return { x: x + step * 0.5, z };
    if (edge === 1) return { x: x + step, z: z + step * 0.5 };
    if (edge === 2) return { x: x + step * 0.5, z: z + step };
    return { x, z: z + step * 0.5 };
  };

  const keyOf = (p: Vec2) => `${Math.round(p.x * 400)},${Math.round(p.z * 400)}`;
  const pts = new Map<string, Vec2>();
  const adj = new Map<string, string[]>();
  const link = (a: Vec2, b: Vec2) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === kb) return;
    pts.set(ka, a);
    pts.set(kb, b);
    const na = adj.get(ka) ?? [];
    const nb = adj.get(kb) ?? [];
    na.push(kb);
    nb.push(ka);
    adj.set(ka, na);
    adj.set(kb, nb);
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const bl = grid[r * cols + c];
      const br = grid[r * cols + c + 1];
      const tr = grid[(r + 1) * cols + c + 1];
      const tl = grid[(r + 1) * cols + c];
      const code = bl | (br << 1) | (tr << 2) | (tl << 3);
      const pair = segs[code];
      if (!pair || pair.length < 2) continue;
      for (let i = 0; i < pair.length; i += 2) {
        link(mid(c, r, pair[i]), mid(c, r, pair[i + 1]));
      }
    }
  }

  const used = new Set<string>();
  const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const loops: Vec2[][] = [];

  for (const start of adj.keys()) {
    const nbrs = adj.get(start)!;
    for (const first of nbrs) {
      const ek0 = edgeKey(start, first);
      if (used.has(ek0)) continue;
      const loopKeys = [start];
      let prev = start;
      let cur = first;
      used.add(ek0);
      let guard = 0;
      while (cur !== start && guard++ < 20000) {
        loopKeys.push(cur);
        const nexts = adj.get(cur) ?? [];
        let nxt = '';
        for (const n of nexts) {
          if (n === prev) continue;
          const ek = edgeKey(cur, n);
          if (!used.has(ek)) {
            nxt = n;
            used.add(ek);
            break;
          }
        }
        if (!nxt) break;
        prev = cur;
        cur = nxt;
      }
      if (cur === start && loopKeys.length >= 4) {
        loops.push(loopKeys.map((k) => pts.get(k)!));
      }
    }
  }

  const smooth = (loop: Vec2[]): Vec2[] => {
    let cur = loop;
    for (let pass = 0; pass < 2; pass++) {
      const next: Vec2[] = [];
      for (let i = 0; i < cur.length; i++) {
        const a = cur[i];
        const b = cur[(i + 1) % cur.length];
        next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
      }
      cur = next;
    }
    const slim: Vec2[] = [];
    for (const p of cur) {
      const last = slim[slim.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.045) slim.push(p);
    }
    if (slim.length > 2 && Math.hypot(slim[0].x - slim[slim.length - 1].x, slim[0].z - slim[slim.length - 1].z) < 0.06) {
      slim.pop();
    }
    return slim;
  };

  return loops
    .map(smooth)
    .filter((loop) => {
      if (loop.length < 4) return false;
      let area = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        area += a.x * b.z - b.x * a.z;
      }
      return Math.abs(area) > 0.35;
    });
}

export function isCrystalEclipsed(crystal: SunCrystal, shadows: Vec2[][]): boolean {
  const p = { x: crystal.x, z: crystal.z };
  for (const poly of shadows) {
    if (distanceToConvexPolygon(p, poly) <= crystal.radius * 0.45) {
      return true;
    }
  }
  return false;
}

/* ---------------------------------------------------------- ramps & elevation */

/** Anything with a sloped top the sphere can roll on. Matches RampDef in types.ts. */
export interface RampLike {
  x: number;
  z: number;
  yaw: number;
  length: number;
  width: number;
  y: number;
  rise: number;
}

const rampForward = (yaw: number): Vec2 => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const rampRight = (yaw: number): Vec2 => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

/**
 * Local-frame coordinates of a point on a ramp: `t` along the ascend axis (0 at the low
 * edge, `length` at the high edge) and `u` across it (0 at the centre).
 */
export function rampLocalFrame(
  ramp: RampLike,
  x: number,
  z: number
): { t: number; u: number; fx: number; fz: number; rx: number; rz: number } {
  const f = rampForward(ramp.yaw);
  const r = rampRight(ramp.yaw);
  const dx = x - ramp.x;
  const dz = z - ramp.z;
  return {
    t: dx * f.x + dz * f.z + ramp.length * 0.5,
    u: dx * r.x + dz * r.z,
    fx: f.x,
    fz: f.z,
    rx: r.x,
    rz: r.z,
  };
}

/**
 * Height of the ramp surface at world (x, z), or null when the point lies outside the
 * footprint. `forgiveness` extends the footprint outward (used for sphere edge tolerance).
 */
export function rampHeightAt(ramp: RampLike, x: number, z: number, forgiveness = 0): number | null {
  const { t, u } = rampLocalFrame(ramp, x, z);
  const hw = ramp.width * 0.5;
  if (u < -hw - forgiveness || u > hw + forgiveness) return null;
  if (t < -forgiveness || t > ramp.length + forgiveness) return null;
  const k = ramp.length > 1e-6 ? Math.max(0, Math.min(1, t / ramp.length)) : 0;
  return ramp.y + k * ramp.rise;
}

/**
 * Distance from a point to the nearest edge of the ramp footprint (0 inside). Used for
 * ledge-dip polish and sphere forgiveness, mirroring distanceToRect for flat stones.
 */
export function distanceToRamp(ramp: RampLike, p: Vec2): number {
  const { t, u } = rampLocalFrame(ramp, p.x, p.z);
  const hw = ramp.width * 0.5;
  const dt = Math.max(0, -t, t - ramp.length);
  const du = Math.max(0, Math.abs(u) - hw);
  return Math.hypot(dt, du);
}

/**
 * Resolves circle-vs-rotated-rectangle collision in the XZ plane (oriented bounding box).
 * Ramps are rotated prisms, so the axis-aligned resolver is not enough to stop the sphere
 * from clipping through an elevated ramp body.
 */
export function resolveCircleRotRectCollision(
  bx: number,
  bz: number,
  vx: number,
  vz: number,
  radius: number,
  center: Vec2,
  halfLength: number,
  halfWidth: number,
  yaw: number
): { x: number; z: number; vx: number; vz: number; hit: boolean } {
  const f = rampForward(yaw);
  const r = rampRight(yaw);
  const dx = bx - center.x;
  const dz = bz - center.z;
  // Local frame: l along the length axis, w along the width axis.
  let l = dx * f.x + dz * f.z;
  let w = dx * r.x + dz * r.z;

  const closestL = Math.max(-halfLength, Math.min(l, halfLength));
  const closestW = Math.max(-halfWidth, Math.min(w, halfWidth));

  let dl = l - closestL;
  let dw = w - closestW;
  const distSq = dl * dl + dw * dw;

  if (distSq >= radius * radius) {
    return { x: bx, z: bz, vx, vz, hit: false };
  }

  let nl = 0;
  let nw = 0;
  let penetration = 0;
  if (distSq > 1e-8) {
    const dist = Math.sqrt(distSq);
    nl = dl / dist;
    nw = dw / dist;
    penetration = radius - dist;
  } else {
    const penL = halfLength - Math.abs(l);
    const penW = halfWidth - Math.abs(w);
    if (penL < penW) {
      nl = l >= 0 ? 1 : -1;
      penetration = penL + radius;
    } else {
      nw = w >= 0 ? 1 : -1;
      penetration = penW + radius;
    }
  }

  // Back to world space
  const nx = nl * f.x + nw * r.x;
  const nz = nl * f.z + nw * r.z;
  const outX = bx + nx * penetration;
  const outZ = bz + nz * penetration;

  const vn = vx * nx + vz * nz;
  let outVx = vx;
  let outVz = vz;
  if (vn < 0) {
    outVx -= 1.2 * vn * nx;
    outVz -= 1.2 * vn * nz;
  }

  return { x: outX, z: outZ, vx: outVx, vz: outVz, hit: true };
}
