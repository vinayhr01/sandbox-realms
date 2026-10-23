/**
 * GLSL ES 3.00 for the terrain mesh. The vertex stage passes a full-screen quad through;
 * the fragment stage maps device pixels to tiles and reads the index texture with texelFetch
 * (no filtering, one tile per texel). Relief shading comes from neighbour elevations, so
 * there is no per-tile geometry or baked bitmap (17 section 12).
 *
 * Uniform layout (uniform names are the contract with terrain.ts):
 *   uView   = (offX, offY, zoom, side)  in device pixels, tiles per side
 *   uRes    = (width, height)           canvas size in device pixels
 *   uCursor = (tileX, tileY, radius, shape)  shape 0 circle, 1 square, 2 diamond, -1 hidden
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

out vec4 fragColor;

const vec3 BACKDROP = vec3(0.07, 0.08, 0.10);

int sideInt() {
  return int(uView.w + 0.5);
}

vec4 indexAt(ivec2 p) {
  int last = sideInt() - 1;
  return texelFetch(uIndex, clamp(p, ivec2(0), ivec2(last)), 0);
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

  ivec2 p = ivec2(floor(tile));
  vec4 cell = indexAt(p);
  int ground = int(floor(cell.r * 255.0 + 0.5));
  vec3 colour = texelFetch(uPalette, ivec2(ground, 0), 0).rgb;

  // Relief: light from the north-west, slope from the four neighbours' elevation (B channel, 0..255).
  float eW = indexAt(p + ivec2(-1, 0)).b;
  float eE = indexAt(p + ivec2(1, 0)).b;
  float eN = indexAt(p + ivec2(0, -1)).b;
  float eS = indexAt(p + ivec2(0, 1)).b;
  float slope = (eW - eE) + (eN - eS);
  colour *= clamp(1.0 + slope * 0.012, 0.72, 1.18);

  // Grid lines only when tiles are large enough to read.
  if (uView.z > 14.0) {
    vec2 f = fract(tile);
    float edge = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
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
