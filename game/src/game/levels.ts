import { BrokenGapHint, LevelData, PillarStructure, PlatformDef, SunCrystal, Vec2 } from './types';

/* ------------------------------------------------------------------ builders
 * Coordinates are centres in the plan: x runs east/west, z runs south/north
 * (negative z is the far side of the sheet). Builders keep the authored numbers
 * readable; the solvability checks read the resulting LevelData unchanged.
 */

type Style = 'main' | 'island' | 'pedestal';
type Variant = 'terracotta' | 'ochre' | 'slate' | 'trim';

const plat = (
  id: string,
  x: number,
  z: number,
  w: number,
  d: number,
  style: Style = 'main'
): PlatformDef => ({
  id,
  xMin: Math.round((x - w / 2) * 100) / 100,
  xMax: Math.round((x + w / 2) * 100) / 100,
  zMin: Math.round((z - d / 2) * 100) / 100,
  zMax: Math.round((z + d / 2) * 100) / 100,
  style,
  brokenEdges: [],
});

const b = (
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  variant: Variant = 'terracotta',
  yMin = 0,
  castsUmbra = true
) => ({
  xMin: Math.round((x - w / 2) * 100) / 100,
  xMax: Math.round((x + w / 2) * 100) / 100,
  yMin: Math.round(yMin * 100) / 100,
  yMax: Math.round((yMin + h) * 100) / 100,
  zMin: Math.round((z - d / 2) * 100) / 100,
  zMax: Math.round((z + d / 2) * 100) / 100,
  variant,
  castsUmbra,
});

const mono = (
  id: string,
  label: string,
  x: number,
  z: number,
  h: number,
  w = 0.86,
  d = 1.18,
  variant: Variant = 'terracotta'
): PillarStructure => ({
  id,
  label,
  parts: [
    b(x, z, w, d, h, variant),
    // decorative cap: reads as a capital but does not double the walkable shadow
    b(x, z, w + 0.18, d + 0.18, 0.26, 'trim', h - 0.24, false),
  ],
});

const wall = (
  id: string,
  label: string,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  variant: Variant = 'terracotta'
): PillarStructure => ({ id, label, parts: [b(x, z, w, d, h, variant)] });

/** Two legs and a suspended lintel. The lintel's shadow detaches from its feet. */
const archX = (
  id: string,
  label: string,
  x: number,
  z: number,
  span: number,
  h: number,
  opening = 1.25,
  legD = 0.62,
  variant: Variant = 'terracotta'
): PillarStructure => ({
  id,
  label,
  parts: [
    b(x - span / 2, z, 0.55, legD, opening, 'ochre'),
    b(x + span / 2, z, 0.55, legD, opening, 'ochre'),
    b(x, z, span + 0.44, legD * 1.18, h - opening, variant, opening),
  ],
});

/** A wall carried above head height: casts a long shadow without blocking the floor. */
const lintel = (
  id: string,
  label: string,
  x: number,
  z: number,
  w: number,
  d: number,
  yMin: number,
  h: number,
  variant: Variant = 'terracotta'
): PillarStructure => ({ id, label, parts: [b(x, z, w, d, h, variant, yMin)] });

const hgap = (
  id: string,
  west: PlatformDef,
  east: PlatformDef,
  z = 0,
  depth = 2.0,
  inset = 0.48
): BrokenGapHint => ({
  id,
  xMin: west.xMax,
  xMax: east.xMin,
  zMin: z - depth / 2,
  zMax: z + depth / 2,
  anchorA: { x: west.xMax - inset, z },
  anchorB: { x: east.xMin + inset, z },
});

const vgap = (
  id: string,
  north: PlatformDef,
  south: PlatformDef,
  x = 0,
  width = 2.0,
  inset = 0.48
): BrokenGapHint => ({
  id,
  xMin: x - width / 2,
  xMax: x + width / 2,
  zMin: north.zMax,
  zMax: south.zMin,
  anchorA: { x, z: north.zMax - inset },
  anchorB: { x, z: south.zMin + inset },
});

/** A chasm around a corner; anchors sit on the two facing courts. */
const dgap = (
  id: string,
  a: PlatformDef,
  z1: number,
  b: PlatformDef,
  z2: number,
  width = 2.1
): BrokenGapHint => ({
  id,
  xMin: Math.min(a.xMin, b.xMin) - 0.4,
  xMax: Math.max(a.xMax, b.xMax) + 0.4,
  zMin: Math.min(z1, z2) - width / 2,
  zMax: Math.max(z1, z2) + width / 2,
  anchorA: { x: (a.xMin + a.xMax) / 2, z: z1 },
  anchorB: { x: (b.xMin + b.xMax) / 2, z: z2 },
});

const crys = (id: string, x: number, z: number, radius = 0.42): SunCrystal => ({ id, x, z, radius });
const sun = (deg: number, radius: number) => {
  const a = (deg * Math.PI) / 180;
  const r = radius * 0.78;
  return { x: Math.round(Math.sin(a) * r * 100) / 100, y: 5.6, z: Math.round(-Math.cos(a) * r * 100) / 100 };
};
const lb = (radius = 9, ratio = 1.25) => ({
  maxRadius: radius,
  y: Math.round(ratio * 4.48 * 100) / 100,
  shadowRatio: ratio,
});

interface Spec {
  title: string;
  subtitle: string;
  prompt: string;
  hint: string;
  platforms: PlatformDef[];
  pillars: PillarStructure[];
  gaps: BrokenGapHint[];
  crystals?: SunCrystal[];
  start: Vec2;
  goal: Vec2;
  az: number;
  radius?: number;
  ratio?: number;
}

/** Broken-edge teeth are derived from where each chasm touches the stone. */
function teeth(platforms: PlatformDef[], gaps: BrokenGapHint[]): PlatformDef[] {
  return platforms.map((p) => {
    const edges: Array<'north' | 'south' | 'east' | 'west'> = [];
    for (const g of gaps) {
      if (Math.abs(g.xMin - p.xMax) < 0.4 && Math.abs(g.zMax - g.zMin) > 0.9) edges.push('east');
      if (Math.abs(g.xMax - p.xMin) < 0.4 && Math.abs(g.zMax - g.zMin) > 0.9) edges.push('west');
      if (Math.abs(g.zMin - p.zMax) < 0.4 && Math.abs(g.xMax - g.xMin) > 0.9) edges.push('south');
      if (Math.abs(g.zMax - p.zMin) < 0.4 && Math.abs(g.xMax - g.xMin) > 0.9) edges.push('north');
    }
    return { ...p, brokenEdges: [...new Set(edges)] };
  });
}

function cameraFor(s: Spec) {
  let x0 = s.start.x;
  let x1 = s.start.x;
  let z0 = s.start.z;
  let z1 = s.start.z;
  const grow = (r: { xMin: number; xMax: number; zMin: number; zMax: number }) => {
    x0 = Math.min(x0, r.xMin);
    x1 = Math.max(x1, r.xMax);
    z0 = Math.min(z0, r.zMin);
    z1 = Math.max(z1, r.zMax);
  };
  s.platforms.forEach(grow);
  s.gaps.forEach(grow);
  s.pillars.forEach((p) => p.parts.forEach(grow));
  (s.crystals ?? []).forEach((c) => grow({ xMin: c.x, xMax: c.x, zMin: c.z, zMax: c.z }));
  const orbit = (s.radius ?? 9) * 0.78;
  x0 = Math.min(x0, -orbit * 0.72);
  x1 = Math.max(x1, orbit * 0.72);
  z0 = Math.min(z0, -orbit * 0.72);
  z1 = Math.max(z1, orbit * 0.72);

  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const extent = Math.max(x1 - x0, (z1 - z0) * 1.15);
  const d = Math.max(12.5, extent * 1.38);
  return {
    offset: {
      x: Math.round((cx + extent * 0.15) * 10) / 10,
      y: Math.round(d * 1.28 * 10) / 10,
      z: Math.round((cz + d * 1.05) * 10) / 10,
    },
    lookAt: { x: Math.round(cx * 10) / 10, y: 1.25, z: Math.round((cz - 0.2) * 10) / 10 },
  };
}

