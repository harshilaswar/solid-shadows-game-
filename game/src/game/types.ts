export interface Vec2 {
  x: number;
  z: number;
  /** Optional world height. Stones/markers use it for elevation; outlines ignore it. */
  y?: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Rect2D {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface PlatformDef extends Rect2D {
  id: string;
  /**
   * Optional world-space outline. When present the stone is drawn, collided and
   * exported as this polygon; the xMin/xMax/zMin/zMax fields remain its bounding
   * box for camera framing and safety checks.
   */
  points?: Vec2[];
  /** Decorative isolated pillar pedestals can still be stone surfaces, or marked pedestal for styling */
  style?: 'main' | 'island' | 'pedestal';
  /** Which edges have fractured broken-bridge teeth for visual storytelling */
  brokenEdges?: Array<'north' | 'south' | 'east' | 'west'>;
  /** Elevation of the stone's top surface in world units (default 0). */
  y?: number;
}

export interface Box3D {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  variant?: 'terracotta' | 'ochre' | 'slate' | 'trim';
  /** Whether this box casts a walkable umbra shadow (default true; decorative base trims can opt out) */
  castsUmbra?: boolean;
  /** Yaw in radians about the box centre, in the XZ plane. */
  yaw?: number;
}

export interface PillarStructure {
  id: string;
  label?: string;
  parts: Box3D[];
}

/** A sloped walkway prism: the sphere rolls up and down it to reach raised terraces. */
export interface RampDef {
  id: string;
  /** Centre of the footprint. */
  x: number;
  z: number;
  /** Yaw in radians; the ramp ascends along its local +Z axis. */
  yaw: number;
  /** Horizontal length along the ascend axis. */
  length: number;
  /** Horizontal width across the ascend axis. */
  width: number;
  /** Elevation of the low edge (world y). */
  y: number;
  /** Height gained from the low edge to the high edge. */
  rise: number;
}

export interface BrokenGapHint extends Rect2D {
  id: string;
  /** Start and end anchor points across the chasm used to confirm when a shadow bridges the broken platform */
  anchorA: Vec2;
  anchorB: Vec2;
  /** Elevation of the bridging slab when the gap is crossed; shadow pools onto this plane (default 0). */
  y?: number;
}

export interface SunCrystal {
  id: string;
  x: number;
  z: number;
  /** Visual pedestal & crystal position; if shadowed, the goal portal locks until sunlit again */
  radius: number;
  /** Elevation of the crystal pedestal (default 0). */
  y?: number;
}

export interface LevelData {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  prompt: string;
  hint: string;
  platforms: PlatformDef[];
  pillars: PillarStructure[];
  brokenGaps: BrokenGapHint[];
  /** Optional sloped walkways the sphere can roll up and down. */
  ramps?: RampDef[];
  sunCrystals?: SunCrystal[];
  start: Vec2;
  goal: Vec2;
  lightInitial: Vec3;
  lightBounds: {
    /** Visual roam radius of the Sun Orb control (only its direction matters). */
    maxRadius: number;
    /** Fixed height of the distant sun — never affects shadows. */
    y: number;
    /** Fixed shadow length per unit of pillar height (sun elevation, locked per level). */
    shadowRatio: number;
  };
  camera: {
    offset: Vec3;
    lookAt: Vec3;
  };
}
