/**
 * GLSL ES 3.00 for the terrain mesh. The vertex stage passes a full-screen quad through;
 * the fragment stage maps device pixels to tiles and reads the index texture with texelFetch
 * (no filtering). Colours and elevation are blended between the four nearest tile centres, so
 * there is no per-tile geometry or baked bitmap (17 section 12).
 *
 * Uniform layout (uniform names are the contract with terrain.ts):
 *   uView   = (offX, offY, zoom, side)  in device pixels, tiles per side
 *   uRes    = (width, height)           canvas size in device pixels
 *   uCursor = (tileX, tileY, radius, shape)  shape 0 circle, 1 square, 2 diamond, -1 hidden
 *   uDetail = (medium, close)           zoom-faded detail weights 0..1 (terrain-detail.ts)
 *   uTime   = seconds                   animates water ripples and crests
 *   uDpr    = device px per CSS px      converts CSS-px thresholds (grid lines) to device px
 *
 * Palette texture: row 0 holds the ground colours; row 1 has R = 255 for water and sea grounds,
 * G = 255 for sea grounds only (lakes and rivers are water but not sea).
 */
export const TERRAIN_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const TERRAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uIndex;
uniform sampler2D uPalette;
uniform vec4 uView;
uniform vec2 uRes;
uniform vec4 uCursor;
uniform vec2 uDetail;
uniform float uTime;
uniform float uDpr;

out vec4 fragColor;

const vec3 BACKDROP = vec3(0.07, 0.08, 0.10);
const vec3 DEEP_TINT = vec3(0.055, 0.157, 0.353);
const vec3 FOAM = vec3(0.96, 0.98, 0.99);
const vec3 RIPPLE = vec3(0.75, 0.86, 0.94);
const vec3 CREST = vec3(0.92, 0.96, 1.0);
/** Hillshade strength per unit of elevation slope (elevation 0..1 per tile); matches the mockup's 3.2 over a half-tile step. */
const float HILL_K = 1.6;
/** Contour spacing: 0.1 of the full elevation range (0..255). */
const float CONTOUR_STEP = 25.5;

int sideInt() {
  return int(uView.w + 0.5);
}

vec4 indexAt(ivec2 p) {
  int last = sideInt() - 1;
  return texelFetch(uIndex, clamp(p, ivec2(0), ivec2(last)), 0);
}

int groundOf(vec4 cell) {
  return int(floor(cell.r * 255.0 + 0.5));
}

vec3 groundColour(int ground) {
  return texelFetch(uPalette, ivec2(ground, 0), 0).rgb;
}

float groundIsWater(int ground) {
  return texelFetch(uPalette, ivec2(ground, 1), 0).r > 0.5 ? 1.0 : 0.0;
}

float groundIsSea(int ground) {
  return texelFetch(uPalette, ivec2(ground, 1), 0).g > 0.5 ? 1.0 : 0.0;
}

// Hash value noise (Dave Hoskins style hash, no sin, so it stays stable on mobile GPUs).
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Two-value hash for cell features (Dave Hoskins hash22, no sin). Components in [0, 1).
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two and three octave sums; each effect calls one of these at most a few times per pixel.
float fbm2(vec2 p) {
  return valueNoise(p) * 0.6 + valueNoise(p * 2.0) * 0.4;
}

float fbm3(vec2 p) {
  return valueNoise(p) * 0.55 + valueNoise(p * 2.0) * 0.28 + valueNoise(p * 4.0) * 0.17;
}