function make(spec: Spec, index: number): LevelData {
  const radius = spec.radius ?? 9;
  const ratio = spec.ratio ?? 1.25;
  return {
    id: `chap-${String(index + 1).padStart(2, '0')}`,
    number: index + 1,
    title: spec.title,
    subtitle: spec.subtitle,
    prompt: spec.prompt,
    hint: spec.hint,
    platforms: teeth(spec.platforms, spec.gaps),
    pillars: spec.pillars,
    brokenGaps: spec.gaps,
    sunCrystals: spec.crystals?.length ? spec.crystals : undefined,
    start: spec.start,
    goal: spec.goal,
    lightInitial: sun(spec.az, radius),
    lightBounds: lb(radius, ratio),
    camera: cameraFor(spec),
  };
}

const aim = 'Turn the distant sun until a shadow holds across the broken stone, then roll.';

/* ---------------------------------------------------------------- chapters */

const SPECS: Spec[] = [
  // I — a single lesson, four compass directions, then the first elevated caster
  {
    title: 'First Alignment', subtitle: 'Materialised Umbra',
    prompt: aim,
    hint: 'Point the sun West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -4.2, 0, 6.4, 3.4), plat('b', 4.2, 0, 6.4, 3.4)],
    pillars: [mono('m', 'West Obelisk', -2.9, 0, 3.5)],
    gaps: [hgap('g', plat('a', -4.2, 0, 6.4, 3.4), plat('b', 4.2, 0, 6.4, 3.4))],
    start: { x: -5.2, z: 0 }, goal: { x: 5.2, z: 0 }, az: 90,
  },
  {
    title: 'From the Far Bank', subtitle: 'Reverse Bearing',
    prompt: aim,
    hint: 'Set the light to East (about 90°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -4.2, 0, 6.4, 3.4), plat('b', 4.2, 0, 6.4, 3.4)],
    pillars: [mono('m', 'East Obelisk', 2.9, 0, 3.5)],
    gaps: [hgap('g', plat('a', -4.2, 0, 6.4, 3.4), plat('b', 4.2, 0, 6.4, 3.4))],
    start: { x: -5.2, z: 0 }, goal: { x: 5.2, z: 0 }, az: 270,
  },
  {
    title: 'Meridian South', subtitle: 'Shadow Falls Downward',
    prompt: aim,
    hint: 'Aim for North (about 0°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', 0, -4.2, 6.4, 3.4), plat('b', 0, 4.2, 6.4, 3.4)],
    pillars: [mono('m', 'North Gnomon', 0, -4.2, 4.95)],
    gaps: [vgap('g', plat('a', 0, -4.2, 6.4, 3.4), plat('b', 0, 4.2, 6.4, 3.4))],
    start: { x: 0, z: -5.2 }, goal: { x: 0, z: 5.2 }, az: 180,
  },
  {
    title: 'Meridian North', subtitle: 'The Returning Ray',
    prompt: aim,
    hint: 'Turn until the sun rests at South (about 180°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', 0, -4.2, 6.4, 3.4), plat('b', 0, 4.2, 6.4, 3.4)],
    pillars: [mono('m', 'South Gnomon', 0, 4.2, 4.95)],
    gaps: [vgap('g', plat('a', 0, -4.2, 6.4, 3.4), plat('b', 0, 4.2, 6.4, 3.4))],
    start: { x: 0, z: -5.2 }, goal: { x: 0, z: 5.2 }, az: 0,
  },
  {
    title: 'The Long Wall', subtitle: 'A Broad Silhouette',
    prompt: 'A narrow needle makes a narrow path. The wall makes a road.',
    hint: 'The answer lies at North (about 0°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', 0, -4.3, 7.2, 3.0), plat('b', 0, 4.3, 7.2, 3.0), plat('ped', 0, -1.7, 5.4, 2.4, 'pedestal')],
    pillars: [lintel('w', 'Horizon Wall', 0, -1.7, 4.6, 0.9, 1.05, 4.0)],
    gaps: [vgap('g', plat('a', 0, -4.3, 7.2, 3.0), plat('b', 0, 4.3, 7.2, 3.0), 0, 3.2)],
    start: { x: 0, z: -5 }, goal: { x: 0, z: 5 }, az: 180,
  },
  {
    title: 'Tall Needle', subtitle: 'Reach Without Width',
    prompt: 'One slender caster. One wide void. Height does the work.',
    hint: 'Point the sun West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -4.4, 0, 6.0, 2.8), plat('b', 4.4, 0, 6.0, 2.8)],
    pillars: [mono('m', 'Needle', -2.85, 0, 4.35, 0.62, 0.85)],
    gaps: [hgap('g', plat('a', -4.4, 0, 6.0, 2.8), plat('b', 4.4, 0, 6.0, 2.8), 0, 1.6)],
    start: { x: -5.4, z: 0 }, goal: { x: 5.4, z: 0 }, az: 90,
  },
  {
    title: 'Suspended Lintel', subtitle: 'The Shadow Detaches',
    prompt: 'No monolith guards the cliff. Look overhead.',
    hint: 'Set the light to West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -4.8, 0, 7.0, 4.0), plat('b', 4.3, 0, 6.0, 3.2)],
    pillars: [archX('ar', 'Sun Gate', -3.5, 0, 2.2, 4.5, 1.25, 0.7)],
    gaps: [hgap('g', plat('a', -4.8, 0, 7.0, 4.0), plat('b', 4.3, 0, 6.0, 3.2))],
    start: { x: -6.4, z: 0 }, goal: { x: 5.2, z: 0 }, az: 90,
  },
  {
    title: 'Oblique Court', subtitle: 'A Diagonal Span',
    prompt: 'The two courts touch only at a corner. Find the bearing that makes them one.',
    hint: 'Aim for North-West (about 318°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -4.2, -3.0, 5.6, 3.2), plat('b', 3.2, 3.0, 5.6, 3.2)],
    pillars: [mono('m', 'Corner Stone', -2.6, -2.0, 4.0)],
    gaps: [dgap('g', plat('a', -4.2, -3.0, 5.6, 3.2), -2.6, plat('b', 3.2, 3.0, 5.6, 3.2), 2.6, 2.6)],
    start: { x: -5.2, z: -3.0 }, goal: { x: 4.2, z: 3.0 }, az: 140,
  },
  {
    title: 'One Island Between', subtitle: 'The First Relay',
    prompt: 'No single shadow can cross both breaks. Use the island as a resting place.',
    hint: 'Read each stone before turning again: first with the sun East (90°), then second with the sun West (270°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -6.0, 0, 4.2, 3.0), plat('mid', 0, 0, 3.2, 3.4, 'island'), plat('b', 6.0, 0, 4.2, 3.0)],
    pillars: [mono('m', 'Sundial Needle', 0, 0, 3.7, 0.95, 1.2)],
    gaps: [
      hgap('g1', plat('a', -6.0, 0, 4.2, 3.0), plat('mid', 0, 0, 3.2, 3.4)),
      hgap('g2', plat('mid', 0, 0, 3.2, 3.4), plat('b', 6.0, 0, 4.2, 3.0)),
    ],
    start: { x: -6.8, z: 0 }, goal: { x: 6.8, z: 0 }, az: 0,
  },
  {
    title: 'Crosswind', subtitle: 'North–South Relay',
    prompt: 'The path turns. The light must turn with it.',
    hint: 'Cross in sequence: first with the sun North-East (60°), then second with the sun North-West (318°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -4.4, -4.4, 4.4, 3.0), plat('mid', -4.4, 0, 3.6, 3.4, 'island'), plat('b', -4.4, 4.4, 4.4, 3.0)],
    pillars: [mono('m1', 'First Gnomon', -4.4, -2.6, 3.6), mono('m2', 'Second Gnomon', -3.8, 1.6, 3.6)],
    gaps: [
      vgap('g1', plat('a', -4.4, -4.4, 4.4, 3.0), plat('mid', -4.4, 0, 3.6, 3.4), -4.4, 2.0),
      vgap('g2', plat('mid', -4.4, 0, 3.6, 3.4), plat('b', -4.4, 4.4, 4.4, 3.0), -4.4, 2.0),
    ],
    start: { x: -5.2, z: -5.2 }, goal: { x: -4.0, z: 5.2 }, az: 220,
  },

  // II — corners, relays and overlapping silhouettes
  {
    title: 'Corner Turn', subtitle: 'Two Bearings, One Journey',
    prompt: 'Go East, then go South. The light has to work twice.',
    hint: 'Work the spans in order: first with the sun East (84°), then second with the sun North (9°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -5.2, 0, 4.4, 3.0),
      plat('mid', 0, 0, 3.4, 3.4, 'island'),
      plat('b', 0, 5.0, 4.6, 3.2),
    ],
    pillars: [mono('m1', 'East Obelisk', 1.0, 0.7, 3.5), wall('m2', 'North Wall', 0, -0.5, 1.6, 0.7, 3.8)],
    gaps: [
      hgap('g1', plat('a', -5.2, 0, 4.4, 3.0), plat('mid', 0, 0, 3.4, 3.4)),
      vgap('g2', plat('mid', 0, 0, 3.4, 3.4), plat('b', 0, 5.0, 4.6, 3.2), 0, 2.0),
    ],
    start: { x: -6, z: 0 }, goal: { x: 0, z: 6 }, az: 230,
  },
  {
    title: 'Split Decision', subtitle: 'Alternate Routes',
    prompt: 'Two chasms and two ways to think about them.',
    hint: 'Take the crossings one at a time: first with the sun East (90°), then second with the sun North (0°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -5.4, -2.4, 4.2, 3.0), plat('mid', 0, -2.4, 3.0, 3.0, 'island'), plat('b', 0, 3.4, 4.6, 3.2)],
    pillars: [mono('m1', 'Island Needle', 0, -2.4, 3.52), wall('m2', 'Southern Wall', 0, 3.4, 2.6, 0.8, 3.5)],
    gaps: [
      hgap('g1', plat('a', -5.4, -2.4, 4.2, 3.0), plat('mid', 0, -2.4, 3.0, 3.0), -2.4),
      vgap('g2', plat('mid', 0, -2.4, 3.0, 3.0), plat('b', 0, 3.4, 4.6, 3.2), 0, 2.0),
    ],
    start: { x: -6.2, z: -2.4 }, goal: { x: 0, z: 4.2 }, az: 310,
  },
  {
    title: 'The Long Reach', subtitle: 'Height Over Distance',
    prompt: 'The chasm is wider than any ordinary shadow.',
    hint: 'Aim for West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -5.4, 0, 5.2, 3.6), plat('b', 5.4, 0, 5.2, 3.6)],
    pillars: [mono('m', 'Tall Sentinel', -5.4, 0, 5.95, 1.0, 1.5)],
    gaps: [hgap('g', plat('a', -5.4, 0, 5.2, 3.6), plat('b', 5.4, 0, 5.2, 3.6), 0, 1.8)],
    start: { x: -6.6, z: 0 }, goal: { x: 6.6, z: 0 }, az: 90, ratio: 1.3,
  },
  {
    title: 'Slender Bridge', subtitle: 'Precision of Angle',
    prompt: 'A wide shadow is no use here. The crossing has to be exact.',
    hint: 'Turn until the sun rests at West (about 282°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -4.8, -1.0, 5.6, 2.8), plat('b', 4.8, 1.0, 5.6, 2.8)],
    pillars: [mono('m', 'Fine Needle', -2.9, -1.0, 3.8, 0.6, 0.8)],
    gaps: [dgap('g', plat('a', -4.8, -1.0, 5.6, 2.8), -0.8, plat('b', 4.8, 1.0, 5.6, 2.8), 0.8, 1.3)],
    start: { x: -6, z: -1.0 }, goal: { x: 6, z: 1.0 }, az: 100,
  },
  {
    title: 'Shadow Play', subtitle: 'Two Make One',
    prompt: 'Neither pillar reaches alone. Their shadows must meet.',
    hint: 'The answer lies at West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -5.4, 0, 5.4, 3.6), plat('b', 5.4, 0, 5.4, 3.6)],
    pillars: [
      mono('m1', 'Lower Tower', -5.4, 0, 6.05, 0.9, 1.1),
      mono('m2', 'Upper Tower', -5.4, 1.3, 3.9, 0.9, 1.1),
    ],
    gaps: [hgap('g', plat('a', -5.4, 0, 5.4, 3.6), plat('b', 5.4, 0, 5.4, 3.6), 0, 2.2)],
    start: { x: -6.4, z: 0 }, goal: { x: 6.4, z: 0 }, az: 90,
  },
  {
    title: 'Relay One', subtitle: 'A Change of Mind',
    prompt: 'Cross to the island. Then change the sun before you move on.',
    hint: 'Work the spans in order: first with the sun East (90°), then second with the sun West (270°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -6.2, 0, 4.2, 3.2), plat('mid', 0, 0, 3.6, 3.8, 'island'), plat('b', 6.2, 0, 4.2, 3.2)],
    pillars: [mono('m', 'Double Needle', 0, 0, 4.0, 1.0, 1.3)],
    gaps: [
      hgap('g1', plat('a', -6.2, 0, 4.2, 3.2), plat('mid', 0, 0, 3.6, 3.8)),
      hgap('g2', plat('mid', 0, 0, 3.6, 3.8), plat('b', 6.2, 0, 4.2, 3.2)),
    ],
    start: { x: -7, z: 0 }, goal: { x: 7, z: 0 }, az: 0,
  },
  {
    title: 'Relay Two', subtitle: 'Three Stone Notes',
    prompt: 'Three separate crossings. Read each one on its own.',
    hint: 'Take the crossings one at a time: first with the sun East (90°), then second with the sun North (0°), then third with the sun North-East (33°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -6.6, 0, 3.8, 3.0),
      plat('m1', -2.2, 0, 2.8, 3.0, 'island'),
      plat('m2', -2.2, 4.6, 3.0, 2.8, 'island'),
      plat('b', 2.4, 4.6, 4.0, 3.0),
    ],
    pillars: [
      mono('m1', 'First Needle', -2.2, 0, 3.52),
      mono('m2', 'Second Needle', -2.2, 0, 3.42),
      mono('m3', 'Third Needle', 0.2, 4.6, 3.5),
    ],
    gaps: [
      hgap('g1', plat('a', -6.6, 0, 3.8, 3.0), plat('m1', -2.2, 0, 2.8, 3.0), 0, 1.7),
      vgap('g2', plat('m1', -2.2, 0, 2.8, 3.0), plat('m2', -2.2, 4.6, 3.0, 2.8), -2.2, 1.7),
      hgap('g3', plat('m2', -2.2, 4.6, 3.0, 2.8), plat('b', 2.4, 4.6, 4.0, 3.0), 4.6, 1.7),
    ],
    start: { x: -7.2, z: 0 }, goal: { x: 3.2, z: 4.6 }, az: 305,
  },
  {
    title: 'Arch and Obelisk', subtitle: 'Two Kinds of Caster',
    prompt: 'One crossing belongs to the arch. The other belongs to the obelisk.',
    hint: 'The islands allow second thoughts: first with the sun East (90°), then second with the sun North (0°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -5.4, 0, 5.6, 3.8), plat('mid', 0.8, 0, 3.2, 3.4, 'island'), plat('b', 0.8, 5.2, 4.4, 3.0)],
    pillars: [archX('ar', 'West Arch', -5.3, 0, 2.0, 4.5, 1.2), mono('m', 'Island Obelisk', 0.8, 0, 3.72)],
    gaps: [
      hgap('g1', plat('a', -5.4, 0, 5.6, 3.8), plat('mid', 0.8, 0, 3.2, 3.4)),
      vgap('g2', plat('mid', 0.8, 0, 3.2, 3.4), plat('b', 0.8, 5.2, 4.4, 3.0), 0.8, 1.9),
    ],
    start: { x: -6.4, z: 0 }, goal: { x: 0.8, z: 6.2 }, az: 185,
  },

  // III — crystals join the vocabulary
  {
    title: 'The Amber Seal', subtitle: 'Light Must Stay Lit',
    prompt: 'The goal is sealed while the sun crystal is covered. Bridge carefully.',
    hint: 'Turn until the sun rests at West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.0, 0, 6.0, 4.2), plat('b', 5.0, 0, 6.0, 4.2)],
    pillars: [mono('m', 'Seal Pillar', -3.1, 0, 3.8)],
    gaps: [hgap('g', plat('a', -5.0, 0, 6.0, 4.2), plat('b', 5.0, 0, 6.0, 4.2), 0, 2.4)],
    crystals: [crys('c', 3.0, 0.6)],
    start: { x: -6.0, z: 0 }, goal: { x: 6.0, z: 0 }, az: 90,
  },
  {
    title: 'Crystal Corner', subtitle: 'An Angled Answer',
    prompt: 'The direct shadow would seal the way. Find the oblique one.',
    hint: 'The answer lies at West (about 285°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.0, -1.4, 6.0, 3.6), plat('b', 5.0, 1.4, 6.0, 3.6)],
    pillars: [mono('m', 'Corner Pillar', -3.1, -1.4, 4.1)],
    gaps: [dgap('g', plat('a', -5.0, -1.4, 6.0, 3.6), -1.2, plat('b', 5.0, 1.4, 6.0, 3.6), 1.2, 2.2)],
    crystals: [crys('c', 3.2, 1.4)],
    start: { x: -6.0, z: -1.4 }, goal: { x: 6.0, z: 1.4 }, az: 105,
  },
  {
    title: 'Twin Witnesses', subtitle: 'A Shadow Made of Two',
    prompt: 'Both casters see the same sun. Only together do they make a road.',
    hint: 'Point the sun West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -5.6, 0, 5.8, 4.4), plat('b', 5.6, 0, 5.8, 4.4)],
    pillars: [
      mono('m1', 'First Witness', -5.6, 0, 6.3, 0.85, 1.1),
      mono('m2', 'Second Witness', -5.6, 1.3, 4.2, 0.85, 1.1),
    ],
    gaps: [hgap('g', plat('a', -5.6, 0, 5.8, 4.4), plat('b', 5.6, 0, 5.8, 4.4), 0, 2.6)],
    start: { x: -6.6, z: 0 }, goal: { x: 6.6, z: 0 }, az: 90,
  },
  {
    title: 'Shadow Stitch', subtitle: 'Overlap as Architecture',
    prompt: 'The break is too wide for any one silhouette. Stitch two together.',
    hint: 'Set the light to North-West (about 300°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -3.6, -2.0, 4.6, 3.2), plat('b', 3.2, 2.0, 4.6, 3.2)],
    pillars: [
      wall('w', 'North Lintel', -4.6, -2.0, 2.4, 0.8, 5.6),
      mono('m', 'South Needle', -4.4, -0.6, 5.4),
    ],
    gaps: [{
        id: 'g', xMin: -1.3, xMax: 0.9, zMin: -3.2, zMax: 3.2,
        anchorA: { x: -1.8, z: -2.0 }, anchorB: { x: 1.4, z: 2.0 },
      }],
    start: { x: -4.8, z: -2.0 }, goal: { x: 4.2, z: 2.0 }, az: 120,
  },
  {
    title: 'Serpentine', subtitle: 'A Path That Bends',
    prompt: 'Three courts, three breaks, one long act of attention.',
    hint: 'The islands allow second thoughts: first with the sun East (90°), then second with the sun North (0°), then third with the sun South-West (216°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -6.4, -2.0, 3.8, 3.0),
      plat('m1', -2.0, -2.0, 3.0, 3.0, 'island'),
      plat('m2', -2.0, 2.6, 3.0, 3.0, 'island'),
      plat('b', 2.6, 2.6, 4.0, 3.2),
    ],
    pillars: [
      mono('m1', 'Needle One', -2.0, -2.0, 3.52),
      mono('m2', 'Needle Two', -2.2, -2.0, 3.42),
      mono('m3', 'Needle Three', -0.4, 2.6, 3.5),
    ],
    gaps: [
      hgap('g1', plat('a', -6.4, -2.0, 3.8, 3.0), plat('m1', -2.0, -2.0, 3.0, 3.0), -2.0, 1.7),
      vgap('g2', plat('m1', -2.0, -2.0, 3.0, 3.0), plat('m2', -2.0, 2.6, 3.0, 3.0), -2.0, 1.7),
      hgap('g3', plat('m2', -2.0, 2.6, 3.0, 3.0), plat('b', 2.6, 2.6, 4.0, 3.2), 2.6, 1.7),
    ],
    start: { x: -7.2, z: -2.0 }, goal: { x: 3.4, z: 2.6 }, az: 270,
  },
  {
    title: 'Switchback', subtitle: 'The Returning Shadow',
    prompt: 'The second crossing runs back against the first.',
    hint: 'Read each stone before turning again: first with the sun South (165°), then second with the sun North-West (315°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -4.0, -4.8, 4.0, 3.0),
      plat('m', -4.0, 0, 3.4, 3.4, 'island'),
      plat('b', 1.0, 0, 4.6, 3.4),
    ],
    pillars: [mono('m1', 'Upper Needle', -4.0, -3.0, 3.6), lintel('m2', 'Island Wall', -2.9, 0, 0.8, 2.8, 1.1, 3.7)],
    gaps: [
      vgap('g1', plat('a', -4.0, -4.8, 4.0, 3.0), plat('m', -4.0, 0, 3.4, 3.4), -4.0, 1.8),
      hgap('g2', plat('m', -4.0, 0, 3.4, 3.4), plat('b', 1.0, 0, 4.6, 3.4), 0, 1.8),
    ],
    start: { x: -4.8, z: -5.6 }, goal: { x: 2.0, z: 0 }, az: 90,
  },
  {
    title: 'The Pinch', subtitle: 'Crystal on the Causeway',
    prompt: 'The crystal sits where the easiest shadow would fall.',
    hint: 'The answer lies at West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.2, 0, 6.0, 3.8), plat('b', 5.2, 0, 6.0, 3.8)],
    pillars: [mono('m', 'Pinch Pillar', -5.2, 0, 5.6)],
    gaps: [hgap('g', plat('a', -5.2, 0, 6.0, 3.8), plat('b', 5.2, 0, 6.0, 3.8), 0, 2.2)],
    crystals: [crys('c', 3.0, 1.4)],
    start: { x: -6.2, z: 0 }, goal: { x: 6.2, z: 0 }, az: 90,
  },
  {
    title: 'Twin Spans', subtitle: 'One Island, Two Directions',
    prompt: 'A single caster serves two broken spans if you ask it twice.',
    hint: 'Work the spans in order: first with the sun East (90°), then second with the sun West (270°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -6.4, 0, 4.0, 3.2), plat('mid', 0, 0, 3.4, 3.4, 'island'), plat('b', 6.4, 0, 4.0, 3.2)],
    pillars: [mono('m', 'Twin Needle', 0, 0, 4.05, 0.9, 1.2)],
    gaps: [
      hgap('g1', plat('a', -6.4, 0, 4.0, 3.2), plat('mid', 0, 0, 3.4, 3.4)),
      hgap('g2', plat('mid', 0, 0, 3.4, 3.4), plat('b', 6.4, 0, 4.0, 3.2)),
    ],
    start: { x: -7.2, z: 0 }, goal: { x: 7.2, z: 0 }, az: 0,
  },
  {
    title: 'The Veil', subtitle: 'A Shadow With a Hole',
    prompt: 'The crystal must stay uncovered while two shadows cross.',
    hint: 'Set the light to West (about 288°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -4.8, -1.8, 5.6, 3.4), plat('b', 4.8, 1.8, 5.6, 3.4)],
    pillars: [
      mono('m1', 'Veil North', -3.2, -1.8, 4.7),
      mono('m2', 'Veil South', -3.2, -0.3, 4.7),
    ],
    gaps: [dgap('g', plat('a', -4.8, -1.8, 5.6, 3.4), -1.8, plat('b', 4.8, 1.8, 5.6, 3.4), 1.8, 2.4)],
    crystals: [crys('c', 3.2, 2.6)],
    start: { x: -5.8, z: -1.8 }, goal: { x: 5.8, z: 1.8 }, az: 105,
  },
  {
    title: 'Elevated Relay', subtitle: 'The Arch Hands Over',
    prompt: 'First a lintel, then a needle. Neither works for both crossings.',
    hint: 'The islands allow second thoughts: first with the sun East (90°), then second with the sun North (354°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -5.8, 0, 5.8, 4.0), plat('mid', 0.6, 0, 3.4, 3.4, 'island'), plat('b', 0.6, 5.2, 4.6, 3.2)],
    pillars: [archX('ar', 'Relay Arch', -4.0, 0, 2.1, 4.6, 1.25), mono('m', 'Relay Needle', 0.6, 0, 3.82)],
    gaps: [
      hgap('g1', plat('a', -5.8, 0, 5.8, 4.0), plat('mid', 0.6, 0, 3.4, 3.4)),
      vgap('g2', plat('mid', 0.6, 0, 3.4, 3.4), plat('b', 0.6, 5.2, 4.6, 3.2), 0.6, 1.9),
    ],
    start: { x: -6.8, z: 0 }, goal: { x: 0.6, z: 6.2 }, az: 145,
  },
  {
    title: 'Broken Cross', subtitle: 'Four Courts, Two Roads',
    prompt: 'The centre is gone. Only two of the four arms can be joined at once.',
    hint: 'Read each stone before turning again: first with the sun West (270°), then second with the sun North-West (336°), then third with the sun North (0°), then fourth with the sun North-West (300°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('w', -5.4, 0, 3.8, 3.0), plat('e', 5.4, 0, 3.8, 3.0),
      plat('n', 0, -5.4, 3.0, 3.8), plat('s', 0, 5.4, 3.0, 3.8),
      plat('mid', 0, 0, 2.8, 2.8, 'island'),
    ],
    pillars: [mono('mw', 'West Needle', -5.4, 0, 5.1), mono('mn', 'North Needle', 0, -5.4, 5.95)],
    gaps: [
      hgap('g1', plat('w', -5.4, 0, 3.8, 3.0), plat('mid', 0, 0, 2.8, 2.8), 0, 1.7),
      hgap('g2', plat('mid', 0, 0, 2.8, 2.8), plat('e', 5.4, 0, 3.8, 3.0), 0, 1.7),
      vgap('g3', plat('n', 0, -5.4, 3.0, 3.8), plat('mid', 0, 0, 2.8, 2.8), 0, 1.7),
      vgap('g4', plat('mid', 0, 0, 2.8, 2.8), plat('s', 0, 5.4, 3.0, 3.8), 0, 1.7),
    ],
    start: { x: -6.2, z: 0 }, goal: { x: 0, z: 6.2 }, az: 135, radius: 10,
  },

  // IV — tighter geometry and multiple constraints
  {
    title: 'The Compass', subtitle: 'Choosing a Direction',
    prompt: 'Four chasms surround the centre. Only one sequence reaches home.',
    hint: 'Cross in sequence: first with the sun North (0°), then second with the sun East (90°), then third with the sun South (180°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('n', 0, -5.6, 3.2, 3.4), plat('mid', 0, 0, 3.2, 3.2, 'island'),
      plat('e', 5.6, 0, 3.4, 3.2), plat('s', 0, 5.6, 3.2, 3.4),
    ],
    pillars: [wall('wn', 'Compass Wall', 0, -5.6, 2.8, 0.85, 3.6), mono('me', 'East Needle', 5.6, 0, 3.62)],
    gaps: [
      vgap('g1', plat('n', 0, -5.6, 3.2, 3.4), plat('mid', 0, 0, 3.2, 3.2), 0, 1.8),
      hgap('g2', plat('mid', 0, 0, 3.2, 3.2), plat('e', 5.6, 0, 3.4, 3.2), 0, 1.8),
      hgap('g3', plat('mid', 0, 0, 3.2, 3.2), plat('s', 0, 5.6, 3.2, 3.4), 0, 1.8),
    ],
    start: { x: 0, z: -6.4 }, goal: { x: 6.4, z: 0 }, az: 0, radius: 10,
  },
  {
    title: 'Two Crystal Seal', subtitle: 'Both Must Shine',
    prompt: 'Two crystals guard the goal. Cover either and the sanctuary closes.',
    hint: 'Point the sun West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.2, 0, 6.0, 4.6), plat('b', 5.2, 0, 6.0, 4.6)],
    pillars: [mono('m', 'Double Seal Pillar', -5.2, 0, 5.65)],
    gaps: [hgap('g', plat('a', -5.2, 0, 6.0, 4.6), plat('b', 5.2, 0, 6.0, 4.6), 0, 2.8)],
    crystals: [crys('c1', 3.0, -1.6), crys('c2', 3.0, 1.6)],
    start: { x: -6.2, z: 0 }, goal: { x: 6.2, z: 0 }, az: 90,
  },
  {
    title: 'The Weave', subtitle: 'Crossing at Different Times',
    prompt: 'Two spans overlap in plan but not in bearing.',
    hint: 'Take the crossings one at a time: first with the sun East (90°), then second with the sun North (0°), then third with the sun West (270°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -5.6, -2.4, 4.6, 3.0), plat('mid', 0, -2.4, 3.2, 3.0, 'island'),
      plat('m2', 0, 2.4, 3.2, 3.0, 'island'), plat('b', 5.6, 2.4, 4.6, 3.0),
    ],
    pillars: [
      mono('m1', 'Upper Needle', 0, -2.4, 3.62),
      mono('m2', 'Lower Needle', -0.9, 2.4, 3.6),
    ],
    gaps: [
      hgap('g1', plat('a', -5.6, -2.4, 4.6, 3.0), plat('mid', 0, -2.4, 3.2, 3.0), -2.4, 1.7),
      vgap('g2', plat('mid', 0, -2.4, 3.2, 3.0), plat('m2', 0, 2.4, 3.2, 3.0), 0, 1.7),
      hgap('g3', plat('m2', 0, 2.4, 3.2, 3.0), plat('b', 5.6, 2.4, 4.6, 3.0), 2.4, 1.7),
    ],
    start: { x: -6.4, z: -2.4 }, goal: { x: 6.4, z: 2.4 }, az: 0,
  },
  {
    title: 'The Causeway', subtitle: 'A Bridge in Two Pieces',
    prompt: 'A long channel with one narrow resting stone.',
    hint: 'The islands allow second thoughts: first with the sun West (270°), then second with the sun East (90°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', -7.0, 0, 4.0, 3.4), plat('mid', 0, 0, 2.6, 2.8, 'pedestal'), plat('b', 7.0, 0, 4.0, 3.4)],
    pillars: [mono('mw', 'West Needle', -7.0, 0, 4.25), lintel('me', 'East Wall', 7.0, 0, 0.9, 2.6, 1.05, 4.2)],
    gaps: [
      hgap('g1', plat('a', -7.0, 0, 4.0, 3.4), plat('mid', 0, 0, 2.6, 2.8), 0, 1.9),
      hgap('g2', plat('mid', 0, 0, 2.6, 2.8), plat('b', 7.0, 0, 4.0, 3.4), 0, 1.9),
    ],
    start: { x: -7.8, z: 0 }, goal: { x: 7.8, z: 0 }, az: 185, radius: 11,
  },
  {
    title: 'The Founder', subtitle: 'Crystal at the Lip',
    prompt: 'The oldest seal sits exactly where the straightest bridge would fall.',
    hint: 'Turn until the sun rests at West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.4, 0, 6.0, 4.2), plat('b', 5.4, 0, 6.0, 4.2)],
    pillars: [mono('m', 'Founder Stone', -5.4, 0, 6.0)],
    gaps: [hgap('g', plat('a', -5.4, 0, 6.0, 4.2), plat('b', 5.4, 0, 6.0, 4.2), 0, 2.6)],
    crystals: [crys('c', 2.9, 1.4)],
    start: { x: -6.4, z: 0 }, goal: { x: 6.4, z: 0 }, az: 90,
  },
  {
    title: 'The Glass Court', subtitle: 'Narrow Footing',
    prompt: 'There is no room to be almost right.',
    hint: 'The answer lies at West (about 279°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -5.0, -0.8, 5.6, 2.4), plat('b', 5.0, 0.8, 5.6, 2.4)],
    pillars: [mono('m', 'Glass Needle', -3.0, -0.8, 3.9, 0.62, 0.82)],
    gaps: [dgap('g', plat('a', -5.0, -0.8, 5.6, 2.4), -0.6, plat('b', 5.0, 0.8, 5.6, 2.4), 0.6, 1.15)],
    start: { x: -6.0, z: -0.8 }, goal: { x: 6.0, z: 0.8 }, az: 100,
  },
  {
    title: 'Meridian', subtitle: 'A Long Vertical Study',
    prompt: 'The court is tall. The shadows must travel a long way south.',
    hint: 'Work the spans in order: first with the sun South-West (210°), then second with the sun North (3°). Pause on each stone island before you turn the light again.',
    platforms: [plat('a', 0, -5.6, 5.0, 3.0), plat('mid', 0, 0, 4.2, 2.8, 'island'), plat('b', 0, 5.6, 5.0, 3.0)],
    pillars: [mono('m1', 'Upper Gnomon', -0.8, -4.2, 4.3), mono('m2', 'Lower Gnomon', 0.8, -1.3, 4.3)],
    gaps: [
      vgap('g1', plat('a', 0, -5.6, 5.0, 3.0), plat('mid', 0, 0, 4.2, 2.8), 0, 2.0),
      vgap('g2', plat('mid', 0, 0, 4.2, 2.8), plat('b', 0, 5.6, 5.0, 3.0), 0, 2.0),
    ],
    start: { x: 0, z: -6.4 }, goal: { x: 0, z: 6.4 }, az: 180, radius: 10,
  },
  {
    title: 'Clockwise', subtitle: 'A Ring of Four Islands',
    prompt: 'Move around the ring. Each crossing asks for a new bearing.',
    hint: 'Take the crossings one at a time: first with the sun North (0°), then second with the sun East (93°), then third with the sun South (180°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('sw', -4.6, 4.2, 3.2, 3.0), plat('nw', -4.6, -0.4, 3.2, 3.0, 'island'),
      plat('ne', 0.6, -0.4, 3.0, 3.2, 'island'), plat('se', 0.6, 4.2, 3.2, 3.0),
    ],
    pillars: [
      mono('m1', 'First Marker', -4.6, -0.4, 3.8),
      mono('m2', 'Second Marker', 0.6, -0.4, 3.8),
      mono('m3', 'Third Marker', 0.6, 4.2, 3.8),
    ],
    gaps: [
      vgap('g1', plat('nw', -4.6, -0.4, 3.2, 3.0), plat('sw', -4.6, 4.2, 3.2, 3.0), -4.6, 1.8),
      hgap('g2', plat('nw', -4.6, -0.4, 3.2, 3.0), plat('ne', 0.6, -0.4, 3.0, 3.2), -0.4, 1.8),
      vgap('g3', plat('ne', 0.6, -0.4, 3.0, 3.2), plat('se', 0.6, 4.2, 3.2, 3.0), 0.6, 1.8),
    ],
    start: { x: -4.6, z: 4.2 }, goal: { x: 0.6, z: 4.2 }, az: 0, radius: 11,
  },

  {
    title: 'Counterclockwise', subtitle: 'The Same Ring, Reversed',
    prompt: 'A familiar arrangement, read in the opposite order.',
    hint: 'The islands allow second thoughts: first with the sun North (3°), then second with the sun North-East (27°), then third with the sun South-East (129°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('sw', -4.2, 4.2, 3.6, 3.2), plat('nw', -4.2, -0.4, 3.2, 3.6, 'island'),
      plat('ne', 0.4, -4.2, 3.6, 3.2, 'island'), plat('se', 4.2, 0.4, 3.2, 3.6),
    ],
    pillars: [
      mono('m1', 'First Marker', -4.2, -0.4, 4.22),
      mono('m2', 'Second Marker', -1.2, -4.2, 4.8),
      mono('m3', 'Third Marker', 4.2, -1.2, 4.8),
    ],
    gaps: [
      vgap('g1', plat('nw', -4.2, -0.4, 3.2, 3.6), plat('sw', -4.2, 4.2, 3.6, 3.2), -4.2, 1.8),
      dgap('g2', plat('sw', -4.2, 4.2, 3.6, 3.2), 4.2, plat('ne', 0.4, -4.2, 3.6, 3.2), -4.2, 2.0),
      dgap('g3', plat('ne', 0.4, -4.2, 3.6, 3.2), -4.2, plat('se', 4.2, 0.4, 3.2, 3.6), 0.4, 2.0),
    ],
    start: { x: -4.2, z: -0.4 }, goal: { x: 4.2, z: 0.4 }, az: 225, radius: 11,
  },
  {
    title: 'The Atrium', subtitle: 'A Central Court With Four Doors',
    prompt: 'Stand in the middle and decide which door can be opened.',
    hint: 'Read each stone before turning again: first with the sun South-West (225°), then second with the sun East (90°), then third with the sun North-East (57°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('mid', 0, 0, 3.4, 3.4, 'island'), plat('n', 0, -5.2, 3.4, 3.0),
      plat('e', 5.2, 0, 3.0, 3.4), plat('s', 0, 5.2, 3.4, 3.0),
    ],
    pillars: [mono('mn', 'Atrium Needle', 0, -2.0, 3.7), mono('me', 'East Needle', 5.2, 0, 4.85)],
    gaps: [
      vgap('g1', plat('n', 0, -5.2, 3.4, 3.0), plat('mid', 0, 0, 3.4, 3.4), 0, 1.8),
      hgap('g2', plat('mid', 0, 0, 3.4, 3.4), plat('e', 5.2, 0, 3.0, 3.4), 0, 1.8),
      vgap('g3', plat('mid', 0, 0, 3.4, 3.4), plat('s', 0, 5.2, 3.4, 3.0), 0, 1.8),
    ],
    start: { x: 0, z: -6.0 }, goal: { x: 0, z: 6.0 }, az: 5, radius: 10,
  },
  {
    title: 'The Lantern', subtitle: 'An Arch Above a Seal',
    prompt: 'The lintel carries the crossing. The crystal decides if it counts.',
    hint: 'The answer lies at West (about 285°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.8, 0, 6.0, 4.2), plat('b', 5.4, 0, 5.6, 4.2)],
    pillars: [archX('ar', 'Lantern Arch', -3.9, 0, 2.2, 4.6, 1.25)],
    gaps: [hgap('g', plat('a', -5.8, 0, 6.0, 4.2), plat('b', 5.4, 0, 5.6, 4.2), 0, 2.6)],
    crystals: [crys('c', 3.0, -1.5)],
    start: { x: -6.8, z: 0 }, goal: { x: 6.4, z: 0 }, az: 90,
  },

  // V — long chains, decoys and tighter windows
  {
    title: 'Labyrinth Light', subtitle: 'Five Stone Rooms',
    prompt: 'A route with more than one wrong turn. Read the shadows, not the floor.',
    hint: 'Work the spans in order: first with the sun East (84°), then second with the sun North (0°), then third with the sun East (96°), then fourth with the sun North (348°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -6.8, -2.6, 3.6, 3.0), plat('m1', -2.4, -2.6, 3.0, 3.0, 'island'),
      plat('m2', -2.4, 1.4, 3.0, 3.0, 'island'), plat('m3', 2.0, 1.4, 3.0, 3.0, 'island'),
      plat('b', 2.0, 5.2, 3.6, 3.0),
    ],
    pillars: [
      mono('m1', 'Room One', -2.4, -3.7, 3.62), mono('m2', 'Room Two', -2.4, -2.8, 3.6),
      mono('m3', 'Room Three', -0.6, 1.4, 3.6), mono('m4', 'Room Four', 2.0, 0.4, 3.6),
      mono('m5', 'Room Five', 2.0, 5.2, 3.9),
    ],
    gaps: [
      hgap('g1', plat('a', -6.8, -2.6, 3.6, 3.0), plat('m1', -2.4, -2.6, 3.0, 3.0), -2.6, 1.7),
      vgap('g2', plat('m1', -2.4, -2.6, 3.0, 3.0), plat('m2', -2.4, 1.4, 3.0, 3.0), -2.4, 1.7),
      hgap('g3', plat('m2', -2.4, 1.4, 3.0, 3.0), plat('m3', 2.0, 1.4, 3.0, 3.0), 1.4, 1.7),
      vgap('g4', plat('m3', 2.0, 1.4, 3.0, 3.0), plat('b', 2.0, 5.2, 3.6, 3.0), 2.0, 1.7),
    ],
    start: { x: -7.6, z: -2.6 }, goal: { x: 2.0, z: 6.0 }, az: 265, radius: 11,
  },
  {
    title: 'The Oblique', subtitle: 'A Corner Never Square',
    prompt: 'The two courts are neither north nor east of each other.',
    hint: 'Set the light to North-West (about 318°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -5.0, -3.4, 5.8, 3.2), plat('b', 3.6, 3.4, 5.8, 3.2)],
    pillars: [mono('m', 'Oblique Needle', -3.2, -2.5, 4.4, 0.8, 1.0)],
    gaps: [dgap('g', plat('a', -5.0, -3.4, 5.8, 3.2), -3.2, plat('b', 3.6, 3.4, 5.8, 3.2), 3.2, 2.0)],
    start: { x: -6.0, z: -3.4 }, goal: { x: 4.6, z: 3.4 }, az: 135, ratio: 1.35,
  },
  {
    title: 'Overlap', subtitle: 'Neither Caster Is Enough',
    prompt: 'The chasm is too wide for one shadow and too narrow for two separate roads.',
    hint: 'Aim for West (about 276°). The shadow falls across the break and the stone beyond it is yours to cross.',
    platforms: [plat('a', -5.2, 0, 5.2, 3.6), plat('b', 5.2, 0, 5.2, 3.6)],
    pillars: [mono('m1', 'High Reach', -4.2, -0.55, 5.6, 0.9, 1.1), mono('m2', 'Low Fill', -4.2, 0.7, 3.8, 1.5, 1.1)],
    gaps: [hgap('g', plat('a', -5.2, 0, 5.2, 3.6), plat('b', 5.2, 0, 5.2, 3.6), 0, 2.2)],
    start: { x: -6.2, z: 0 }, goal: { x: 6.2, z: 0 }, az: 95, radius: 10,
  },
  {
    title: 'The Sentinel', subtitle: 'A Seal Directly Behind',
    prompt: 'The straightest answer is watched by an amber eye.',
    hint: 'Turn until the sun rests at West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.6, 0, 6.0, 4.4), plat('b', 5.6, 0, 6.0, 4.4)],
    pillars: [mono('m', 'Sentinel', -5.6, 0, 6.1)],
    gaps: [hgap('g', plat('a', -5.6, 0, 6.0, 4.4), plat('b', 5.6, 0, 6.0, 4.4), 0, 2.8)],
    crystals: [crys('c', 3.2, 1.3)],
    start: { x: -6.6, z: 0 }, goal: { x: 6.6, z: 0 }, az: 90,
  },
  {
    title: 'The Long Day', subtitle: 'Five Courts in a Line',
    prompt: 'A long processional way with four missing sections.',
    hint: 'Cross in sequence: first with the sun East (90°), then second with the sun West (273°), then third with the sun East (90°), then fourth with the sun West (270°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -7.6, 0, 3.2, 2.8), plat('m1', -3.8, 0, 2.6, 2.8, 'island'),
      plat('m2', 0, 0, 2.6, 2.8, 'island'), plat('m3', 3.8, 0, 2.6, 2.8, 'island'),
      plat('b', 7.6, 0, 3.2, 2.8),
    ],
    pillars: [
      mono('m1', 'First Marker', -3.8, -0.6, 3.62), mono('m2', 'Second Marker', -3.8, 0.6, 3.62),
      mono('m3', 'Third Marker', 3.8, -0.6, 3.62), mono('m4', 'Fourth Marker', 3.8, 0.6, 3.62),
    ],
    gaps: [
      hgap('g1', plat('a', -7.6, 0, 3.2, 2.8), plat('m1', -3.8, 0, 2.6, 2.8), 0, 1.5),
      hgap('g2', plat('m1', -3.8, 0, 2.6, 2.8), plat('m2', 0, 0, 2.6, 2.8), 0, 1.5),
      hgap('g3', plat('m2', 0, 0, 2.6, 2.8), plat('m3', 3.8, 0, 2.6, 2.8), 0, 1.5),
      hgap('g4', plat('m3', 3.8, 0, 2.6, 2.8), plat('b', 7.6, 0, 3.2, 2.8), 0, 1.5),
    ],
    start: { x: -8.4, z: 0 }, goal: { x: 8.4, z: 0 }, az: 180, radius: 12,
  },
  {
    title: 'Solar Choir', subtitle: 'Three Seals in Chorus',
    prompt: 'Three crystals must remain in light while the bridge is held.',
    hint: 'Point the sun West (about 270°). The shadow falls across the break and the stone beyond it is yours to cross. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [plat('a', -5.4, 0, 6.2, 5.0), plat('b', 5.4, 0, 6.2, 5.0)],
    pillars: [mono('m', 'Choir Pillar', -5.4, 0, 5.8)],
    gaps: [hgap('g', plat('a', -5.4, 0, 6.2, 5.0), plat('b', 5.4, 0, 6.2, 5.0), 0, 3.2)],
    crystals: [crys('c1', 3.2, -2.2), crys('c2', 3.4, -1.1), crys('c3', 3.2, 2.4)],
    start: { x: -6.4, z: 0 }, goal: { x: 6.4, z: 0 }, az: 90,
  },
  {
    title: 'Sundial Ring', subtitle: 'Six Stones Around a Void',
    prompt: 'A circular walk with five absent sections.',
    hint: 'Take the crossings one at a time: first with the sun South (180°), then second with the sun West (258°), then third with the sun South (180°), then fourth with the sun South (162°), then fifth with the sun East (90°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('s1', -5.6, -2.8, 3.2, 3.0), plat('s2', -2.8, -5.6, 3.0, 3.2, 'island'),
      plat('s3', 2.8, -5.6, 3.0, 3.2, 'island'), plat('s4', 5.6, -2.8, 3.2, 3.0, 'island'),
      plat('s5', 5.6, 2.8, 3.2, 3.0, 'island'), plat('s6', -3.6, 2.8, 3.2, 3.0),
    ],
    pillars: [
      mono('m1', 'Ring Stone I', -4.3, -3.2, 3.6), mono('m2', 'Ring Stone II', -2.8, -4.3, 3.6),
      mono('m3', 'Ring Stone III', 4.3, -3.2, 3.6), mono('m4', 'Ring Stone IV', 5.6, 0, 3.6),
      mono('m5', 'Ring Stone V', 5.6, 2.8, 5.75),
    ],
    gaps: [
      dgap('g1', plat('s1', -5.6, -2.8, 3.2, 3.0), -2.8, plat('s2', -2.8, -5.6, 3.0, 3.2), -5.6, 1.7),
      hgap('g2', plat('s2', -2.8, -5.6, 3.0, 3.2), plat('s3', 2.8, -5.6, 3.0, 3.2), -5.6, 1.7),
      dgap('g3', plat('s3', 2.8, -5.6, 3.0, 3.2), -5.6, plat('s4', 5.6, -2.8, 3.2, 3.0), -2.8, 1.7),
      vgap('g4', plat('s4', 5.6, -2.8, 3.2, 3.0), plat('s5', 5.6, 2.8, 3.2, 3.0), 5.6, 1.7),
      hgap('g5', plat('s5', 5.6, 2.8, 3.2, 3.0), plat('s6', -3.6, 2.8, 3.2, 3.0), 2.8, 1.7),
    ],
    start: { x: -5.6, z: -2.8 }, goal: { x: -3.6, z: 2.8 }, az: 0, radius: 12,
  },
  {
    title: 'The Keystone', subtitle: 'Arch Above the Seal',
    prompt: 'One lintel carries the first line. Two seals judge the second.',
    hint: 'The islands allow second thoughts: first with the sun East (90°), then second with the sun North-West (324°). Pause on each stone island before you turn the light again. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [
      plat('a', -6.0, -2.0, 5.8, 3.8), plat('mid', 0.4, -2.0, 3.4, 3.4, 'island'),
      plat('b', 0.4, 4.0, 5.0, 4.2),
    ],
    pillars: [archX('ar', 'Keystone Arch', -4.1, -2.0, 2.1, 4.6, 1.25), mono('m', 'Keystone Obelisk', 0.4, -2.0, 4.42)],
    gaps: [
      hgap('g1', plat('a', -6.0, -2.0, 5.8, 3.8), plat('mid', 0.4, -2.0, 3.4, 3.4), -2.0, 2.0),
      vgap('g2', plat('mid', 0.4, -2.0, 3.4, 3.4), plat('b', 0.4, 4.0, 5.0, 4.2), 0.4, 2.0),
    ],
    crystals: [crys('c1', -1.2, 4.0), crys('c2', 2.0, 4.0)],
    start: { x: -7.0, z: -2.0 }, goal: { x: 0.4, z: 5.0 }, az: 145, radius: 11,
  },
  {
    title: "Architect's Trial", subtitle: 'Five Breaks, Four Witnesses',
    prompt: 'Every caster has one job. Find the order before you spend the light.',
    hint: 'Read each stone before turning again: first with the sun East (99°), then second with the sun North-East (33°), then third with the sun North-West (309°), then fourth with the sun East (99°), then fifth with the sun West (285°). Pause on each stone island before you turn the light again.',
    platforms: [
      plat('a', -7.2, -2.6, 3.4, 3.0), plat('m1', -3.0, -2.6, 2.8, 2.8, 'island'),
      plat('m2', -3.0, 1.6, 2.8, 2.8, 'island'), plat('m3', 1.2, 1.6, 2.8, 2.8, 'island'),
      plat('m4', 1.2, 5.6, 2.8, 2.8, 'island'), plat('b', 5.6, 5.6, 3.4, 3.0),
    ],
    pillars: [
      mono('m1', 'Witness I', -3.0, -2.6, 3.62), mono('m2', 'Witness II', -3.0, -0.6, 3.5),
      mono('m3', 'Witness III', -1.0, 1.6, 3.6), mono('m4', 'Witness IV', 1.2, 3.6, 3.6),
      mono('m5', 'Witness V', 3.4, 5.6, 3.6),
    ],
    gaps: [
      hgap('g1', plat('a', -7.2, -2.6, 3.4, 3.0), plat('m1', -3.0, -2.6, 2.8, 2.8), -2.6, 1.6),
      vgap('g2', plat('m1', -3.0, -2.6, 2.8, 2.8), plat('m2', -3.0, 1.6, 2.8, 2.8), -3.0, 1.6),
      hgap('g3', plat('m2', -3.0, 1.6, 2.8, 2.8), plat('m3', 1.2, 1.6, 2.8, 2.8), 1.6, 1.6),
      vgap('g4', plat('m3', 1.2, 1.6, 2.8, 2.8), plat('m4', 1.2, 5.6, 2.8, 2.8), 1.2, 1.6),
      hgap('g5', plat('m4', 1.2, 5.6, 2.8, 2.8), plat('b', 5.6, 5.6, 3.4, 3.0), 5.6, 1.6),
    ],
    start: { x: -8.0, z: -2.6 }, goal: { x: 6.4, z: 5.6 }, az: 215, radius: 12,
  },
  {
    title: 'Umbra', subtitle: 'The Final Study',
    prompt: 'Everything you know, held at once. Read carefully; the sun remembers only direction.',
    hint: 'Cross in sequence: first with the sun North-West (312°), then second with the sun North-West (321°), then third with the sun North-West (297°), then fourth with the sun North-West (303°), then fifth with the sun East (90°). Pause on each stone island before you turn the light again. Keep the amber seals uncovered; a shadow over a crystal closes the goal.',
    platforms: [
      plat('a', -7.8, 0, 5.0, 4.6), plat('m1', -2.6, 0, 3.0, 3.2, 'island'),
      plat('m2', -2.6, 5.0, 3.0, 3.0, 'island'), plat('m3', 2.6, 5.0, 3.0, 3.0, 'island'),
      plat('m4', 2.6, 0, 3.0, 3.2, 'island'), plat('b', 7.4, 0, 4.6, 4.6),
    ],
    pillars: [
      archX('ar', 'Final Arch', -6.0, 0, 2.2, 4.7, 1.25),
      mono('m1', 'Upper Obelisk', -2.6, 2.0, 3.8),
      mono('m2', 'Central Wall', -2.6, 5.0, 6.0),
      mono('m3', 'Seal Needle', 2.6, 2.0, 4.2),
      mono('m4', 'Last Needle', 7.4, 0, 4.02),
    ],
    gaps: [
      hgap('g1', plat('a', -7.8, 0, 5.0, 4.6), plat('m1', -2.6, 0, 3.0, 3.2), 0, 2.0),
      vgap('g2', plat('m1', -2.6, 0, 3.0, 3.2), plat('m2', -2.6, 5.0, 3.0, 3.0), -2.6, 1.7),
      hgap('g3', plat('m2', -2.6, 5.0, 3.0, 3.0), plat('m3', 2.6, 5.0, 3.0, 3.0), 5.0, 1.7),
      vgap('g4', plat('m3', 2.6, 5.0, 3.0, 3.0), plat('m4', 2.6, 0, 3.0, 3.2), 2.6, 1.7),
      hgap('g5', plat('m4', 2.6, 0, 3.0, 3.2), plat('b', 7.4, 0, 4.6, 4.6), 0, 2.0),
    ],
    crystals: [crys('c1', 6.0, -1.4), crys('c2', 6.0, 1.4)],
    start: { x: -8.8, z: 0 }, goal: { x: 8.4, z: 0 }, az: 25, radius: 13,
  },
];

export const LEVELS: LevelData[] = SPECS.map(make);
