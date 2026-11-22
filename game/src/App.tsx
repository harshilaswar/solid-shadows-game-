import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Compass,
  Gamepad2,
  Lightbulb,
  List,
  Pause,
  PencilRuler,
  PenLine,
  Play,
  RotateCcw,
  Settings2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { GameSettings, LiveStatus, UmbraCanvas } from './components/UmbraCanvas';
import { LEVELS } from './game/levels';
import { SANCTUARY_PALETTES } from './game/palettes';
import { sound } from './game/sound';
import { EditorApp } from './editor/EditorApp';
import { loadSaved, SESSION_KEY, toLevelData, validate, type Doc } from './editor/doc';
import type { LevelData } from './game/types';

const paletteFor = (i: number) =>
  SANCTUARY_PALETTES[i >= 48 ? SANCTUARY_PALETTES.length - 1 : i % SANCTUARY_PALETTES.length];

const ROMAN: string[] = (() => {
  const map: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  return Array.from({ length: 50 }, (_, i) => {
    let n = i + 1;
    let out = '';
    for (const [v, sym] of map) while (n >= v) { out += sym; n -= v; }
    return out;
  });
})();
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function bearingOf(deg: number) {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/* ------------------------------------------------------------------ marks */

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.4" />
      <circle cx="20" cy="20" r="11" stroke="currentColor" strokeWidth="0.9" />
      <path d="M20 2v7M20 31v7M2 20h7M31 20h7" stroke="currentColor" strokeWidth="0.9" />
      <path d="M20 9a11 11 0 0 1 0 22z" fill="currentColor" fillOpacity="0.85" />
      <circle cx="20" cy="20" r="2.4" fill="currentColor" />
    </svg>
  );
}

function SunDial({ deg, active }: { deg: number; active: boolean }) {
  return (
    <div className="relative h-11 w-11 shrink-0">
      <svg viewBox="0 0 44 44" className="h-full w-full text-[#77766f]" fill="none">
        <circle cx="22" cy="22" r="19" stroke="currentColor" strokeWidth="0.8" strokeOpacity="0.45" />
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2;
          const long = i % 6 === 0;
          const r1 = long ? 14.5 : 16.5;
          return (
            <line
              key={i}
              x1={22 + Math.sin(a) * r1}
              y1={22 - Math.cos(a) * r1}
              x2={22 + Math.sin(a) * 19}
              y2={22 - Math.cos(a) * 19}
              stroke="currentColor"
              strokeWidth={long ? 1 : 0.6}
              strokeOpacity={long ? 0.85 : 0.45}
            />
          );
        })}
      </svg>
      <div
        className="absolute inset-0 transition-transform duration-100 ease-out"
        style={{ transform: `rotate(${deg}deg)` }}
      >
        <span
          className="absolute left-1/2 top-[3px] h-[7px] w-[7px] -translate-x-1/2 rounded-full transition-colors duration-300"
          style={{
            background: active ? '#E9B957' : '#B5A58D',
            boxShadow: active ? '0 0 10px rgba(233,185,87,0.9)' : 'none',
          }}
        />
      </div>
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-medium tracking-[0.1em] text-[#77766f]">
        {bearingOf(deg)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

function Sheet({
  children,
  className = '',
  side = 'center',
}: {
  children: ReactNode;
  className?: string;
  side?: 'center' | 'left' | 'right';
}) {
  const pos =
    side === 'left'
      ? 'left-0 top-0 bottom-0 justify-start'
      : side === 'right'
        ? 'right-0 top-0 bottom-0 justify-end'
        : 'inset-0 justify-center';
  return (
    <div className={`fixed z-40 flex items-stretch ${pos} ${className}`}>{children}</div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between">
        <span className="label text-[#77766f]">{label}</span>
        <span className="text-[11px] tabular-nums text-[#383936]">{Math.round(value * 100)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1.5"
        aria-label={label}
      />
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => {
        sound.playUiClick();
        onChange(!on);
      }}
      className="flex w-full items-center justify-between py-2.5 text-left cursor-pointer group"
    >
      <span className="label text-[#77766f] group-hover:text-[#383936] transition-colors">
        {label}
      </span>
      <span
        className="relative h-[18px] w-[34px] border transition-colors duration-200"
        style={{
          borderColor: on ? 'rgba(233,185,87,0.75)' : 'rgba(181,165,141,0.7)',
          background: on ? 'rgba(233,185,87,0.18)' : 'transparent',
        }}
      >
        <span
          className="absolute top-[2px] h-[12px] w-[12px] transition-all duration-200 ease-out"
          style={{
            left: on ? '18px' : '2px',
            background: on ? '#E9B957' : '#B5A58D',
          }}
        />
      </span>
    </button>
  );
}

function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; name: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-2.5">
      <span className="label text-[#77766f]">{label}</span>
      <div className="mt-2 flex border border-[rgba(181,165,141,0.6)]">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => {
              sound.playUiClick();
              onChange(o.id);
            }}
            className="flex-1 py-1.5 text-[11px] font-medium tracking-[0.08em] uppercase transition-colors duration-150 cursor-pointer"
            style={{
              background: value === o.id ? '#383936' : 'transparent',
              color: value === o.id ? '#F5D98A' : '#77766f',
            }}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ app */

type Panel = null | 'chapters' | 'settings' | 'pause';

/* ------------------------------------------------------------------- route
 * The level editor lives at #/forge. The game links to it from the title, the
 * pause menu and the chapter index; the hash keeps it bookmarkable and lets the
 * browser's Back button return to the game.
 */
function useForgeRoute() {
  const read = () =>
    typeof window !== 'undefined' &&
    (window.location.hash.toLowerCase().startsWith('#/forge') ||
      new URLSearchParams(window.location.search).get('forge') === '1');
  const [on, setOn] = useState(read);

  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);

  const go = useCallback((next: boolean) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('forge');
      url.hash = next ? '/forge' : '';
      window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* embedded frames can refuse history writes; the state below still switches the view */
    }
    setOn(next);
  }, []);

  return [on, go] as const;
}

