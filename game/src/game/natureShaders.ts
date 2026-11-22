import * as THREE from 'three';

export interface NatureUniforms {
  uTime: { value: number };
  uWindStrength: { value: number };
  uBallWorld: { value: THREE.Vector3 };
  uBallOnShadow: { value: number };
  uBridgedGlow: { value: number };
}

export function createNatureUniforms(): NatureUniforms {
  return {
    uTime: { value: 0 },
    uWindStrength: { value: 1.0 },
    uBallWorld: { value: new THREE.Vector3(0, 0, 0) },
    uBallOnShadow: { value: 0 },
    uBridgedGlow: { value: 0 },
  };
}

/**
 * Curved, tapered 4-segment 3D grass blade (height = 1.0, base width = 0.11)
 * with `aHeight` (0 at root -> 1 at tip) for quadratic wind bending.
 */
export function createGrassBladeGeometry(): THREE.BufferGeometry {
  const segs = 4;
  const positions: number[] = [];
  const normals: number[] = [];
  const heights: number[] = [];
  const indices: number[] = [];

  const baseHalfW = 0.058;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t;
    // Natural slight forward arch even at rest
    const curveZ = t * t * 0.11;
    const halfW = baseHalfW * (1.0 - t * 0.88);

    if (i < segs) {
      positions.push(-halfW, y, curveZ, halfW, y, curveZ);
      // Tilt normal upward so blades catch warm overhead sunlight cleanly
      normals.push(-0.18, 0.78, 0.58, 0.18, 0.78, 0.58);
      heights.push(t, t);
    } else {
      // Single apex vertex at tip
      positions.push(0, y, curveZ);
      normals.push(0, 0.88, 0.48);
      heights.push(1.0);
    }
  }

  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  const lastPair = (segs - 1) * 2;
  const tip = segs * 2;
  indices.push(lastPair, lastPair + 1, tip);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Delicate meadow wildflower geometry (slender stem + 4-petal cross blossom at top).
 * Uses `aIsPetal` (0 = green stem, 1 = tinted blossom) so instanceColor tints only the flower head!
 */
export function createWildflowerGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const heights: number[] = [];
  const isPetal: number[] = [];
  const indices: number[] = [];

  // Thin vertical stem quad (y = 0..0.78)
  const sw = 0.022;
  positions.push(-sw, 0, 0, sw, 0, 0, -sw * 0.7, 0.78, 0.04, sw * 0.7, 0.78, 0.04);
  normals.push(0, 0.6, 0.8, 0, 0.6, 0.8, 0, 0.6, 0.8, 0, 0.6, 0.8);
  heights.push(0, 0, 0.85, 0.85);
  isPetal.push(0, 0, 0, 0);
  indices.push(0, 1, 2, 1, 3, 2);

  // Horizontal 4-petal blossom star at y = 0.80
  const r = 0.13;
  const base = positions.length / 3;
  positions.push(
    0, 0.82, 0.04,      // center
    -r, 0.79, 0.04 - r, // NW
    r, 0.79, 0.04 - r,  // NE
    r, 0.79, 0.04 + r,  // SE
    -r, 0.79, 0.04 + r  // SW
  );
  for (let i = 0; i < 5; i++) {
    normals.push(0, 1, 0);
    heights.push(1.0);
    isPetal.push(1.0);
  }
  indices.push(
    base, base + 1, base + 2,
    base, base + 2, base + 3,
    base, base + 3, base + 4,
    base, base + 4, base + 1
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aHeight', new THREE.Float32BufferAttribute(heights, 1));
  geo.setAttribute('aIsPetal', new THREE.Float32BufferAttribute(isPetal, 1));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

const GRASS_WIND_PARS = /* glsl */ `
  attribute float aHeight;
  uniform float uTime;
  uniform float uWindStrength;
`;

const GRASS_WIND_VERTEX = /* glsl */ `
  {
    vec4 wp = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    wp = modelMatrix * wp;

    float w1 = sin( wp.x * 0.36 + wp.z * 0.24 + uTime * 2.15 );
    float w2 = cos( wp.x * 0.88 - wp.z * 0.64 + uTime * 3.45 );
    float gust = ( w1 * 0.68 + w2 * 0.32 ) * uWindStrength;
    float bend = ( 0.14 + 0.19 * gust ) * ( aHeight * aHeight );
    vec3 worldDelta = vec3( bend * 0.88, -abs( bend ) * 0.24 * aHeight, bend * 0.47 );

    // Map world-space wind displacement back into local instance space
    #ifdef USE_INSTANCING
      mat3 m3 = mat3( modelMatrix ) * mat3( instanceMatrix );
    #else
      mat3 m3 = mat3( modelMatrix );
    #endif
    vec3 c0 = m3[0];
    vec3 c1 = m3[1];
    vec3 c2 = m3[2];
    float l0 = max( 1e-4, length( c0 ) );
    float l1 = max( 1e-4, length( c1 ) );
    float l2 = max( 1e-4, length( c2 ) );
    transformed += vec3(
      dot( worldDelta, c0 / l0 ) / l0,
      dot( worldDelta, c1 / l1 ) / l1,
      dot( worldDelta, c2 / l2 ) / l2
    );
    vGust = gust;
    vBladeH = aHeight;
  }
`;

export function createWindGrassMaterial(
  rootHex: string,
  tipHex: string,
  uniforms: NatureUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.84,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const uRoot = { value: new THREE.Color(rootHex) };
  const uTip = { value: new THREE.Color(tipHex) };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uRootColor = uRoot;
    shader.uniforms.uTipColor = uTip;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${GRASS_WIND_PARS}\nvarying float vGust;\nvarying float vBladeH;`
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GRASS_WIND_VERTEX}`);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uRootColor;\nuniform vec3 uTipColor;\nvarying float vGust;\nvarying float vBladeH;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 bladeGrad = mix( uRootColor, uTipColor, smoothstep( 0.05, 0.95, vBladeH ) );
         float sheen = smoothstep( 0.15, 0.85, vGust ) * vBladeH * 0.14;
         diffuseColor.rgb *= ( bladeGrad + vec3( sheen * 0.9, sheen, sheen * 0.35 ) );`
      );
  };
  mat.customProgramCacheKey = () => 'umbra-wind-grass-v1';
  return mat;
}

export function createWildflowerMaterial(
  stemHex: string,
  uniforms: NatureUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.75,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const uStem = { value: new THREE.Color(stemHex) };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uStemColor = uStem;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${GRASS_WIND_PARS}\nattribute float aIsPetal;\nvarying float vGust;\nvarying float vBladeH;\nvarying float vIsPetal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvIsPetal = aIsPetal;\n${GRASS_WIND_VERTEX}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uStemColor;\nvarying float vGust;\nvarying float vBladeH;\nvarying float vIsPetal;`
      )
      .replace(
        '#include <color_fragment>',
        `vec3 instCol = vec3( 1.0 );
         #ifdef USE_INSTANCING_COLOR
           instCol = vColor;
         #endif
         diffuseColor.rgb = mix( uStemColor, instCol, step( 0.5, vIsPetal ) );`
      );
  };
  mat.customProgramCacheKey = () => 'umbra-wildflower-v1';
  return mat;
}

