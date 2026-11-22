import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Move, RotateCcw, RotateCw, X } from 'lucide-react';
import {
  round,
  setObjectPosition,
  setObjectSize,
  setObjectYaw,
  transformOf,
  type Doc,
  type DocApi,
} from './doc';
import type { Sel } from './PlanCanvas';

const fmt = (v: number | null, dp = 2) => (v === null || !Number.isFinite(v) ? '—' : round(v, dp).toString());

function TFNum({
  label,
  value,
  onCommit,
  disabled,
  suffix,
  dp = 2,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
  dp?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const enabled = !disabled && value !== null;
  const shown = text ?? fmt(value, dp);

  const commit = () => {
    if (!enabled) {
      setText(null);
      return;
    }
    const v = parseFloat(text ?? '');
    if (Number.isFinite(v)) onCommit(v);
    setText(null);
  };

  return (
    <label className="min-w-0">
      <span className="forge-mono mb-0.5 block text-[8px] uppercase tracking-[0.14em] text-[var(--muted)]">{label}</span>
      <span className="flex h-7 items-stretch border border-[var(--line-soft)] bg-[#14171a] focus-within:border-[#6b5a34]">
        <input
          className="min-w-0 flex-1 bg-transparent px-1.5 font-mono text-[10.5px] text-[var(--text)] outline-none disabled:pointer-events-none disabled:text-[#5f6669]"
          value={shown}
          disabled={!enabled}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setText(shown === '—' ? '' : shown)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(null);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        {suffix && (
          <span className="grid place-items-center border-l border-[var(--line-soft)] px-1 font-mono text-[8.5px] text-[var(--muted)]">
            {suffix}
          </span>
        )}
      </span>
    </label>
  );
}

export function TransformPanel({ doc, api, sel }: { doc: Doc; api: DocApi; sel: Sel }) {
  const [open, setOpen] = useState(true);
  const info = useMemo(() => transformOf(doc, sel.kind, sel.id), [doc, sel.kind, sel.id]);

  const rotateBy = (delta: number) => {
    if (!info || info.rotationDeg === null) return;
    api.update((d) => setObjectYaw(d, sel.kind, sel.id, info.rotationDeg! + delta));
  };

  const summary = info
    ? `${fmt(info.position.x, 1)}, ${fmt(info.position.y, 1)}, ${fmt(info.position.z, 1)}  ·  ${
        info.rotationDeg === null ? '—' : `${fmt(info.rotationDeg, 1)}°`
      }  ·  ${fmt(info.size.x, 1)} × ${info.size.y === null ? '—' : fmt(info.size.y, 1)} × ${fmt(info.size.z, 1)}`
    : '';

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 w-[min(330px,calc(100vw-5.25rem))] border border-[var(--line)] bg-[#1e2225]/95 shadow-[0_16px_38px_-18px_rgba(0,0,0,0.85)] backdrop-blur-sm">
      <div className="flex h-8 items-center gap-1.5 border-b border-[var(--line-soft)] px-2">
        <Move className="h-3.5 w-3.5 text-[var(--amber)]" strokeWidth={1.7} />
        <span className="forge-label small">Transform</span>
        <span className="forge-mono min-w-0 flex-1 truncate text-right text-[9px] text-[var(--muted)]">
          {info ? `${info.kindLabel} · ${info.name}` : 'Nothing selected'}
        </span>
        <button className="fg-btn fg-icon !h-6 !w-6 border-0 bg-transparent" onClick={() => setOpen((v) => !v)} title={open ? 'Collapse transform panel' : 'Expand transform panel'}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <div className="px-2 pb-2 pt-1.5">
          {!info ? (
            <p className="py-1.5 text-[11px] leading-snug text-[var(--muted)]">
              Select any stone, span, caster, crystal, start, goal or light to read its transform here.
            </p>
          ) : (
            <>
              <div className="mb-1 grid grid-cols-[52px_repeat(3,1fr)] gap-1 px-0.5 text-[8px] font-medium uppercase tracking-[0.16em] text-[#6f777a]">
                <span>Field</span>
                <span>X</span>
                <span>Y</span>
                <span>Z</span>
              </div>

              <div className="grid grid-cols-[52px_repeat(3,1fr)] items-end gap-1">
                <span className="pb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--text)]">Position</span>
                <TFNum label="x" value={info.position.x} onCommit={(v) => api.update((d) => setObjectPosition(d, sel.kind, sel.id, { x: v }))} />
                <TFNum label="y" value={info.position.y} disabled={!info.canMoveY} onCommit={(v) => api.update((d) => setObjectPosition(d, sel.kind, sel.id, { y: v }))} />
                <TFNum label="z" value={info.position.z} onCommit={(v) => api.update((d) => setObjectPosition(d, sel.kind, sel.id, { z: v }))} />
              </div>

              <div className="mt-1.5 grid grid-cols-[52px_1fr_auto] items-end gap-1">
                <span className="pb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--text)]">Rotation</span>
                <TFNum
                  label={sel.kind === 'sun' ? 'bearing' : 'yaw'}
                  value={info.rotationDeg}
                  disabled={!info.canRotate}
                  suffix="°"
                  dp={1}
                  onCommit={(v) => api.update((d) => setObjectYaw(d, sel.kind, sel.id, v))}
                />
                <span className="flex h-7 gap-1">
                  <button className="fg-btn fg-icon !h-7 !w-7" disabled={!info.canRotate} onClick={() => rotateBy(-15)} title="Rotate 15° left">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                  <button className="fg-btn fg-icon !h-7 !w-7" disabled={!info.canRotate} onClick={() => rotateBy(15)} title="Rotate 15° right">
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>

              <div className="mt-1.5 grid grid-cols-[52px_repeat(3,1fr)] items-end gap-1">
                <span className="pb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[var(--text)]">Scale</span>
                <TFNum label="x" value={info.size.x} disabled={!info.canScaleX} suffix="u" onCommit={(v) => api.update((d) => setObjectSize(d, sel.kind, sel.id, { x: v }))} />
                <TFNum label="y" value={info.size.y} disabled={!info.canScaleY} suffix="u" onCommit={(v) => api.update((d) => setObjectSize(d, sel.kind, sel.id, { y: v }))} />
                <TFNum label="z" value={info.size.z} disabled={!info.canScaleZ} suffix="u" onCommit={(v) => api.update((d) => setObjectSize(d, sel.kind, sel.id, { z: v }))} />
              </div>

              <div className="mt-2 flex items-center gap-2 border-t border-[var(--line-soft)] pt-1.5">
                <span className="forge-mono min-w-0 flex-1 truncate text-[8.5px] text-[var(--muted)]">{summary}</span>
                <button className="fg-btn fg-icon !h-6 !w-6 border-0 bg-transparent" title="Close transform panel" onClick={() => setOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
