import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  Box,
  Circle,
  Copy,
  Download,
  Eraser,
  FilePlus2,
  Hexagon,
  RotateCw,
  SkipForward,
  Grid3x3,
  Hand,
  Keyboard,
  LayoutGrid,
  Lightbulb,
  Link,
  Magnet,
  MousePointer2,
  PanelRight,
  TrendingUp,
  Play,
  Redo2,
  Save,
  Scan,
  Settings2,
  Square,
  Sun,
  Target,
  Trash2,
  Undo2,
  X,
  ZoomIn,
} from 'lucide-react';
import './editor.css';
import { UmbraCanvas, type GameSettings } from '../components/UmbraCanvas';
import { LEVELS } from '../game/levels';
import { sound } from '../game/sound';
import { AzimuthRuler, shadowFootprint } from './AzimuthRuler';
import {
  analyse,
  type Analysis,
  autoCamera,
  type Doc,
  docFromLevel,
  deleteDocObject,
  download,
  platformOutline,
  polyBounds,
  regularPolygon,
  rotateDocObject,
  emptyDoc,
  loadSaved,
  round,
  saveAll,
  SESSION_KEY,
  slug,
  snapVal,
  toLevelData,
  toTS,
  useAutosave,
  useDoc,
  validate,
} from './doc';
import { Inspector } from './Inspector';
import { type PlanLayers, PlanCanvas, type Sel, type Tool } from './PlanCanvas';
import { TransformPanel } from './TransformPanel';

const TOOLS: Array<{ id: Tool; name: string; key: string; icon: typeof Square }> = [
  { id: 'select', name: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'platform', name: 'Stone', key: 'P', icon: Square },
  { id: 'polygon', name: 'N-gon', key: 'O', icon: Hexagon },
  { id: 'pillar', name: 'Caster', key: 'C', icon: Box },
  { id: 'gap', name: 'Span', key: 'G', icon: Eraser },
  { id: 'ramp', name: 'Ramp', key: 'T', icon: TrendingUp },
  { id: 'crystal', name: 'Crystal', key: 'X', icon: Circle },
  { id: 'start', name: 'Start', key: 'B', icon: Target },
  { id: 'goal', name: 'Goal', key: 'E', icon: Link },
  { id: 'sun', name: 'Light', key: 'L', icon: Sun },
];

const LAYER_DEFS: Array<{ id: keyof PlanLayers; name: string }> = [
  { id: 'grid', name: 'Grid' },
  { id: 'shadow', name: 'Shadow' },
  { id: 'spans', name: 'Spans' },
  { id: 'casters', name: 'Casters' },
  { id: 'marks', name: 'Marks' },
  { id: 'dims', name: 'Dims' },
];

