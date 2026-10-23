/**
 * Achievement catalogue (14 section 4 subset). Each entry has a predicate over the lifetime stats
 * record (src/sim/stats.ts). Thresholds are TUNE. Order is the catalogue order: simultaneous
 * unlocks resolve in this order (14 section 2.2 step 7).
 */
import type { StatsRecord } from '../sim/stats.ts';

export interface AchievementDef {
  id: string;
  name: string;
  group: 'Creation' | 'Realms' | 'Beings' | 'Destruction' | 'Nature' | 'Experiments' | 'Codex';
  hidden: boolean;
  check: (s: StatsRecord) => boolean;
}

const c = (s: StatsRecord, key: string): number => s.counters[key] ?? 0;
const cause = (s: StatsRecord, name: string): number => c(s, `deathsByCause.${name}`);

const def = (
  id: string,
  name: string,
  group: AchievementDef['group'],
  check: (s: StatsRecord) => boolean,
  hidden = false,
): AchievementDef => ({ id, name, group, hidden, check });

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  def('ach_cradle', 'Cradle', 'Beings', (s) => c(s, 'beingsSpawned') >= 100),
  def('ach_busy_hands', 'Busy Hands', 'Beings', (s) => c(s, 'beingsSpawned') >= 10000),
  def('ach_firm_ground', 'Firm Ground', 'Creation', (s) => c(s, 'tilesPaintedLand') >= 1000),
  def('ach_stonemason', 'Stonemason', 'Creation', (s) => c(s, 'wallsPlaced') >= 10000),
  def('ach_five_horizons', 'Five Horizons', 'Realms', (s) => c(s, 'realmsCreated') >= 5),
  def('ach_cartographer', 'Cartographer', 'Realms', (s) => c(s, 'realmsCreated') >= 40),
  def('ach_atlas', 'Atlas', 'Realms', (s) => c(s, 'realmsCreated') >= 100),
  def('ach_first_year', 'First Year', 'Realms', (s) => c(s, 'simYearsElapsed') >= 1),
  def('ach_centurion', 'Centurion', 'Realms', (s) => c(s, 'simYearsElapsed') >= 100),
  def('ach_lightning_rod', 'Lightning Rod', 'Destruction', (s) => c(s, 'lightningStrikes') >= 50),
  def('ach_wildfire', 'Wildfire', 'Destruction', (s) => c(s, 'tilesBurned') >= 5000),
  def('ach_quake_wright', 'Quake Wright', 'Destruction', (s) => c(s, 'calamitiesCaused') >= 10),
  def('ach_plague_bearer', 'Plague Bearer', 'Destruction', (s) => cause(s, 'plague') >= 50),
  def('ach_eternal_hunger', 'Eternal Hunger', 'Beings', (s) => cause(s, 'starved') >= 500),
  def('ach_old_guard', 'Old Guard', 'Beings', (s) => cause(s, 'age') >= 500),
  def('ach_blood_hunter', 'Blood Hunter', 'Beings', (s) => cause(s, 'eaten') >= 1000),
  def('ach_green_thumb', 'Green Thumb', 'Nature', (s) => (s.sets['seedsUsed']?.length ?? 0) >= 23),
  def('ach_full_set', 'Full Set', 'Creation', (s) => (s.sets['stamps']?.length ?? 0) >= 12),
  def('ach_peak_maker', 'Peak Maker', 'Nature', (s) => c(s, 'summitRegionMax') >= 30),
  def('ach_powerful', 'Powerful', 'Experiments', (s) => c(s, 'powersUsed') >= 1000),
  def('ach_war_hound', 'War Hound', 'Destruction', (s) => c(s, 'warsStarted') >= 5),
  def('ach_peacemaker', 'Peacemaker', 'Experiments', (s) => c(s, 'peaceTreaties') >= 3),
  def('ach_hidden_lore', 'Hidden Lore', 'Codex', (s) => (s.sets['discoveries']?.length ?? 0) >= 10, true),
  def('ach_crypt_keeper', 'Crypt Keeper', 'Beings', (s) => c(s, 'boneshamblersRaised') >= 10, true),
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