void main() {
  // gl_FragCoord is bottom-left in device pixels; the camera is top-left.
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 tile = (px - uView.xy) / uView.z;
  float side = uView.w;

  if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= side || tile.y >= side) {
    fragColor = vec4(BACKDROP, 1.0);
    return;
  }

  // Four nearest tile centres. Corner A is the lower-left centre around the fragment.
  vec2 g = tile - 0.5;
  ivec2 c0 = ivec2(floor(g));
  vec2 f = g - vec2(c0);
  vec4 tA = indexAt(c0);
  vec4 tB = indexAt(c0 + ivec2(1, 0));
  vec4 tC = indexAt(c0 + ivec2(0, 1));
  vec4 tD = indexAt(c0 + ivec2(1, 1));
  float wA = (1.0 - f.x) * (1.0 - f.y);
  float wB = f.x * (1.0 - f.y);
  float wC = (1.0 - f.x) * f.y;
  float wD = f.x * f.y;

  // The home tile (the one this pixel is in) decides the layer. Colour only blends with tiles of that layer.
  vec4 home = f.x >= 0.5 ? (f.y >= 0.5 ? tD : tB) : (f.y >= 0.5 ? tC : tA);
  float homeWater = groundIsWater(groundOf(home));
  float homeSea = groundIsSea(groundOf(home));

  int gA = groundOf(tA);
  int gB = groundOf(tB);
  int gC = groundOf(tC);
  int gD = groundOf(tD);
  float kA = abs(groundIsWater(gA) - homeWater) < 0.5 ? wA : 0.0;
  float kB = abs(groundIsWater(gB) - homeWater) < 0.5 ? wB : 0.0;
  float kC = abs(groundIsWater(gC) - homeWater) < 0.5 ? wC : 0.0;
  float kD = abs(groundIsWater(gD) - homeWater) < 0.5 ? wD : 0.0;
  float sameW = kA + kB + kC + kD;
  // Weight of tiles on the other side of a coast: the foam band sits where this grows.
  float otherW = 1.0 - sameW;

  vec3 colour = (kA * groundColour(gA) + kB * groundColour(gB) + kC * groundColour(gC) + kD * groundColour(gD)) / sameW;

  // Elevation (0..255, from the B channel) interpolated across the four centres.
  float eA = tA.b * 255.0;
  float eB = tB.b * 255.0;
  float eC = tC.b * 255.0;
  float eD = tD.b * 255.0;
  float eBilinear = mix(mix(eA, eB, f.x), mix(eC, eD, f.x), f.y);
  float eSame = (kA * eA + kB * eB + kC * eC + kD * eD) / sameW;
  float rockiness = smoothstep(180.0, 200.0, eBilinear);

  // Hillshade from the bilinear gradient (raw elevation units per tile, east and south positive).
  // Sign matches the approved mockup and the previous shader: slopes rising east or south are darker.
  float gx = mix(eB - eA, eD - eC, f.y);
  float gy = mix(eC - eA, eD - eB, f.x);
  if (homeWater < 0.5) {
    float shade = clamp(1.0 - HILL_K * (gx + gy) / 255.0, 0.65, 1.3);
    colour *= shade;
  } else if (homeSea > 0.5) {
    // Deep sea is darker: elevation 0 is the deepest sea, shoal (75) the shallowest. Lakes and rivers stay plain.
    float depth = clamp((80.0 - eSame) / 80.0, 0.0, 1.0);
    colour = mix(colour, DEEP_TINT, depth * 0.6);
  }

  // Shoreline foam: a band on both sides of a water and land edge.
  colour = mix(colour, FOAM, smoothstep(0.3, 0.5, otherW) * 0.6);

  // Medium detail: speckle, rock, ripples and contour lines.
  if (uDetail.x > 0.0) {
    float mW = uDetail.x;
    if (homeWater > 0.5) {
      float r = sin(tile.x * 2.6 + fbm2(tile * 0.9 + 3.0) * 6.0 + uTime * 0.9) * sin(tile.y * 3.1 - uTime * 0.7);
      colour = mix(colour, RIPPLE, smoothstep(0.82, 0.95, r) * 0.35 * mW);
    } else {
      float n = fbm3(tile * 6.0);
      colour *= mix(1.0, 0.9 + n * 0.22, mW * (1.0 - rockiness));
      colour *= mix(1.0, 0.82 + n * 0.34, mW * rockiness);
      if (eBilinear > 110.0) {
        // Contour line every 0.1 of elevation, about half a device pixel wide on the slope.
        float halfWidth = max(0.5 * length(vec2(gx, gy)) / uView.z, 0.15);
        float cc = fract(eBilinear / CONTOUR_STEP);
        float dl = min(cc, 1.0 - cc) * CONTOUR_STEP;
        float line = 1.0 - smoothstep(halfWidth, halfWidth * 2.0 + 0.2, dl);
        colour *= 1.0 - 0.14 * line * mW;
      }
    }
  }

  // Close detail: wave crests, grass tufts and pebbles on rock.
  if (uDetail.y > 0.0) {
    float cW = uDetail.y;
    if (homeWater > 0.5) {
      // Crests: thin bright bands, about 1 to 2 device px wide at 64 px per tile.
      float crest = sin(tile.x * 19.0 + sin(tile.y * 5.0 + uTime * 1.3) * 2.5) * sin(tile.y * 13.0 - uTime * 1.1);
      colour = mix(colour, CREST, smoothstep(0.85, 0.97, crest) * 0.6 * cW);
    } else {
      // Tufts: one dark clump per 1/8 tile cell, on grass only. Each cell's clump is placed by its hash (kept inside the
      // cell so it is not cut at the edge) and about 40% of cells have none, so no regular grid of clumps shows.
      vec2 tc = tile * 8.0;
      vec2 tcell = floor(tc);
      vec2 tq = fract(tc) - 0.5;
      vec2 to = hash22(tcell) * 0.48 - 0.24;
      float tKeep = step(0.4, hash12(tcell + vec2(31.7, 12.3)));
      float tuft = (1.0 - smoothstep(0.16, 0.26, length(tq - to))) * tKeep;
      colour *= mix(1.0, 0.7, tuft * (1.0 - rockiness) * cW);

      // Pebbles: one light stone per 1/5 tile cell, on rock only, jittered and thinned the same way.
      vec2 pc = tile * 5.0;
      vec2 pcell = floor(pc);
      vec2 pq = fract(pc) - 0.5;
      vec2 po = hash22(pcell + 17.0) * 0.36 - 0.18;
      float pKeep = step(0.4, hash12(pcell + vec2(47.1, 5.9)));
      float ph = hash12(pcell + 17.0);
      float pebble = (1.0 - smoothstep(0.26, 0.32, length(pq - po))) * pKeep;
      colour = mix(colour, colour * (0.8 + ph * 0.4), pebble * rockiness * cW);
    }
  }

  // Grid lines only when tiles are large enough to read (14 CSS px, scaled to device px) and close detail is off.
  if (uView.z > 14.0 * uDpr && uDetail.y < 0.5) {
    vec2 f2 = fract(tile);
    float edge = min(min(f2.x, f2.y), min(1.0 - f2.x, 1.0 - f2.y));
    float line = 1.0 - smoothstep(0.0, 1.5 / uView.z, edge);
    colour = mix(colour, colour * 0.8, line);
  }

  // Brush outline: circle, square or diamond around the cursor tile, plus a faint fill.
  if (uCursor.w >= 0.0) {
    vec2 delta = (tile - (uCursor.xy + 0.5));
    float dist;
    if (uCursor.w < 0.5) {
      dist = length(delta);
    } else if (uCursor.w < 1.5) {
      dist = max(abs(delta.x), abs(delta.y));
    } else {
      dist = abs(delta.x) + abs(delta.y);
    }
    float ringAt = uCursor.z + 0.5;
    float width = 1.5 / uView.z;
    float band = abs(dist - ringAt);
    float ring = 1.0 - smoothstep(width * 0.5, width, band);
    float fill = (dist < ringAt) ? 0.10 : 0.0;
    colour = mix(colour, vec3(1.0), fill);
    colour = mix(colour, vec3(1.0, 0.95, 0.6), ring * 0.9);
  }

  fragColor = vec4(colour, 1.0);
}
`;