const FOLIAGE_RUSTLE_VERTEX = /* glsl */ `
  {
    vec4 wp = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    wp = modelMatrix * wp;

    float sway = sin( wp.x * 0.45 + wp.z * 0.35 + uTime * 1.65 ) * 0.085 * uWindStrength;
    float flutter = sin( wp.x * 2.6 + wp.y * 2.9 + wp.z * 2.3 + uTime * 3.9 ) * 0.032 * uWindStrength;
    float hMask = clamp( ( wp.y + 1.15 ) * 0.28, 0.0, 1.2 );
    transformed.x += ( sway + flutter ) * hMask;
    transformed.z += ( sway * 0.6 - flutter * 0.7 ) * hMask;
    transformed.y += flutter * 0.35 * hMask;
  }
`;

/**
 * Animated tree/shrub/ivy foliage material + matching depth material so
 * cast leaf shadows on the meadow physically rustle and breathe in the wind!
 */
export function createWindFoliageMaterials(
  colorHex: string,
  uniforms: NatureUniforms,
  cacheSuffix: string
): { material: THREE.MeshStandardMaterial; depthMaterial: THREE.MeshDepthMaterial } {
  const material = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.82,
    metalness: 0.0,
    flatShading: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FOLIAGE_RUSTLE_VERTEX}`);
  };
  material.customProgramCacheKey = () => `umbra-foliage-${cacheSuffix}`;

  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uWindStrength;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${FOLIAGE_RUSTLE_VERTEX}`);
  };
  depthMaterial.customProgramCacheKey = () => `umbra-foliage-depth-${cacheSuffix}`;

  return { material, depthMaterial };
}

/**
 * Animated painterly water material. The supplied pattern map is the reference-style
 * tile: irregular blue pools separated by crisp white branching veins. Two slowly
 * drifting UV layers make the veins slide and refract like shallow water, while the
 * mesh receives real-time shadows and keeps an animated lapping shoreline.
 */
