/**
 * Campaign records (10 section 1 Campaign, section 11): a campaign has sides (attackers, defenders), each a list of dominion
 * ids, and a main party on each side. Only the uprising is started (rebellion.ts, intrigue.ts). No campaign ends in this
 * build: the outcome, peace, merge and renown rules of section 11 are not built, so a record runs for the rest of the save.
 * The dominion's own `target` and `campaignSince` (types.ts) stay the strength-exchange war of step.ts and are not written
 * here. See DECISIONS.md "Rebellion close 14".
 */

/** Campaign kinds (10 section 11). Only `uprising` is started in this build. */
export type CampaignKind = 'conquest' | 'spite' | 'uprising' | 'incited' | 'whispered';
/** Every campaign kind, for the save check (adapter.ts restoreDominions). */
export const CAMPAIGN_KINDS: readonly CampaignKind[] = ['conquest', 'spite', 'uprising', 'incited', 'whispered'];

/** One campaign: the dominions on each side, and the main party of each side (the one that declared, or the first one that joined it). */
export interface Campaign {
  id: number;
  kind: CampaignKind;
  attackers: number[];
  defenders: number[];
  mainAttacker: number;
  mainDefender: number;
  startTick: number;
}

/** The campaign records of one realm. */
export interface CampaignState {
  items: Campaign[];
  nextId: number;
}

/** Plain-data form of the campaign records (DominionSnapshot.campaigns). */
export interface CampaignSnapshot {
  items: Campaign[];
  nextId: number;
}

export function newCampaignState(): CampaignState {
  return { items: [], nextId: 1 };
}
