import * as THREE from 'three';

/* ------------------------------------------------------------------ helpers */

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

type Rand = () => number;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

/** crisp = nearest-neighbour magnification, for the chunky hand-painted pixel look */
function finish(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
  srgb = true,
  crisp = true
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (crisp) tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Mix two hex colours; t = 0 gives a, t = 1 gives b. */
function mix(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

/** Irregular hand-cut blob with a hard edge. */
function blob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rand: Rand,
  color: string,
  points = 9,
  squash = 1
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = r * (0.58 + rand() * 0.62);
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * squash;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Draw wrapped so a texture tiles with no visible seam. */
function wrapped(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      draw(px, py);
    }
  }
}

export interface MaterialTexturePair {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

/* ------------------------------------------------------------------- stone */

/**
 * Cream paving flags with moss creeping in from the seams and a few fallen petals.
 */
export function createTravertineTextures(baseHex: string): MaterialTexturePair {
  const size = 128;
  const [cCol, ctx] = makeCanvas(size, size);
  const [cBmp, bCtx] = makeCanvas(size, size);
  const rand = mulberry32(20261);

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#9a9a9a';
  bCtx.fillRect(0, 0, size, size);

  const cells = 4;
  const cw = size / cells;
  for (let row = 0; row < cells; row++) {
    const shift = row % 2 === 0 ? 0 : cw * 0.5;
    for (let col = -1; col <= cells; col++) {
      const x = col * cw + shift;
      const y = row * cw;
      const t = rand();
      ctx.fillStyle = t > 0.5 ? mix(baseHex, '#ffffff', (t - 0.5) * 0.22) : mix(baseHex, '#b9a778', (0.5 - t) * 0.3);
      ctx.fillRect(x + 1, y + 1, cw - 2, cw - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(x + 1, y + 1, cw - 2, 1);
      ctx.fillStyle = 'rgba(120,100,60,0.45)';
      ctx.fillRect(x, y, cw, 1);
      ctx.fillRect(x, y, 1, cw);
      bCtx.fillStyle = '#4a4a4a';
      bCtx.fillRect(x, y, cw, 1);
      bCtx.fillRect(x, y, 1, cw);
    }
  }

  // Moss patches, hard-edged, favouring the seams
  for (let i = 0; i < 9; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 7;
    wrapped(size, x, y, r + 2, (px, py) => {
      blob(ctx, px, py, r, rand, '#86B147', 8, 0.8);
      blob(ctx, px + 1, py + 1, r * 0.62, rand, '#9CC95A', 7, 0.8);
    });
  }
  // Petals
  const petals = ['#F4A9D2', '#D8A6E8', '#FFF1F6'];
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = petals[i % 3];
    ctx.fillRect(Math.floor(rand() * size), Math.floor(rand() * size), 2, 2);
  }

  return { map: finish(cCol), bumpMap: finish(cBmp, 1, 1, false) };
}

/** Cream brickwork for platform walls, cooler and mossier toward the base. */
export function createMasonryTextures(baseHex: string): MaterialTexturePair {
  const size = 128;
  const [cCol, ctx] = makeCanvas(size, size);
  const [cBmp, bCtx] = makeCanvas(size, size);
  const rand = mulberry32(51077);

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#9a9a9a';
  bCtx.fillRect(0, 0, size, size);

  const rows = 5;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const blocks = 3 + (r % 2);
    const bw = size / blocks;
    const shift = (r % 2) * bw * 0.4;
    for (let b = -1; b <= blocks; b++) {
      const x = b * bw + shift;
      const y = r * rh;
      const t = rand();
      ctx.fillStyle = t > 0.5 ? mix(baseHex, '#ffffff', (t - 0.5) * 0.28) : mix(baseHex, '#7f93a3', (0.5 - t) * 0.5);
      ctx.fillRect(x + 1, y + 1, bw - 2, rh - 2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(x + 1, y + 1, bw - 2, 1);
      ctx.fillStyle = 'rgba(70,90,110,0.55)';
      ctx.fillRect(x, y, bw, 1);
      ctx.fillRect(x, y, 1, rh);
      bCtx.fillStyle = '#4a4a4a';
      bCtx.fillRect(x, y, bw, 1);
      bCtx.fillRect(x, y, 1, rh);
    }
  }

  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(70,110,140,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 7; i++) {
    const x = rand() * size;
    const y = size * (0.04 + rand() * 0.9);
    wrapped(size, x, y, 8, (px, py) => blob(ctx, px, py, 3 + rand() * 4, rand, '#86B147', 7, 0.7));
  }

  return { map: finish(cCol), bumpMap: finish(cBmp, 1, 1, false) };
}

/**
 * Carved pillar stone: inset panels, bevel lines, hairline cracks and a little moss.
 * The base colour decides whether it reads blue-grey slate or warm cream.
 */
export function createMonolithTextures(baseHex: string, seed = 8811): MaterialTexturePair {
  const size = 128;
  const [cCol, ctx] = makeCanvas(size, size);
  const [cBmp, bCtx] = makeCanvas(size, size);
  const rand = mulberry32(seed);

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#9a9a9a';
  bCtx.fillRect(0, 0, size, size);

  const dark = mix(baseHex, '#1b2a3a', 0.4);
  const light = mix(baseHex, '#ffffff', 0.3);

  const cols = 2;
  const rows = 4;
  const pw = size / cols;
  const ph = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * pw;
      const y = r * ph;
      const t = rand();
      ctx.fillStyle = mix(baseHex, t > 0.5 ? '#ffffff' : '#2f4658', Math.abs(t - 0.5) * 0.28);
      ctx.fillRect(x + 3, y + 3, pw - 6, ph - 6);
      // bevel: light on the top and left, shade on the bottom and right
      ctx.fillStyle = light;
      ctx.fillRect(x + 3, y + 3, pw - 6, 2);
      ctx.fillRect(x + 3, y + 3, 2, ph - 6);
      ctx.fillStyle = dark;
      ctx.fillRect(x + 3, y + ph - 5, pw - 6, 2);
      ctx.fillRect(x + pw - 5, y + 3, 2, ph - 6);
      // joint
      ctx.fillStyle = mix(baseHex, '#101c28', 0.55);
      ctx.fillRect(x, y, pw, 1);
      ctx.fillRect(x, y, 1, ph);
      bCtx.fillStyle = '#4a4a4a';
      bCtx.fillRect(x, y, pw, 2);
      bCtx.fillRect(x, y, 2, ph);
    }
  }

  // Hairline cracks
  ctx.strokeStyle = mix(baseHex, '#101c28', 0.5);
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (rand() - 0.5) * 12;
      y += 4 + rand() * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Moss gathers near the top and the foot
  for (let i = 0; i < 6; i++) {
    const x = rand() * size;
    const y = rand() > 0.5 ? rand() * size * 0.16 : size * (0.84 + rand() * 0.16);
    wrapped(size, x, y, 8, (px, py) => {
      blob(ctx, px, py, 3 + rand() * 5, rand, '#86B147', 7, 0.7);
      blob(ctx, px, py, 1.5 + rand() * 2, rand, '#A2CE5E', 6, 0.7);
    });
  }

  return { map: finish(cCol), bumpMap: finish(cBmp, 1, 1, false) };
}

