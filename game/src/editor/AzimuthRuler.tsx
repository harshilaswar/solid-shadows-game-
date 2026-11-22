import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCw, Scan } from 'lucide-react';
import type { Analysis, Doc, DocApi } from './doc';
import { azimuthOf, shadowsAt, snapVal, stateAt } from './doc';

interface Props {
  doc: Doc;
  api: DocApi;
  analysis: Analysis | null;
  analysing: number | null;
  onAnalyse: () => void;
  grid: number;
  snapOn: boolean;
}

/**
 * The design instrument: sweep the light around its orbit and read, at a glance,
 * which bearings bridge which spans, which eclipse a crystal, and where a finished
 * solution actually exists.
 */
export function AzimuthRuler({ doc, api, analysis, analysing, onAnalyse, grid, snapOn }: Props) {
  const [playing, setPlaying] = useState(false);
  const [tip, setTip] = useState<{ x: number; az: number } | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Pointer id that owns the drag (null = not dragging). A bare boolean sticks
  // on if pointerup is missed, after which mere hover would swing the light.
  const dragRef = useRef<number | null>(null);

  // Recomputed once per edit, so the ruler reacts the moment the light moves.
  const live = useMemo(() => stateAt(doc, doc.sun.azimuth, false), [doc]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      api.live((d) => {
        let az = d.sun.azimuth + dt * 24;
        if (az >= 360) az -= 360;
        if (snapOn && grid > 0) az = Math.round(az / 5) * 5;
        return { ...d, sun: { ...d.sun, azimuth: az } };
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, api, snapOn, grid]);

  const azFromEvent = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      if (!el) return doc.sun.azimuth;
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(0.9999, (clientX - r.left) / r.width));
      let az = f * 360;
      if (snapOn && grid > 0) az = Math.round(az / 2.5) * 2.5;
      return az;
    },
    [doc.sun.azimuth, snapOn, grid]
  );

  const setAz = (az: number) => api.live((d) => ({ ...d, sun: { ...d.sun, azimuth: ((az % 360) + 360) % 360 } }));

  const rows: Array<{ label: string; color: string; bands: { from: number; to: number }[] | null; flags?: boolean[] }> = [];
  if (analysis) {
    analysis.gapBands.forEach((b, i) => rows.push({ label: doc.gaps[i]?.name ?? `Span ${i}`, color: 'var(--teal)', bands: b, flags: analysis.perGap[i] }));
    if (doc.crystals.length) rows.push({ label: 'Crystal clear', color: 'var(--sage)', bands: null, flags: analysis.eclipse.map((e) => !e) });
    rows.push({ label: 'Solvable', color: 'var(--amber)', bands: analysis.solutionBands, flags: analysis.reach });
  }

  const pct = (deg: number) => ((((deg % 360) + 360) % 360) / 360) * 100;

  const renderRow = (flags?: boolean[], bands?: { from: number; to: number }[] | null) => {
    if (bands) {
      return bands.flatMap((b, i) => {
        const segs: Array<{ left: number; width: number }> = [];
        if (b.from < 0) {
          segs.push({ left: 0, width: pct(b.to) });
          segs.push({ left: pct(360 + b.from), width: 100 - pct(360 + b.from) });
        } else {
          segs.push({ left: pct(b.from), width: Math.max(0.6, pct(b.to) - pct(b.from)) });
        }
        return segs.map((s, j) => (
          <span
            key={`${i}-${j}`}
            className="fg-band absolute top-0 bottom-0"
            style={{ left: `${s.left}%`, width: `${s.width}%`, background: 'currentColor', opacity: 0.55 }}
          />
        ));
      });
    }
    if (!flags) return null;
    return (
      <span className="absolute inset-0 flex">
        {flags.map((f, i) => (
          <span key={i} className="flex-1" style={{ background: 'currentColor', opacity: f ? 0.55 : 0.05 }} />
        ))}
      </span>
    );
  };

  return (
    <div className="border-t border-[var(--line)] bg-[var(--panel)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-2.5">
        <span className="forge-label">Bearing sweep</span>
        <span className="forge-mono text-[10px] text-[var(--muted)]">
          {doc.sun.azimuth.toFixed(1)}° · {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(pct(doc.sun.azimuth) / 12.5) % 8]}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button className="fg-btn" data-on={playing} onClick={() => setPlaying((p) => !p)} title="Animate the sun around its orbit">
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {playing ? 'Stop' : 'Sweep'}
          </button>
          <button className="fg-btn" onClick={() => { api.beginEdit(); setAz(0); api.endEdit(); }} title="Return the light to north">
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button className="fg-btn" data-accent={analysis ? 'false' : 'true'} onClick={onAnalyse} disabled={analysing !== null} title="Test every bearing for a real, walkable solution">
            <Scan className="h-3.5 w-3.5" />
            {analysing === null ? 'Solve' : `${Math.round(analysing * 100)}%`}
          </button>
        </div>
      </div>

      <div
        ref={barRef}
        className="relative mx-4 mt-2 mb-1 select-none"
        onPointerDown={(e) => {
          dragRef.current = e.pointerId;
          api.beginEdit();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          setAz(azFromEvent(e.clientX));
        }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
          setTip({ x: e.clientX - r.left, az: f * 360 });
          if (dragRef.current === e.pointerId) setAz(azFromEvent(e.clientX));
        }}
        onPointerUp={(e) => {
          if (dragRef.current !== e.pointerId) return;
          dragRef.current = null;
          api.endEdit();
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={(e) => {
          if (dragRef.current !== e.pointerId) return;
          dragRef.current = null;
          api.endEdit();
        }}
        onLostPointerCapture={(e) => {
          if (dragRef.current !== e.pointerId) return;
          dragRef.current = null;
          api.endEdit();
        }}
        onPointerLeave={() => setTip(null)}
        style={{ cursor: 'ew-resize', touchAction: 'none' }}
      >
        {/* ticks */}
        <div className="relative h-3.5 border-b border-[var(--line)]">
          {Array.from({ length: 25 }).map((_, i) => {
            const major = i % 6 === 0 || i === 24;
            return (
              <span
                key={i}
                className="absolute bottom-0 w-px bg-[#4a5255]"
                style={{ left: `${(i / 24) * 100}%`, height: major ? 11 : 5 }}
              />
            );
          })}
          {[0, 90, 180, 270].map((d) => (
            <span key={d} className="forge-mono absolute top-0 -translate-x-1/2 text-[8.5px] text-[var(--muted)]" style={{ left: `${(d / 360) * 100}%` }}>
              {d}
            </span>
          ))}
        </div>

        {/* rows */}
        {rows.length > 0 ? (
          rows.map((r) => (
            <div key={r.label} className="relative mt-[3px] h-[13px] bg-[#191d20]" style={{ color: r.color }}>
              {renderRow(r.flags, r.bands)}
              <span className="forge-label small absolute left-1.5 top-[1px] z-10 text-[#c9c3b6]">{r.label}</span>
            </div>
          ))
        ) : (
          <div className="mt-[3px] flex h-[42px] items-center bg-[#191d20] px-2">
            <span className="text-[11px] text-[var(--muted)]">
              Press <span className="forge-mono text-[var(--amber)]">Solve</span> to sweep all 120 bearings and map where this level can actually be crossed.
            </span>
          </div>
        )}

        {/* live readout */}
        <div className="relative mt-1">
          {live && (
            <div className="flex gap-3 pt-0.5">
              {live.bridged.map((b, i) => (
                <span key={i} className="forge-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: b ? 'var(--teal)' : '#5b6265' }}>
                  {doc.gaps[i]?.name ?? `span ${i}`} {b ? 'holding' : 'open'}
                </span>
              ))}
              {doc.crystals.length > 0 && (
                <span className="forge-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: live.eclipsed ? 'var(--clay)' : 'var(--sage)' }}>
                  {live.eclipsed ? 'crystal covered' : 'crystal lit'}
                </span>
              )}
              {analysis && <span className="forge-mono ml-auto text-[9px] uppercase tracking-[0.14em] text-[var(--muted)]">{analysis.solutions} solvable bearings</span>}
            </div>
          )}
        </div>

        {/* handle */}
        <span
          className="fg-handle absolute -top-3.5 bottom-[14px] z-20 w-[2px] bg-[var(--amber)]"
          style={{ left: `calc(${pct(doc.sun.azimuth)}% - 1px)`, boxShadow: '0 0 10px rgba(233,185,87,0.55)' }}
        >
          <span className="absolute -top-[3px] left-1/2 h-[7px] w-[7px] -translate-x-1/2 rotate-45 bg-[var(--amber)]" />
        </span>

        {tip && (
          <span
            className="forge-mono pointer-events-none absolute -top-6 z-30 -translate-x-1/2 bg-[#2f3336] px-1.5 py-0.5 text-[9.5px] text-[#f0e9da]"
            style={{ left: tip.x }}
          >
            {tip.az.toFixed(0)}°
          </span>
        )}
      </div>
    </div>
  );
}

/** Small readout used in the status bar: shadow footprint area per bearing. */
export function shadowFootprint(doc: Doc) {
  const polys = shadowsAt(doc);
  let area = 0;
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      area += a.x * b.z - b.x * a.z;
    }
  }
  return Math.abs(area / 2);
}

export { azimuthOf, snapVal };
