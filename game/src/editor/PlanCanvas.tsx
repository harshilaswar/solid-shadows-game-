import { useCallback, useEffect, useRef, useState } from 'react';
import { traceUmbraSilhouette } from '../game/shadowMath';
import {
  azimuthOf,
  centerOf,
  norm,
  type Doc,
  type DocApi,
  type Rect,
  type SelectionKind,
  polyBounds,
  pointInPolygon,
  regularPolygon,
  rotateDocObject,
  moveDocObject,
  selectionCenter,
  shadowsAt,
  snapVal,
  sunPoint,
  uid,
} from './doc';
import type { Vec2 } from '../game/types';

export type Tool = 'select' | 'platform' | 'polygon' | 'pillar' | 'gap' | 'crystal' | 'start' | 'goal' | 'sun';

export interface Sel {
  kind: SelectionKind;
  id: string;
}

export interface PlanLayers {
  grid: boolean;
  shadow: boolean;
  spans: boolean;
  casters: boolean;
  marks: boolean;
  dims: boolean;
}

const C = {
  sheet: '#e9e3d5',
  gridMinor: 'rgba(120,110,94,0.13)',
  gridMajor: 'rgba(104,94,76,0.26)',
  axis: 'rgba(104,94,76,0.42)',
  ink: '#3b3c38',
  stone: '#f4eee1',
  stoneIsland: '#efe6d3',
  stonePedestal: '#e4dcc9',
  stoneEdge: '#b3a48b',
  shadowFill: 'rgba(96,100,108,0.36)',
  shadowEdge: '#2f3336',
  span: 'rgba(194,112,92,0.5)',
  spanFill: 'rgba(194,112,92,0.11)',
  amber: '#d99f2e',
  teal: '#4f8a80',
  clay: '#b45f4b',
  sage: '#6d8a5e',
  label: '#6b6353',
};

const VARIANT_FILL: Record<string, string> = {
  terracotta: '#c8a279',
  ochre: '#ded2bb',
  slate: '#5c6066',
  trim: '#efe7d7',
};

interface Props {
  doc: Doc;
  api: DocApi;
  sel: Sel;
  setSel: (s: Sel) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  grid: number;
  snap: boolean;
  layers: PlanLayers;
  fitSignal: number;
  onReadout?: (t: string) => void;
  /** Show draggable vertex handles on the selected polygon platform. */
  vertexMode?: boolean;
  /** Sides used by the polygon stone tool (3–12). */
  polygonSides?: number;
  /** Reports live rotation in degrees while a rotate handle is dragged. */
  onRotation?: (deg: number | null) => void;
}

type Drag =
  | { mode: 'pan'; px: number; py: number }
  | { mode: 'maybePan'; px: number; py: number }
  | { mode: 'move'; kind: SelectionKind; id: string; wx: number; wz: number; before: Doc }
  | { mode: 'resize'; id: string; rect: 'platform' | 'part' | 'gap'; handle: string; start: Rect }
  | { mode: 'anchor'; id: string; which: 'a' | 'b' }
  | { mode: 'point'; kind: 'crystal' | 'start' | 'goal'; id: string }
  | { mode: 'create'; type: 'platform' | 'pillar' | 'gap' | 'polygon'; ax: number; az: number; bx: number; bz: number }
  | { mode: 'vertex'; kind: 'platform'; id: string; index: number; before: Doc }
  | { mode: 'rotate'; kind: SelectionKind; id: string; center: Vec2; startAngle: number; before: Doc }
  | { mode: 'sun' }
  | null;