/* ------------------------------------------------------------------ player */

/** A glossy coral sphere with a cream equator and two seams — the brightest thing on the lawn. */
export function createCeramicSphereTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const [canvas, ctx] = makeCanvas(w, h);
  const rand = mulberry32(60217);

  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#F2704C');
  g.addColorStop(0.5, '#E4583C');
  g.addColorStop(1, '#C94530');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#FFF0CC';
  ctx.fillRect(0, h * 0.5 - 6, w, 12);
  ctx.fillStyle = '#F0B840';
  ctx.fillRect(0, h * 0.5 - 6, w, 2);
  ctx.fillRect(0, h * 0.5 + 4, w, 2);

  for (let i = 0; i < 4; i++) {
    const x = (i / 4) * w;
    ctx.fillStyle = 'rgba(255,240,204,0.55)';
    ctx.fillRect(x - 1, 0, 3, h * 0.5 - 6);
    ctx.fillRect(x - 1, h * 0.5 + 6, 3, h * 0.5 - 6);
    ctx.fillStyle = '#7B2A22';
    ctx.fillRect(x - 2, h * 0.5 - 2, 5, 4);
  }

  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), 2, 2);
  }

  return finish(canvas, 1, 1, true, false);
}

/* ------------------------------------------------------------------- world */

