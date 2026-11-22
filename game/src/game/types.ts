export interface Vec2 {
  x: number;
  z: number;
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
}

export interface Box3D {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  variant?: 'terracotta' | 'ochre' | 'slate' | 'trim';
  /** Whether this box casts a walkable umbra shadow onto y=0 (default true; decorative base trims can opt out) */
  castsUmbra?: boolean;
  /** Yaw in radians about the box centre, in the XZ plane. */
  yaw?: number;
}

export interface PillarStructure {
  id: string;
  label?: string;
  parts: Box3D[];
}

export interface BrokenGapHint extends Rect2D {
  id: string;
  /** Start and end anchor points across the chasm used to confirm when a shadow bridges the broken platform */
  anchorA: Vec2;
  anchorB: Vec2;
}

export interface SunCrystal {
  id: string;
  x: number;
  z: number;
  /** Visual pedestal & crystal position; if shadowed, the goal portal locks until sunlit again */
  radius: number;
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