export function PlanCanvas({ doc, api, sel, setSel, tool, setTool, grid, snap, layers, fitSignal, onReadout, vertexMode = false, polygonSides = 6, onRotation }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const view = useRef({ cx: 0, cz: 0, scale: 42 });
  const drag = useRef<Drag>(null);
  const dragPid = useRef<number | null>(null);
  /** Last time the active drag saw a pointer event; used to clear dead touches quickly. */
  const dragSeenAt = useRef(0);
  const hover = useRef<{ kind: SelectionKind; id: string } | null>(null);
  const pointer = useRef({ down: false, space: false, x: 0, y: 0 });
  const [mode, setMode] = useState<'select' | 'pan' | 'grab' | 'move'>('select');

  // refs so the animation loop always reads fresh state without re-binding
  const S = useRef({ doc, sel, tool, grid, snap, layers, api, setSel, setTool, onReadout, vertexMode, polygonSides, onRotation });
  S.current = { doc, sel, tool, grid, snap, layers, api, setSel, setTool, onReadout, vertexMode, polygonSides, onRotation };

  const toWorld = useCallback((px: number, py: number) => {
    const r = cvRef.current!.getBoundingClientRect();
    const v = view.current;
    return {
      x: (px - r.left - r.width / 2) / v.scale + v.cx,
      z: (py - r.top - r.height / 2) / v.scale + v.cz,
    };
  }, []);

  const sn = useCallback((v: number) => {
    const { grid: g, snap: s } = S.current;
    return s && g > 0 ? snapVal(v, g) : Math.round(v * 1000) / 1000;
  }, []);

  const fit = useCallback(() => {
    const d = S.current.doc;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    const grow = (r: Rect) => {
      x0 = Math.min(x0, r.xMin);
      x1 = Math.max(x1, r.xMax);
      z0 = Math.min(z0, r.zMin);
      z1 = Math.max(z1, r.zMax);
    };
    d.platforms.forEach((p) => grow(norm(p)));
    d.gaps.forEach((g) => grow(norm(g)));
    for (const s of d.pillars) for (const b of s.parts) grow(norm(b));
    grow({ xMin: d.start.x, xMax: d.start.x, zMin: d.start.z, zMax: d.start.z });
    grow({ xMin: d.goal.x, xMax: d.goal.x, zMin: d.goal.z, zMax: d.goal.z });
    const orbit = d.sun.maxRadius * 0.78;
    x0 = Math.min(x0, -orbit);
    x1 = Math.max(x1, orbit);
    z0 = Math.min(z0, -orbit);
    z1 = Math.max(z1, orbit);
    if (!isFinite(x0)) return;
    const r = cvRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.max(4, x1 - x0) + 4;
    const h = Math.max(4, z1 - z0) + 4;
    view.current = {
      cx: (x0 + x1) / 2,
      cz: (z0 + z1) / 2,
      scale: Math.min(r.width / w, r.height / h),
    };
  }, []);

  useEffect(() => {
    fit();
  }, [fitSignal, fit]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cv = cvRef.current;
      if (!cv) return;
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      cv.width = Math.max(1, Math.floor(r.width * dpr));
      cv.height = Math.max(1, Math.floor(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ------------------------------------------------------------- picking */

  const rectOf = useCallback((kind: SelectionKind, id: string, base?: Doc): Rect | null => {
    const d = base ?? S.current.doc;
    if (kind === 'platform') {
      const p = d.platforms.find((v) => v.id === id);
      if (!p) return null;
      return p.points && p.points.length >= 3 ? polyBounds(p.points) : norm(p);
    }
    if (kind === 'gap') {
      const g = d.gaps.find((v) => v.id === id);
      return g ? norm(g) : null;
    }
    if (kind === 'part') {
      for (const s of d.pillars) {
        const b = s.parts.find((v) => v.id === id);
        if (b) return norm(b);
      }
    }
    if (kind === 'pillar') {
      const s = d.pillars.find((v) => v.id === id);
      if (!s || s.parts.length === 0) return null;
      return s.parts.reduce<Rect>((acc, b) => {
        const r = norm(b);
        return {
          xMin: Math.min(acc.xMin, r.xMin),
          xMax: Math.max(acc.xMax, r.xMax),
          zMin: Math.min(acc.zMin, r.zMin),
          zMax: Math.max(acc.zMax, r.zMax),
        };
      }, norm(s.parts[0]));
    }
    return null;
  }, []);

  /** eight grab points in world space, for resizing a selected rectangle */
  const handlesOf = useCallback(
    (r: Rect) => {
      const mx = (r.xMin + r.xMax) / 2;
      const mz = (r.zMin + r.zMax) / 2;
      const p = (x: number, z: number) => ({ x, z });
      return {
        w: p(r.xMin, mz),
        e: p(r.xMax, mz),
        n: p(mx, r.zMin),
        s: p(mx, r.zMax),
        nw: p(r.xMin, r.zMin),
        ne: p(r.xMax, r.zMin),
        se: p(r.xMax, r.zMax),
        sw: p(r.xMin, r.zMax),
      } as Record<string, { x: number; z: number }>;
    },
    []
  );

  const hitTest = useCallback(
    (
      px: number,
      py: number,
      pointerType?: string
    ): { kind: SelectionKind; id: string; handle?: string; r: number } | null => {
      const d = S.current.doc;
      const v = view.current;
      const w = toWorld(px, py);
      // Fingers are fat: give touch roughly double the mouse tolerance so taps
      // actually land on handles and small markers instead of missing them.
      const isTouch = pointerType === 'touch';
      const tol = (isTouch ? 14 : 7) / v.scale;

      const sr = rectOf(S.current.sel.kind, S.current.sel.id);

      // rotate handle: sits above the selection's top-centre
      if (sr) {
        const rx = (sr.xMin + sr.xMax) / 2;
        const rz = sr.zMin - 42 / v.scale;
        if (Math.hypot(rx - w.x, rz - w.z) < (isTouch ? 20 : 12) / v.scale) {
          return { kind: S.current.sel.kind, id: S.current.sel.id, handle: 'rotate', r: 0 };
        }
      }

      // polygon vertex handles (edit-points mode)
      if (sr) {
        const poly = S.current.doc.platforms.find((p) => p.id === S.current.sel.id);
        if (poly?.points && poly.points.length >= 3) {
          for (let i = 0; i < poly.points.length; i++) {
            if (Math.hypot(poly.points[i].x - w.x, poly.points[i].z - w.z) < (isTouch ? 16 : 10) / v.scale) {
              return { kind: 'platform', id: poly.id, handle: `v${i}`, r: 0 };
            }
          }
        }
      }

      // resize handles of the current selection
      if (sr && (S.current.sel.kind === 'platform' || S.current.sel.kind === 'part' || S.current.sel.kind === 'gap')) {
        const hs = handlesOf(sr);
        for (const [name, hp] of Object.entries(hs)) {
          if (Math.abs(hp.x - w.x) < tol && Math.abs(hp.z - w.z) < tol) {
            return { kind: S.current.sel.kind, id: S.current.sel.id, handle: name, r: 0 };
          }
        }
      }

      // sun
      const sp = sunPoint(d);
      if (Math.hypot(sp.x - w.x, sp.z - w.z) < 1.15) return { kind: 'sun', id: 'sun', r: 0 };

      // gap anchors
      for (const g of d.gaps) {
        if (Math.hypot(g.ax - w.x, g.az - w.z) < tol * 1.6) return { kind: 'anchorA', id: g.id, r: 0 };
        if (Math.hypot(g.bx - w.x, g.bz - w.z) < tol * 1.6) return { kind: 'anchorB', id: g.id, r: 0 };
      }

      // markers
      const markR = isTouch ? 0.85 : 0.62;
      if (Math.hypot(d.goal.x - w.x, d.goal.z - w.z) < markR) return { kind: 'goal', id: 'goal', r: 0 };
      if (Math.hypot(d.start.x - w.x, d.start.z - w.z) < markR) return { kind: 'start', id: 'start', r: 0 };

      for (let i = d.crystals.length - 1; i >= 0; i--) {
        const c = d.crystals[i];
        const crystalR = isTouch ? Math.max(c.radius + 0.35, 0.7) : Math.max(c.radius + 0.2, 0.5);
        if (Math.hypot(c.x - w.x, c.z - w.z) < crystalR) {
          return { kind: 'crystal', id: c.id, r: 0 };
        }
      }

      // casters (ground first, then elevated)
      for (const s of d.pillars) {
        for (let j = s.parts.length - 1; j >= 0; j--) {
          const b = s.parts[j];
          if (inRectLoose(w.x, w.z, norm(b), 0)) return { kind: 'part', id: b.id, r: 0 };
        }
      }

      for (let i = d.platforms.length - 1; i >= 0; i--) {
        const p = d.platforms[i];
        const hit = p.points && p.points.length >= 3 ? pointInPolygon(w.x, w.z, p.points) : inRectLoose(w.x, w.z, norm(p), 0);
        if (hit) return { kind: 'platform', id: p.id, r: 0 };
      }
      for (let i = d.gaps.length - 1; i >= 0; i--) {
        const g = d.gaps[i];
        if (inRectLoose(w.x, w.z, norm(g), 0)) return { kind: 'gap', id: g.id, r: 0 };
      }
      return null;
    },
    [handlesOf, rectOf, toWorld]
  );

  /* ----------------------------------------------------------- mutate */

  /** Move any object from the drag-start snapshot by the accumulated delta. */
  const applyDelta = useCallback(
    (base: Doc, kind: SelectionKind, id: string, dx: number, dz: number) => {
      api.live(() => moveDocObject(base, kind, id, dx, dz));
    },
    [api]
  );

  /* ---------------------------------------------------------- handlers */

  /**
   * The single authoritative way a drag ends. Always clears every piece of drag
   * state and releases pointer capture, so a lost pointerup, a second finger or a
   * window blur can never leave the sheet in a "stuck" state where nothing is
   * selectable and the camera keeps drifting from a stale origin.
   */
  const finishDrag = useCallback((pointerId?: number, force = false) => {
    if (!force && pointerId !== undefined && dragPid.current !== pointerId) return;
    const d = drag.current;
    if (d?.mode === 'rotate') S.current.onRotation?.(null);
    if (d) api.endEdit();
    drag.current = null;
    dragPid.current = null;
    dragSeenAt.current = 0;
    pointer.current.down = false;
    setMode('select');
    const cv = cvRef.current;
    if (cv && pointerId !== undefined) {
      try {
        cv.releasePointerCapture(pointerId);
      } catch {
        /* capture may already be gone */
      }
    }
  }, [api]);

  /**
   * Drop a drag only when its owner has gone quiet for a moment. A second finger
   * landing on the sheet is ignored while the owner is active; a pointer whose
   * up/cancel never arrived is cleared on the next press. Much steadier than a
   * pointer set, which only forgets a touch when the missing event finally shows.
   */
  const pruneStaleDrag = useCallback(() => {
    if (!drag.current) return;
    if (performance.now() - dragSeenAt.current > 350) finishDrag(undefined, true);
  }, [finishDrag]);

  // Safety nets: releasing outside the window, cancelling, blurring or hiding the
  // tab all end the drag. Without these a single missed event bricks selection.
  useEffect(() => {
    const onWindowUp = (e: PointerEvent) => {
      if (dragPid.current === e.pointerId) finishDrag(e.pointerId, true);
    };
    const forceRelease = () => finishDrag(undefined, true);
    const onBlur = () => {
      pointer.current.space = false;
      forceRelease();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && drag.current) {
        forceRelease();
        setSel({ kind: 'none', id: '' });
      }
    };
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', forceRelease);
    return () => {
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('pointercancel', onWindowUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', forceRelease);
      drag.current = null;
      dragPid.current = null;
      dragSeenAt.current = 0;
    };
  }, [finishDrag, setSel]);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Clear a dead touch from the owner that never sent pointerup. If the owner
    // is still active, extra fingers are ignored instead of cancelling its gesture.
    pruneStaleDrag();
    if (drag.current) return;
    e.preventDefault();
    dragSeenAt.current = performance.now();

    const cv = cvRef.current!;
    try {
      cv.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
    pointer.current.down = true;
    const w = toWorld(e.clientX, e.clientY);

    // explicit pan gestures (middle/right button, or Space held) start panning at once
    if (e.button === 1 || e.button === 2 || pointer.current.space) {
      drag.current = { mode: 'pan', px: e.clientX, py: e.clientY };
      dragPid.current = e.pointerId;
      setMode('grab');
      return;
    }

    const t = S.current.tool;

    if (t === 'polygon') {
      drag.current = { mode: 'create', type: 'polygon', ax: sn(w.x), az: sn(w.z), bx: w.x, bz: w.z };
      dragPid.current = e.pointerId;
      return;
    }

    if (t === 'platform' || t === 'pillar' || t === 'gap') {
      drag.current = { mode: 'create', type: t, ax: sn(w.x), az: sn(w.z), bx: w.x, bz: w.z };
      dragPid.current = e.pointerId;
      return;
    }
    if (t === 'crystal') {
      const id = uid('c');
      api.beginEdit();
      api.commit(
        { ...doc, crystals: [...doc.crystals, { id, x: sn(w.x), z: sn(w.z), radius: 0.42 }] },
);
      api.endEdit();
      setSel({ kind: 'crystal', id });
      setTool('select');
      return;
    }
    if (t === 'start' || t === 'goal') {
      const key = t === 'start' ? 'start' : 'goal';
      api.beginEdit();
      api.commit({ ...doc, [key]: { x: sn(w.x), z: sn(w.z) } } as Doc);
      api.endEdit();
      setSel({ kind: t, id: t });
      setTool('select');
      return;
    }
    if (t === 'sun') {
      drag.current = { mode: 'sun' };
      dragPid.current = e.pointerId;
      api.beginEdit();
      api.live((d) => ({ ...d, sun: { ...d.sun, azimuth: Math.round(azimuthOf(w.x, w.z) * 10) / 10 } }));
      return;
    }

    const hit = hitTest(e.clientX, e.clientY, e.pointerType);
    if (!hit) {
      // Pressing empty space deselects. Panning only begins after a deliberate
      // drag, so a simple tap can never nudge the camera.
      setSel({ kind: 'none', id: '' });
      drag.current = { mode: 'maybePan', px: e.clientX, py: e.clientY };
      dragPid.current = e.pointerId;
      return;
    }

    if (hit.handle === 'rotate') {
      const start = rectOf(hit.kind, hit.id)!;
      const center = selectionCenter(doc, hit.kind, hit.id) ?? centerOf(start);
      drag.current = {
        mode: 'rotate',
        kind: hit.kind,
        id: hit.id,
        center,
        startAngle: Math.atan2(w.z - center.z, w.x - center.x),
        before: doc,
      };
      dragPid.current = e.pointerId;
      api.beginEdit();
      setSel({ kind: hit.kind, id: hit.id });
      return;
    }
    if (hit.handle?.startsWith('v')) {
      const index = parseInt(hit.handle.slice(1), 10);
      if (Number.isFinite(index)) {
        drag.current = { mode: 'vertex', kind: 'platform', id: hit.id, index, before: doc };
        dragPid.current = e.pointerId;
        api.beginEdit();
        setSel({ kind: 'platform', id: hit.id });
        return;
      }
    }
    if (hit.handle) {
      const start = rectOf(hit.kind, hit.id)!;
      drag.current = { mode: 'resize', id: hit.id, rect: hit.kind as 'platform' | 'part' | 'gap', handle: hit.handle, start };
      dragPid.current = e.pointerId;
      api.beginEdit();
      return;
    }
    if (hit.kind === 'anchorA' || hit.kind === 'anchorB') {
      drag.current = { mode: 'anchor', id: hit.id, which: hit.kind === 'anchorA' ? 'a' : 'b' };
      dragPid.current = e.pointerId;
      api.beginEdit();
      setSel({ kind: 'gap', id: hit.id });
      return;
    }
    if (hit.kind === 'sun') {
      drag.current = { mode: 'sun' };
      dragPid.current = e.pointerId;
      api.beginEdit();
      setSel({ kind: 'sun', id: 'sun' });
      return;
    }
    if (hit.kind === 'start' || hit.kind === 'goal' || hit.kind === 'crystal') {
      drag.current = { mode: 'point', kind: hit.kind, id: hit.id };
      dragPid.current = e.pointerId;
      api.beginEdit();
      setSel({ kind: hit.kind, id: hit.id });
      return;
    }

    const isPart = hit.kind === 'part';
    const targetId = isPart ? pillarIdOfPart(doc, hit.id) : hit.id;
    setSel({ kind: hit.kind, id: hit.id });
    drag.current = { mode: 'move', kind: hit.kind, id: isPart ? hit.id : targetId, wx: w.x, wz: w.z, before: doc };
    dragPid.current = e.pointerId;
    api.beginEdit();
    setMode('move');
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const w = toWorld(e.clientX, e.clientY);
    S.current.onReadout?.(`${w.x.toFixed(2)}, ${w.z.toFixed(2)}`);
    const d = drag.current;

    // Only the pointer that started the gesture may drive it. Moves from a
    // second finger (palm, resting thumb) must never yank the camera or the
    // object — that was the "viewport jumps on every touch" bug.
    if (d && dragPid.current !== null && e.pointerId !== dragPid.current) return;
    if (d) dragSeenAt.current = performance.now();

    if (!d) {
      const hit = hitTest(e.clientX, e.clientY, e.pointerType);
      hover.current = hit ? { kind: hit.kind, id: hit.id } : null;
      const CURSOR: Record<string, string> = {
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        nw: 'nwse-resize',
        se: 'nwse-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
      };
      cvRef.current!.style.cursor = hit?.handle
        ? CURSOR[hit.handle] ?? 'pointer'
        : hit && hit.kind !== 'none'
          ? hit.kind === 'sun'
            ? 'grab'
            : 'move'
          : S.current.tool === 'select'
            ? ''
            : 'crosshair';
      return;
    }

    if (d.mode === 'pan') {
      // Incremental, not absolute: coalesced moves and a late join can never
      // teleport the camera because we always consume only the newest delta.
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      d.px = e.clientX;
      d.py = e.clientY;
      view.current.cx -= dx / view.current.scale;
      view.current.cz -= dy / view.current.scale;
      return;
    }
    if (d.mode === 'maybePan') {
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      // Fingers wobble more than a mouse: demand a longer deliberate drag
      // before a touch becomes a pan, so taps never nudge the sheet.
      const threshold = e.pointerType === 'touch' ? 12 : 4;
      if (Math.hypot(dx, dy) < threshold) return; // still a tap, not a pan
      // Pan by the accumulated delta right away so the sheet follows the
      // finger 1:1 with no one-frame jump, then track incrementally.
      view.current.cx -= dx / view.current.scale;
      view.current.cz -= dy / view.current.scale;
      drag.current = { mode: 'pan', px: e.clientX, py: e.clientY };
      setMode('grab');
      return;
    }
    if (d.mode === 'create') {
      d.bx = sn(w.x);
      d.bz = sn(w.z);
      return;
    }
    if (d.mode === 'rotate') {
      const ang = Math.atan2(w.z - d.center.z, w.x - d.center.x);
      let delta = ang - d.startAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (e.shiftKey) {
        const step = Math.PI / 12; // 15°
        delta = Math.round(delta / step) * step;
      }
      S.current.onRotation?.(Math.round((delta * 180) / Math.PI));
      api.live(() => rotateDocObject(d.before, d.kind, d.id, delta));
      return;
    }
    if (d.mode === 'vertex') {
      const x = sn(w.x);
      const z = sn(w.z);
      api.live(() => ({
        ...d.before,
        platforms: d.before.platforms.map((p) => {
          if (p.id !== d.id || !p.points) return p;
          const pts = p.points.map((v, i) => (i === d.index ? { x, z } : v));
          const bb = polyBounds(pts);
          return { ...p, points: pts, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax };
        }),
      }));
      return;
    }
    if (d.mode === 'sun') {
      api.live((doc0) => ({ ...doc0, sun: { ...doc0.sun, azimuth: Math.round(azimuthOf(w.x, w.z) * 10) / 10 } }));
      return;
    }
    if (d.mode === 'move') {
      // 1:1 follow: total cursor delta since press, applied to the drag-start doc.
      let dx = w.x - d.wx;
      let dz = w.z - d.wz;
      if (S.current.snap && S.current.grid > 0 && !e.altKey) {
        // snap against the object's ORIGINAL rect so the delta stays stable
        const b = rectOf(d.kind, d.id, d.before);
        if (b) {
          dx = sn(b.xMin + dx) - b.xMin;
          dz = sn(b.zMin + dz) - b.zMin;
        }
      }
      applyDelta(d.before, d.kind, d.id, dx, dz);
      return;
    }
    if (d.mode === 'resize') {
      const x = sn(w.x);
      const z = sn(w.z);
      let { xMin, xMax, zMin, zMax } = d.start;
      if (d.handle.includes('w')) xMin = Math.min(x, xMax - 0.25);
      if (d.handle.includes('e')) xMax = Math.max(x, xMin + 0.25);
      if (d.handle.includes('n')) zMin = Math.min(z, zMax - 0.25);
      if (d.handle.includes('s')) zMax = Math.max(z, zMin + 0.25);
      const patch = { xMin, xMax, zMin, zMax };
      api.live((doc0) => {
        if (d.rect === 'platform') {
          return { ...doc0, platforms: doc0.platforms.map((p) => (p.id === d.id ? { ...p, ...patch } : p)) };
        }
        if (d.rect === 'gap') {
          return { ...doc0, gaps: doc0.gaps.map((g) => (g.id === d.id ? { ...g, ...patch } : g)) };
        }
        return {
          ...doc0,
          pillars: doc0.pillars.map((s) => ({
            ...s,
            parts: s.parts.map((b) => (b.id === d.id ? { ...b, ...patch } : b)),
          })),
        };
      });
      return;
    }
    if (d.mode === 'anchor') {
      const x = sn(w.x);
      const z = sn(w.z);
      api.live((doc0) => ({
        ...doc0,
        gaps: doc0.gaps.map((g) => (g.id === d.id ? { ...g, ...(d.which === 'a' ? { ax: x, az: z } : { bx: x, bz: z }) } : g)),
      }));
      return;
    }
    if (d.mode === 'point') {
      const x = sn(w.x);
      const z = sn(w.z);
      api.live((doc0) => {
        if (d.kind === 'crystal') {
          return { ...doc0, crystals: doc0.crystals.map((c) => (c.id === d.id ? { ...c, x, z } : c)) };
        }
        return { ...doc0, [d.kind]: { x, z } } as Doc;
      });
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      finishDrag(e.pointerId, true);
      return;
    }
    // a stray pointer (second finger, palm, pen) must never terminate the gesture
    if (dragPid.current !== e.pointerId) {
      finishDrag(e.pointerId);
      return;
    }
    finishDrag(e.pointerId, true);
    if (d.mode === 'maybePan' || d.mode === 'pan') return;

    if (d.mode === 'create' && d.type === 'polygon') {
      const radius = Math.max(0.7, Math.hypot(d.bx - d.ax, d.bz - d.az));
      const sides = Math.max(3, Math.min(12, S.current.polygonSides));
      const pts = regularPolygon(d.ax, d.az, radius, sides);
      const bb = polyBounds(pts);
      const id = uid('p');
      api.beginEdit();
      api.commit({
        ...doc,
        platforms: [
          ...doc.platforms,
          {
            id,
            name: `${sides}-gon ${doc.platforms.length + 1}`,
            xMin: bb.xMin,
            xMax: bb.xMax,
            zMin: bb.zMin,
            zMax: bb.zMax,
            style: 'main',
            brokenEdges: [],
            points: pts,
          },
        ],
      });
      api.endEdit();
      setSel({ kind: 'platform', id });
      setTool('select');
      return;
    }
    if (d.mode === 'create') {
      const r = norm({ xMin: d.ax, xMax: d.bx, zMin: d.az, zMax: d.bz });
      const w = r.xMax - r.xMin;
      const dep = r.zMax - r.zMin;
      if (w < 0.35 && dep < 0.35) {
        setTool('select');
        return;
      }
      api.beginEdit();
      if (d.type === 'platform') {
        const id = uid('p');
        api.commit(
          {
            ...doc,
            platforms: [...doc.platforms, { id, name: `Platform ${doc.platforms.length + 1}`, ...r, style: 'main', brokenEdges: [] }],
          },
          'add platform'
        );
        api.endEdit();
        setSel({ kind: 'platform', id });
      } else if (d.type === 'gap') {
        const id = uid('g');
        const c = centerOf(r);
        const horizontal = w >= dep;
        api.commit(
          {
            ...doc,
            gaps: [
              ...doc.gaps,
              {
                id,
                name: `Span ${String.fromCharCode(65 + doc.gaps.length)}`,
                ...r,
                ax: horizontal ? r.xMin - 0.8 : c.x,
                az: horizontal ? c.z : r.zMin - 0.8,
                bx: horizontal ? r.xMax + 0.8 : c.x,
                bz: horizontal ? c.z : r.zMax + 0.8,
              },
            ],
          },
          'add span'
        );
        api.endEdit();
        setSel({ kind: 'gap', id });
      } else {
        const id = uid('pil');
        const partId = uid('b');
        const size = Math.max(0.7, Math.min(w, dep, 1.4));
        const c2 = centerOf(r);
        api.commit({
          ...doc,
          pillars: [
            ...doc.pillars,
            {
              id,
              label: `Caster ${doc.pillars.length + 1}`,
              parts: [
                {
                    id: partId,
                    xMin: c2.x - size / 2,
                    xMax: c2.x + size / 2,
                    yMin: 0,
                    yMax: 3.4,
                    zMin: c2.z - size / 2,
                    zMax: c2.z + size / 2,
                    variant: 'terracotta',
                    castsUmbra: true,
                  },
                ],
              },
            ],
          },
          'add caster'
        );
        api.endEdit();
        setSel({ kind: 'part', id: doc.pillars.at(-1)?.parts[0]?.id ?? '' });
      }
      setTool('select');
      return;
    }
  };

  // Native non-passive wheel listener: React attaches wheel at the root as
  // passive, so preventDefault there is ignored and the browser can scroll /
  // pinch-zoom the page out from under the sheet. A direct listener with
  // { passive: false } actually stops it.
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const before = toWorld(e.clientX, e.clientY);
      const v = view.current;
      const step = Math.max(-3, Math.min(3, e.deltaY * 0.0022));
      v.scale = Math.max(8, Math.min(220, v.scale * Math.exp(-step)));
      const after = toWorld(e.clientX, e.clientY);
      v.cx += before.x - after.x;
      v.cz += before.z - after.z;
    };
    cv.addEventListener('wheel', onWheelNative, { passive: false });
    return () => cv.removeEventListener('wheel', onWheelNative);
  }, [toWorld]);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.code === 'Space' && !typing) {
        pointer.current.space = true;
        if (!pointer.current.down) setMode('pan');
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        pointer.current.space = false;
        if (!pointer.current.down) setMode('select');
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  /* ------------------------------------------------------------- paint */

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = cvRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const W = cv.width / dpr;
      const H = cv.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = view.current;
      const d = S.current.doc;
      const t = performance.now() / 1000;
      const px = (x: number) => (x - v.cx) * v.scale + W / 2;
      const py = (z: number) => (z - v.cz) * v.scale + H / 2;
      const rr = (r: Rect) => ({ x: px(r.xMin), y: py(r.zMin), w: (r.xMax - r.xMin) * v.scale, h: (r.zMax - r.zMin) * v.scale });

      ctx.fillStyle = C.sheet;
      ctx.fillRect(0, 0, W, H);

      if (S.current.layers.grid) {
        const step = v.scale > 26 ? 1 : 5;
        ctx.lineWidth = 1;
        const x0 = v.cx - W / 2 / v.scale;
        const x1 = v.cx + W / 2 / v.scale;
        const z0 = v.cz - H / 2 / v.scale;
        const z1 = v.cz + H / 2 / v.scale;
        ctx.strokeStyle = C.gridMinor;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) {
          ctx.moveTo(Math.round(px(x)) + 0.5, 0);
          ctx.lineTo(Math.round(px(x)) + 0.5, H);
        }
        for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) {
          ctx.moveTo(0, Math.round(py(z)) + 0.5);
          ctx.lineTo(W, Math.round(py(z)) + 0.5);
        }
        ctx.stroke();
        ctx.strokeStyle = C.gridMajor;
        ctx.beginPath();
        for (let x = Math.ceil(x0 / 5) * 5; x < x1; x += 5) {
          ctx.moveTo(Math.round(px(x)) + 0.5, 0);
          ctx.lineTo(Math.round(px(x)) + 0.5, H);
        }
        for (let z = Math.ceil(z0 / 5) * 5; z < z1; z += 5) {
          ctx.moveTo(0, Math.round(py(z)) + 0.5);
          ctx.lineTo(W, Math.round(py(z)) + 0.5);
        }
        ctx.stroke();
        ctx.strokeStyle = C.axis;
        ctx.beginPath();
        ctx.moveTo(px(0), 0);
        ctx.lineTo(px(0), H);
        ctx.moveTo(0, py(0));
        ctx.lineTo(W, py(0));
        ctx.stroke();
      }

      // sun orbit ring
      const orbit = d.sun.maxRadius * 0.78;
      ctx.save();
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = 'rgba(180,150,88,0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px(0), py(0), orbit * v.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // platforms
      for (const p of d.platforms) {
        const r = rr(norm(p));
        const fill = p.style === 'pedestal' ? C.stonePedestal : p.style === 'island' ? C.stoneIsland : C.stone;
        if (p.points && p.points.length >= 3) {
          ctx.beginPath();
          p.points.forEach((v, k) => (k ? ctx.lineTo(px(v.x), py(v.z)) : ctx.moveTo(px(v.x), py(v.z))));
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = C.stoneEdge;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // inset echo of the outline
          let cxp = 0;
          let czp = 0;
          for (const v of p.points) {
            cxp += v.x;
            czp += v.z;
          }
          cxp /= p.points.length;
          czp /= p.points.length;
          const insetPts = p.points.map((v) => {
            const dx = v.x - cxp;
            const dz = v.z - czp;
            const len = Math.hypot(dx, dz) || 1;
            const k = Math.max(0.2, (len - 0.2) / len);
            return { x: cxp + dx * k, z: czp + dz * k };
          });
          ctx.beginPath();
          insetPts.forEach((v, k) => (k ? ctx.lineTo(px(v.x), py(v.z)) : ctx.moveTo(px(v.x), py(v.z))));
          ctx.closePath();
          ctx.strokeStyle = 'rgba(150,138,116,0.45)';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (p.style === 'pedestal') ctx.setLineDash([]);
          if ((p.brokenEdges || []).length) {
            ctx.fillStyle = 'rgba(180,95,75,0.85)';
            p.points.forEach((v, k) => {
              if (k % 2 === 0) ctx.fillRect(px(v.x) - 2, py(v.z) - 2, 4, 4);
            });
          }
        } else {
          ctx.fillStyle = fill;
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeStyle = C.stoneEdge;
          ctx.lineWidth = 1.4;
          ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
          if (p.style === 'pedestal') {
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(120,110,92,0.6)';
            ctx.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
            ctx.restore();
          } else {
            ctx.strokeStyle = 'rgba(150,138,116,0.45)';
            ctx.lineWidth = 1;
            ctx.strokeRect(r.x + 5.5, r.y + 5.5, r.w - 11, r.h - 11);
          }
          const edges = new Set(p.brokenEdges);
          ctx.fillStyle = 'rgba(180,95,75,0.85)';
          const teeth = (x: number, y: number, w: number, h: number, horiz: boolean) => {
            const n = Math.max(3, Math.floor((horiz ? w : h) / 11));
            for (let i = 0; i < n; i++) {
              const f = (i + 0.5) / n;
              if (horiz) ctx.fillRect(x + w * f - 2, y - 2.5, 4, 5.5);
              else ctx.fillRect(x - 2.5, y + h * f - 2, 5.5, 4);
            }
          };
          if (edges.has('east')) teeth(r.x + r.w, r.y, r.w, r.h, false);
          if (edges.has('west')) teeth(r.x, r.y, r.w, r.h, false);
          if (edges.has('south')) teeth(r.x, r.y + r.h, r.w, r.h, true);
          if (edges.has('north')) teeth(r.x, r.y, r.w, r.h, true);
        }
      }

      // spans
      if (S.current.layers.spans) {
        for (const g of d.gaps) {
          const base = norm(g);
          const r = rr(base);
          ctx.fillStyle = C.spanFill;
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();
          ctx.strokeStyle = C.span;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = -r.h; i < r.w; i += 9) {
            ctx.moveTo(r.x + i, r.y + r.h);
            ctx.lineTo(r.x + i + r.h, r.y);
          }
          ctx.stroke();
          ctx.restore();
          ctx.save();
          ctx.setLineDash([6, 4]);
          ctx.lineDashOffset = -t * 14;
          ctx.strokeStyle = C.clay;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(r.x, r.y, r.w, r.h);
          ctx.restore();
          // span test line
          ctx.strokeStyle = 'rgba(180,95,75,0.75)';
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(px(g.ax), py(g.az));
          ctx.lineTo(px(g.bx), py(g.bz));
          ctx.stroke();
          ctx.setLineDash([]);
          for (const [ax, az, tag] of [
            [g.ax, g.az, 'A'],
            [g.bx, g.bz, 'B'],
          ] as const) {
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = C.clay;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(px(ax), py(az), 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = C.clay;
            ctx.font = '600 9px "Schibsted Grotesk", sans-serif';
            ctx.fillText(tag, px(ax) + 7, py(az) - 6);
          }
        }
      }

      // shadows (merged silhouette, one covered line)
      if (S.current.layers.shadow && d.pillars.length) {
        const polys = shadowsAt(d);
        const loops = traceUmbraSilhouette(polys);
        const set = loops.length ? loops : polys;
        ctx.fillStyle = C.shadowFill;
        ctx.strokeStyle = C.shadowEdge;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        for (const loop of set) {
          ctx.beginPath();
          loop.forEach((p, i) => (i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))));
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      // casters
      if (S.current.layers.casters) {
        for (const s of d.pillars) {
          for (const b of s.parts) {
            const r = rr(norm(b));
            const elevated = b.yMin > 0.02;
            ctx.globalAlpha = elevated ? 0.55 : 1;
            ctx.fillStyle = VARIANT_FILL[b.variant] ?? C.stone;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.strokeStyle = b.variant === 'slate' ? '#20242a' : 'rgba(60,54,44,0.75)';
            ctx.lineWidth = elevated ? 1 : 1.5;
            if (elevated) ctx.setLineDash([4, 3]);
            ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
            ctx.setLineDash([]);
            if (!elevated && v.scale > 26) {
              ctx.strokeStyle = 'rgba(255,252,244,0.5)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              const n = Math.max(2, Math.round(r.w / 9));
              for (let i = 1; i < n; i++) {
                const fx = r.x + (r.w * i) / n;
                ctx.moveTo(fx, r.y + 2);
                ctx.lineTo(fx, r.y + r.h - 2);
              }
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          if (S.current.layers.dims && v.scale > 22 && s.parts[0]) {
            const c = centerOf(norm(s.parts[0]));
            ctx.fillStyle = C.label;
            ctx.font = '600 10px "Schibsted Grotesk", sans-serif';
            ctx.fillText(s.label, px(c.x) + 6, py(c.z) - 6);
          }
        }
      }

      // crystals
      for (const c of d.crystals) {
        ctx.beginPath();
        ctx.arc(px(c.x), py(c.z), Math.max(6, c.radius * v.scale), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(217,159,46,0.5)';
        ctx.fill();
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px(c.x), py(c.z), 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      // start + goal
      if (S.current.layers.marks) {
        const mark = (x: number, z: number, color: number[], label: string) => {
          ctx.beginPath();
          ctx.arc(px(x), py(z), 13, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.fill();
          ctx.strokeStyle = `rgb(${color.join(',')})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px(x), py(z), 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgb(${color.join(',')})`;
          ctx.fill();
          ctx.font = '700 9px "Schibsted Grotesk", sans-serif';
          ctx.fillStyle = `rgb(${color.join(',')})`;
          ctx.fillText(label, px(x) + 16, py(z) + 3);
        };
        mark(d.start.x, d.start.z, [79, 138, 128], 'START');
        mark(d.goal.x, d.goal.z, [109, 138, 94], 'GOAL');
      }

      // sun handle
      const sp = sunPoint(d);
      const sx = px(sp.x);
      const sy = py(sp.z);
      ctx.strokeStyle = 'rgba(217,159,46,0.45)';
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px(0), py(0));
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(t * 0.35);
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(0, 11);
        ctx.lineTo(0, 16);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f6d089';
      ctx.fill();
      ctx.strokeStyle = '#8a6a22';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // creation preview
      const dr = drag.current;
      if (dr && dr.mode === 'create' && dr.type === 'polygon') {
        const rad = Math.max(0.7, Math.hypot(dr.bx - dr.ax, dr.bz - dr.az));
        const sides = Math.max(3, Math.min(12, S.current.polygonSides));
        const prev = regularPolygon(dr.ax, dr.az, rad, sides);
        ctx.beginPath();
        prev.forEach((v, k) => (k ? ctx.lineTo(px(v.x), py(v.z)) : ctx.moveTo(px(v.x), py(v.z))));
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
        ctx.strokeStyle = C.teal;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.ink;
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillText(`${sides}-gon · r ${rad.toFixed(2)}`, px(dr.ax) + 10, py(dr.az) - 10);
      } else if (dr && dr.mode === 'create') {
        const r = rr(norm({ xMin: dr.ax, xMax: dr.bx, zMin: dr.az, zMax: dr.bz }));
        ctx.fillStyle = dr.type === 'gap' ? 'rgba(194,112,92,0.18)' : 'rgba(255,255,255,0.5)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = C.teal;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.6;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.setLineDash([]);
        ctx.fillStyle = C.ink;
        ctx.font = '600 11px "JetBrains Mono", monospace';
        const wpx = Math.abs(dr.bx - dr.ax);
        const zpx = Math.abs(dr.bz - dr.az);
        ctx.fillText(`${wpx.toFixed(2)} × ${zpx.toFixed(2)}`, r.x + r.w + 8, r.y + 12);
      }

      // hover
      const hv = hover.current;
      if (hv && !(dr && (dr.mode === 'move' || dr.mode === 'resize'))) {
        const hr = rectOf(hv.kind, hv.id);
        if (hr) {
          const r = rr(hr);
          ctx.strokeStyle = 'rgba(59,60,56,0.4)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        }
      }

      // selection
      const sr = rectOf(S.current.sel.kind, S.current.sel.id);
      const selPlat = S.current.sel.kind === 'platform' ? d.platforms.find((p) => p.id === S.current.sel.id) : undefined;
      const selPoly = selPlat?.points && selPlat.points.length >= 3 ? selPlat : undefined;
      if (sr && selPoly) {
        // polygon: draw its own outline, vertex handles and a rotate grip
        const r = rr(sr);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -t * 26;
        ctx.strokeStyle = '#2f3336';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        selPoly.points!.forEach((v, k) => (k ? ctx.lineTo(px(v.x), py(v.z)) : ctx.moveTo(px(v.x), py(v.z))));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        for (const v of selPoly.points!) {
          ctx.fillStyle = S.current.vertexMode ? '#f4e9c8' : '#fff';
          ctx.strokeStyle = '#2f3336';
          ctx.lineWidth = 1.5;
          ctx.fillRect(px(v.x) - 4.5, py(v.z) - 4.5, 9, 9);
          ctx.strokeRect(px(v.x) - 4.5, py(v.z) - 4.5, 9, 9);
        }
        // rotate grip above the outline
        const gx = (r.x + r.w) / 2;
        const gy = r.y - 42;
        ctx.strokeStyle = 'rgba(47,51,54,0.55)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(gx, r.y);
        ctx.lineTo(gx, gy + 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(gx, gy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#2f3336';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(gx, gy, 4.5, -0.6, Math.PI * 1.2);
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else if (sr) {
        const r = rr(sr);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -t * 26;
        ctx.strokeStyle = '#2f3336';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
        ctx.restore();
        for (const hp of Object.values(handlesOf(sr))) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#2f3336';
          ctx.lineWidth = 1.4;
          ctx.fillRect(px(hp.x) - 4, py(hp.z) - 4, 8, 8);
          ctx.strokeRect(px(hp.x) - 4, py(hp.z) - 4, 8, 8);
        }
        const gx = (r.x + r.w) / 2;
        const gy = r.y - 42;
        ctx.strokeStyle = 'rgba(47,51,54,0.55)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(gx, r.y);
        ctx.lineTo(gx, gy + 8);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(gx, gy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#2f3336';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(gx, gy, 4.5, -0.6, Math.PI * 1.2);
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (S.current.layers.dims) {
          ctx.fillStyle = '#2f3336';
          ctx.font = '500 10.5px "JetBrains Mono", monospace';
          const w = sr.xMax - sr.xMin;
          const dp = sr.zMax - sr.zMin;
          ctx.fillText(`${w.toFixed(2)} × ${dp.toFixed(2)}`, r.x, r.y - 8);
        }
      } else if (S.current.sel.kind === 'crystal') {
        const c = d.crystals.find((x) => x.id === S.current.sel.id);
        if (c) {
          ctx.save();
          ctx.setLineDash([5, 4]);
          ctx.lineDashOffset = -t * 26;
          ctx.strokeStyle = '#2f3336';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(px(c.x), py(c.z), Math.max(10, c.radius * v.scale + 4), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // north arrow + scale bar
      ctx.fillStyle = C.label;
      ctx.font = '700 10px "Schibsted Grotesk", sans-serif';
      ctx.fillText('N ↑', 14, 20);
      ctx.strokeStyle = C.label;
      ctx.lineWidth = 1.2;
      const bar = Math.round(80 / v.scale) || 1;
      ctx.beginPath();
      ctx.moveTo(14, H - 16);
      ctx.lineTo(14 + bar * v.scale, H - 16);
      ctx.moveTo(14, H - 20);
      ctx.lineTo(14, H - 12);
      ctx.moveTo(14 + bar * v.scale, H - 20);
      ctx.lineTo(14 + bar * v.scale, H - 12);
      ctx.stroke();
      ctx.fillText(`${bar} unit${bar === 1 ? '' : 's'}`, 16, H - 22);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [handlesOf, rectOf]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={cvRef}
        className="fg-sheet absolute inset-0 h-full w-full"
        data-mode={mode}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={(e) => finishDrag(e.pointerId, true)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {tool !== 'select' && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 bg-[#2f3336] px-3 py-1.5 text-[10.5px] uppercase tracking-[0.18em] text-[#f0e9da]">
          {tool === 'platform' && 'Drag a rectangle for stone'}
          {tool === 'polygon' && `Drag out a ${polygonSides}-sided stone (3–12 sides in the header)`}
          {tool === 'pillar' && 'Drag a footprint for a caster'}
          {tool === 'gap' && 'Drag the broken span'}
          {tool === 'crystal' && 'Click to set a sun crystal'}
          {tool === 'start' && 'Click to place the sphere'}
          {tool === 'goal' && 'Click to place the sanctuary'}
          {tool === 'sun' && 'Drag to swing the light'}
        </div>
      )}
    </div>
  );
}

function inRectLoose(x: number, z: number, r: Rect, inflate: number) {
  return x >= r.xMin - inflate && x <= r.xMax + inflate && z >= r.zMin - inflate && z <= r.zMax + inflate;
}

function pillarIdOfPart(doc: Doc, partId: string) {
  for (const s of doc.pillars) if (s.parts.some((p) => p.id === partId)) return s.id;
  return '';
}