export function createAnimatedWaterMaterial(
  patternMap: THREE.Texture,
  foamHex: string,
  uniforms: NatureUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map: patternMap,
    color: '#ffffff',
    roughness: 0.28,
    metalness: 0.04,
  });

  const uFoam = { value: new THREE.Color(foamHex) };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uFoam = uFoam;
    shader.uniforms.uPattern = { value: patternMap };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nvarying vec3 vWaterWorld;\nvarying vec2 vWaterUv;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vWaterUv = uv;
         vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
         float ripple = sin( wPos.x * 2.05 + uTime * 1.7 ) * cos( wPos.z * 1.72 - uTime * 1.35 ) * 0.022;
         transformed.y += ripple;
         vWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nuniform vec3 uFoam;\nuniform sampler2D uPattern;\nvarying vec3 vWaterWorld;\nvarying vec2 vWaterUv;`
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
           vec2 wp = vWaterWorld.xz;
           vec2 driftA = vec2( sin( wp.z * 0.55 + uTime * 0.34 ), cos( wp.x * 0.51 - uTime * 0.29 ) ) * 0.008;
           vec2 driftB = vec2( cos( wp.z * 0.31 - uTime * 0.21 ), sin( wp.x * 0.37 + uTime * 0.25 ) ) * 0.012;
           vec3 poolA = texture2D( map, vMapUv + driftA ).rgb;
           vec3 poolB = texture2D( map, vMapUv * 1.37 + driftB ).rgb;
           vec3 waterCol = mix( poolA, poolB, 0.18 );

           // Animated lapping white foam around the pool edge
           float edgeDist = min( min( vWaterUv.x, 1.0 - vWaterUv.x ), min( vWaterUv.y, 1.0 - vWaterUv.y ) );
           float waveEdge = 0.05 + 0.018 * sin( wp.x * 2.7 + wp.z * 2.2 + uTime * 2.35 );
           float shoreFoam = 1.0 - smoothstep( waveEdge * 0.62, waveEdge, edgeDist );
           waterCol = mix( waterCol, uFoam, shoreFoam * 0.9 );

           diffuseColor.rgb *= waterCol;
         #endif`
      );
  };
  mat.customProgramCacheKey = () => 'umbra-painterly-water-v2';
  return mat;
}

/**
 * Animated dense turf material: broad mown contour bands breathe in slow wind
 * waves while the instanced 3D blades above it rustle independently.
 */
export function createAnimatedTurfMaterial(
  map: THREE.Texture,
  uniforms: NatureUniforms
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    color: '#ffffff',
    roughness: 0.96,
    metalness: 0.0,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nuniform float uWindStrength;\nvarying vec3 vTurfWorld;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 turfW = modelMatrix * vec4( transformed, 1.0 );
         float turfWave = sin( turfW.x * 0.31 + turfW.z * 0.19 + uTime * 0.72 )
                        * cos( turfW.z * 0.27 - turfW.x * 0.11 - uTime * 0.51 );
         transformed.y += turfWave * 0.026 * uWindStrength;
         vTurfWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nvarying vec3 vTurfWorld;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float turfSheen = sin( vTurfWorld.x * 0.9 + vTurfWorld.z * 0.55 + uTime * 1.15 ) * 0.5 + 0.5;
         diffuseColor.rgb *= 0.94 + turfSheen * 0.09;`
      );
  };
  mat.customProgramCacheKey = () => 'umbra-animated-turf-v1';
  return mat;
}

/**
 * Physically grounded solidified shadow bridge shader:
 * - Rich translucent forest-slate umbra with subtle sky-light refraction
 * - Live concentric contact ripples radiating from the rolling sphere when on shadow!
 */
export function createPhysicalUmbraMaterial(
  shadowHex: string,
  accentHex: string,
  initialOpacity: number,
  uniforms: NatureUniforms
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uColor: { value: new THREE.Color(shadowHex) },
      uAccent: { value: new THREE.Color(accentHex) },
      uOpacity: { value: initialOpacity },
      uTime: uniforms.uTime,
      uBallWorld: uniforms.uBallWorld,
      uBallOnShadow: uniforms.uBallOnShadow,
      uBridgedGlow: uniforms.uBridgedGlow,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vNormalLocal;
      void main() {
        vNormalLocal = normal;
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uAccent;
      uniform float uOpacity;
      uniform float uTime;
      uniform vec3 uBallWorld;
      uniform float uBallOnShadow;
      uniform float uBridgedGlow;
      varying vec3 vWorldPos;
      varying vec3 vNormalLocal;

      void main() {
        // Subtle vertical depth darkening on extruded umbra side faces
        float topFace = step( 0.5, abs( vNormalLocal.y ) );
        vec3 col = mix( uColor * 0.72, uColor, topFace );

        // Subtle atmospheric motes / caustics inside the solidified shadow
        float shimmer = sin( vWorldPos.x * 2.4 + uTime * 1.2 ) * cos( vWorldPos.z * 2.4 - uTime * 0.95 );
        col += uAccent * ( uBridgedGlow * 0.08 * ( 0.5 + 0.5 * shimmer ) );

        // Physical weight-bearing concentric ripple under the sphere when rolling on shadow
        float dBall = length( vWorldPos.xz - uBallWorld.xz );
        float ring = sin( dBall * 14.0 - uTime * 7.5 ) * exp( -dBall * 1.85 );
        float contactGlow = exp( -dBall * 2.6 ) * 0.22 + max( 0.0, ring ) * 0.18;
        col = mix( col, uAccent, clamp( contactGlow * uBallOnShadow, 0.0, 0.55 ) );

        float alpha = uOpacity * ( topFace > 0.5 ? 1.0 : 0.85 );
        alpha = clamp( alpha + contactGlow * uBallOnShadow * 0.14, 0.0, 0.95 );
        gl_FragColor = vec4( col, alpha );
      }
    `,
  });
}