/**
 * Dense short turf, painted as soft mown contour bands over a neon-lime base
 * with thousands of tiny upright blade flicks — the grass study reference.
 */
export function createGrassTexture(base: string, light: string, deep: string): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size, size);
  const rand = mulberry32(777);

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Mown contour terraces: broad, soft-edged wave bands that tile vertically and horizontally.
  const bands = 7;
  for (let band = 0; band < bands; band++) {
    const y0 = (band / bands) * size;
    const bandH = size / bands;
    const tone =
      band % 3 === 0
        ? mix(base, light, 0.45)
        : band % 3 === 1
          ? mix(base, deep, 0.28)
          : mix(base, light, 0.18);
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.moveTo(0, y0 - 4);
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin((x / size) * Math.PI * 4 + band * 0.7) * bandH * 0.17;
      ctx.lineTo(x, y);
    }
    for (let x = size; x >= 0; x -= 8) {
      const y = y0 + bandH * 0.62 + Math.sin((x / size) * Math.PI * 4 + band * 0.7 + 0.9) * bandH * 0.17;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    // Soft bright crest line, like sunlight catching the top of a mown ridge
    ctx.strokeStyle = mix(tone, light, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const y = y0 + Math.sin((x / size) * Math.PI * 4 + band * 0.7) * bandH * 0.17;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Furry micro-flecks: individual short grass tips catching the light.
  for (let i = 0; i < 13500; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 1 + Math.floor(rand() * 3);
    const bright = rand();
    ctx.fillStyle =
      bright > 0.72
        ? mix(base, '#FFFFFF', 0.3)
        : bright > 0.4
          ? mix(base, light, 0.75)
          : mix(base, deep, 0.6);
    wrapped(size, x, y, len + 2, (px, py) => ctx.fillRect(Math.floor(px), Math.floor(py), 1, len));
  }

  // Tiny speckled flowers/dew to break up the surface at close range
  for (let i = 0; i < 55; i++) {
    const x = rand() * size;
    const y = rand() * size;
    ctx.fillStyle = rand() > 0.5 ? '#F7FFC9' : paletteSafePetal();
    wrapped(size, x, y, 3, (px, py) => ctx.fillRect(Math.floor(px), Math.floor(py), 2, 2));
  }

  return finish(canvas, 1, 1, true, true);
}

function paletteSafePetal() {
  return '#E9F58A';
}

/**
 * Painterly reference water: irregular turquoise/cobalt pools separated by crisp
 * white branching veins, with tiny bubble dots and translucent pale shallows.
 */
export function createWaterPatternTexture(water: string, deep: string, foam: string): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);

  // Seamless jittered Voronoi field: nearest = pool, nearest/second distance = white vein.
  const cols = 7;
  const rows = 7;
  const cw = size / cols;
  const ch = size / rows;
  const centers: Array<{ x: number; y: number; tone: number }> = [];
  const rand = mulberry32(4242);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      centers.push({
        x: (c + 0.18 + rand() * 0.64) * cw,
        y: (r + 0.18 + rand() * 0.64) * ch,
        tone: rand() < 0.42 ? rand() * 0.36 : rand() < 0.82 ? 0.32 + rand() * 0.37 : 0.68 + rand() * 0.32,
      });
    }
  }

  const image = ctx.createImageData(size, size);
  const colDeep = new THREE.Color(deep);
  const colWater = new THREE.Color(water);
  const colPale = new THREE.Color(mix(water, foam, 0.72));
  const colFoam = new THREE.Color(foam);
  const cyan = new THREE.Color('#5FD4F2');

  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Periodic low-frequency warp: curves the Voronoi walls into organic branching veins
      // while keeping the texture seam-free when tiled.
      const wx = x + Math.sin(y * TAU * 2 / size) * 9 + Math.cos((x + y) * TAU / size) * 5;
      const wy = y + Math.cos(x * TAU * 2 / size) * 8 + Math.sin((x - y) * TAU / size) * 6;

      let d1 = Infinity;
      let d2 = Infinity;
      let tone = 0;
      for (const c of centers) {
        let dx = Math.abs(wx - c.x);
        let dy = Math.abs(wy - c.y);
        if (dx > size * 0.5) dx = size - dx;
        if (dy > size * 0.5) dy = size - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = c.tone;
        } else if (d < d2) {
          d2 = d;
        }
      }

      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const radius = Math.sqrt(d1);
      const base = tone > 0.7 ? colDeep : tone > 0.34 ? colWater : colPale;
      const pool = new THREE.Color().copy(base).lerp(cyan, Math.max(0, 0.34 - radius / 70) * 0.65);
      // Crisp white cell boundaries with a soft pale halo
      const halo = 1 - Math.min(1, edge / 17);
      const vein = 1 - Math.min(1, edge / 4.6);
      pool.lerp(colFoam, halo * 0.38);
      pool.lerp(colFoam, vein * 0.96);

      const i = (y * size + x) * 4;
      image.data[i] = Math.round(pool.r * 255);
      image.data[i + 1] = Math.round(pool.g * 255);
      image.data[i + 2] = Math.round(pool.b * 255);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Scattered bubbles and pinprick sun glints inside the cells
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.7 + rand() * 2.7;
    ctx.strokeStyle = rand() > 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.8;
    wrapped(size, x, y, r + 2, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  return finish(canvas, 1, 1, true, false);
}

