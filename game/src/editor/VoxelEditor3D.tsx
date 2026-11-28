import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, Compass, Eraser, Grid3x3, MousePointer2, RotateCw, Trash2 } from 'lucide-react';
import './editor.css';
import type { Doc, DocApi } from './doc';
import {
  BLOCKS,
  blockDef,
  docToVoxels,
  makeVoxel,
  shapeKey,
  voxelKey,
  voxelsToDoc,
  type BlockKind,
  type Voxel,
} from './voxels';

type Mode = BlockKind | 'select' | 'erase';
type Target = { x: number; y: number; z: number } | null;

interface Props {
  doc: Doc;
  api: DocApi;
  onReadout?: (text: string) => void;
  onToast?: (text: string) => void;
}

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  blocks: THREE.Group;
  ghost: THREE.Group;
  selection: THREE.LineSegments;
  heightGrid: THREE.GridHelper;
  ground: THREE.Mesh;
  hits: THREE.Mesh[];
  hitMap: Map<string, Voxel>;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
}

/** Wedge with its low edge at local -Z and its high edge at local +Z. */
function rampGeometry(cell: number): THREE.BufferGeometry {
  const h = cell / 2;
  const a = [-h, 0, -h];
  const b = [h, 0, -h];
  const c = [h, 0, h];
  const d = [-h, 0, h];
  const g = [h, cell, h];
  const e = [-h, cell, h];
  const tri = (...pts: number[][]) => pts.flat();
  const verts = [
    ...tri(a, d, c), ...tri(a, c, b), // bottom
    ...tri(a, e, g), ...tri(a, g, b), // sloping walk surface
    ...tri(b, g, c), // high-end wall
    ...tri(a, d, e), // left wall
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

const disposeTree = (root: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => materials.add(m));
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
};

/** A full 3D, block-based level editor. Blocks are translated to native Umbra level data. */
export function VoxelEditor3D({ doc, api, onReadout, onToast }: Props) {
  const [cell, setCell] = useState(0.5);
  const [mode, setMode] = useState<Mode>('stone');
  const [layer, setLayer] = useState(0);
  const [rot, setRot] = useState(0);
  const [stack, setStack] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [voxels, setVoxels] = useState<Voxel[]>(() => docToVoxels(doc, 0.5));

  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const voxelsRef = useRef(voxels);
  const docRef = useRef(doc);
  const cellRef = useRef(cell);
  const lastShapeRef = useRef(shapeKey(doc));
  const importedCellRef = useRef(cell);
  voxelsRef.current = voxels;
  docRef.current = doc;
  cellRef.current = cell;
  const liveRef = useRef({ mode, layer, rot, stack, cell, gridOn });
  liveRef.current = { mode, layer, rot, stack, cell, gridOn };

  /** Push a block change into the shared document (one undo step per edit). */
  const apply = useCallback(
    (next: Voxel[]) => {
      voxelsRef.current = next;
      setVoxels(next);
      const nextDoc = voxelsToDoc(docRef.current, next, cellRef.current);
      const key = shapeKey(nextDoc);
      if (key !== shapeKey(docRef.current)) {
        lastShapeRef.current = key;
        api.replace(nextDoc);
      }
    },
    [api]
  );

  const applyRef = useRef(apply);
  applyRef.current = apply;

  const removeAt = useCallback((target: Target) => {
    if (!target) return;
    const list = voxelsRef.current;
    const here = list.filter((v) => v.x === target.x && v.y === target.y && v.z === target.z);
    if (!here.length) return;
    // Markers sit above solids, so remove them first.
    const victim = here.find((v) => v.layer === 'mark') ?? here[here.length - 1];
    applyRef.current(list.filter((v) => v.id !== victim.id));
    setSelected((s) => (s === victim.id ? null : s));
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    applyRef.current(voxelsRef.current.filter((v) => v.id !== selected));
    setSelected(null);
  }, [selected]);

  const deleteRef = useRef(deleteSelected);
  deleteRef.current = deleteSelected;

  // Another view (or undo) changed the level: rebuild the block representation.
  useEffect(() => {
    const key = shapeKey(doc);
    if (lastShapeRef.current === key && importedCellRef.current === cell) return;
    lastShapeRef.current = key;
    importedCellRef.current = cell;
    setVoxels(docToVoxels(doc, cell));
    setSelected(null);
  }, [doc, cell]);

  const changeCell = (size: number) => {
    const key = shapeKey(docRef.current);
    lastShapeRef.current = key;
    importedCellRef.current = size;
    cellRef.current = size;
    setCell(size);
    setVoxels(docToVoxels(docRef.current, size));
    setSelected(null);
    onToast?.(`Block size set to ${size}`);
  };

  /* ------------------------------------------------------------- three.js */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#c7d5d3');
    scene.fog = new THREE.Fog('#c7d5d3', 42, 110);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
    camera.position.set(13, 12, 17);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = 'none';

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 2.5;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI * 0.495;
    // Left click is reserved for placing/erasing; drag the right button (or one
    // finger) to orbit, middle/two fingers to pan, wheel to zoom.
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    controls.update();
    controls.saveState();

    scene.add(new THREE.HemisphereLight('#eef6f2', '#8a7f6d', 2.1));
    const sun = new THREE.DirectionalLight('#fff3d6', 2.6);
    sun.position.set(14, 24, 11);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: '#cfc7b5', roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(80, 80, '#a58a55', '#9a9c8f');
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.38;
    grid.position.y = 0.004;
    scene.add(grid);

    const heightGrid = new THREE.GridHelper(80, 80, '#e9b957', '#c7a464');
    (heightGrid.material as THREE.Material).transparent = true;
    (heightGrid.material as THREE.Material).opacity = 0.3;
    heightGrid.position.y = 0.006;
    scene.add(heightGrid);

    const blocks = new THREE.Group();
    scene.add(blocks);
    const ghost = new THREE.Group();
    ghost.visible = false;
    scene.add(ghost);
    const selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: '#ffd972', depthTest: false })
    );
    selection.visible = false;
    selection.renderOrder = 5;
    scene.add(selection);

    const stage: Stage = {
      renderer,
      scene,
      camera,
      controls,
      blocks,
      ghost,
      selection,
      heightGrid,
      ground,
      hits: [],
      hitMap: new Map(),
      raycaster: new THREE.Raycaster(),
      pointer: new THREE.Vector2(),
    };
    stageRef.current = stage;

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const setTarget = (next: Target) => {
      if (!next) {
        ghost.visible = false;
        onReadout?.('cursor —');
        return;
      }
      const s = cellRef.current;
      ghost.visible = true;
      ghost.position.set((next.x + 0.5) * s, next.y * s, (next.z + 0.5) * s);
      onReadout?.(`x ${next.x} · y ${((next.y + 1) * s).toFixed(2)} · z ${next.z}`);
    };

    const computeTarget = (event: PointerEvent, direct = false): Target => {
      const rect = renderer.domElement.getBoundingClientRect();
      stage.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      stage.raycaster.setFromCamera(stage.pointer, camera);
      const hit = stage.raycaster.intersectObjects(stage.hits, false)[0];
      if (hit) {
        const v = stage.hitMap.get(hit.object.userData.voxelId as string);
        if (v) {
          const current = liveRef.current;
          if (direct || current.mode === 'select' || current.mode === 'erase' || !current.stack) {
            return current.mode === 'select' || current.mode === 'erase'
              ? { x: v.x, y: v.y, z: v.z }
              : { x: v.x, y: current.layer, z: v.z };
          }
          const n = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
          return {
            x: v.x + (Math.abs(n.x) > 0.5 ? Math.sign(n.x) : 0),
            y: v.y + (Math.abs(n.y) > 0.5 ? Math.sign(n.y) : 0),
            z: v.z + (Math.abs(n.z) > 0.5 ? Math.sign(n.z) : 0),
          };
        }
      }
      const floor = stage.raycaster.intersectObject(ground, false)[0];
      if (floor) return { x: Math.floor(floor.point.x / cellRef.current), y: liveRef.current.layer, z: Math.floor(floor.point.z / cellRef.current) };
      return null;
    };

    const onMove = (event: PointerEvent) => setTarget(computeTarget(event));
    const onLeave = () => setTarget(null);
    let down: { x: number; y: number; time: number; button: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, time: performance.now(), button: e.button };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || down.button !== 0) {
        down = null;
        return;
      }
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const held = performance.now() - down.time;
      down = null;
      if (moved > 6 || held > 650) return; // that was an orbit gesture
      const current = liveRef.current;
      const hitTarget = computeTarget(e, current.mode === 'erase' || e.shiftKey);
      if (current.mode === 'select') {
        if (!hitTarget) return;
        const here = voxelsRef.current.filter(
          (v) => v.x === hitTarget.x && v.y === hitTarget.y && v.z === hitTarget.z
        );
        const pick = here.find((v) => v.layer === 'mark') ?? here[0];
        setSelected(pick?.id ?? null);
        onReadout?.(pick ? `${blockDef(pick.kind).name} · y ${((pick.y + 1) * current.cell).toFixed(2)}` : 'cursor —');
      } else if (current.mode === 'erase' || e.shiftKey) {
        removeAt(hitTarget);
      } else if (hitTarget) {
        const kind = current.mode as BlockKind;
        applyRef.current([
          ...voxelsRef.current.filter((v) => voxelKey(v) !== `${blockDef(kind).layer}:${hitTarget.x},${hitTarget.y},${hitTarget.z}`),
          makeVoxel(kind, hitTarget.x, hitTarget.y, hitTarget.z, current.rot),
        ]);
        // Keep the ghost in the freshly occupied cell without re-clicking.
        setTarget(hitTarget);
      }
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      stageRef.current = null;
    };
  }, [onReadout, removeAt]);

  /* ------------------------------------------------------ rebuild the view */

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = cell;
    disposeTree(stage.blocks);
    stage.blocks.clear();
    stage.hits = [];
    stage.hitMap.clear();

    const box = new THREE.BoxGeometry(s * 0.96, s * 0.96, s * 0.96);
    const hitBox = new THREE.BoxGeometry(s, s, s);
    const wedge = rampGeometry(s);
    const edgeBox = new THREE.EdgesGeometry(box);
    const edgeWedge = new THREE.EdgesGeometry(wedge);
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const mats = new Map<BlockKind, THREE.MeshStandardMaterial>();
    for (const def of BLOCKS) {
      mats.set(
        def.kind,
        new THREE.MeshStandardMaterial({
          color: def.color,
          roughness: def.kind === 'crystal' ? 0.25 : 0.85,
          metalness: def.kind === 'slate' ? 0.18 : 0.02,
          emissive: def.kind === 'crystal' ? new THREE.Color('#245e6b') : new THREE.Color('#000000'),
        })
      );
    }
    const edgeMatFor = (kind: BlockKind) => {
      const c = new THREE.Color(blockDef(kind).edge);
      return new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: 0.75 });
    };

    for (const v of voxels) {
      const group = new THREE.Group();
      group.position.set((v.x + 0.5) * s, v.y * s, (v.z + 0.5) * s);
      if (v.layer === 'solid') {
        const isRamp = v.kind === 'ramp';
        const mesh = new THREE.Mesh(isRamp ? wedge : box, mats.get(v.kind)!);
        mesh.position.y = isRamp ? 0 : s / 2;
        if (isRamp) mesh.rotation.y = v.rot * (Math.PI / 2);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const edges = new THREE.LineSegments(isRamp ? edgeWedge : edgeBox, edgeMatFor(v.kind));
        mesh.add(edges);
        group.add(mesh);
      } else {
        const markerMat = mats.get(v.kind)!;
        if (v.kind === 'crystal') {
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(s * 0.38), markerMat);
          gem.position.y = s * 1.25;
          gem.rotation.y = Math.PI / 4;
          gem.castShadow = true;
          group.add(gem);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.42, s * 0.05, 6, 24), markerMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = s * 1.02;
          group.add(ring);
        } else if (v.kind === 'start' || v.kind === 'goal') {
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.36, s * 0.36, s * 0.06, 24), markerMat);
          disc.position.y = s * 1.03;
          group.add(disc);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(s * 0.42, s * 0.045, 6, 28), markerMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = s * 1.06;
          group.add(ring);
          if (v.kind === 'goal') {
            const beam = new THREE.Mesh(
              new THREE.CylinderGeometry(s * 0.09, s * 0.3, s * 1.2, 12, 1, true),
              new THREE.MeshBasicMaterial({ color: '#f0d080', transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
            );
            beam.position.y = s * 1.6;
            group.add(beam);
          }
        } else {
          const slab = new THREE.Mesh(
            new THREE.BoxGeometry(s * 0.96, s * 0.03, s * 0.96),
            new THREE.MeshBasicMaterial({ color: '#d97567', transparent: true, opacity: 0.55, depthWrite: false })
          );
          slab.position.y = s * 1.02;
          group.add(slab);
          const outline = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(s * 0.96, s * 0.06, s * 0.96)),
            new THREE.LineBasicMaterial({ color: '#8d3529' })
          );
          outline.position.y = s * 1.02;
          group.add(outline);
        }
      }
      // An invisible full-cell box makes every block easy to pick, including markers.
      const hit = new THREE.Mesh(hitBox, hitMat);
      hit.position.y = s * (v.layer === 'mark' ? 1.15 : 0.5);
      hit.userData.voxelId = v.id;
      group.add(hit);
      stage.hits.push(hit);
      stage.hitMap.set(v.id, v);
      stage.blocks.add(group);
    }

    const selectedVoxel = voxels.find((v) => v.id === selected);
    stage.selection.visible = !!selectedVoxel;
    if (selectedVoxel) {
      stage.selection.scale.setScalar(s * 1.04);
      stage.selection.position.set((selectedVoxel.x + 0.5) * s, (selectedVoxel.y + 0.5) * s, (selectedVoxel.z + 0.5) * s);
    }
  }, [voxels, cell, selected]);

  // Ghost preview follows the armed block and ramp rotation.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    disposeTree(stage.ghost);
    stage.ghost.clear();
    const s = cell;
    const isRamp = mode === 'ramp';
    const def = mode === 'select' || mode === 'erase' ? null : blockDef(mode as BlockKind);
    const geo = isRamp ? rampGeometry(s) : new THREE.BoxGeometry(s * 0.96, s * 0.96, s * 0.96);
    const mat = new THREE.MeshBasicMaterial({
      color: mode === 'erase' ? '#e06a55' : mode === 'select' ? '#ffd972' : def!.color,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = isRamp ? 0 : def?.layer === 'mark' ? s * 1.02 : s / 2;
    if (isRamp) mesh.rotation.y = rot * (Math.PI / 2);
    stage.ghost.add(mesh);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: mode === 'erase' ? '#8d3529' : '#fff1c9', depthTest: false })
    );
    outline.position.copy(mesh.position);
    outline.rotation.copy(mesh.rotation);
    stage.ghost.add(outline);
  }, [mode, cell, rot]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const s = cell;
    stage.heightGrid.scale.set(s, 1, s);
    stage.heightGrid.position.y = layer * s + 0.006;
    stage.heightGrid.visible = gridOn && layer !== 0;
    const floorGrid = stage.scene.children.find((o) => o !== stage.heightGrid && o.type === 'GridHelper') as THREE.GridHelper | undefined;
    if (floorGrid) {
      floorGrid.scale.set(s, 1, s);
      floorGrid.visible = gridOn;
    }
  }, [cell, layer, gridOn]);

  // Keys local to the 3D forge. The shell disables its own shortcuts in this view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const key = e.key.toLowerCase();
      const block = BLOCKS.find((b) => b.key === key);
      if (block) {
        e.preventDefault();
        setMode(block.kind);
        setSelected(null);
        return;
      }
      if (key === 'v') setMode('select');
      else if (key === 'x') setMode('erase');
      else if (key === 'r') setRot((n) => (n + 1) % 4);
      else if (key === '[') setLayer((n) => Math.max(-8, n - 1));
      else if (key === ']') setLayer((n) => Math.min(40, n + 1));
      else if (key === 'delete' || key === 'backspace') deleteRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const palette = (kind: Mode, icon: ReactNode, name: string, hint: string) => (
    <button
      key={kind}
      data-on={mode === kind}
      className="fg-blockbtn"
      onClick={() => {
        setMode(kind);
        setSelected(null);
      }}
      title={`${name} — ${hint}`}
    >
      <span className="grid h-5 w-5 flex-none place-items-center border border-black/30" style={{ background: kind === 'erase' ? '#d97567' : kind === 'select' ? '#ffd972' : blockDef(kind as BlockKind).color }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[11px] leading-tight text-[#e8e2d3]">{name}</span>
        <span className="forge-mono block truncate text-[8.5px] leading-tight text-[var(--muted)]">{hint}</span>
      </span>
    </button>
  );

  const selectedVoxel = voxels.find((v) => v.id === selected);
  const updateSelected = (patch: Partial<Pick<Voxel, 'x' | 'y' | 'z' | 'rot'>>) => {
    if (!selectedVoxel) return;
    const next = { ...selectedVoxel, ...patch };
    const occupied = voxels.some((v) => v.id !== selectedVoxel.id && voxelKey(v) === voxelKey(next));
    if (occupied) { onToast?.('That transform would overlap another block'); return; }
    apply(voxels.map((v) => v.id === selectedVoxel.id ? next : v));
  };

  return (
    <div className="flex h-full w-full min-w-0">
      {/* block palette */}
      <aside className="fg-noscroll flex w-[166px] flex-none flex-col overflow-y-auto border-r border-[var(--line)] bg-[var(--panel)] p-1.5 max-sm:w-[122px]">
        <div className="forge-label small px-1.5 pb-1.5">Blocks</div>
        <div className="flex flex-col gap-0.5">
          {palette('select', <MousePointer2 className="h-3 w-3 text-[#2b2418]" />, 'Select', 'click a block · V')}
          {BLOCKS.map((b) =>
            palette(b.kind, <Box className="h-3 w-3 text-[#2b2418]" />, b.name, `${b.key} · ${b.caption}`)
          )}
          {palette('erase', <Eraser className="h-3 w-3 text-[#2b2418]" />, 'Erase', 'X · shift+click')}
        </div>

        <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
          <div className="flex items-center justify-between px-1">
            <span className="forge-label tiny">Height</span>
            <span className="forge-mono text-[9px] text-[var(--amber)]">{((layer + 1) * cell).toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={-8}
            max={40}
            step={1}
            value={layer}
            onChange={(e) => setLayer(Number(e.target.value))}
            className="mt-1.5 w-full accent-[#e9b957]"
            title="Layer used when placing on the ground or in fixed-height mode"
          />
          <input
            type="number"
            value={((layer + 1) * cell).toFixed(2)}
            step={cell}
            onChange={(e) => {
              const top = Number(e.target.value);
              if (Number.isFinite(top)) setLayer(Math.max(-8, Math.min(40, Math.round(top / cell) - 1)));
            }}
            className="fg-text mt-1 w-full !px-1.5 !py-0.5 text-center forge-mono text-[10px]"
            title="Exact height of the block's top face"
          />
          <div className="mt-1 flex gap-1">
            <button className="fg-chip flex-1" onClick={() => setLayer((n) => Math.max(-8, n - 1))}>−</button>
            <button className="fg-chip flex-1" onClick={() => setLayer((n) => Math.min(40, n + 1))}>+</button>
          </div>
        </div>

        <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
          <span className="forge-label tiny px-1">Ramp facing</span>
          <div className="mt-1 flex items-center gap-1">
            <button className="fg-btn fg-icon" onClick={() => setRot((r) => (r + 1) % 4)} title="Rotate ramp (R)">
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            <span className="forge-mono flex-1 text-center text-[10px] text-[var(--amber)]">{rot * 90}°</span>
            <button className="fg-btn fg-icon" onClick={() => setRot((r) => (r + 3) % 4)} title="Rotate ramp back">
              <RotateCw className="h-3.5 w-3.5 scale-x-[-1]" />
            </button>
          </div>
        </div>

        <div className="mt-2 border-t border-[var(--line-soft)] pt-2">
          <span className="forge-label tiny px-1">Block size</span>
          <div className="mt-1 flex gap-1">
            {[0.25, 0.5, 1].map((size) => (
              <button key={size} data-on={cell === size} className="fg-chip flex-1 !px-0.5" onClick={() => changeCell(size)}>
                {size}
              </button>
            ))}
          </div>
          <button
            className="fg-btn mt-2 w-full !justify-between !px-2"
            data-on={stack}
            onClick={() => setStack((s) => !s)}
            title="Click block faces to stack, or always place at the height above"
          >
            <span className="text-[10px]">{stack ? 'Stack on faces' : 'Fixed height'}</span>
            <span className="forge-mono text-[9px] text-[var(--amber)]">{stack ? 'ON' : 'OFF'}</span>
          </button>
          <button className="fg-btn mt-1 w-full !justify-between !px-2" data-on={gridOn} onClick={() => setGridOn((g) => !g)}>
            <span className="flex items-center gap-1.5 text-[10px]"><Grid3x3 className="h-3 w-3" /> Grid</span>
            <span className="forge-mono text-[9px] text-[var(--amber)]">{gridOn ? 'ON' : 'OFF'}</span>
          </button>
          {selectedVoxel && (
            <button className="fg-btn mt-1 w-full !justify-between !px-2 !text-[var(--clay)]" onClick={deleteSelected}>
              <span className="flex items-center gap-1.5 text-[10px]"><Trash2 className="h-3 w-3" /> Delete</span>
              <span className="forge-mono text-[9px]">{blockDef(selectedVoxel.kind).name}</span>
            </button>
          )}
        </div>
      </aside>

      {/* 3D viewport */}
      <div className="relative min-w-0 flex-1 bg-[#c7d5d3]">
        <div ref={hostRef} className="absolute inset-0" />

        <div className="pointer-events-none absolute left-3 top-3 flex flex-col items-start gap-1">
          <div className="pointer-events-auto flex items-center gap-2 bg-[#14171acc] px-2.5 py-1.5 text-[#f0e9da] backdrop-blur-sm">
            <span className="forge-label amber">3D block forge</span>
            <span className="h-3 w-px bg-[var(--line)]" />
            <span className="forge-mono text-[9px] text-[var(--muted)]">{voxels.length} blocks</span>
          </div>
          <div className="pointer-events-auto bg-[#14171acc] px-2.5 py-1.5 forge-mono text-[9px] leading-relaxed text-[#b9b3a5] backdrop-blur-sm">
            click to place · shift+click to erase · right-drag orbit · wheel zoom
          </div>
        </div>

        <div className="absolute right-3 top-3 z-10 w-[220px] max-h-[calc(100%-24px)] overflow-y-auto border border-[#ffffff30] bg-[#14171aeF] p-2 text-[#f0e9da] shadow-xl backdrop-blur-md max-sm:w-[174px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="forge-label amber">Transform</span>
            <span className="forge-mono text-[9px] text-[#aaa394]">{selectedVoxel ? blockDef(selectedVoxel.kind).name : 'No selection'}</span>
          </div>
          {selectedVoxel ? <>
            <div className="forge-mono mb-1 text-[9px] text-[#aaa394]">LOCATION · world units</div>
            <div className="grid grid-cols-3 gap-1">
              {(['x','y','z'] as const).map((axis) => <label key={axis} className="text-center">
                <span className="forge-mono block text-[9px] text-[#d6ad5d]">{axis.toUpperCase()}</span>
                <input aria-label={`Position ${axis}`} type="number" step={cell} value={((selectedVoxel[axis] + (axis === 'y' ? 0 : 0.5)) * cell).toFixed(2)}
                  onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) updateSelected({ [axis]: Math.round(n / cell - (axis === 'y' ? 0 : 0.5)) }); }}
                  className="w-full border border-[#ffffff25] bg-[#282a29] px-1 py-1 text-center forge-mono text-[10px]" />
              </label>)}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="forge-mono text-[9px] text-[#aaa394]">ROTATION · Y</span>
              <div className="flex items-center gap-1">
                <button className="fg-btn fg-icon !h-6 !w-6" aria-label="Rotate counterclockwise" onClick={() => updateSelected({ rot: (selectedVoxel.rot + 3) % 4 })}>−</button>
                <span className="forge-mono min-w-8 text-center text-[10px] text-[#e9b957]">{selectedVoxel.rot * 90}°</span>
                <button className="fg-btn fg-icon !h-6 !w-6" aria-label="Rotate clockwise" onClick={() => updateSelected({ rot: (selectedVoxel.rot + 1) % 4 })}>+</button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {(['x','y','z'] as const).map((axis) => <div key={axis} className="flex gap-1">
                <button className="fg-chip flex-1 !px-0" aria-label={`Move ${axis} negative`} onClick={() => updateSelected({ [axis]: selectedVoxel[axis] - 1 })}>−{axis}</button>
                <button className="fg-chip flex-1 !px-0" aria-label={`Move ${axis} positive`} onClick={() => updateSelected({ [axis]: selectedVoxel[axis] + 1 })}>+{axis}</button>
              </div>)}
            </div>
          </> : <div className="py-2 forge-mono text-[9px] leading-relaxed text-[#aaa394]">Choose Select in the block palette, then click an object. Edit X, Y, Z or rotation here.</div>}
          <div className="mt-2 flex justify-end border-t border-[#ffffff20] pt-2">
            <button className="fg-btn fg-icon" title="Reset camera view" onClick={() => stageRef.current?.controls.reset()}><Compass className="h-4 w-4" /></button>
          </div>
        </div>

        {/* quick height controls */}
        <div className="absolute right-[238px] top-3 flex flex-col gap-1 max-sm:right-[188px]">
          <button
            className="fg-btn fg-icon glass"
            title="Reset camera view"
            onClick={() => stageRef.current?.controls.reset()}
          >
            <Compass className="h-4 w-4" />
          </button>
          <button
            className="fg-btn fg-icon glass"
            title="Step build height up (])"
            onClick={() => setLayer((n) => Math.min(40, n + 1))}
          >
            +
          </button>
          <button
            className="fg-btn fg-icon glass"
            title="Step build height down ([)"
            onClick={() => setLayer((n) => Math.max(-8, n - 1))}
          >
            −
          </button>
        </div>

        {!voxels.length && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="bg-[#14171acc] px-5 py-3 text-center backdrop-blur-sm">
              <div className="text-[13px] text-[#f0e9da]">Start with a Stone floor block</div>
              <div className="forge-mono mt-1 text-[9.5px] text-[var(--muted)]">click the ground to place · stack blocks on any face</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
