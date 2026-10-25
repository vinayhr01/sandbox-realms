/**
 * Custom traits (11 section 9.1). A custom holds traits from this catalogue; the spawn rule and the
 * opposites rule are in culture/culture.ts. Rarity weights (TUNE): common 10, uncommon 5, rare 2, locked 0.
 *
 * Row: id|rarity|opposites|effect|status. `opposites` is a comma list, symmetric once parsed. `status` is
 * `live` when the sim applies the effect (culture/effects.ts, culture/trait-rules.ts, settlements/custom-rules.ts,
 * settlements/roads.ts and outward claims, dominions, items/hamlet-gear.ts; DECISIONS.md, "Customs close-out"), or
 * `data` when the trait is held and listed but its mechanic does not exist in this build (the close-out lists why).
 */

export type CustomRarity = 'common' | 'uncommon' | 'rare' | 'locked';

export interface CustomTraitDef {
  id: string;
  rarity: CustomRarity;
  /** Traits this one removes when added, and that remove it (11 section 2). */
  opposites: readonly string[];
  effect: string;
  /** True when the sim applies the effect; false when the trait is data only. */
  live: boolean;
}

const ROWS = `roadworks|uncommon||hamlets build roads (09 section 11.3)|live
outwardGrowth|uncommon||claim also takes free neighbour parcels|live
crowded|uncommon|spacious,swarm|house limit parcels x2 (09 section 5)|live
spacious|uncommon|crowded,swarm|house limit parcels x1/3|live
swarm|uncommon|crowded,spacious|house limit parcels x3|live
towerPride|uncommon||tower limit +4|live
statuePride|uncommon||statue limit +4|live
scatteredBuild|rare||buildings placed first-valid, not centre-first|live
ringPlan|common|crossPlan,lattice2Plan,lattice3Plan,lattice4Plan,checkerPlan,grovePlan|zone rule: dist(zone, centre) mod 2 >= 1|live
crossPlan|common|ringPlan,lattice2Plan,lattice3Plan,lattice4Plan,checkerPlan,grovePlan|zone rule: abs(dx) <= 1 or abs(dy) <= 1|live
lattice2Plan|common|ringPlan,crossPlan,lattice3Plan,lattice4Plan,checkerPlan,grovePlan|zone rule: x mod 2 < 1 or y mod 2 < 1|live
lattice3Plan|common|ringPlan,crossPlan,lattice2Plan,lattice4Plan,checkerPlan,grovePlan|zone rule: x mod 3 < 1 or y mod 3 < 1|live
lattice4Plan|common|ringPlan,crossPlan,lattice2Plan,lattice3Plan,checkerPlan,grovePlan|zone rule: x mod 4 < 1 or y mod 4 < 1|live
checkerPlan|common|ringPlan,crossPlan,lattice2Plan,lattice3Plan,lattice4Plan,grovePlan|zone rule: (x/2 + y/2) mod 2 = 0|live
grovePlan|common|ringPlan,crossPlan,lattice2Plan,lattice3Plan,lattice4Plan,checkerPlan|zone rule: noise(0.7x, 0.7y) > 0.4|live
centeredLot|common|stairLot,wobbleLot|tile in parcel: centre|live
stairLot|common|centeredLot,wobbleLot|tile in parcel: 3 above or below by parity of x+y|live
wobbleLot|common|centeredLot,stairLot|tile in parcel: centre, 60% shift to a neighbour|live
childLabour|uncommon|childShelter|children may work|data
childShelter|uncommon|childLabour|adults gift younger talkers|live
elderRespect|uncommon||adults gift older talkers|live
beastFriends|rare||Folk talk with animals|live
maleLevy|uncommon||only men become soldiers|live
femaleLevy|uncommon||only women become soldiers|live
heritageLore|rare||newborn inherits the parent's best attribute x0.5 + 1|live
swiftStudy|uncommon||xp x2|live
mentorTrade|uncommon||+10 xp each on a good chat|live
deepTraining|rare||level-up grants an extra level|live
bookLovers|uncommon||negative-mood books read as positive|data
eagerReaders|rare||book xp x3|data
chatterCircle|common||50% both inspired after a chat|live
gossipers|common||mood from chats|live
warlikeJoy|rare||campaign start and end mood events|live
convertOrElse|rare||civil attacker below 30% hp on a weak target: 30% defect|live
peaceable|uncommon||blocks declareCampaign; love-of-peace tag|live
serenity|uncommon||blocks declareCampaign|live
insular|uncommon|welcoming|-50 opinion to other strains; razes conquered towns of other lineages|live
kinGuard|uncommon||-50 opinion to same-strain dominions of other customs|live
welcoming|uncommon|insular|+20 opinion to same strain|live
rooted|rare||cannot be replaced by conversion (fight, talk)|live
keepers|rare||blocks divide, schism and divergence|live
patriarchy|uncommon|matriarchy|male first in succession; opposite-sex ruler -50 loyalty|live
matriarchy|uncommon|patriarchy|female first in succession; opposite-sex ruler -50 loyalty|live
youngestFirst|uncommon||succession by age, youngest first|live
envoyLine|uncommon|warLine,fameLine,goldLine|succession by diplomacy|live
warLine|uncommon|envoyLine,fameLine,goldLine|succession by warfare|live
fameLine|uncommon|envoyLine,warLine,goldLine|succession by renown|live
goldLine|uncommon|envoyLine,warLine,fameLine|succession by wealth|live
shatteredCrown|rare||file 10 section 4|live
unbrokenLine|rare||file 10 section 4|live
weaponLovers|common||crafting weight 10 (bow 6)|live
smithMastery|rare||+5 crafting skill|live
craft|rare||allows crafting the unique weapons of 08 section 6.2|live`;

function parse(text: string): CustomTraitDef[] {
  return text.split('\n').map((line) => {
    const [id, rarity, opp, effect, status] = line.split('|');
    if (!id || !rarity || effect === undefined || status === undefined) throw new Error(`customs: bad row ${line}`);
    return {
      id,
      rarity: rarity as CustomRarity,
      opposites: opp ? opp.split(',') : [],
      effect,
      live: status === 'live',
    };
  });
}

/** Opposites are symmetric: if A lists B, B lists A (11 section 2: adding one removes the other). */
function symmetric(defs: CustomTraitDef[]): CustomTraitDef[] {
  const extra = new Map<string, Set<string>>();
  for (const d of defs) {
    for (const o of d.opposites) {
      if (!extra.has(o)) extra.set(o, new Set());
      extra.get(o)?.add(d.id);
    }
  }
  return defs.map((d) => {
    const set = new Set([...d.opposites, ...(extra.get(d.id) ?? [])]);
    set.delete(d.id);
    return { ...d, opposites: [...set] };
  });
}

/** The custom trait catalogue, frozen at module load. The order is the table order. */
export const CUSTOM_TRAITS: readonly CustomTraitDef[] = symmetric(parse(ROWS));

export const CUSTOM_TRAIT_BY_ID = new Map(CUSTOM_TRAITS.map((t) => [t.id, t]));

/** Spawn weight per rarity (TUNE, 11 section 9). Locked traits are never drawn at random. */
export const CUSTOM_RARITY_WEIGHT: Record<CustomRarity, number> = { common: 10, uncommon: 5, rare: 2, locked: 0 };

/** Customs with a live effect in this build. */
export const LIVE_CUSTOM_TRAITS: readonly string[] = CUSTOM_TRAITS.filter((t) => t.live).map((t) => t.id);