type View = 'plan' | 'split' | 'preview';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function EditorApp({ onExit }: { onExit?: () => void } = {}) {
  const boot = useMemo(() => {
    const saved = loadSaved();
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw) as Doc;
    } catch {
      /* ignore */
    }
    return saved[0]?.doc ?? emptyDoc();
  }, []);

  const api = useDoc(boot);
  const doc = api.doc;

  const [sel, setSel] = useState<Sel>({ kind: 'none', id: '' });
  const [tool, setTool] = useState<Tool>('select');
  const [grid, setGrid] = useState(0.25);
  const [snapOn, setSnapOn] = useState(true);
  const [view, setView] = useState<View>('plan');
  const [layers, setLayers] = useState<PlanLayers>({
    grid: true,
    shadow: true,
    spans: true,
    casters: true,
    marks: true,
    dims: true,
  });
  const [vertexMode, setVertexMode] = useState(false);
  const [polygonSides, setPolygonSides] = useState(6);
  const [liveRotation, setLiveRotation] = useState<number | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [readout, setReadout] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysing, setAnalysing] = useState<number | null>(null);
  const [playLevel, setPlayLevel] = useState<Doc | null>(null);
  const [playResult, setPlayResult] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'export' | 'files' | 'keys'>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [tab, setTab] = useState<'ts' | 'json'>('ts');

  const cancelRef = useRef(false);
  const virtualInputRef = useRef({ x: 0, y: 0 });

  const [settings, setSettings] = useState<GameSettings>({
    quality: 'high',
    shadowOpacity: 0.68,
    cameraDrift: false,
    dustMotes: true,
  });

  const { dirty } = useAutosave(doc, !playLevel);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  /** Write the open sheet to this browser's level list straight away. */
  const storeNow = useCallback(() => {
    const list = loadSaved();
    const entry = { id: doc.meta.id, savedAt: Date.now(), doc };
    const i = list.findIndex((l) => l.id === doc.meta.id);
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
    saveAll(list);
  }, [doc]);

  // Autosave waits for a pause in editing. Leaving inside that window (button or
  // browser Back) must not drop the last change, or the game would list a stale level.
  const flushRef = useRef({ dirty, storeNow });
  flushRef.current = { dirty, storeNow };
  useEffect(
    () => () => {
      if (flushRef.current.dirty) flushRef.current.storeNow();
    },
    []
  );

  const leave = useCallback(() => {
    sound.playUiBack();
    onExit?.();
  }, [onExit]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(doc));
    } catch {
      /* ignore */
    }
  }, [doc]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const flash = (m: string) => setToast(m);

  const issues = useMemo(() => validate(doc), [doc]);
  const counts = useMemo(
    () => ({ platforms: doc.platforms.length, pillars: doc.pillars.length, gaps: doc.gaps.length, crystals: doc.crystals.length, ramps: (doc.ramps ?? []).length }),
    [doc]
  );

  /** Tool buttons double as a reset for selection gestures, so placement cannot inherit a stuck selection. */
  const chooseTool = useCallback((next: Tool) => {
    setTool(next);
    if (next !== 'select') {
      setSel({ kind: 'none', id: '' });
      setVertexMode(false);
    }
  }, []);

  /** Tab walks every selectable thing, including objects hidden under other objects. */
  const cycleSelection = useCallback(
    (dir: 1 | -1) => {
      const items: Sel[] = [
        ...doc.platforms.map((p) => ({ kind: 'platform', id: p.id }) as Sel),
        ...doc.gaps.map((g) => ({ kind: 'gap', id: g.id }) as Sel),
        ...doc.pillars.flatMap((s) => [
          { kind: 'pillar', id: s.id } as Sel,
          ...s.parts.map((b) => ({ kind: 'part', id: b.id }) as Sel),
        ]),
        ...doc.crystals.map((c) => ({ kind: 'crystal', id: c.id }) as Sel),
        ...(doc.ramps ?? []).map((r) => ({ kind: 'ramp', id: r.id }) as Sel),
        { kind: 'start', id: 'start' },
        { kind: 'goal', id: 'goal' },
        { kind: 'sun', id: 'sun' },
      ];
      if (items.length === 0) return;
      const current = items.findIndex((i) => i.kind === sel.kind && i.id === sel.id);
      const next = current < 0 ? (dir === 1 ? 0 : items.length - 1) : (current + dir + items.length) % items.length;
      setSel(items[next]);
    },
    [doc, sel]
  );

  const previewDoc = useDebounced(doc, 420);
  const previewLevel = useMemo(() => toLevelData(previewDoc), [previewDoc]);
  const playLevelData = useMemo(() => (playLevel ? toLevelData(playLevel) : null), [playLevel]);
  const footprint = useMemo(() => shadowFootprint(doc), [doc]);

  // invalidate analysis whenever the shape of the level changes
  const shapeKey = useMemo(() => JSON.stringify([doc.platforms, doc.pillars, doc.gaps, doc.crystals, doc.ramps, doc.start, doc.goal, doc.sun.shadowRatio]), [doc]);
  useEffect(() => {
    setAnalysis(null);
    cancelRef.current = true;
  }, [shapeKey]);

  /** Turn a rectangular stone into an editable 4-point outline. */
  const makeEditable = useCallback(() => {
    if (sel.kind !== 'platform') {
      setVertexMode((v) => !v);
      return;
    }
    const platform = doc.platforms.find((p) => p.id === sel.id);
    if (!platform) return;
    if (!platform.points || platform.points.length < 3) {
      const pts = platformOutline(platform);
      api.update((d) => ({
        ...d,
        platforms: d.platforms.map((p) => (p.id === sel.id ? { ...p, points: pts } : p)),
      }));
      flash('Outline enabled — drag the corner points to bend this stone');
    } else {
      flash(vertexMode ? 'Point editing off' : 'Drag the amber square points to reshape');
    }
    setVertexMode(true);
  }, [api, doc.platforms, sel, vertexMode]);

  const restoreRectangle = useCallback(() => {
    if (sel.kind !== 'platform') return;
    api.update((d) => ({
      ...d,
      platforms: d.platforms.map((p) => {
        if (p.id !== sel.id) return p;
        const bb = polyBounds(platformOutline(p));
        return { ...p, points: undefined, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax };
      }),
    }));
    flash('Shape reset to an axis-aligned rectangle');
  }, [api, sel]);

  const applySides = useCallback(
    (sides: number) => {
      setPolygonSides(sides);
      if (sel.kind !== 'platform') return;
      const platform = doc.platforms.find((p) => p.id === sel.id);
      if (!platform) return;
      const outline = platformOutline(platform);
      const bb = polyBounds(outline);
      const cx = (bb.xMin + bb.xMax) / 2;
      const cz = (bb.zMin + bb.zMax) / 2;
      const radius = Math.max(0.5, Math.min(bb.xMax - bb.xMin, bb.zMax - bb.zMin) / 2);
      const pts = regularPolygon(cx, cz, radius, sides);
      const nb = polyBounds(pts);
      api.update((d) => ({
        ...d,
        platforms: d.platforms.map((p) =>
          p.id === sel.id ? { ...p, points: pts, xMin: nb.xMin, xMax: nb.xMax, zMin: nb.zMin, zMax: nb.zMax } : p
        ),
      }));
      flash(`Rebuilt as a regular ${sides}-gon`);
    },
    [api, doc.platforms, sel]
  );

  const rotationless = (k: typeof sel.kind) => k === 'none' || k === 'start' || k === 'goal' || k === 'crystal';

  const rotateSelection = useCallback(
    (deg: number) => {
      if (sel.kind === 'none') {
        flash('Select an object first');
        return;
      }
      if (rotationless(sel.kind)) {
        flash('That marker has no rotation');
        return;
      }
      if (sel.kind === 'sun') {
        api.update((d) => ({ ...d, sun: { ...d.sun, azimuth: (d.sun.azimuth + deg + 360) % 360 } }));
        return;
      }
      api.update((d) => rotateDocObject(d, sel.kind, sel.id, (deg * Math.PI) / 180));
      flash(`Rotated ${deg > 0 ? '+' : ''}${deg}°`);
    },
    [api, sel]
  );

  const deleteSelection = useCallback(() => {
    if (sel.kind === 'none' || sel.kind === 'sun') {
      flash('Select a platform, caster, span, ramp or crystal to delete');
      return;
    }
    api.update((d) => deleteDocObject(d, sel.kind, sel.id));
    setSel({ kind: 'none', id: '' });
    setVertexMode(false);
    flash('Deleted');
  }, [api, sel]);

  const runAnalysis = useCallback(async () => {
    cancelRef.current = true;
    setAnalysing(0);
    const snapshot = doc;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    cancelRef.current = false;
    const res = await analyse(
      snapshot,
      (p) => setAnalysing(p),
      () => cancelRef.current
    );
    setAnalysing(null);
    if (res) {
      setAnalysis(res);
      sound.playBridgeAligned();
      flash(
        res.solutions > 0
          ? `${res.solutions} of 120 bearings solve this — ${res.ms.toFixed(0)} ms`
          : 'No bearing solves it yet — adjust casters or spans'
      );
    }
  }, [doc]);

  /* ------------------------------------------------------------ shortcuts */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? api.redo() : api.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        storeNow();
        flash('Saved to this browser');
        return;
      }
      if (e.key === 'Tab' && !mod) {
        e.preventDefault();
        cycleSelection(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Escape') {
        if (playLevel) {
          setPlayLevel(null);
          return;
        }
        if (modal) {
          setModal(null);
          return;
        }
        setSel({ kind: 'none', id: '' });
        setTool('select');
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        setView((v) => (v === 'plan' ? 'preview' : 'plan'));
        return;
      }
      const k = e.key.toLowerCase();
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t && !mod) {
        chooseTool(t.id);
        return;
      }
      if (k === 'f') setFitSignal((n) => n + 1);
      if (k === 'a') runAnalysis();
      if (k === 'r') {
        api.update((d) => ({ ...d, sun: { ...d.sun, azimuth: (d.sun.azimuth + 15) % 360 } }));
      }
      if ((k === 'Delete' || k === 'Backspace') && !mod) {
        deleteSelection();
        return;
      }
      if (k === '[') {
        rotateSelection(-15);
        return;
      }
      if (k === ']') {
        rotateSelection(15);
        return;
      }
      if (k === 'y') {
        api.update((d) => ({ ...d, sun: { ...d.sun, azimuth: (d.sun.azimuth - 15 + 360) % 360 } }));
      }
      if (k === 'm') setSnapOn((s) => !s);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, modal, playLevel, runAnalysis, storeNow, chooseTool, cycleSelection]);

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText);
      const d: Doc = parsed.platforms ? parsed : parsed.doc ?? parsed;
      api.replace(d as Doc);
      setModal(null);
      setImportText('');
      setFitSignal((n) => n + 1);
      flash('Level imported');
    } catch {
      flash('That is not valid level JSON');
    }
  };

  const [saved, setSaved] = useState(() => loadSaved());

  return (
    <div className="forge fixed inset-0 flex flex-col overflow-hidden">
      {/* ---------------------------------------------------------- top bar */}
      <header className="fg-noscroll flex flex-none items-center gap-3 overflow-x-auto border-b border-[var(--line)] bg-[var(--panel)] px-3 py-2">
        {onExit && (
          <>
            <button className="fg-btn shrink-0" onClick={leave} title="Back to the game">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Game</span>
            </button>
            <span className="h-5 w-px shrink-0 bg-[var(--line)]" />
          </>
        )}
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center bg-[#2b2418] text-[var(--amber)] max-sm:hidden">
            <Sun className="h-4 w-4" strokeWidth={1.7} />
          </span>
          <div className="leading-none">
            <div className="forge-mono text-[8.5px] uppercase tracking-[0.3em] text-[var(--muted)]">Umbra · Forge</div>
            <input
              className="mt-1 w-[128px] bg-transparent sm:w-[190px] text-[14px] font-semibold text-[var(--text)] outline-none transition-colors focus:text-[var(--amber)]"
              value={doc.meta.title}
              onChange={(e) => api.update((d) => ({ ...d, meta: { ...d.meta, title: e.target.value } }))}
            />
          </div>
        </div>

        <span className="ml-1 flex shrink-0 items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${dirty ? 'fg-led bg-[var(--amber)]' : 'bg-[#3d4447]'}`}
            title={dirty ? 'Unsaved changes' : 'Saved'}
          />
          <span className="forge-mono hidden text-[9.5px] text-[var(--muted)] lg:inline">{dirty ? 'saving…' : 'saved'}</span>
        </span>

        <div className="mx-auto flex shrink-0 items-center gap-1">
          <div className="fg-seg mr-1 flex border border-[var(--line)]">
            {(['plan', 'split', 'preview'] as View[]).map((v) => (
              <button
                key={v}
                data-on={view === v}
                className="fg-btn uppercase tracking-[0.14em]"
                style={{ background: view === v ? '#3a3120' : undefined, color: view === v ? 'var(--amber)' : undefined }}
                onClick={() => {
                  sound.playUiClick();
                  setView(v);
                }}
                title={`${v === 'plan' ? 'Drafting sheet' : v === 'split' ? 'Sheet and stage' : 'Live stage'} (Space toggles plan/stage)`}
              >
                {v === 'plan' ? <LayoutGrid className="h-3.5 w-3.5" /> : v === 'split' ? <Grid3x3 className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
                <span className="hidden md:inline">{v}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button className="fg-btn fg-icon" onClick={api.undo} disabled={!api.canUndo} title="Undo (⌘Z)">
            <Undo2 className="h-4 w-4" />
          </button>
          <button className="fg-btn fg-icon" onClick={api.redo} disabled={!api.canRedo} title="Redo (⇧⌘Z)">
            <Redo2 className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-[var(--line)]" />
          <button
            className="fg-btn"
            onClick={() => {
              sound.playUiClick();
              setPlayResult(null);
              setPlayLevel(JSON.parse(JSON.stringify(doc)));
            }}
            title="Play this level from the start"
          >
            <Play className="h-3.5 w-3.5" /> <span className="hidden md:inline">Playtest</span>
          </button>
          <button className="fg-btn" onClick={() => setModal('export')} title="Copy or download the level source">
            <Download className="h-3.5 w-3.5" /> <span className="hidden md:inline">Export</span>
          </button>
          <button className="fg-btn fg-icon" onClick={() => { setSaved(loadSaved()); setModal('files'); }} title="Chapters in this browser">
            <Save className="h-4 w-4" />
          </button>
          <span className="hidden sm:inline-flex">
            <button className="fg-btn fg-icon" onClick={() => setModal('keys')} title="Shortcuts">
              <Keyboard className="h-4 w-4" />
            </button>
          </span>
          {/* below the desktop breakpoint the inspector is a drawer */}
          <span className="lg:hidden">
            <button
              className="fg-btn fg-icon"
              data-on={inspectorOpen}
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((o) => !o)}
              title="Properties and diagnostics"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </span>
        </div>
      </header>

      {/* ------------------------------------------------------------ body */}
      <div className="relative flex min-h-0 flex-1">
        {/* tool rail */}
        <nav className="fg-noscroll flex w-[62px] flex-none flex-col items-stretch gap-0.5 overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)] p-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              data-on={tool === t.id}
              className="fg-tool"
              onClick={() => {
                sound.playUiClick();
                chooseTool(t.id);
              }}
              title={`${t.name}  ·  ${t.key}`}
            >
              <t.icon className="h-[17px] w-[17px]" strokeWidth={1.5} />
              <span>{t.name}</span>
            </button>
          ))}

          <div className="my-2 h-px bg-[var(--line-soft)]" />

          <button
            className="fg-tool"
            data-on={snapOn}
            onClick={() => {
              sound.playUiClick();
              setSnapOn((s) => !s);
            }}
            title="Snap to grid (M)"
          >
            <Magnet className="h-[17px] w-[17px]" strokeWidth={1.5} />
            <span>Snap</span>
          </button>
          <button className="fg-tool" onClick={() => setFitSignal((n) => n + 1)} title="Fit sheet to level (F)">
            <ZoomIn className="h-[17px] w-[17px]" strokeWidth={1.5} />
            <span>Fit</span>
          </button>
          <button
            className="fg-tool"
            onClick={() => {
              api.update((d) => ({ ...d, camera: autoCamera(d) }));
              flash('Camera auto-fitted');
            }}
            title="Fit the stage camera to the plan"
          >
            <Settings2 className="h-[17px] w-[17px]" strokeWidth={1.5} />
            <span>Framing</span>
          </button>
          <button
            className="fg-tool"
            onClick={() => {
              api.replace(emptyDoc());
              setSel({ kind: 'none', id: '' });
              setFitSignal((n) => n + 1);
              flash('Blank chapter created');
            }}
            title="Start a new chapter"
          >
            <FilePlus2 className="h-[17px] w-[17px]" strokeWidth={1.5} />
            <span>New</span>
          </button>

          <div className="mt-auto flex flex-col gap-1 px-0.5 pb-0.5">
            <div className="forge-label tiny leading-tight">Grid</div>
            {[0.25, 0.5, 1].map((g) => (
              <button
                key={g}
                data-on={grid === g}
                className="fg-chip tight"
                onClick={() => setGrid(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </nav>

        {/* canvas stack */}
        <main className="relative flex min-w-0 flex-1">
          {/* selection actions: rotate, reshape, delete — floating above the sheet */}
          <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-1.5 border border-[var(--line)] bg-[#1e2225]/95 px-1.5 py-1 shadow-lg backdrop-blur-sm">
              <span className="forge-label small px-1.5">
                {sel.kind === 'none' ? 'Nothing selected' : sel.kind}
              </span>
              <button
                className="fg-btn fg-icon"
                title="Cycle to the next object (Tab)"
                onClick={() => cycleSelection(1)}
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
              <span className="h-4 w-px bg-[var(--line)]" />
              <button
                className="fg-btn fg-icon"
                title="Rotate 15° left  ( [ )"
                onClick={() => rotateSelection(-15)}
                disabled={sel.kind === 'none' || sel.kind === 'sun' || sel.kind === 'start' || sel.kind === 'goal' || sel.kind === 'crystal'}
              >
                <RotateCw className="h-3.5 w-3.5 scale-x-[-1]" />
              </button>
              <button
                className="fg-btn fg-icon"
                title="Rotate 15° right  ( ] )"
                onClick={() => rotateSelection(15)}
                disabled={sel.kind === 'none' || sel.kind === 'sun' || sel.kind === 'start' || sel.kind === 'goal' || sel.kind === 'crystal'}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <span className="forge-mono w-[42px] text-center text-[9.5px] text-[var(--amber)]">
                {liveRotation !== null ? `${liveRotation > 0 ? '+' : ''}${liveRotation}°` : ''}
              </span>
              <span className="h-4 w-px bg-[var(--line)]" />
              <button
                className="fg-btn"
                data-on={vertexMode}
                onClick={makeEditable}
                disabled={sel.kind !== 'platform'}
                title="Turn this stone into an editable outline, then drag its points"
              >
                <Hexagon className="h-3.5 w-3.5" /> Points
              </button>
              <button
                className="fg-btn fg-icon"
                onClick={restoreRectangle}
                disabled={sel.kind !== 'platform'}
                title="Back to a plain rectangle"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
              <span className="h-4 w-px bg-[var(--line)]" />
              <button
                className="fg-btn fg-icon"
                style={{ color: 'var(--clay)', borderColor: '#5c3a32' }}
                onClick={deleteSelection}
                disabled={sel.kind === 'none' || sel.kind === 'sun'}
                title="Delete selected object (Del)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* polygon sides — visible while the n-gon tool is armed or a polygon is selected */}
            {(tool === 'polygon' || sel.kind === 'platform') && (
              <div className="pointer-events-auto mt-1 flex items-center gap-1 border border-[var(--line)] bg-[#1e2225]/95 px-1.5 py-1 shadow-lg backdrop-blur-sm">
                <span className="forge-label small px-1">Sides</span>
                {[3, 4, 5, 6, 7, 8, 12].map((n) => (
                  <button
                    key={n}
                    data-on={polygonSides === n}
                    className="fg-chip px-1.5 py-0.5 !text-[9px]"
                    onClick={() => applySides(n)}
                    title={`${n}-sided regular stone`}
                  >
                    {n}
                  </button>
                ))}
                <span className="forge-mono ml-1 text-[9px] text-[var(--muted)]">
                  {tool === 'polygon' ? 'drag on the sheet' : 'rebuild selected'}
                </span>
              </div>
            )}
          </div>

          {view !== 'preview' && <TransformPanel doc={doc} api={api} sel={sel} />}

          {view !== 'preview' && (
            <div className={view === 'split' ? 'w-1/2 border-r border-[var(--line)]' : 'flex-1'}>
              <PlanCanvas
                doc={doc}
                api={api}
                sel={sel}
                setSel={setSel}
                tool={tool}
                setTool={setTool}
                grid={grid}
                snap={snapOn}
                layers={layers}
                fitSignal={fitSignal}
                onReadout={setReadout}
                vertexMode={vertexMode}
                polygonSides={polygonSides}
                onRotation={setLiveRotation}
              />
            </div>
          )}

          {view !== 'plan' && (
            <div className={view === 'split' ? 'w-1/2' : 'flex-1'}>
              <div className="relative h-full w-full bg-[#c9c0ae]">
                <UmbraCanvas
                  level={previewLevel}
                  settings={settings}
                  resetSignal={0}
                  resetLightSignal={fitSignal}
                  virtualInputRef={virtualInputRef}
                  isPausedOverlay
                  onLevelComplete={() => undefined}
                  onStatusChange={() => undefined}
                />
                <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 bg-[#14171acc] px-2.5 py-1.5 backdrop-blur-sm">
                  <span className="forge-label small">Stage preview</span>
                  <span className="forge-mono text-[9px] text-[var(--muted)]">updates when you stop editing</span>
                </div>
                <div className="absolute bottom-3 left-3 flex gap-1">
                  {LAYER_DEFS.map((l) => (
                    <button
                      key={l.id}
                      data-on={layers[l.id]}
                      className="fg-chip glass"
                      onClick={() => setLayers((s) => ({ ...s, [l.id]: !s[l.id] }))}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
                <div className="absolute right-3 top-3 flex flex-col gap-1">
                  {(['low', 'medium', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      data-on={settings.quality === q}
                      className="fg-chip glass"
                      onClick={() => setSettings((s) => ({ ...s, quality: q }))}
                      title="Render scale"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* inspector */}
        <aside
          className={`w-[318px] flex-none border-l border-[var(--line)] bg-[var(--panel)] max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:w-[min(318px,88vw)] max-lg:shadow-[-18px_0_40px_-18px_rgba(0,0,0,0.85)] max-lg:transition-[transform,visibility] max-lg:duration-300 max-lg:ease-out ${
            inspectorOpen ? '' : 'max-lg:invisible max-lg:translate-x-full'
          }`}
        >
          <Inspector
            doc={doc}
            api={api}
            sel={sel}
            setSel={setSel}
            grid={grid}
            snapOn={snapOn}
            counts={counts}
            onSelect={setSel}
            issues={issues}
            onFit={() => setFitSignal((n) => n + 1)}
            onAnalyse={runAnalysis}
            solving={analysis ? analysis.solutions : -1}
          />
        </aside>
      </div>

      {/* ------------------------------------------------------- bottom bar */}
      <AzimuthRuler
        doc={doc}
        api={api}
        analysis={analysis}
        analysing={analysing}
        onAnalyse={runAnalysis}
        grid={grid}
        snapOn={snapOn}
      />

      <footer className="flex flex-none items-center gap-4 whitespace-nowrap border-t border-[var(--line)] bg-[#191d20] px-4 py-1.5">
        <span className="forge-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
          {readout || 'cursor —'}
        </span>
        <span className="forge-mono hidden text-[9.5px] text-[var(--muted)] md:inline">
          {counts.platforms} stone · {counts.pillars} casters · {counts.gaps} spans · {counts.ramps} ramps · {counts.crystals} crystals
        </span>
        <span className="forge-mono hidden text-[9.5px] text-[var(--muted)] md:inline">umbra area {footprint.toFixed(1)} u²</span>
        <span className="forge-mono hidden text-[9.5px] text-[var(--muted)] md:inline">ratio {doc.sun.shadowRatio.toFixed(2)}</span>
        <span className="ml-auto flex items-center gap-3">
          {issues.some((i) => i.severity === 'error') ? (
            <span className="forge-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--clay)]">
              {issues.filter((i) => i.severity === 'error').length} blocking
            </span>
          ) : (
            <span className="forge-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--sage)]">plan consistent</span>
          )}
          <button className="fg-btn mini" onClick={() => api.update((d) => ({ ...d, sun: { ...d.sun, azimuth: round(snapVal(d.sun.azimuth, 5), 1) } }))} title="Snap bearing to 5°">
            <Hand className="h-3 w-3" />
          </button>
        </span>
      </footer>

      {/* ------------------------------------------------------- playtest */}
      {playLevelData && (
        <div className="fixed inset-0 z-50 bg-[#0f1113]">
          <UmbraCanvas
            key={`${playLevel?.meta.id}-${playLevel?.sun.azimuth}`}
            level={playLevelData}
            settings={settings}
            resetSignal={0}
            resetLightSignal={0}
            virtualInputRef={virtualInputRef}
            isPausedOverlay={false}
            onLevelComplete={(t) => {
              setPlayResult(`Sanctuary aligned in ${t.toFixed(1)}s`);
              if (analysis) {
                const az = playLevel?.sun.azimuth ?? 0;
                const idx = Math.round((az / 360) * 120) % 120;
                setAnalysis({ ...analysis, reach: analysis.reach.map((r, i) => (i === idx ? true : r)) });
              }
            }}
            onStatusChange={() => undefined}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="flex items-center gap-3 bg-[#14171ae6] px-4 py-2 backdrop-blur-sm">
              <span className="forge-label amber">Playtest</span>
              <span className="h-3 w-px bg-[var(--line)]" />
              <span className="text-[11.5px] text-[#cfc9bb]">{playLevel?.meta.title}</span>
              <span className="h-3 w-px bg-[var(--line)]" />
              <span className="forge-mono text-[10px] text-[var(--muted)]">Esc to stop</span>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-5">
            {playResult ? (
              <div className="fg-toast flex items-center gap-4 bg-[#14171af2] px-5 py-3.5 backdrop-blur-sm">
                <Lightbulb className="h-4 w-4 text-[var(--amber)]" />
                <span className="text-[13px] text-[var(--text)]">{playResult}</span>
                <button
                  className="fg-btn"
                  data-accent="true"
                  onClick={() => {
                    setPlayLevel(JSON.parse(JSON.stringify(playLevel!)));
                    setPlayResult(null);
                  }}
                >
                  <Play className="h-3.5 w-3.5" /> Again
                </button>
                <button className="fg-btn" onClick={() => setPlayLevel(null)}>
                  <X className="h-3.5 w-3.5" /> Back to the sheet
                </button>
              </div>
            ) : (
              <button
                className="fg-btn scrim"
                onClick={() => {
                  setPlayLevel(null);
                  flash('Playtest ended');
                }}
              >
                <X className="h-3.5 w-3.5" /> Stop playtest
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- modals */}
      {modal === 'export' && (
        <Modal title="Export chapter" onClose={() => setModal(null)}>
          <div className="mb-3 flex gap-1">
            <button data-on={tab === 'ts'} className="fg-chip" onClick={() => setTab('ts')}>
              levels.ts entry
            </button>
            <button data-on={tab === 'json'} className="fg-chip" onClick={() => setTab('json')}>
              forge JSON
            </button>
          </div>
          <pre className="forge-mono max-h-[46vh] overflow-auto bg-[#12161899] p-3 text-[10.5px] leading-relaxed text-[#c8c2b4]">
            {tab === 'ts' ? toTS(doc) : JSON.stringify(doc, null, 2)}
          </pre>
          <div className="mt-3 flex gap-1.5">
            <button
              className="fg-btn flex-1"
              data-accent="true"
              onClick={() => {
                const text = tab === 'ts' ? toTS(doc) : JSON.stringify(doc, null, 2);
                navigator.clipboard.writeText(text).then(
                  () => flash('Copied'),
                  () => flash('Clipboard blocked — use download')
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button
              className="fg-btn flex-1"
              onClick={() =>
                download(
                  `${slug(doc.meta.title)}.${tab === 'ts' ? 'ts' : 'json'}`,
                  tab === 'ts' ? toTS(doc) : JSON.stringify(doc, null, 2),
                  tab === 'ts' ? 'text/plain' : 'application/json'
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
            Paste the entry into the LEVELS array in <span className="forge-mono text-[var(--amber)]">src/game/levels.ts</span>, and give it the next chapter number. The Forge JSON round-trips back into this editor.
          </p>
        </Modal>
      )}

      {modal === 'files' && (
        <Modal title="Chapters in this browser" onClose={() => setModal(null)} wide>
          <div className="max-h-[34vh] overflow-y-auto">
            {saved.length === 0 && <p className="py-3 text-[12px] text-[var(--muted)]">Nothing stored yet. Edits autosave here after a pause.</p>}
            {saved.map((s) => (
              <div key={s.id} className="fg-row">
                <button
                  className="flex-1 text-left"
                  onClick={() => {
                    api.replace(s.doc);
                    setModal(null);
                    setFitSignal((n) => n + 1);
                    flash(`Loaded “${s.doc.meta.title}”`);
                  }}
                >
                  <div className="text-[12.5px] text-[var(--text)]">{s.doc.meta.title}</div>
                  <div className="forge-mono text-[9.5px] text-[var(--muted)]">
                    {new Date(s.savedAt).toLocaleString()} · {s.doc.platforms.length}p / {s.doc.pillars.length}c / {s.doc.gaps.length}g
                  </div>
                </button>
                <button
                  className="fg-btn fg-icon"
                  title="Delete"
                  onClick={() => {
                    const next = saved.filter((x) => x.id !== s.id);
                    saveAll(next);
                    setSaved(next);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-[var(--line-soft)] pt-3">
            <span className="forge-label">Start from a shipped chapter</span>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {LEVELS.map((l, i) => (
                <button
                  key={l.id}
                  className="fg-chip"
                  onClick={() => {
                    api.replace(docFromLevelShipped(l));
                    setModal(null);
                    setFitSignal((n) => n + 1);
                    flash(`Loaded “${l.title}” as a starting point`);
                  }}
                >
                  {['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]} {l.title}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <span className="forge-label">Import forge JSON</span>
            <textarea
              className="fg-text mt-1.5 h-20 resize-y font-mono text-[10.5px]"
              placeholder="Paste a chapter exported from this editor…"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <button className="fg-btn mt-2 w-full" data-accent="true" onClick={importJson} disabled={!importText.trim()}>
              <Download className="h-3.5 w-3.5 rotate-180" /> Import
            </button>
          </div>
        </Modal>
      )}

      {modal === 'keys' && (
        <Modal title="Controls" onClose={() => setModal(null)}>
          <div className="grid grid-cols-2 gap-x-6">
            {[
              ['V / P / C / G', 'select · stone · caster · span'],
              ['T / X / B / E / L', 'ramp · crystal · start · goal · light'],
              ['Drag', 'create · resize · Alt = free'],
              ['Wheel', 'zoom · space-drag to pan'],
              ['F', 'fit sheet to the level'],
              ['Space', 'swap sheet and stage'],
              ['A', 'solve: sweep all bearings'],
              ['R / Y', 'swing light +15° / −15°'],
              ['Arrows', 'nudge selection (shift ×10)'],
              ['Tab / ⇧Tab', 'cycle every object'],
              ['⌫ / D', 'delete / duplicate'],
              ['⌘Z / ⇧⌘Z', 'undo / redo'],
              ['⌘S', 'store in this browser'],
              ['M', 'toggle snapping'],
              ['Esc', 'deselect · stop playtest'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[var(--line-soft)] py-1.5">
                <span className="forge-mono text-[10.5px] text-[var(--amber)]">{k}</span>
                <span className="text-right text-[11px] text-[var(--muted)]">{v}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* ----------------------------------------------------------- toast */}
      {toast && (
        <div className="pointer-events-none fixed bottom-[104px] left-1/2 z-[60] -translate-x-1/2">
          <div className="fg-toast flex items-center gap-2.5 bg-[#2f3336f2] px-4 py-2 text-[12px] text-[#f0e9da] shadow-lg">
            <Scan className="h-3.5 w-3.5 text-[var(--amber)]" />
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[#0d0f11cc] p-5 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`forge-panel w-full ${wide ? 'max-w-[620px]' : 'max-w-[540px]'} max-h-[82vh] overflow-y-auto p-5`}
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'toastIn 0.34s cubic-bezier(0.22,1,0.36,1) both' }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">{title}</h2>
          <button className="fg-btn fg-icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function docFromLevelShipped(l: (typeof LEVELS)[number]): Doc {
  return docFromLevel({ ...l, title: `${l.title} (copy)` });
}
