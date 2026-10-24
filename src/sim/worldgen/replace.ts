import { groundId, ground } from '../../content/grounds.ts';
import { createRng, hash3 } from '../../shared/rng.ts';
import { FLAG, type Realm } from '../realm.ts';
import { noise01 } from './noise.ts';

/** One replace rule (03 section 5.1): ground keys and a threshold on a scale-15 noise field. */
export interface ReplaceRule {
  threshold: number;
  from: string;
  to: string;
}

/** Noise scale of the replace field (03 section 5.1). */
const REPLACE_SCALE = 15;

/**
 * Applies replace rules in order (03 section 5.1). A tile whose ground is `from` becomes `to`
 * when `floor(noise01 * 255) >= threshold`. The elevation snaps to the target kind's band. The
 * edge ring is never replaced. `>=` (not `>`) makes threshold 0 cover every tile, as 03 section
 * 9 states for Open Plains (see DECISIONS.md).
 */
export function applyReplaceRules(realm: Realm, rules: readonly ReplaceRule[], seed: number): void {
  if (rules.length === 0) return;
  const rng = createRng(hash3(seed, 0x72706c63, 1));
  const offX = rng.int(1_000_000);
  const offY = rng.int(1_000_000);
  const noiseSeed = rng.int(0x7fffffff);
  const side = realm.side;
  for (const rule of rules) {
    const fromId = groundId(rule.from);
    const toId = groundId(rule.to);
    const band = ground(toId).band;
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const k = y * side + x;
        if ((realm.ground[k] ?? 0) !== fromId || realm.hasFlag(k, FLAG.edgeOfRealm)) continue;
        const n255 = Math.floor(noise01(((offX + x) / side) * REPLACE_SCALE, ((offY + y) / side) * REPLACE_SCALE, noiseSeed) * 255);
        if (n255 < rule.threshold) continue;
        if (band !== null) realm.elevation[k] = band;
        realm.setGround(k, toId);
      }
    }
  }
}
