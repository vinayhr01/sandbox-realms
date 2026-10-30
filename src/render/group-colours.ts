/**
 * Fill colour of each species group, as pure data. No renderer import, so the 3D view (src/render3d/) reads the same colours
 * without pulling the renderer into its chunk. sprites.ts re-exports it.
 */
import type { MapKindGroup } from '../shared/protocol.ts';

/** Fill colour of each species group. Folk keeps the colour the dots used before. */
export const GROUP_COLOUR: Record<MapKindGroup, number> = {
  folk: 0xf2d18b,
  beast: 0xde9650,
  sea: 0x3b7dd4,
  insect: 0x7fbf3f,
  undead: 0xa3a3a3,
  monster: 0xf2331a,
  divine: 0xffe04a,
};