/** Kept for callers that need a simple animated texture; the pattern version is preferred. */
export const createWaterTexture = createWaterPatternTexture;

/**
 * The cast shadow of leaf canopies that hang just off-screen: hard, blocky dark-green
 * pools scattered around the garden, leaving the play area itself clear.
 */
export function createCanopyShadowTexture(worldSize: number, clearRadius: number, color: string): THREE.CanvasTexture {
  const size = 160;
  const [canvas, ctx] = makeCanvas(size, size);
  const rand = mulberry32(9090);
  const px = (v: number) => (v / worldSize + 0.5) * size;

  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const d = clearRadius + 3 + Math.pow(rand(), 0.8) * (worldSize / 2 - clearRadius - 6);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const r = (worldSize / size) * (6 + rand() * 12);
    if (Math.hypot(x, z) - r < clearRadius) continue;
    const cx = px(x);
    const cy = px(z);
    const rr = (r / worldSize) * size;
    for (let k = 0; k < 3; k++) {
      blob(ctx, cx + (rand() - 0.5) * rr, cy + (rand() - 0.5) * rr, rr * (0.5 + rand() * 0.6), rand, color, 9, 0.85);
    }
  }
  return finish(canvas, 1, 1, true, true);
}

/** Four hard steps of light: the whole look hangs on this ramp. */
export function createToonGradient(): THREE.DataTexture {
  const data = new Uint8Array([105, 165, 215, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial contact-occlusion blob used beneath the player sphere. */
export function createSoftBlobShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.72, 'rgba(0,0,0,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas, 1, 1, true, false);
}

/** Soft radial glow used for the light source halo. */
export function createGlowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.22, 'rgba(255,240,205,0.42)');
  g.addColorStop(0.55, 'rgba(255,225,160,0.1)');
  g.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return finish(canvas, 1, 1, true, false);
}
