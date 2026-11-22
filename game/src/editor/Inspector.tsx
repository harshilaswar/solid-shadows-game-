import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  Crosshair,
  Trash2,
  Wand2,
  ArrowDownToLine,
  ArrowUpToLine,
} from 'lucide-react';
import type { Doc, DocApi, SelectionKind } from './doc';
import {
  autoCamera,
  centerOf,
  deleteDocObject,
  norm,
  pad,
  platformOutline,
  polyBounds,
  regularPolygon,
  requiredHeightFor,
  rotateDocObject,
  round,
  snapVal,
  uid,
} from './doc';
import type { Sel } from './PlanCanvas';

/* ------------------------------------------------------------------ atoms */

function Num({
  label,
  value,
  api,
  onChange,
  step = 0.1,
  min,
  suffix,
}: {
  label: string;
  value: number;
  api: DocApi;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const scrub = useRef<{ x: number; v: number; id: number } | null>(null);

  const shown = text ?? (Number.isFinite(value) ? round(value, 3).toString() : '0');

  const commitText = (raw: string) => {
    const v = parseFloat(raw);
    if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, v) : v);
    setText(null);
    api.endEdit();
  };

  return (
    <label className="fg-field">
      <span
        className="forge-label fg-scrub"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          e.preventDefault();
          scrub.current = { x: e.clientX, v: value, id: e.pointerId };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          api.beginEdit();
        }}
        onPointerMove={(e) => {
          if (!scrub.current || scrub.current.id !== e.pointerId) return;
          const dx = e.clientX - scrub.current.x;
          const next = scrub.current.v + Math.round(dx / 4) * step;
          onChange(min !== undefined ? Math.max(min, round(next, 4)) : round(next, 4));
        }}
        onPointerUp={(e) => {
          if (!scrub.current || scrub.current.id !== e.pointerId) return;
          scrub.current = null;
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
          api.endEdit();
        }}
        onPointerCancel={(e) => {
          if (!scrub.current || scrub.current.id !== e.pointerId) return;
          scrub.current = null;
          api.endEdit();
        }}
        onLostPointerCapture={(e) => {
          if (!scrub.current || scrub.current.id !== e.pointerId) return;
          scrub.current = null;
          api.endEdit();
        }}
        title="Drag to scrub"
      >
        {label}
      </span>
      <span className="flex items-center gap-1">
        <input
          className="fg-num forge-mono"
          value={shown}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          onFocus={() => {
            setText(shown);
            api.beginEdit();
          }}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              api.beginEdit();
              onChange(round(value + (e.key === 'ArrowUp' ? step : -step), 4));
              api.endEdit();
            }
          }}
        />
        {suffix && <span className="forge-mono text-[9px] text-[var(--muted)]">{suffix}</span>}
      </span>
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block py-1.5">
      <span className="forge-label">{label}</span>
      <textarea
        className="fg-text mt-1.5 resize-y leading-snug"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: Array<{ id: T; name: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-1.5">
      {label && <span className="forge-label">{label}</span>}
      <div className={`mt-1.5 flex gap-1 ${label ? '' : 'mt-0'}`}>
        {options.map((o) => (
          <button
            key={o.id}
            data-on={value === o.id}
            className="fg-chip flex-1"
            onClick={() => onChange(o.id)}
          >
            {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="border-b border-[var(--line-soft)] px-4 py-3">
      <header className="mb-1 flex items-center justify-between">
        <h3 className="forge-label ink">{title}</h3>
        {right}
      </header>
      {children}
    </section>
  );
}

function Btn({
  children,
  onClick,
  danger,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      className="fg-btn flex-1"
      style={danger ? { color: 'var(--clay)', borderColor: '#5c3a32' } : undefined}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

function RotateRow({
  label,
  onRotate,
  onReset,
}: {
  label: string;
  onRotate: (deg: number) => void;
  onReset?: () => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-1 border-t border-[var(--line-soft)] pt-2">
      <span className="forge-label mr-auto">{label}</span>
      {[-45, -15, 15, 45].map((d) => (
        <button key={d} className="fg-chip px-1.5" onClick={() => onRotate(d)} title={`Rotate ${d}°`}>
          {d > 0 ? `+${d}` : d}°
        </button>
      ))}
      {onReset && (
        <button className="fg-chip px-1.5" onClick={onReset} title="Clear rotation">
          reset
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- inspector */

interface Props {
  doc: Doc;
  api: DocApi;
  sel: Sel;
  setSel: (s: Sel) => void;
  grid: number;
  snapOn: boolean;
  counts: Record<string, number>;
  onSelect: (s: Sel) => void;
  issues: { severity: string; message: string; target?: { kind: SelectionKind; id: string } }[];
  onFit: () => void;
  onAnalyse: () => void;
  solving: number;
}

const EDGE_NAMES: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'east', 'south', 'west'];

export function Inspector({
  doc,
  api,
  sel,
  setSel,
  grid,
  snapOn,
  counts,
  onSelect,
  issues,
  onFit,
  onAnalyse,
  solving,
}: Props) {
  // history labels are accepted for readability; the doc hook snapshots on every commit
  const update = (fn: (d: Doc) => Doc, _label?: string) => api.update(fn);

  const setPoint = (key: 'start' | 'goal', patch: { x?: number; z?: number }) =>
    update((d) => ({ ...d, [key]: { ...d[key], ...patch } } as Doc));

  type Patch = Record<string, number | boolean | string>;

  const patchRect = (kind: 'platform' | 'gap' | 'part', id: string, r: Patch) =>
    update((d) => {
      if (kind === 'platform') {
        return { ...d, platforms: d.platforms.map((p) => (p.id === id ? { ...p, ...r } : p)) };
      }
      if (kind === 'gap') {
        return { ...d, gaps: d.gaps.map((g) => (g.id === id ? { ...g, ...r } : g)) };
      }
      return {
        ...d,
        pillars: d.pillars.map((s) => ({ ...s, parts: s.parts.map((b) => (b.id === id ? { ...b, ...r } : b)) })),
      };
    });

  const platform = sel.kind === 'platform' ? doc.platforms.find((p) => p.id === sel.id) : undefined;
  const gap = sel.kind === 'gap' ? doc.gaps.find((g) => g.id === sel.id) : undefined;
  const crystal = sel.kind === 'crystal' ? doc.crystals.find((c) => c.id === sel.id) : undefined;
  let part: Doc['pillars'][number]['parts'][number] | undefined;
  let pillar: Doc['pillars'][number] | undefined;
  for (const s of doc.pillars) {
    if (s.id === sel.id) pillar = s;
    const b = s.parts.find((x) => x.id === sel.id);
    if (b) {
      part = b;
      pillar = s;
    }
  }

  const deleteSelected = () => {
    if (platform) update((d) => ({ ...d, platforms: d.platforms.filter((p) => p.id !== sel.id) }), 'delete platform');
    else if (gap) update((d) => ({ ...d, gaps: d.gaps.filter((g) => g.id !== sel.id) }), 'delete span');
    else if (crystal) update((d) => ({ ...d, crystals: d.crystals.filter((c) => c.id !== sel.id) }), 'delete crystal');
    else if (part)
      update(
        (d) => ({
          ...d,
          pillars: d.pillars
            .map((s) => ({ ...s, parts: s.parts.filter((b) => b.id !== part!.id) }))
            .filter((s) => s.parts.length > 0),
        }),
        'delete block'
      );
    setSel({ kind: 'none', id: '' });
  };

  const duplicate = () => {
    const off = platform ? platform.xMax - platform.xMin + 0.6 : 2.4;
    if (platform) {
      const id = uid('p');
      update(
        (d) => ({
          ...d,
          platforms: [...d.platforms, { ...platform, id, name: `${platform.name} copy`, xMin: platform.xMin + off, xMax: platform.xMax + off }],
        }),
        'duplicate'
      );
      setSel({ kind: 'platform', id });
    } else if (gap) {
      const id = uid('g');
      update(
        (d) => ({
          ...d,
          gaps: [
            ...d.gaps,
            {
              ...gap,
              id,
              name: `Span ${String.fromCharCode(65 + d.gaps.length)}`,
              xMin: gap.xMin + off,
              xMax: gap.xMax + off,
              ax: gap.ax + off,
              bx: gap.bx + off,
            },
          ],
        }),
        'duplicate'
      );
      setSel({ kind: 'gap', id });
    } else if (part && pillar) {
      const id = uid('b');
      update(
        (d) => ({
          ...d,
          pillars: d.pillars.map((s) =>
            s.id === pillar!.id
              ? { ...s, parts: [...s.parts, { ...part!, id, xMin: part!.xMin + off, xMax: part!.xMax + off }] }
              : s
          ),
        }),
        'duplicate block'
      );
      setSel({ kind: 'part', id });
    }
  };

  const rectKind: 'platform' | 'gap' | 'part' | null = platform ? 'platform' : gap ? 'gap' : part ? 'part' : null;
  const activeRect = platform ?? gap ?? part ?? null;

  // Selection-level shortcuts live here because this panel owns the ops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;

      if ((k === 'Delete' || k === 'Backspace') && rectKind && activeRect) {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (k.toLowerCase() === 'd' && rectKind) {
        e.preventDefault();
        duplicate();
        return;
      }
      if (!k.startsWith('Arrow')) return;
      const step = (snapOn && grid > 0 ? grid : 0.1) * (e.shiftKey ? 10 : 1);
      const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
      const dz = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
      if (!dx && !dz) return;
      e.preventDefault();
      if (platform) patchRect('platform', platform.id, { xMin: platform.xMin + dx, xMax: platform.xMax + dx, zMin: platform.zMin + dz, zMax: platform.zMax + dz });
      else if (gap) patchRect('gap', gap.id, { xMin: gap.xMin + dx, xMax: gap.xMax + dx, zMin: gap.zMin + dz, zMax: gap.zMax + dz });
      else if (part) patchRect('part', part.id, { xMin: part.xMin + dx, xMax: part.xMax + dx, zMin: part.zMin + dz, zMax: part.zMax + dz });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const errs = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warn').length;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* selection */}
      <Section
        title={
          sel.kind === 'none'
            ? 'Nothing selected'
            : sel.kind === 'sun'
              ? 'The light'
              : sel.kind === 'start'
                ? 'Sphere start'
                : sel.kind === 'goal'
                  ? 'Sanctuary goal'
                  : sel.kind === 'crystal'
                    ? 'Sun crystal'
                    : sel.kind === 'pillar'
                      ? 'Caster'
                      : sel.kind === 'part'
                        ? 'Caster block'
                        : sel.kind === 'gap'
                          ? 'Broken span'
                          : 'Stone platform'
        }
        right={
          rectKind && activeRect ? (
            <span className="forge-mono text-[9.5px] text-[var(--muted)]">{sel.id.slice(0, 6)}</span>
          ) : null
        }
      >
        {!rectKind && sel.kind === 'none' && (
          <p className="py-1 text-[11.5px] leading-relaxed text-[var(--muted)]">
            Click any shape on the sheet. Drag its handles to resize, drag the body to move. Alt-scrub ignores the grid.
          </p>
        )}

        {(sel.kind === 'start' || sel.kind === 'goal') && (
          <>
            <Num
              label="x"
              value={sel.kind === 'start' ? doc.start.x : doc.goal.x}
              api={api}
              onChange={(v) => setPoint(sel.kind as 'start' | 'goal', { x: v })}
            />
            <Num
              label="z"
              value={sel.kind === 'start' ? doc.start.z : doc.goal.z}
              api={api}
              onChange={(v) => setPoint(sel.kind as 'start' | 'goal', { z: v })}
            />
            <div className="mt-2 flex gap-1.5">
              <Btn
                onClick={() => {
                  const key = sel.kind as 'start' | 'goal';
                  const p = doc.platforms[0];
                  if (!p) return;
                  const c = centerOf(norm(p));
                  update((d) => ({ ...d, [key]: c } as Doc), `centre ${key}`);
                }}
                title="Drop onto the centre of the first platform"
              >
                <Crosshair className="h-3.5 w-3.5" /> Centre on stone
              </Btn>
            </div>
          </>
        )}

        {crystal && (
          <>
            <Num label="x" value={crystal.x} api={api} onChange={(v) => update((d) => ({ ...d, crystals: d.crystals.map((c) => (c.id === crystal.id ? { ...c, x: v } : c)) }))} />
            <Num label="z" value={crystal.z} api={api} onChange={(v) => update((d) => ({ ...d, crystals: d.crystals.map((c) => (c.id === crystal.id ? { ...c, z: v } : c)) }))} />
            <Num label="eclipse radius" value={crystal.radius} step={0.05} min={0.1} api={api} onChange={(v) => update((d) => ({ ...d, crystals: d.crystals.map((c) => (c.id === crystal.id ? { ...c, radius: v } : c)) }))} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
              While any shadow covers this point the goal stays sealed.
            </p>
          </>
        )}

        {platform && (
          <>
            <label className="block py-1.5">
              <span className="forge-label">Name</span>
              <input
                className="fg-text mt-1"
                value={platform.name}
                onChange={(e) => update((d) => ({ ...d, platforms: d.platforms.map((p) => (p.id === platform.id ? { ...p, name: e.target.value } : p)) }))}
              />
            </label>
            <Chips
              label="Style"
              value={platform.style}
              options={[
                { id: 'main', name: 'Main' },
                { id: 'island', name: 'Island' },
                { id: 'pedestal', name: 'Pedestal' },
              ]}
              onChange={(v) => update((d) => ({ ...d, platforms: d.platforms.map((p) => (p.id === platform.id ? { ...p, style: v } : p)) }))}
            />
            <div className="py-1.5">
              <span className="forge-label">Broken edges</span>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {EDGE_NAMES.map((edge) => {
                  const on = platform.brokenEdges.includes(edge);
                  return (
                    <button
                      key={edge}
                      data-on={on}
                      className="fg-chip"
                      onClick={() =>
                        update((d) => ({
                          ...d,
                          platforms: d.platforms.map((p) =>
                            p.id === platform.id
                              ? { ...p, brokenEdges: on ? p.brokenEdges.filter((x) => x !== edge) : [...p.brokenEdges, edge] }
                              : p
                          ),
                        }))
                      }
                    >
                      {edge}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-1.5 flex gap-1">
              <Btn
                onClick={() => {
                  // open the edges that face a defined span
                  const r = norm(platform);
                  const edges = new Set(platform.brokenEdges);
                  for (const g of doc.gaps) {
                    const gr = norm(g);
                    if (Math.abs(gr.xMin - r.xMax) < 0.6) edges.add('east');
                    if (Math.abs(gr.xMax - r.xMin) < 0.6) edges.add('west');
                    if (Math.abs(gr.zMin - r.zMax) < 0.6) edges.add('south');
                    if (Math.abs(gr.zMax - r.zMin) < 0.6) edges.add('north');
                  }
                  update((d) => ({ ...d, platforms: d.platforms.map((p) => (p.id === platform.id ? { ...p, brokenEdges: [...edges] } : p)) }));
                }}
                title="Mark every edge that touches a broken span"
              >
                <Wand2 className="h-3.5 w-3.5" /> Match spans
              </Btn>
            </div>

            <RotateRow
              label="Rotate stone"
              onRotate={(deg) => update((d) => rotateDocObject(d, 'platform', platform.id, (deg * Math.PI) / 180))}
            />

            <div className="mt-2 rounded-sm border border-[var(--line-soft)] p-2">
              <div className="flex items-center justify-between">
                <span className="forge-label">Outline · {platformOutline(platform).length} pts</span>
                <button
                  className="fg-chip px-1.5"
                  onClick={() =>
                    update((d) => ({
                      ...d,
                      platforms: d.platforms.map((p) =>
                        p.id === platform.id ? { ...p, points: platformOutline(p) } : p
                      ),
                    }))
                  }
                  title="Make this stone editable point by point"
                >
                  make editable
                </button>
              </div>

              {platform.points && platform.points.length >= 3 ? (
                <>
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="forge-label mr-auto">regular n-gon</span>
                    {[3, 5, 6, 8, 12].map((n) => (
                      <button
                        key={n}
                        className="fg-chip px-1.5"
                        title={`Rebuild as a ${n}-gon`}
                        onClick={() =>
                          update((d) => ({
                            ...d,
                            platforms: d.platforms.map((p) => {
                              if (p.id !== platform.id) return p;
                              const bb = polyBounds(platformOutline(p));
                              const pts = regularPolygon(
                                (bb.xMin + bb.xMax) / 2,
                                (bb.zMin + bb.zMax) / 2,
                                Math.max(0.5, Math.min(bb.xMax - bb.xMin, bb.zMax - bb.zMin) / 2),
                                n
                              );
                              const nb = polyBounds(pts);
                              return { ...p, points: pts, xMin: nb.xMin, xMax: nb.xMax, zMin: nb.zMin, zMax: nb.zMax };
                            }),
                          }))
                        }
                      >
                        {n}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 max-h-[140px] space-y-1 overflow-y-auto pr-0.5">
                    {platform.points.map((v, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="forge-mono w-6 text-[9px] text-[var(--muted)]">P{i + 1}</span>
                        {(['x', 'z'] as const).map((axis) => (
                          <input
                            key={axis}
                            className="fg-num flex-1 w-0"
                            type="number"
                            step={0.1}
                            value={round(v[axis], 3)}
                            onChange={(e) => {
                              const nv = parseFloat(e.target.value);
                              if (!Number.isFinite(nv)) return;
                              update((d) => ({
                                ...d,
                                platforms: d.platforms.map((p) => {
                                  if (p.id !== platform.id || !p.points) return p;
                                  const pts = p.points.map((q, qi) => (qi === i ? { ...q, [axis]: nv } : q));
                                  const bb = polyBounds(pts);
                                  return { ...p, points: pts, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax };
                                }),
                              }));
                            }}
                          />
                        ))}
                        <button
                          className="fg-chip px-1 py-0.5"
                          title="Remove this point (minimum 3)"
                          onClick={() =>
                            update((d) => ({
                              ...d,
                              platforms: d.platforms.map((p) => {
                                if (p.id !== platform.id || !p.points || p.points.length <= 3) return p;
                                const pts = p.points.filter((_, qi) => qi !== i);
                                const bb = polyBounds(pts);
                                return { ...p, points: pts, xMin: bb.xMin, xMax: bb.xMax, zMin: bb.zMin, zMax: bb.zMax };
                              }),
                            }))
                          }
                        >
                          −
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    className="fg-chip mt-1.5 w-full"
                    onClick={() =>
                      update((d) => ({
                        ...d,
                        platforms: d.platforms.map((p) => {
                          if (p.id !== platform.id || !p.points) return p;
                          const bb = polyBounds(p.points);
                          const cx0 = (bb.xMin + bb.xMax) / 2;
                          const cz0 = (bb.zMin + bb.zMax) / 2;
                          const a = p.points[p.points.length - 1];
                          const bq = p.points[0];
                          const mid = { x: (a.x + bq.x) / 2, z: (a.z + bq.z) / 2 };
                          const out = {
                            x: round(cx0 + (mid.x - cx0) * 1.2),
                            z: round(cz0 + (mid.z - cz0) * 1.2),
                          };
                          const pts = [...p.points, out];
                          const nb = polyBounds(pts);
                          return { ...p, points: pts, xMin: nb.xMin, xMax: nb.xMax, zMin: nb.zMin, zMax: nb.zMax };
                        }),
                      }))
                    }
                  >
                    + add point
                  </button>
                </>
              ) : (
                <p className="mt-1 text-[10.5px] leading-snug text-[var(--muted)]">
                  Rectangles resize from their eight handles. Make it editable to drag arbitrary points, or draw a
                  pentagon / hexagon with the n-gon tool.
                </p>
              )}
            </div>
          </>
        )}

        {part && pillar && (
          <>
            <label className="block py-1.5">
              <span className="forge-label">Caster label</span>
              <input
                className="fg-text mt-1"
                value={pillar.label}
                onChange={(e) => update((d) => ({ ...d, pillars: d.pillars.map((s) => (s.id === pillar.id ? { ...s, label: e.target.value } : s)) }))}
              />
            </label>
            <Chips
              label="Material"
              value={part.variant}
              options={[
                { id: 'terracotta', name: 'Sand' },
                { id: 'ochre', name: 'Plaster' },
                { id: 'slate', name: 'Basalt' },
                { id: 'trim', name: 'Ivory' },
              ]}
              onChange={(v) =>
                update((d) => ({
                  ...d,
                  pillars: d.pillars.map((s) => (s.id === pillar.id ? { ...s, parts: s.parts.map((b) => (b.id === part.id ? { ...b, variant: v } : b)) } : s)),
                }))
              }
            />
            <div className="py-1">
              <button
                className="fg-chip w-full"
                data-on={part.castsUmbra}
                onClick={() =>
                  update((d) => ({
                    ...d,
                    pillars: d.pillars.map((s) => (s.id === pillar.id ? { ...s, parts: s.parts.map((b) => (b.id === part.id ? { ...b, castsUmbra: !b.castsUmbra } : b)) } : s)),
                  }))
                }
              >
                {part.castsUmbra ? 'Casts walkable shadow' : 'Decorative — no shadow'}
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3">
              <Num label="x from" value={part.xMin} api={api} onChange={(v) => patchRect('part', part.id, { xMin: v })} />
              <Num label="x to" value={part.xMax} api={api} onChange={(v) => patchRect('part', part.id, { xMax: v })} />
              <Num label="z from" value={part.zMin} api={api} onChange={(v) => patchRect('part', part.id, { zMin: v })} />
              <Num label="z to" value={part.zMax} api={api} onChange={(v) => patchRect('part', part.id, { zMax: v })} />
              <Num label="y from" value={part.yMin} step={0.1} api={api} onChange={(v) => patchRect('part', part.id, { yMin: v })} suffix="m" />
              <Num label="y to" value={part.yMax} step={0.1} min={0.2} api={api} onChange={(v) => patchRect('part', part.id, { yMax: v })} suffix="m" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Btn
                onClick={() => {
                  const need = requiredHeightFor(doc, part);
                  patchRect('part', part.id, { yMin: 0, yMax: need });
                }}
                title="Set the height so this block's shadow reaches the far side of the nearest span"
              >
                <ArrowUpToLine className="h-3.5 w-3.5" /> Height to span
              </Btn>
              <Btn
                onClick={() => {
                  // make this block a cap for the tallest ground block of the caster
                  const base = pillar.parts.find((b) => b.id !== part.id && b.yMin < 0.02);
                  if (!base) return;
                  patchRect('part', part.id, {
                    yMin: round(base.yMax - 0.28, 3),
                    yMax: round(base.yMax + 0.08, 3),
                    xMin: base.xMin - 0.1,
                    xMax: base.xMax + 0.1,
                    zMin: base.zMin - 0.1,
                    zMax: base.zMax + 0.1,
                    castsUmbra: false,
                    variant: 'trim',
                  });
                }}
                title="Fit as a capstone on the main block"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" /> Cap it
              </Btn>
            </div>
            <RotateRow
              label="Rotate caster"
              onRotate={(deg) => update((d) => rotateDocObject(d, 'pillar', pillar.id, (deg * Math.PI) / 180))}
            />
            <div className="mt-2 flex gap-1">
              <Btn
                onClick={() =>
                  update((d) => ({
                    ...d,
                    pillars: [
                      ...d.pillars,
                      {
                        id: uid('pil'),
                        label: `${pillar.label} II`,
                        parts: pillar.parts.map((b) => ({ ...b, id: uid('b') })),
                      },
                    ],
                  }))
                }
              >
                <Copy className="h-3.5 w-3.5" /> Clone caster
              </Btn>
              <Btn
                danger
                onClick={() => {
                  update((d) => deleteDocObject(d, 'pillar', pillar!.id));
                  setSel({ kind: 'none', id: '' });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete caster
              </Btn>
            </div>
          </>
        )}

        {gap && (
          <>
            <label className="block py-1.5">
              <span className="forge-label">Name</span>
              <input className="fg-text mt-1" value={gap.name} onChange={(e) => update((d) => ({ ...d, gaps: d.gaps.map((g) => (g.id === gap.id ? { ...g, name: e.target.value } : g)) }))} />
            </label>
            <div className="grid grid-cols-2 gap-x-3">
              <Num label="x from" value={gap.xMin} api={api} onChange={(v) => patchRect('gap', gap.id, { xMin: v })} />
              <Num label="x to" value={gap.xMax} api={api} onChange={(v) => patchRect('gap', gap.id, { xMax: v })} />
              <Num label="z from" value={gap.zMin} api={api} onChange={(v) => patchRect('gap', gap.id, { zMin: v })} />
              <Num label="z to" value={gap.zMax} api={api} onChange={(v) => patchRect('gap', gap.id, { zMax: v })} />
            </div>
            <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
              <span className="forge-label">Span test anchors</span>
              <div className="mt-1 grid grid-cols-2 gap-x-3">
                <Num label="A x" value={gap.ax} api={api} onChange={(v) => update((d) => ({ ...d, gaps: d.gaps.map((g) => (g.id === gap.id ? { ...g, ax: v } : g)) }))} />
                <Num label="A z" value={gap.az} api={api} onChange={(v) => update((d) => ({ ...d, gaps: d.gaps.map((g) => (g.id === gap.id ? { ...g, az: v } : g)) }))} />
                <Num label="B x" value={gap.bx} api={api} onChange={(v) => update((d) => ({ ...d, gaps: d.gaps.map((g) => (g.id === gap.id ? { ...g, bx: v } : g)) }))} />
                <Num label="B z" value={gap.bz} api={api} onChange={(v) => update((d) => ({ ...d, gaps: d.gaps.map((g) => (g.id === gap.id ? { ...g, bz: v } : g)) }))} />
              </div>
              <div className="mt-2 flex gap-1">
                <Btn
                  onClick={() => {
                    const near = (x: number, z: number, other: { x: number; z: number }) => {
                      let best = { x, z };
                      let bd = Infinity;
                      for (const p of doc.platforms) {
                        const c = centerOf(norm(p));
                        const dd = Math.hypot(c.x - other.x, c.z - other.z);
                        if (Math.hypot(c.x - x, c.z - z) < 3.2 && dd < bd) {
                          bd = dd;
                          best = c;
                        }
                      }
                      return best;
                    };
                    const a = near(gap.ax, gap.az, { x: gap.bx, z: gap.bz });
                    const b = near(gap.bx, gap.bz, a);
                    update((d) => ({ ...d, gaps: d.gaps.map((g) => (g.id === gap.id ? { ...g, ax: a.x, az: a.z, bx: b.x, bz: b.z } : g)) }));
                  }}
                  title="Place both anchors at the centre of the nearest stone"
                >
                  <Wand2 className="h-3.5 w-3.5" /> Snap anchors to stone
                </Btn>
                <Btn
                  onClick={() => {
                    const r = pad(norm(gap), 0.9);
                    const c = centerOf(norm(gap));
                    const horizontal = r.xMax - r.xMin >= r.zMax - r.zMin;
                    update((d) => ({
                      ...d,
                      gaps: d.gaps.map((g) =>
                        g.id === gap.id
                          ? {
                              ...g,
                              ax: horizontal ? g.xMin - 0.9 : c.x,
                              az: horizontal ? c.z : g.zMin - 0.9,
                              bx: horizontal ? g.xMax + 0.9 : c.x,
                              bz: horizontal ? c.z : g.zMax + 0.9,
                            }
                          : g
                      ),
                    }));
                  }}
                >
                  Widen test
                </Btn>
              </div>
            </div>
            <RotateRow
              label="Rotate span"
              onRotate={(deg) => update((d) => rotateDocObject(d, 'gap', gap.id, (deg * Math.PI) / 180))}
            />
          </>
        )}

        {sel.kind === 'sun' && (
          <>
            <Num label="bearing" value={doc.sun.azimuth} step={1} api={api} onChange={(v) => update((d) => ({ ...d, sun: { ...d.sun, azimuth: ((v % 360) + 360) % 360 } }))} suffix="°" />
            <Num label="orbit radius" value={doc.sun.maxRadius} step={0.2} min={4} api={api} onChange={(v) => update((d) => ({ ...d, sun: { ...d.sun, maxRadius: v } }))} />
            <Num label="shadow ratio" value={doc.sun.shadowRatio} step={0.05} min={0.5} api={api} onChange={(v) => update((d) => ({ ...d, sun: { ...d.sun, shadowRatio: v } }))} />
            <Num label="sun height" value={doc.sun.y} step={0.1} min={1} api={api} onChange={(v) => update((d) => ({ ...d, sun: { ...d.sun, y: v } }))} />
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
              Shadow ratio is locked altitude: every unit of height throws {doc.sun.shadowRatio.toFixed(2)} units of shadow. Sun height only moves the orb art, never the shadow.
            </p>
          </>
        )}

        {rectKind && activeRect && (
          <div className="mt-3 flex gap-1.5 border-t border-[var(--line-soft)] pt-3">
            <Btn onClick={duplicate}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </Btn>
            <Btn danger onClick={deleteSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Btn>
          </div>
        )}
      </Section>

      {/* outline */}
      <Section title="Contents" right={<span className="forge-mono text-[9.5px] text-[var(--muted)]">{solving >= 0 ? `${solving}/120 sol` : '—'}</span>}>
        {doc.platforms.map((p) => (
          <button key={p.id} className="fg-row w-full text-left" data-on={sel.id === p.id} onClick={() => setSel({ kind: 'platform', id: p.id })}>
            <span className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 bg-[#efe6d3] ring-1 ring-[#b3a48b]" />
              {p.name}
            </span>
            <span className="forge-mono text-[9.5px] text-[var(--muted)]">
              {round(p.xMax - p.xMin, 1)}×{round(p.zMax - p.zMin, 1)}
            </span>
          </button>
        ))}
        {doc.pillars.map((s) => (
          <button
            key={s.id}
            className="fg-row w-full text-left"
            data-on={sel.id === s.id || sel.id === s.parts[0]?.id}
            onClick={() => setSel({ kind: 'part', id: s.parts[0].id })}
          >
            <span className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 rotate-45 bg-[#c8a279]" />
              {s.label}
            </span>
            <span className="forge-mono text-[9.5px] text-[var(--muted)]">{round(s.parts[0]?.yMax ?? 0, 1)} tall</span>
          </button>
        ))}
        {doc.gaps.map((g) => (
          <button key={g.id} className="fg-row w-full text-left" data-on={sel.id === g.id} onClick={() => setSel({ kind: 'gap', id: g.id })}>
            <span className="flex items-center gap-2 text-[12px]">
              <span className="h-2 w-2 bg-[rgba(194,112,92,0.6)] ring-1 ring-[#b45f4b]" />
              {g.name}
            </span>
                <span className="forge-mono text-[9.5px] text-[var(--muted)]">
                  {round(Math.max(g.xMax - g.xMin, g.zMax - g.zMin), 1)} wide
                </span>
          </button>
        ))}
        {doc.crystals.length > 0 &&
          doc.crystals.map((c) => (
            <button key={c.id} className="fg-row w-full text-left" data-on={sel.id === c.id} onClick={() => setSel({ kind: 'crystal', id: c.id })}>
              <span className="flex items-center gap-2 text-[12px]">
                <span className="h-2 w-2 rounded-full bg-[var(--amber)]" />
                Sun crystal
              </span>
              <span className="forge-mono text-[9.5px] text-[var(--muted)]">r {c.radius.toFixed(2)}</span>
            </button>
          ))}
        <div className="flex gap-1.5 pt-2.5">
          <Btn onClick={() => onUpdateAll(api, grid, snapOn)}>
            <Wand2 className="h-3.5 w-3.5" /> Snap all to grid
          </Btn>
        </div>
      </Section>

      {/* level */}
      <Section title="Chapter">
        <label className="block py-1.5">
          <span className="forge-label">Title</span>
          <input className="fg-text mt-1" value={doc.meta.title} onChange={(e) => update((d) => ({ ...d, meta: { ...d.meta, title: e.target.value } }))} />
        </label>
        <label className="block py-1.5">
          <span className="forge-label">Subtitle</span>
          <input className="fg-text mt-1" value={doc.meta.subtitle} onChange={(e) => update((d) => ({ ...d, meta: { ...d.meta, subtitle: e.target.value } }))} />
        </label>
        <TextArea label="Objective line" value={doc.meta.prompt} onChange={(v) => update((d) => ({ ...d, meta: { ...d.meta, prompt: v } }))} />
        <TextArea label="Architect's note" value={doc.meta.hint} placeholder="Shown when the player asks for a hint" onChange={(v) => update((d) => ({ ...d, meta: { ...d.meta, hint: v } }))} />
        <Chips
          label="Palette · chapter number"
          value={String(doc.meta.chapter)}
          options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: String(n), name: ['Ivory', 'Sand', 'Colonnade', 'Apricot', 'Court', 'Amber', 'Solstice'][n - 1] }))}
          onChange={(v) => update((d) => ({ ...d, meta: { ...d.meta, chapter: parseInt(v, 10) } }))}
        />
      </Section>

      {/* framing */}
      <Section title="Framing" right={<span className="forge-mono text-[9.5px] text-[var(--muted)]">{counts.platforms}p · {counts.pillars}c · {counts.gaps}g</span>}>
        <div className="grid grid-cols-2 gap-x-3">
          <Num label="cam x" value={doc.camera.ox} step={0.5} api={api} onChange={(v) => update((d) => ({ ...d, camera: { ...d.camera, ox: v } }))} />
          <Num label="cam y" value={doc.camera.oy} step={0.5} api={api} onChange={(v) => update((d) => ({ ...d, camera: { ...d.camera, oy: v } }))} />
          <Num label="cam z" value={doc.camera.oz} step={0.5} api={api} onChange={(v) => update((d) => ({ ...d, camera: { ...d.camera, oz: v } }))} />
          <Num label="look y" value={doc.camera.ly} step={0.25} api={api} onChange={(v) => update((d) => ({ ...d, camera: { ...d.camera, ly: v } }))} />
          <Num label="look x" value={doc.camera.lx} step={0.5} api={api} onChange={(v) => update((d) => ({ ...d, camera: { ...d.camera, lx: v } }))} />
          <Num label="look z" value={doc.camera.lz} step={0.5} api={api} onChange={(v) => update((d) => ({ ...d, camera: { ...d.camera, lz: v } }))} />
        </div>
        <div className="mt-2 flex gap-1.5">
          <Btn
            onClick={() => {
              update((d) => ({ ...d, camera: autoCamera(d) }), 'auto-fit camera');
              onFit();
            }}
          >
            <Wand2 className="h-3.5 w-3.5" /> Auto-fit framing
          </Btn>
          <Btn onClick={onAnalyse} title="Sweep every bearing and measure solvability">
            Re-run solver
          </Btn>
        </div>
      </Section>

      {/* diagnostics */}
      <Section
        title="Diagnostics"
        right={
          <span className="forge-mono text-[9.5px]">
            <span style={{ color: errs ? 'var(--clay)' : 'var(--muted)' }}>{errs} err</span>
            <span className="px-1 text-[var(--line)]">/</span>
            <span style={{ color: warns ? 'var(--amber)' : 'var(--muted)' }}>{warns} warn</span>
          </span>
        }
      >
        {issues.length === 0 ? (
          <p className="py-1 text-[11.5px] text-[var(--sage)]">Clean. Every anchor lands on stone and the plan is consistent.</p>
        ) : (
          <ul className="space-y-1.5 py-1">
            {issues.map((i, n) => (
              <li key={n}>
                <button
                  className="flex w-full gap-2 text-left text-[11.5px] leading-snug text-[#cfc9bb] transition-colors hover:text-[var(--text)]"
                  onClick={() => i.target && onSelect(i.target)}
                >
                  <span
                    className="fg-sev mt-[6px]"
                    style={{
                      background: i.severity === 'error' ? 'var(--clay)' : i.severity === 'warn' ? 'var(--amber)' : 'var(--teal)',
                    }}
                  />
                  <span>{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function onUpdateAll(api: DocApi, grid: number, snapOn: boolean) {
  if (!snapOn || grid <= 0) return;
  api.update((d) => {
    const s = (v: number) => snapVal(v, grid);
    return {
      ...d,
      platforms: d.platforms.map((p) => ({ ...p, xMin: s(p.xMin), xMax: s(p.xMax), zMin: s(p.zMin), zMax: s(p.zMax) })),
      gaps: d.gaps.map((g) => ({ ...g, xMin: s(g.xMin), xMax: s(g.xMax), zMin: s(g.zMin), zMax: s(g.zMax), ax: s(g.ax), az: s(g.az), bx: s(g.bx), bz: s(g.bz) })),
      pillars: d.pillars.map((p) => ({
        ...p,
        parts: p.parts.map((b) => ({ ...b, xMin: s(b.xMin), xMax: s(b.xMax), zMin: s(b.zMin), zMax: s(b.zMax), yMin: s(b.yMin), yMax: s(b.yMax) })),
      })),
      crystals: d.crystals.map((c) => ({ ...c, x: s(c.x), z: s(c.z) })),
      start: { x: s(d.start.x), z: s(d.start.z) },
      goal: { x: s(d.goal.x), z: s(d.goal.z) },
    };
  });
}