/** What the player keeps while they are away in the editor. */
interface Session {
  levelIdx: number;
  completed: Set<string>;
  atTitle: boolean;
  customId: string | null;
}

/* ------------------------------------------------------------ own levels */

interface CustomEntry {
  id: string;
  title: string;
  subtitle: string;
  doc: Doc;
  /** blocking problems that would make the level unplayable (start over the void, etc.) */
  blocking: number;
}

interface CustomLevel {
  id: string;
  level: LevelData;
  doc: Doc;
}

/** Levels drawn in the editor and kept in this browser. Malformed entries are skipped. */
function readCustomEntries(): CustomEntry[] {
  const out: CustomEntry[] = [];
  for (const saved of loadSaved()) {
    try {
      out.push({
        id: saved.id,
        title: saved.doc.meta.title?.trim() || 'Untitled level',
        subtitle: saved.doc.meta.subtitle?.trim() || '',
        doc: saved.doc,
        blocking: validate(saved.doc).filter((i) => i.severity === 'error').length,
      });
    } catch {
      /* not a level we can read */
    }
  }
  return out;
}

function toCustomLevel(entry: CustomEntry | undefined): CustomLevel | null {
  if (!entry || entry.blocking > 0) return null;
  try {
    const level = toLevelData(entry.doc);
    // the chapter number picks the palette, so keep it inside the seven that exist
    const n = Number.isFinite(level.number) ? Math.round(level.number) : 1;
    const number = Math.min(SANCTUARY_PALETTES.length, Math.max(1, n));
    return { id: entry.id, level: { ...level, number }, doc: entry.doc };
  } catch {
    return null;
  }
}

export function App() {
  const [forge, setForge] = useForgeRoute();
  const session = useRef<Session>({
    levelIdx: 0,
    completed: new Set(),
    atTitle: true,
    customId: null,
  }).current;

  if (forge) return <EditorApp onExit={() => setForge(false)} />;
  return <Game session={session} onOpenEditor={() => setForge(true)} />;
}

function Game({ session, onOpenEditor }: { session: Session; onOpenEditor: () => void }) {
  const [levelIdx, setLevelIdx] = useState(session.levelIdx);
  const [completed, setCompleted] = useState<Set<string>>(session.completed);
  const [atTitle, setAtTitle] = useState(session.atTitle);
  // re-read on mount, so edits made in the editor are what gets played on return
  const [custom, setCustom] = useState<CustomLevel | null>(() =>
    session.customId ? toCustomLevel(readCustomEntries().find((e) => e.id === session.customId)) : null
  );
  const [panel, setPanel] = useState<Panel>(null);
  const [hint, setHint] = useState(false);
  const [victory, setVictory] = useState<{ elapsed: number } | null>(null);
  const [showPad, setShowPad] = useState(
    () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );

  const [volumes, setVolumes] = useState({ master: 0.9, music: 0.5, sfx: 0.85, ambience: 0.6 });
  const [settings, setSettings] = useState<GameSettings>({
    quality: 'high',
    shadowOpacity: 0.68,
    cameraDrift: true,
    dustMotes: true,
  });

  const [ballSignal, setBallSignal] = useState(0);
  const [lightSignal, setLightSignal] = useState(0);
  const [viewSignal, setViewSignal] = useState(0);
  const [status, setStatus] = useState<LiveStatus>({
    bridgedCount: 0,
    totalGaps: 1,
    eclipsed: false,
    hasCrystals: false,
    onShadow: false,
    isDraggingSun: false,
    sunAzimuthDeg: 245,
    viewAzimuthDeg: 0,
    isRotatingView: false,
  });

  const virtualInputRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const padRef = useRef<HTMLDivElement | null>(null);
  const padLive = useRef(false);

  const level = custom ? custom.level : LEVELS[levelIdx];
  const palette = paletteFor(custom ? custom.level.number - 1 : levelIdx);
  const isLast = !custom && levelIdx === LEVELS.length - 1;
  const sheetLabel = custom ? 'Your level' : `Sheet ${String(level.number).padStart(2, '0')}`;
  const doneKey = custom ? `custom:${custom.id}` : level.id;
  const frozen = atTitle || panel !== null || victory !== null;

  useEffect(() => {
    session.levelIdx = levelIdx;
    session.completed = completed;
    session.atTitle = atTitle;
    session.customId = custom?.id ?? null;
  }, [session, levelIdx, completed, atTitle, custom]);

  // only read storage while the index is open
  const customEntries = useMemo(() => (panel === 'chapters' ? readCustomEntries() : []), [panel]);

  useEffect(() => {
    sound.setVolumes(volumes);
  }, [volumes]);

  const begin = useCallback(() => {
    sound.wake();
    sound.playUiClick();
    setAtTitle(false);
    setPanel(null);
  }, []);

  const gotoLevel = useCallback((i: number) => {
    sound.playUiClick();
    setCustom(null);
    setLevelIdx(i);
    setVictory(null);
    setPanel(null);
    setHint(false);
    setAtTitle(false);
  }, []);

  const playCustom = useCallback((entry: CustomEntry) => {
    const next = toCustomLevel(entry);
    if (!next) return;
    sound.wake();
    sound.playUiClick();
    setCustom(next);
    setVictory(null);
    setPanel(null);
    setHint(false);
    setAtTitle(false);
  }, []);

  /** Opens the editor, optionally on a specific saved level. */
  const openEditor = useCallback(
    (doc?: Doc) => {
      if (doc) {
        try {
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(doc));
        } catch {
          /* storage blocked: the editor opens on its last sheet instead */
        }
      }
      onOpenEditor();
    },
    [onOpenEditor]
  );

  const nextLevel = useCallback(() => {
    sound.playUiClick();
    if (custom) {
      // an own level has no "next": reset it behind the index, ready to replay
      setVictory(null);
      setBallSignal((n) => n + 1);
      setLightSignal((n) => n + 1);
      setPanel('chapters');
      return;
    }
    gotoLevel(isLast ? 0 : levelIdx + 1);
  }, [custom, gotoLevel, isLast, levelIdx]);

  const restart = useCallback(() => {
    sound.playUiClick();
    setVictory(null);
    setPanel(null);
    setBallSignal((n) => n + 1);
    setLightSignal((n) => n + 1);
  }, []);

  const onComplete = useCallback(
    (elapsed: number) => {
      setCompleted((prev) => new Set(prev).add(doneKey));
      setVictory({ elapsed });
    },
    [doneKey]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = e.code;
      if (c === 'Escape') {
        if (hint) setHint(false);
        else if (panel) {
          sound.playUiBack();
          setPanel(null);
        } else if (!atTitle && !victory) {
          sound.playUiClick();
          setPanel('pause');
        }
        return;
      }
      if (atTitle && (c === 'Enter' || c === 'Space')) {
        e.preventDefault();
        begin();
        return;
      }
      if (victory && (c === 'Enter' || c === 'Space')) {
        e.preventDefault();
        nextLevel();
        return;
      }
      if (c === 'KeyP' && !atTitle && !victory) {
        sound.playUiClick();
        setPanel((p) => (p === 'pause' ? null : 'pause'));
      } else if (c === 'KeyR') {
        sound.playUiClick();
        setBallSignal((n) => n + 1);
      } else if (c === 'KeyT') {
        sound.playUiClick();
        setLightSignal((n) => n + 1);
      } else if (c === 'KeyH') {
        sound.playUiClick();
        setHint((v) => !v);
      } else if (c === 'KeyZ') {
        sound.playUiClick();
        setViewSignal((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [atTitle, begin, hint, nextLevel, panel, victory]);

  const padFrom = (cx: number, cy: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const max = r.width * 0.36;
    let dx = cx - (r.left + r.width / 2);
    let dy = cy - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    setKnob({ x: dx, y: dy });
    virtualInputRef.current = { x: dx / max, y: -dy / max };
  };

  const padEnd = () => {
    padLive.current = false;
    setKnob({ x: 0, y: 0 });
    virtualInputRef.current = { x: 0, y: 0 };
  };

  const progress = useMemo(
    () => LEVELS.map((l) => completed.has(l.id)),
    [completed]
  );
  const alignedCount = progress.filter(Boolean).length;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* ---------------------------------------------------------- 3D world */}
      <div className="fixed inset-0 z-0">
        <UmbraCanvas
          level={level}
          settings={settings}
          resetSignal={ballSignal}
          resetLightSignal={lightSignal}
          resetViewSignal={viewSignal}
          virtualInputRef={virtualInputRef}
          isPausedOverlay={frozen}
          onLevelComplete={onComplete}
          onStatusChange={setStatus}
          onFirstInteract={() => sound.wake()}
        />
      </div>
      <div className="pointer-events-none fixed inset-0 z-[1] vignette" />
      <div className="pointer-events-none fixed inset-0 z-[1] grain" />
      {atTitle && <div className="fixed inset-0 z-[2]" />}

      {/* ---------------------------------------------------------- top rail */}
      {!atTitle && (
        <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-3 p-3 sm:p-5">
          <div className="pointer-events-auto flex items-start gap-3">
            <button
              onClick={() => {
                sound.playUiClick();
                setPanel(panel === 'chapters' ? null : 'chapters');
              }}
              className="plate rise flex items-stretch overflow-hidden text-left transition-[box-shadow,border-color] duration-200 hover:border-[rgba(119,118,111,0.6)] cursor-pointer"
              style={{ borderRadius: 3 }}
            >
              <span
                className="flex w-11 items-center justify-center border-r border-[rgba(181,165,141,0.5)] bg-[rgba(201,185,158,0.2)]"
                style={{ color: '#383936' }}
              >
                {custom ? (
                  <PenLine className="h-4 w-4" strokeWidth={1.6} />
                ) : (
                  <span className="display text-[17px] leading-none">{ROMAN[levelIdx]}</span>
                )}
              </span>
              <span className="flex flex-col justify-center px-3.5 py-2">
                <span className="label text-[#77766f]">{sheetLabel}</span>
                <span className="display mt-0.5 text-[15px] leading-tight text-[#2b2c29] sm:text-[17px]">
                  {level.title}
                </span>
              </span>
              <span className="flex items-center pr-2.5 text-[#b5a58d]">
                <List className="h-3.5 w-3.5" strokeWidth={1.6} />
              </span>
            </button>

            <div className="mt-2 hidden flex-row gap-[2px] sm:flex">
              {progress.map((done, i) => (
                <span
                  key={i}
                  className="h-[3px] w-[3px] transition-colors duration-500"
                  style={{
                    background: done
                      ? '#E9B957'
                      : !custom && i === levelIdx
                        ? 'rgba(56,57,54,0.55)'
                        : 'rgba(181,165,141,0.45)',
                  }}
                />
              ))}
            </div>
          </div>

          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              className="icon-btn"
              style={{ borderRadius: 3 }}
              data-on={hint}
              onClick={() => {
                sound.playUiClick();
                setHint((v) => !v);
              }}
              title="Architect's note (H)"
              aria-label="Hint"
            >
              <Lightbulb className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
            <button
              className="icon-btn"
              style={{ borderRadius: 3 }}
              data-on={showPad}
              onClick={() => {
                sound.playUiClick();
                setShowPad((v) => !v);
              }}
              title="Roll control"
              aria-label="Toggle thumbstick"
            >
              <Gamepad2 className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
            <button
              className="icon-btn"
              style={{ borderRadius: 3 }}
              onClick={() => {
                sound.playUiClick();
                setVolumes((v) => ({
                  ...v,
                  master: v.master > 0 ? 0 : 0.9,
                }));
              }}
              title={volumes.master > 0 ? 'Mute' : 'Unmute'}
              aria-label="Mute"
            >
              {volumes.master > 0 ? (
                <Volume2 className="h-[17px] w-[17px]" strokeWidth={1.5} />
              ) : (
                <VolumeX className="h-[17px] w-[17px]" strokeWidth={1.5} />
              )}
            </button>
            <button
              className="icon-btn"
              style={{ borderRadius: 3 }}
              onClick={() => {
                sound.playUiClick();
                setPanel('pause');
              }}
              title="Pause (P)"
              aria-label="Pause"
            >
              <Pause className="h-[17px] w-[17px]" strokeWidth={1.5} />
            </button>
          </div>
        </header>
      )}

      {/* ---------------------------------------------------------- status */}
      {!atTitle && !victory && (
        <div className="pointer-events-none fixed inset-x-0 top-[74px] z-20 flex justify-center sm:top-[86px]">
          {status.hasCrystals && status.eclipsed ? (
            <div className="plate-dark rise flex items-center gap-2.5 px-3.5 py-1.5" style={{ borderRadius: 3 }}>
              <span className="breathe h-1.5 w-1.5 rounded-full bg-[#E9B957]" />
              <span className="label text-[#F5D98A]">Crystal eclipsed · seal closed</span>
            </div>
          ) : status.bridgedCount > 0 ? (
            <div className="plate rise flex items-center gap-2.5 px-3.5 py-1.5" style={{ borderRadius: 3 }}>
              <span className="h-1.5 w-1.5 rounded-full bg-[#E9B957]" />
              <span className="label text-[#4a4b47]">
                Shadow bearing weight
                {status.totalGaps > 1 && ` · ${status.bridgedCount}/${status.totalGaps}`}
              </span>
            </div>
          ) : status.onShadow ? (
            <div className="plate rise px-3.5 py-1.5" style={{ borderRadius: 3 }}>
              <span className="label text-[#77766f]">On cast shadow</span>
            </div>
          ) : null}
        </div>
      )}

      {/* ------------------------------------------------- bottom left dial */}
      {!atTitle && !victory && (
        <div className="pointer-events-none fixed bottom-4 left-3 z-20 flex items-end gap-3 sm:bottom-6 sm:left-6">
          <div className="plate rise pointer-events-auto flex items-center gap-3 px-3 py-2" style={{ borderRadius: 3, animationDelay: '0.08s' }}>
            <SunDial deg={status.sunAzimuthDeg} active={status.isDraggingSun} />
            <div className="pr-1">
              <div className="label text-[#77766f]">Sun bearing</div>
              <div className="display text-[19px] leading-none tabular-nums text-[#2b2c29]">
                {String(Math.round(status.sunAzimuthDeg)).padStart(3, '0')}°
              </div>
              <div className="mt-1 text-[10px] leading-none text-[#77766f]">
                {status.bridgedCount}/{status.totalGaps} spans held
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              sound.playUiClick();
              setViewSignal((n) => n + 1);
            }}
            className="plate rise pointer-events-auto flex items-center gap-2.5 px-3 py-2 transition-colors hover:border-[rgba(119,118,111,0.7)] cursor-pointer"
            style={{ borderRadius: 3, animationDelay: '0.14s' }}
            title="Reset the camera view (Z or double-click). Two fingers rotate · right-drag or Shift-drag on desktop"
            aria-label="Reset camera view"
          >
            <Compass
              className={`h-4 w-4 ${status.isRotatingView ? 'text-[#e5a93c]' : 'text-[#77766f]'}`}
              strokeWidth={1.6}
            />
            <span className="text-left leading-none">
              <span className="label block text-[#77766f]">View</span>
              <span className="display mt-0.5 block text-[14px] tabular-nums text-[#2b2c29]">
                {status.viewAzimuthDeg > 0 ? '+' : ''}{status.viewAzimuthDeg}°
              </span>
            </span>
            <RotateCcw className="h-3.5 w-3.5 text-[#77766f]" strokeWidth={1.6} />
          </button>
        </div>
      )}

      {/* --------------------------------------------------- objective line */}
      {!atTitle && !victory && panel === null && (
        <footer className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-3 sm:bottom-6">
          <div className="max-w-[560px] text-center">
            <div className="hair line-grow mx-auto mb-2 w-24" />
            <p className="text-[12.5px] leading-relaxed text-[#3d3e3a] sm:text-[13.5px]">
              {level.prompt}
            </p>
            <p className="label mt-2 hidden text-[#77766f] sm:block">
              Drag the light · WASD to roll · Two fingers / right-drag to orbit · H for the note
            </p>
          </div>
        </footer>
      )}

      {/* ------------------------------------------------------- hint sheet */}
      {hint && !atTitle && (
        <Sheet side="right" className="pointer-events-none p-3 sm:p-5">
          <div className="plate-dark sheet-right pointer-events-auto mt-[76px] w-[min(88vw,320px)] p-5" style={{ borderRadius: 3 }}>
            <div className="flex items-start justify-between gap-4">
              <span className="label text-[#E9B957]">Architect’s note</span>
              <button
                onClick={() => {
                  sound.playUiBack();
                  setHint(false);
                }}
                className="text-[#b5a58d] transition-colors hover:text-[#F5D98A] cursor-pointer"
                aria-label="Close note"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="hair-dark my-3.5" />
            <p className="text-[13.5px] leading-relaxed text-[#e9e2d3]">{level.hint}</p>
          </div>
        </Sheet>
      )}

      {/* ------------------------------------------------------ title sheet */}
      {atTitle && (
        <>
          {/* Sun-path study, drawn behind the plate */}
          <div className="pointer-events-none fixed inset-0 z-10 hidden items-end justify-end pb-24 pr-16 lg:flex">
            <div className="relative h-[150px] w-[300px]">
              <svg viewBox="0 0 300 150" className="absolute inset-0 h-full w-full" fill="none">
                <path
                  d="M18 140 A 132 132 0 0 1 282 140"
                  stroke="#B5A58D"
                  strokeWidth="1"
                  strokeDasharray="2 7"
                  strokeOpacity="0.85"
                />
                <line x1="4" y1="140" x2="296" y2="140" stroke="#B5A58D" strokeWidth="0.8" strokeOpacity="0.5" />
                {Array.from({ length: 9 }).map((_, i) => {
                  const a = Math.PI - (i / 8) * Math.PI;
                  return (
                    <line
                      key={i}
                      x1={150 + Math.cos(a) * 132}
                      y1={140 - Math.sin(a) * 132}
                      x2={150 + Math.cos(a) * 140}
                      y2={140 - Math.sin(a) * 140}
                      stroke="#B5A58D"
                      strokeWidth="0.9"
                      strokeOpacity="0.7"
                    />
                  );
                })}
              </svg>
              <div className="absolute bottom-[10px] left-1/2 h-0 w-0">
                <div className="sun-sweep">
                  <span className="sun-dot" />
                </div>
              </div>
              <div className="absolute -bottom-6 left-0 right-0 flex justify-between">
                <span className="label text-[#77766f]">Dawn</span>
                <span className="label text-[#77766f]">Zenith</span>
                <span className="label text-[#77766f]">Dusk</span>
              </div>
            </div>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-30 p-3 sm:p-6">
              <div
                className="plate-solid settle relative w-full max-w-[620px] p-6 sm:p-9"
              style={{ borderRadius: 3 }}
            >
              <div
                className="pointer-events-none absolute inset-[7px] border border-[rgba(181,165,141,0.4)]"
                style={{ borderRadius: 2 }}
              />

              <div className="flex items-center gap-3">
                <Wordmark className="h-8 w-8 text-[#383936]" />
                <span className="label text-[#77766f]">Fifty architectural studies</span>
              </div>

              <h1 className="display mt-5 text-[62px] leading-[0.86] tracking-[0.14em] text-[#2b2c29] sm:text-[86px]">
                UMBRA
              </h1>

              <div className="hair my-6" />

              <p className="max-w-[430px] text-[14px] leading-relaxed text-[#4a4b47] sm:text-[15px]">
                The bridges are gone. What remains is light — and light, aimed carefully, will hold
                your weight. Turn the sun until a pillar’s shadow spans the void, then cross.
              </p>

              <dl className="stagger mt-7 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                {[
                  ['Light', 'Distant · fixed altitude'],
                  ['Control', 'Bearing only'],
                  ['Scale', '1 : 1'],
                  ['Sheets', `${LEVELS.length} chapters`],
                  ['Android', 'side-load the APK'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="label text-[#77766f]">{k}</dt>
                    <dd className="mt-1 text-[12.5px] leading-snug text-[#383936]">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                <button
                  onClick={begin}
                  className="primary-btn display flex items-center gap-3 px-7 py-3.5 text-[13px] tracking-[0.16em] uppercase cursor-pointer"
                  style={{ borderRadius: 3 }}
                >
                  Enter
                  <ArrowRight className="h-4 w-4 text-[#E9B957]" strokeWidth={1.6} />
                </button>
                <button
                  onClick={() => {
                    sound.playUiClick();
                    setPanel('chapters');
                  }}
                  className="text-btn cursor-pointer"
                >
                  Chapters
                </button>
                <button
                  onClick={() => {
                    sound.playUiClick();
                    setPanel('settings');
                  }}
                  className="text-btn cursor-pointer"
                >
                  Settings
                </button>
                <button
                  onClick={() => {
                    sound.playUiClick();
                    openEditor();
                  }}
                  className="text-btn cursor-pointer"
                >
                  Level editor
                </button>
                {/* Hidden when already running inside the packaged Android app */}
                {!(
                  typeof window !== 'undefined' &&
                  window.location.hostname === 'umbra.local'
                ) && (
                  <a
                    href="/download/Umbra.apk"
                    download="Umbra.apk"
                    className="text-btn cursor-pointer"
                    title="Download the signed Android package (Umbra.apk)"
                  >
                    Android app
                  </a>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] leading-snug text-[#77766f]">
                <span>Two fingers — rotate the world</span>
                <span>Right-drag / Shift-drag — desktop</span>
                <span>Z or double-click — recenter</span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* --------------------------------------------------- chapters sheet */}
      {panel === 'chapters' && (
        <Sheet side="left" className="pointer-events-none">
            <div
              className="plate-solid sheet-left pointer-events-auto flex h-full w-[min(92vw,380px)] flex-col"
              style={{ borderRadius: 0 }}
            >
            <div className="flex items-center justify-between px-6 pt-6">
              <div>
                <span className="label text-[#77766f]">Index</span>
                <h2 className="display mt-1 text-[26px] leading-none text-[#2b2c29]">Chapters</h2>
              </div>
              <button
                className="icon-btn"
                style={{ borderRadius: 3 }}
                onClick={() => {
                  sound.playUiBack();
                  setPanel(null);
                }}
                aria-label="Close index"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="px-6 pt-4">
              <div className="flex items-baseline justify-between">
                <span className="label text-[#77766f]">Aligned</span>
                <span className="display text-[15px] tabular-nums text-[#383936]">
                  {alignedCount} / {LEVELS.length}
                </span>
              </div>
              <div className="mt-2 h-[3px] w-full bg-[rgba(181,165,141,0.35)]">
                <div
                  className="h-full bg-[#E9B957] transition-[width] duration-700 ease-out"
                  style={{ width: `${(alignedCount / LEVELS.length) * 100}%` }}
                />
              </div>
            </div>

            <div className="hair mx-6 my-5" />

            <div className="stagger flex-1 overflow-y-auto px-3 pb-6">
              {LEVELS.map((l, i) => {
                const p = paletteFor(i);
                const active = !custom && i === levelIdx;
                const done = completed.has(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => gotoLevel(i)}
                    className="row-hover flex w-full items-center gap-4 border-l-2 px-4 py-3.5 text-left cursor-pointer"
                    style={{
                      borderColor: active ? '#E9B957' : 'transparent',
                      background: active ? 'rgba(201,185,158,0.22)' : 'transparent',
                    }}
                  >
                    <span className="display w-8 shrink-0 text-[15px] text-[#77766f]">{ROMAN[i]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-[#2b2c29]">
                        {l.title}
                      </span>
                      <span className="label mt-1 block text-[#77766f]">{p.name} · {l.number.toString().padStart(2, '0')}</span>
                    </span>
                    {done && (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(233,185,87,0.2)] text-[#8a6a22]">
                        <Check className="h-3 w-3" strokeWidth={2.4} />
                      </span>
                    )}
                  </button>
                );
              })}

              {/* levels drawn in the editor */}
              <div className="px-4 pt-7">
                <div className="hair mb-5" />
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <span className="label text-[#77766f]">Made in the editor</span>
                    <h3 className="display mt-1 text-[19px] leading-none text-[#2b2c29]">Your levels</h3>
                  </div>
                  <button
                    onClick={() => {
                      sound.playUiClick();
                      openEditor();
                    }}
                    className="ghost-btn flex shrink-0 items-center gap-2 px-3 py-2 text-[10.5px] font-medium uppercase tracking-[0.14em] cursor-pointer"
                    style={{ borderRadius: 3 }}
                  >
                    <PencilRuler className="h-3.5 w-3.5" strokeWidth={1.6} />
                    Level editor
                  </button>
                </div>
                {customEntries.length === 0 && (
                  <p className="mt-3 pb-2 text-[12.5px] leading-relaxed text-[#77766f]">
                    Nothing drawn yet. Levels you make in the editor are kept in this browser and listed here, ready
                    to play.
                  </p>
                )}
              </div>

              {customEntries.length > 0 && (
                <div className="pt-3">
                  {customEntries.map((entry) => {
                    const active = custom?.id === entry.id;
                    const done = completed.has(`custom:${entry.id}`);
                    const blocked = entry.blocking > 0;
                    return (
                      <div
                        key={entry.id}
                        className="flex items-stretch border-l-2"
                        style={{
                          borderColor: active ? '#E9B957' : 'transparent',
                          background: active ? 'rgba(201,185,158,0.22)' : 'transparent',
                        }}
                      >
                        <button
                          onClick={() => playCustom(entry)}
                          disabled={blocked}
                          title={blocked ? 'Open it in the editor to fix what stops it being played' : undefined}
                          className={`flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5 text-left ${
                            blocked ? 'cursor-not-allowed opacity-60' : 'row-hover cursor-pointer'
                          }`}
                        >
                          <span className="flex w-8 shrink-0 text-[#77766f]">
                            <PenLine className="h-4 w-4" strokeWidth={1.5} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-[#2b2c29]">
                              {entry.title}
                            </span>
                            <span
                              className="label mt-1 block truncate"
                              style={{ color: blocked ? '#8a6a22' : '#77766f' }}
                            >
                              {blocked
                                ? `${entry.blocking} ${entry.blocking === 1 ? 'problem' : 'problems'} to fix`
                                : entry.subtitle || 'Ready to play'}
                            </span>
                          </span>
                          {done && (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(233,185,87,0.2)] text-[#8a6a22]">
                              <Check className="h-3 w-3" strokeWidth={2.4} />
                            </span>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            sound.playUiClick();
                            openEditor(entry.doc);
                          }}
                          className="flex w-11 shrink-0 items-center justify-center text-[#b5a58d] transition-colors duration-150 hover:text-[#383936] cursor-pointer"
                          aria-label={`Edit ${entry.title}`}
                          title="Edit in the level editor"
                        >
                          <PencilRuler className="h-4 w-4" strokeWidth={1.5} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <button
            className="scrim pointer-events-auto flex-1 cursor-default bg-[rgba(56,57,54,0.22)] backdrop-blur-[2px]"
            onClick={() => {
              sound.playUiBack();
              setPanel(null);
            }}
            aria-label="Dismiss"
          />
        </Sheet>
      )}

      {/* --------------------------------------------------- settings sheet */}
      {panel === 'settings' && (
        <Sheet side="right" className="pointer-events-none">
          <button
            className="scrim pointer-events-auto flex-1 cursor-default bg-[rgba(56,57,54,0.22)] backdrop-blur-[2px]"
            onClick={() => {
              sound.playUiBack();
              setPanel(null);
            }}
            aria-label="Dismiss"
          />
          <div
            className="plate-solid sheet-right pointer-events-auto flex h-full w-[min(92vw,360px)] flex-col overflow-y-auto"
            style={{ borderRadius: 0 }}
          >
            <div className="flex items-center justify-between px-6 pt-6">
              <div>
                <span className="label text-[#77766f]">Preferences</span>
                <h2 className="display mt-1 text-[26px] leading-none text-[#2b2c29]">Settings</h2>
              </div>
              <button
                className="icon-btn"
                style={{ borderRadius: 3 }}
                onClick={() => {
                  sound.playUiBack();
                  setPanel(null);
                }}
                aria-label="Close settings"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="px-6 pb-8 pt-4">
              <span className="label text-[#77766f]">Audio</span>
              <div className="mt-1">
                <Slider
                  label="Master"
                  value={volumes.master}
                  onChange={(v) => setVolumes((s) => ({ ...s, master: v }))}
                />
                <Slider
                  label="Score"
                  value={volumes.music}
                  onChange={(v) => setVolumes((s) => ({ ...s, music: v }))}
                />
                <Slider
                  label="Effects"
                  value={volumes.sfx}
                  onChange={(v) => setVolumes((s) => ({ ...s, sfx: v }))}
                />
                <Slider
                  label="Ambience"
                  value={volumes.ambience}
                  onChange={(v) => setVolumes((s) => ({ ...s, ambience: v }))}
                />
              </div>

              <div className="hair my-5" />

              <span className="label text-[#77766f]">Shadow readability</span>
              <div className="mt-1">
                <Slider
                  label="Umbra density"
                  value={settings.shadowOpacity}
                  onChange={(v) =>
                    setSettings((s) => ({ ...s, shadowOpacity: Math.min(0.92, Math.max(0.3, v)) }))
                  }
                />
              </div>

              <div className="hair my-5" />

              <span className="label text-[#77766f]">Presentation</span>
              <Segment
                label="Render scale"
                value={settings.quality}
                onChange={(q) => setSettings((s) => ({ ...s, quality: q }))}
                options={[
                  { id: 'low', name: 'Low' },
                  { id: 'medium', name: 'Med' },
                  { id: 'high', name: 'High' },
                ]}
              />
              <Toggle
                label="Camera drift"
                on={settings.cameraDrift}
                onChange={(v) => setSettings((s) => ({ ...s, cameraDrift: v }))}
              />
              <Toggle
                label="Airborne dust"
                on={settings.dustMotes}
                onChange={(v) => setSettings((s) => ({ ...s, dustMotes: v }))}
              />
              <Toggle
                label="Thumbstick"
                on={showPad}
                onChange={setShowPad}
              />

              <div className="hair my-5" />

              <button
                onClick={() => {
                  sound.playUiClick();
                  setVolumes({ master: 0.9, music: 0.5, sfx: 0.85, ambience: 0.6 });
                  setSettings({
                    quality: 'high',
                    shadowOpacity: 0.68,
                    cameraDrift: true,
                    dustMotes: true,
                  });
                }}
                className="ghost-btn w-full py-2.5 text-[11px] font-medium uppercase tracking-[0.16em] cursor-pointer"
                style={{ borderRadius: 3 }}
              >
                Restore defaults
              </button>
            </div>
          </div>
        </Sheet>
      )}

      {/* ------------------------------------------------------ pause sheet */}
      {panel === 'pause' && (
        <Sheet className="scrim pointer-events-auto bg-[rgba(56,57,54,0.3)] backdrop-blur-[3px]">
          <div
            className="plate-solid settle my-auto w-[min(92vw,380px)] p-7"
            style={{ borderRadius: 3 }}
          >
            <div className="flex items-center gap-3">
              <Settings2 className="h-4 w-4 text-[#b5a58d]" strokeWidth={1.5} />
              <span className="label text-[#77766f]">Paused</span>
            </div>
            <h2 className="display mt-2 text-[30px] leading-none text-[#2b2c29]">{level.title}</h2>
            <div className="hair my-5" />

            <div className="stagger flex flex-col">
              {[
                { name: 'Resume', icon: Play, act: () => setPanel(null) },
                { name: 'Restart chapter', icon: RotateCcw, act: restart },
                { name: 'Chapters', icon: List, act: () => setPanel('chapters') },
                { name: 'Settings', icon: Settings2, act: () => setPanel('settings') },
                {
                  name: custom ? 'Edit this level' : 'Level editor',
                  icon: PencilRuler,
                  act: () => openEditor(custom?.doc),
                },
              ].map(({ name, icon: Icon, act }, i) => (
                <button
                  key={name}
                  onClick={() => {
                    sound.playUiClick();
                    act();
                  }}
                  className="group flex items-center justify-between border-b border-[rgba(181,165,141,0.4)] py-3.5 text-left last:border-0 cursor-pointer"
                >
                  <span className="flex items-center gap-3">
                    <Icon
                      className="h-4 w-4 text-[#b5a58d] transition-colors group-hover:text-[#E9B957]"
                      strokeWidth={1.5}
                    />
                    <span className="text-[14px] font-medium text-[#383936] transition-transform duration-200 group-hover:translate-x-0.5">
                      {name}
                    </span>
                  </span>
                  <span className="label text-[#b5a58d]">{String(i + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                sound.playUiBack();
                setPanel(null);
                setAtTitle(true);
              }}
              className="text-btn mt-4 cursor-pointer"
            >
              Return to title
            </button>
          </div>
        </Sheet>
      )}

      {/* ---------------------------------------------------- aligned plate */}
      {victory && (
        <div className="scrim fixed inset-0 z-40 flex items-end justify-start bg-[rgba(56,57,54,0.24)] p-3 backdrop-blur-[3px] sm:items-center sm:justify-center sm:p-6">
          <div
            className="plate-solid settle w-full max-w-[440px] p-7 sm:p-9"
            style={{ borderRadius: 3 }}
          >
            <div className="flex items-center justify-between">
              <span className="label text-[#77766f]">
                {custom ? 'Your level' : `Chapter ${ROMAN[levelIdx]} · Sheet ${String(level.number).padStart(2, '0')}`}
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(233,185,87,0.18)] text-[#8a6a22]">
                <Check className="h-4 w-4" strokeWidth={2.2} />
              </span>
            </div>

            <h2 className="display mt-4 text-[38px] leading-[0.95] text-[#2b2c29] sm:text-[46px]">
              {isLast ? 'Solstice' : 'Aligned'}
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[#4a4b47]">
              {isLast
                ? 'Every sanctuary crossed. The light holds where you leave it.'
                : `${palette.name} — ${level.subtitle}.`}
            </p>

            <div className="hair my-6" />

            <div className="flex items-end justify-between">
              <div>
                <span className="label text-[#77766f]">Crossing time</span>
                <div className="display mt-1 text-[34px] leading-none tabular-nums text-[#383936]">
                  {victory.elapsed.toFixed(1)}
                  <span className="ml-1 text-[15px] text-[#77766f]">s</span>
                </div>
              </div>
              <div className="text-right">
                <span className="label text-[#77766f]">Sun bearing</span>
                <div className="display mt-1 text-[20px] leading-none tabular-nums text-[#383936]">
                  {bearingOf(status.sunAzimuthDeg)} · {Math.round(status.sunAzimuthDeg)}°
                </div>
              </div>
            </div>

            <div className="mt-7 flex items-center gap-3">
              <button
                onClick={restart}
                className="ghost-btn flex-1 py-3 text-[11px] font-medium uppercase tracking-[0.16em] cursor-pointer"
                style={{ borderRadius: 3 }}
              >
                Replay
              </button>
              <button
                onClick={nextLevel}
                className="primary-btn display flex flex-[1.6] items-center justify-center gap-2.5 py-3.5 text-[12px] tracking-[0.16em] uppercase cursor-pointer"
                style={{ borderRadius: 3 }}
              >
                {custom ? 'Chapters' : isLast ? 'Begin again' : 'Next chapter'}
                <ChevronRight className="h-4 w-4 text-[#E9B957]" strokeWidth={1.7} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- thumbstick */}
      {showPad && !atTitle && !victory && panel === null && (
        <div className="fixed bottom-4 right-4 z-30 flex flex-col items-center gap-2 sm:bottom-6 sm:right-6">
          <div
            ref={padRef}
            onPointerDown={(e) => {
              sound.wake();
              padLive.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              padFrom(e.clientX, e.clientY);
            }}
            onPointerMove={(e) => padLive.current && padFrom(e.clientX, e.clientY)}
            onPointerUp={padEnd}
            onPointerCancel={padEnd}
            className="plate relative flex h-[112px] w-[112px] touch-none items-center justify-center cursor-pointer"
            style={{ borderRadius: '50%' }}
          >
            <div className="h-[62px] w-[62px] rounded-full border border-[rgba(181,165,141,0.55)]" />
            <div
              className="pointer-events-none absolute flex h-[44px] w-[44px] items-center justify-center rounded-full border transition-transform duration-75"
              style={{
                transform: `translate(${knob.x}px, ${knob.y}px)`,
                background: '#383936',
                borderColor: 'rgba(245,217,138,0.75)',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#F5D98A]" />
            </div>
          </div>
          <span className="label bg-[rgba(233,226,211,0.8)] px-2 py-0.5 text-[#77766f]">Roll</span>
        </div>
      )}
    </div>
  );
}

export default App;
