/**
 * Trait tables of 18b: 144 being traits (marks, belong to one individual) and 154 strain traits
 * (belong to a whole strain). The rows are the spec's data; `fx` holds the effects the sim can
 * express today (stat sources and meta values). Rows without `fx` are data only until their
 * mechanic exists (see DECISIONS.md, "Beings round 2").
 *
 * Being row: id|name|grp|rar|src|inh|xg|effect. `src` B newborn pot, G adulthood pot, A acquired,
 * X event only. `inh` is the percent a parent passes it on, `-` never.
 * Strain row: id|name|grp|rar|pot|inh|xg|effect. `pot` `+` add pot, `-` remove pot. `inh` Y, N, R.
 */

/** Stat keys a trait can add to (flat) or scale (mult, 05 section 3.1). */
export interface TraitFx {
  /** Flat additions to a stat (05 section 1 keys). */
  flat?: Partial<Record<'wit' | 'rapport' | 'valor' | 'husbandry' | 'plating' | 'litter' | 'brood', number>>;
  /** Multiplier fractions (mult_<key>), summed across sources before they apply once. */
  mult?: Partial<Record<'vitality' | 'might' | 'pace' | 'span' | 'metabolism' | 'litter', number>>;
  /** Strain-level meta values (05 section 2 `meta`; 06 section 6.3 pregnancy length). */
  meta?: { gestationMonths?: number; mutation?: number; maturation?: number };
}

export interface BeingTraitDef {
  id: string;
  name: string;
  group: string;
  rarity: 'C' | 'U' | 'R' | 'M';
  src: string;
  /** Percent chance a parent passes the trait on; null = never. */
  inherit: number | null;
  xg: string;
  effect: string;
  fx?: TraitFx;
}

export interface StrainTraitDef {
  id: string;
  name: string;
  group: string;
  rarity: 'C' | 'U' | 'R' | 'M';
  pot: string;
  inherit: 'Y' | 'N' | 'R';
  xg: string;
  effect: string;
  fx?: TraitFx;
}

const BEING_ROWS = `quickwit|Quickwit|MND|U|B|60||Lore +4; reading speed x1.3|wit
dullard|Dullard|MND|C|B|50||Lore -3; build speed x0.9|wit
luminary|Luminary|MND|R|G|40||Lore +8, Parley +2; also lifts Hamlet research|wit
sharptongue|Sharptongue|MND|U|B|50||Parley +4|tongue
bluntspeech|Bluntspeech|MND|C|B|50||Parley -3|tongue
fiery_temper|Fiery Temper|MND|C|B|50||Valor +1; starts fights 20% more often|temper
placid|Placid|MND|C|B|50||Starts fights 50% less; mood +2|temper
stout_nerve|Stout Nerve|MND|C|B|50||Flees only below 15% hp|nerve
craven|Craven|MND|C|B|50||Flees below 60% hp; Valor -1|nerve
wanderlust|Wanderlust|MND|U|B|40||Roams far; migration chance x2|roam
homebody|Homebody|MND|U|B|40||Stays within 12 tiles of dwelling; mood +5 at home|roam
stalwartheart|Stalwartheart|MND|R|B|40||Immune to mind statuses (dread, frenzy, bewildered, hexed)|mindshield
pliant|Pliant|MND|C|B|50||Mind statuses last x2|mindshield
magpie|Magpie|MND|C|B|40||Hoards items; steals unseen from neighbours 3% per Month
aspiring|Aspiring|MND|U|B|45||Valor +1, Lore +1; ruler/leader seeking decisions weight x1.5; mood -3 while not a leader (Folk only)|drive
abiding|Abiding|MND|C|B|45||Mood +3 baseline; ruler/leader seeking weight x0.5; defection and revolt chances -50%|drive
sage|Sage|MND|R|A|-||Lore +5, Parley +3; mood +2 for neighbours within 5 tiles; acquired at age 40+, never inherited|
towering|Towering|BOD|R|B|50|stature|Size class +1, hp +30%, spd -10%
diminutive|Diminutive|BOD|C|B|50|stature|Size class -1, hp -25%, spd +10%
thickhide|Thickhide|BOD|U|B|50|hide|Armour +4
thinhide|Thinhide|BOD|C|B|50|hide|Armour -3
hardy_stock|Hardy Stock|BOD|U|B|55|stock|hp +15%; disease catch chance -20%
sickly|Sickly|BOD|C|B|50|stock|hp -20%; disease catch chance x1.5
swiftfoot|Swiftfoot|BOD|U|B|50|pace|Speed +20%
leadfoot|Leadfoot|BOD|C|B|50|pace|Speed -20%
keen_nose|Keen Nose|BOD|U|B|50||Food and prey detection range x2
broad_lungs|Broad Lungs|BOD|U|B|45||Swim speed +30%; holds breath x2
silt_blooded|Silt-blooded|BOD|R|B|45||Immune to venom and bog statuses
buoyant|Buoyant|BOD|U|B|45||Cannot gasp (drown); water speed x1
hollow_bones|Hollow Bones|BOD|C|B|40||hp -10%, spd +15%; no fall damage
sunmend|Sunmend|BOD|R|B|35||Daytime: 20% chance every 5 s to heal 5-10% hp
brawny|Brawny|BOD|U|B|50||Damage +20%; carry capacity +25%
ironclad|Ironclad|BOD|R|B|35|stunres|Immune to dazed; armour +2 (opposes glass_jaw)
keen_eyed|Keen-eyed|BOD|U|B|50|eyes|Sight range +2 tiles; ranged aim +10%
prolific|Prolific|BOD|U|B|45|fertility|Brood +4 per birth event (06 section 6.4); litter +1
warded_blood|Warded Blood|BOD|R|B|40||Immune to the four afflictions (08 section 8), coughing and ash_sickness
robust_vigor|Robust Vigor|VIT|U|B|55|vigor|hp +40%
frail_vigor|Frail Vigor|VIT|C|B|50|vigor|hp -40%
longlived|Long Span|VIT|U|B|55|span|Lifespan +50%
shortlived|Brief Span|VIT|C|B|50|span|Lifespan -50%
evergreen|Evergreen|VIT|R|G|30|span|Stops ageing at 30 Years
mendflesh|Mendflesh|VIT|R|B|35||20% every 10 s to heal 2% hp (not when hungry or ill)
bloodclot|Bloodclot|VIT|U|B|50||Bleeding statuses end 50% sooner
ironstomach|Ironstomach|VIT|U|B|50||Immune to food-poison; can eat carrion
slow_burn|Slow Burn|VIT|U|B|50|hungerrate|Hunger rate x0.7
glutton|Glutton|VIT|C|B|50|hungerrate|Hunger rate x1.5
lunge|Lunge|SKL|U|G|30||Combat action: leap 3 tiles at target, 2 s cooldown
counterguard|Counterguard|SKL|U|G|30||Combat action: 25% to block a projectile of a blockable kind
sidestep|Sidestep|SKL|U|G|30||Combat action: 20% to evade a hit (melee or projectile)
backhop|Backhop|SKL|U|G|30||Combat action: hops away after being hit, 3 s cooldown
turn_shot|Turn Shot|SKL|R|G|20||Combat action: 30% to deflect a projectile
shieldbash|Shieldbash|SKL|U|G|25||After a parry, stun 1 s
battlecry|Battlecry|SKL|U|G|25||Allies within 4 tiles get dmg +10% for 5 s
riposte|Riposte|SKL|R|G|20||After a parry, counter for 15 dmg
powderhurler|Powderhurler|SKL|R|G|20||Throws powder_flask projectiles
torchhurler|Torchhurler|SKL|R|G|20||Throws pitch_torch projectiles; fire-proof while holding
hearth_luck|Hearth Luck|MER|U|B|40|luck|Crit chance +5%; loot gain x1.1
voracious_reader|Voracious Reader|MER|R|G|35||Reads books 2x faster; each book gives +1 Lore extra
gifted_healer|Gifted Healer|MER|R|B|30||Heals allies 8% hp every 10 s within 3 tiles
inspiring_presence|Inspiring Presence|MER|R|B|25||Allies within 5 tiles: loyalty +, mood +3
master_builder|Master Builder|MER|U|G|40||Build speed x1.5
green_thumb|Green Thumb|MER|U|G|40||Farm output +25%
fleet_trader|Fleet Trader|MER|U|G|40||Trade income +20%
rallying_voice|Rallying Voice|MER|R|G|25||Army of leader: Valor +10%
keen_hunter|Keen Hunter|MER|U|B|45||Damage vs beasts +20%
forge_hands|Forge Hands|MER|U|B|40||Crafted items gain +1 tier 15% of the time
bargainer|Bargainer|MER|U|B|45||Purchases at -10% price
leafwise|Leafwise|MER|U|B|40||Lore +3; plants within 3 tiles grow x1.2
lucky_hide|Lucky Hide|MER|R|B|30|luck|Damage taken -5%, dodge +5% (albino and melanic always carry it)
peacemaker|Peacemaker|MER|R|G|30||Treaty odds +15% when ruler or envoy
seasoned|Seasoned|MER|U|A|-||Granted at more than 10 kills: damage +10%, skill_combat +0.1, Valor +1
ruler_slayer|Ruler-slayer|MER|R|A|-||Granted for killing a ruler: renown +5, Valor +2, mood +10 once
wyrm_slayer|Wyrm-slayer|MER|R|A|-||Granted for killing a flagged monster: Valor +3, mana +10
caster_slayer|Caster-slayer|MER|R|A|-||Granted for killing a being that holds a spell: Lore +2; spell chance of foes -10%
butterfingers|Butterfingers|FLW|C|B|40||Drops carried items 5%; craft quality -1
night_blind|Night-blind|FLW|C|B|40||Vision at night halved
jittery|Jittery|FLW|C|B|40||2% per Month to stumble (stun 1 s)
spendthrift|Spendthrift|FLW|C|B|40||Wastes 10% of resources it handles
quarrelsome|Quarrelsome|FLW|C|B|40|temper|Opinion of others -10; fights more
thin_blooded|Thin-blooded|FLW|C|B|45||Cold damage x1.5
fireshy|Fireshy|FLW|C|B|45||Fire damage x1.5
bad_seed|Bad Seed|FLW|R|B|35||Mood -3, loyalty -20; crime chance up
jinxed|Jinxed|FLW|R|B|30|luck|Crit -5%; wanders into hazards
unquiet|Unquiet|FLW|C|B|40||Needs less sleep; mood -2
glass_jaw|Glass Jaw|FLW|C|B|40|stunres|Stun durations x2
covetous|Covetous|FLW|C|B|40||Steals from stores when hungry
near_sighted|Near-sighted|FLW|C|B|40|eyes|Sight range -3 tiles; ranged aim -10%
fumbling|Fumbling|FLW|C|B|40||Melee hit chance -10%, ranged aim -15%; crit -3%
barren|Barren|FLW|C|B|35|fertility|Cannot breed (litter 0 for pairing purposes); mood -2 inside a Hamlet
dull_reflex|Dull Reflex|FLW|C|B|40||Cannot use combat actions of the advanced pools; defence pools abort for it
scarred|Scarred|ACQ|C|A|-||Valor +1; hp -5%; face scar sprite
limping|Limping|ACQ|C|A|-|limb|Speed x0.75 (leg injury)
one_eyed|One-eyed|ACQ|C|A|-||Aim -20%; sight range x0.7
missing_hand|Missing Hand|ACQ|C|A|-|limb|Damage x0.7
rot_touched|Rot-touched|ACQ|R|A|-|undying|Carries rotting; on death becomes rotstride
spore_lodged|Spore-lodged|ACQ|R|A|-||Spore puff on hit; on death becomes a capstroll host
gnawing_ill|Gnawing Ill|ACQ|U|A|-||Contagious; lifespan -10 Years
frenzied_mind|Frenzied Mind|ACQ|R|A|-||Permanent frenzy: dmg +40% but ignores orders
growth_fever|Growth Fever|ACQ|R|A|-|undying|Skin growths; on death becomes patchbeast
soot_lung|Soot Lung|ACQ|U|A|-||Speed x0.9, stamina x0.8
sunburnt|Sunburnt|ACQ|C|A|-||Daytime desert: hp -10%
hexmarked|Hexmarked|ACQ|R|A|-||Damage x0.8; mood -3; curse residue
campaign_hardened|Campaign-hardened|ACQ|U|A|-||Valor +3 after 5 Campaigns survived
wet_chill|Wet Chill|ACQ|C|A|-||After soaking in cold: speed x0.9 for 2 Months
bloodthirst|Bloodthirst|ACQ|U|A|10||Granted by a first kill in a fight the Being started; mood -1 per Month without a kill
unravelled|Unravelled|ACQ|R|A|-||The mind frays: faction mad, emotion bursts, heals 5% max hp per kill
reaver|Reaver|ACQ|U|A|10||Kills of its own species still yield loot; mood +5 per such kill
vermin_bearer|Vermin-bearer|ACQ|C|A|-||Carries gnawing vermin: plague ticks in crowds of more than 20 under vermin_plague
nightsinger|Nightsinger|QRK|C|B|40||Sings at night; neighbours mood +1
dancing_feet|Dancing Feet|QRK|C|B|40||Dances when mood high; attracts audience
loud_snorer|Loud Snorer|QRK|C|B|40||Neighbours sleep worse
sweet_tooth|Sweet Tooth|QRK|C|B|40||Seeks honey/sweets; mood +3 when fed
tall_tale_teller|Tall-tale Teller|QRK|C|B|40||Spreads Customs faster
prankster|Prankster|QRK|C|B|40||Harmlessly startles neighbours
firework_fan|Firework Fan|QRK|U|B|40||Lights fireworks on celebrations
stone_collector|Stone Collector|QRK|U|B|40||Carries stones; gifts them
fated_hero|Fated Hero|FAT|M|X|-||On losing a Campaign battle: all stats +30% for 60 s
doom_marked|Doom-marked|FAT|M|X|-||Dread aura 5 tiles; dies at a fixed age
second_wind|Second Wind|FAT|R|X|-||Once per life, revives at 30% hp
undying_will|Undying Will|FAT|R|X|-||Cannot be killed by a single hit; hp floor 1 for 3 s
oathbound|Oathbound|FAT|R|X|-||Never betrays ruler; loyalty max
star_born|Star-born|FAT|M|X|-||Lore +10; light aura (comet event)
hearthward|Hearthward|FAT|R|X|-||Dwellings within 8 tiles: mood +2
cursed_line|Cursed Line|FAT|R|A|40||All children born hexmarked
haloed|Haloed|FAT|R|X|-||Architect favour: cannot be hexed; never converted by rage, rot or spore rules
tyrant|Tyrant|FAT|M|A|-||Corrupting mark: a rulerless ageless Folk over 300 Years gains it at 50%; Valor +4, Lore +2
wonder_born|Wonder-born|FAT|M|A|-||Mark given to a Being born by the Architect miracle birth; litter +2 for its parent; never inherited
wonder_bearer|Wonder-bearer|FAT|M|A|-||Mark on a parent that has produced a wonder-born child; blocks a second miracle birth
cinderblood|Cinderblood|ELM|R|B|50|element|Fire-proof; fire damage heals 25% of its amount
rime_marrow|Rime Marrow|ELM|R|B|50|element|Chill-proof; attackers slowed 20% 2 s
dune_stride|Dune Stride|ELM|U|B|50||Ignores sand slowdown; thirst-proof
storm_touched|Storm-touched|ELM|R|B|30|element|Melee chains arc to 1 extra target for 4 dmg
venom_gland|Venom Gland|ELM|R|B|30||Bite applies venomed
sap_blood|Sap Blood|ELM|R|B|30||Plants grow where it bleeds
moonchilded|Moonchilded|ELM|U|B|40|daycycle|Night: dmg +15%, regen; day: dmg -5%
sunchilded|Sunchilded|ELM|U|B|40|daycycle|Day: dmg +10%; night: vision -20%
glimmer_aura|Glimmer Aura|ELM|R|B|20||Light radius 3; undead flinch
echo_voice|Echo Voice|ELM|R|B|20||10% chance a gift effect repeats
mana_wellspring|Mana Wellspring|ELM|R|B|30||Mana +50
hexbreaker|Hexbreaker|ELM|R|B|25||Cures hexed and hexmarked on touch
thorn_skin|Thorn Skin|ELM|R|B|30||Reflects 3 flat melee damage
shadow_cloak|Shadow Cloak|ELM|R|B|20||Unseen beyond 5 tiles while still
ember_hand|Ember Hand|ELM|R|B|20|element|Melee ignites 15%
tidal_gills|Tidal Gills|ELM|U|B|40||Breathes underwater`;

const STRAIN_ROWS = `sparse_kin|Sparse Kin|POP|C|+|Y|pop|meta: strain cap x0.5
loose_kin|Loose Kin|POP|C|+-|Y|pop|meta: strain cap x0.8
dense_kin|Dense Kin|POP|U|+-|Y|pop|meta: strain cap x1.3
teeming_kin|Teeming Kin|POP|R|+|Y|pop|meta: strain cap x1.8; litter -1
memory_lobe|Memory Lobe|COG|R|.|Y||Remembers places; required for awakening
fear_organ|Fear Organ|COG|R|.|Y||Gains fear/flee responses; required for awakening
speech_organ|Speech Organ|COG|R|.|Y||Can speak and form Dialects; required for awakening
planner_lobe|Planner Lobe|COG|R|.|Y||Can plan jobs; required for awakening
swift_learner|Swift Learner|COG|U|+-|Y||Aptitude growth chance +30%
dream_gland|Dream Gland|COG|U|+-|R||Sleepers dream: mood +/-15
herd_mind|Herd Mind|COG|U|+-|Y|cohesion|Group cohesion; follows leader
solitary_mind|Solitary Mind|COG|U|+-|Y|cohesion|Avoids groups; +5% stats alone
cheerful|Cheerful|COG|U|+-|Y||Reflection pot holds only laugh x3, sing, child play; mood +2
stout_gut|Stout Gut|BOD|C|+-|Y||Food stores x1.5
scaled_plates|Scaled Plates|BOD|U|+-|Y||Armour +3
light_frame|Light Frame|BOD|C|+-|Y|frame|hp x0.9, speed x1.1
dense_frame|Dense Frame|BOD|C|+-|Y|frame|hp x1.1, speed x0.9
strong_back|Strong Back|BOD|U|+-|Y||Carry capacity x1.5
deep_lungs|Deep Lungs|BOD|U|+-|Y||Breath hold x2
fine_senses|Fine Senses|BOD|U|+-|Y||Sight range +2 tiles
antlered|Antlered|BOD|U|+-|Y||Counter-hit 15% when attacked
clawed_grip|Clawed Grip|BOD|U|+-|Y||Damage +10%; can climb crag
spined_tail|Spined Tail|BOD|U|+-|Y||Reflects 2 damage
glide_membrane|Glide Membrane|BOD|R|+-|R||Can glide off ledges 6 tiles
long_neck|Long Neck|BOD|U|+-|Y||Sight range +3; reach food in canopy
night_eyes|Night Eyes|BOD|U|+-|Y||Night vision full
big_ears|Big Ears|BOD|U|+-|Y||Hears threats at 2x radius
grazer_gut|Grazer Gut|DIE|C|+|Y|diet|Eats grass and herbs
browser_gut|Browser Gut|DIE|C|+|Y|diet|Eats leaves and shoots
fruit_gut|Fruit Gut|DIE|C|+|Y|diet|Eats fruit and berries
nectar_gut|Nectar Gut|DIE|C|+|Y|diet|Eats nectar and honey
flesh_gut|Flesh Gut|DIE|C|+|Y|diet|Eats meat (hunts)
fish_gut|Fish Gut|DIE|C|+|Y|diet|Eats fish only
carrion_gut|Carrion Gut|DIE|C|+|Y|diet|Eats corpses
omni_gut|Omni Gut|DIE|C|+|Y|diet|Eats plants and meat
kin_eater|Kin-eater|DIE|R|+|N||May eat its own kind; mood -5 near kin
detritus_gut|Detritus Gut|DIE|U|+|Y||Eats rot and fallen leaves; fertilises
grave_bloom|Grave Bloom|REB|U|+-|Y|rebirth|Grows a tree where it dies
ember_return|Ember Return|REB|R|+-|R|rebirth|On death, 20% returns once at 25% hp, burning
soul_seed|Soul Seed|REB|R|+-|R|rebirth|Dies into a seed that sprouts a child
split_self|Split-self|REB|R|+-|N|rebirth|On death splits into 2 half-hp copies once
spore_return|Spore Return|REB|R|+-|R|rebirth|Dies into a spore patch spawning sporeant
swift_growth|Swift Growth|GRO|U|+-|Y|growth|meta: maturation x0.7
slow_growth|Slow Growth|GRO|U|+-|Y|growth|meta: maturation x1.4
late_bloomer|Late Bloomer|GRO|U|+-|Y|growth|Stats grow +20% after adulthood
early_maturity|Early Maturity|GRO|U|+-|Y|growth|Adult at half age, less peak stats
lasting_youth|Lasting Youth|GRO|R|+-|Y|growth|Youth period x2; stat bonus for juveniles
growth_spurt|Growth Spurt|GRO|U|+-|R||Size +10% at adulthood
swift_mending|Swift Mending|GRO|R|+-|Y||Each growth tick removes every removableByHealing mark and cures plague ticks
wool_coat|Wool Coat|BIO|U|+|Y||Drops wool every 3 Months
milk_glands|Milk Glands|BIO|U|+|Y||Produces milk when kept
honey_gland|Honey Gland|BIO|R|+|Y||Produces honey; attracts sweet-seekers
silk_gland|Silk Gland|BIO|R|+|Y||Spins silk; web ability
gem_shell|Gem Shell|BIO|R|+|Y||Drops a gem 5% on death
tallow_fat|Tallow Fat|BIO|U|+|Y||Drops tallow (lamp fuel)
musk_gland|Musk Gland|BIO|U|+|Y||Repels insects; nearby mood -1
pearl_fold|Pearl Fold|BIO|R|+|Y||Aquatic: drops pearl 3% per Month
wild_genes|Wild Genes|CHA|R|+|Y|mutrate|meta: mutation +1
stable_genes|Stable Genes|CHA|U|+-|Y|mutrate|meta: mutation -1
chimeric_blood|Chimeric Blood|CHA|R|+|N||1 random extra being trait at birth
flux_mind|Flux Mind|CHA|R|+|N||Gains a random trait every 10 Years
splinter_line|Splinter Line|CHA|R|+|Y||Enables speciation events (new strain)
echo_genes|Echo Genes|CHA|R|+|N||25% copies both parents' traits
shifting_code|Shifting Code|CHA|R|+|N||Lineage code re-shuffles every 6000-12000 ticks; 1% per birthday at old age to gain a defect
likeness|Likeness|CHA|R|+|N||Children copy parent 1's marks exactly instead of the inheritance draw
ember_gift|Ember Gift|TAL|R|+|R|gift|Casts firebloom spell; kill triggers mage-slayer rumour
arc_gift|Arc Gift|TAL|R|+|R|gift|Casts arc strike (lightning)
rift_gift|Rift Gift|TAL|R|+|R|gift|Blinks short range
gale_gift|Gale Gift|TAL|R|+|R|gift|Summons a small twister
crimson_gift|Crimson Gift|TAL|R|+|R|gift|Rains blood: heals allies, harms foes
mending_gift|Mending Gift|TAL|R|+|R|gift|Cures statuses and heals
ward_gift|Ward Gift|TAL|R|+|R|gift|Casts warded on allies
rime_gift|Rime Gift|TAL|R|+|R|gift|Freezes a target area
briar_gift|Briar Gift|TAL|R|+|R|gift|Roots snare enemies for 3 s
mist_gift|Mist Gift|TAL|R|+|R|gift|Blinds foes in a cloud
quake_gift|Quake Gift|TAL|R|+|R|gift|Ground shock stuns nearby
sun_gift|Sun Gift|TAL|R|+|R|gift|Smites with a beam; heals sunmend carriers
split_sleep|Split Sleep|SLP|C|+|Y|sleep|Sleeps in short rests
one_sleep|One Sleep|SLP|C|+|Y|sleep|Single long sleep
night_cycle|Night Cycle|SLP|C|+|Y|sleep|Sleeps by day, active at night
day_cycle|Day Cycle|SLP|C|+|Y|sleep|Sleeps by night, active by day
light_sleeper|Light Sleeper|SLP|U|+-|Y||Wakes at noise; bonus to alertness
deep_sleeper|Deep Sleeper|SLP|U|+-|Y||Fully rests faster; harder to wake
winter_slumber|Winter Slumber|HIB|U|+|Y|hib|Hibernates when cold
summer_slumber|Summer Slumber|HIB|U|+|Y|hib|Aestivates when hot
long_sleeper|Long Sleeper|HIB|U|+|Y|hib|Needs long rests; recovers fully
energy_saver|Energy Saver|HIB|U|+-|Y||Hunger x0.8 while resting
birth_live|Live Birth|RST|C|.|Y|strategy|Gestation then live young
birth_egg|Egg Laying|RST|C|.|Y|strategy|Lays eggs; see egg traits
birth_budded|Bud-bearing|RST|R|.|Y|strategy|Grows buds that detach as young
birth_rooted|Rooting|RST|R|.|Y|strategy|Roots in place then produces sapling-like young
birth_clonal|Clonal Birth|RST|R|.|Y|strategy|Single-parent copies with variation
birth_spore|Spore Birth|RST|R|.|Y|strategy|Releases spores that seed young nearby
kin_pairs|Kin Pairs|RMT|C|.|Y|method|Two-parent reproduction
single_parent|Single Parent|RMT|U|.|Y|method|One-parent reproduction
dual_nature|Dual Nature|RMT|R|.|Y|method|Any two adults may pair
pair_bond|Pair Bond|RMT|U|+-|Y|method|Lifelong partners; litter +1
harem_breeding|Harem Breeding|RMT|U|+-|Y|method|One male, many females
season_breeding|Season Breeding|RMT|U|+-|Y|method|Breeds only in spring Months
gestation_blink|Blink Gestation|GST|R|+-|Y|gest|meta: pregnancy 1 Month
gestation_brief|Brief Gestation|GST|C|+-|Y|gest|meta: pregnancy 2 Months
gestation_mid|Mid Gestation|GST|C|+-|Y|gest|meta: pregnancy 4 Months
gestation_extended|Extended Gestation|GST|U|+-|Y|gest|meta: pregnancy 7 Months
gestation_vlong|Very Long Gestation|GST|R|+-|Y|gest|meta: pregnancy 12 Months
gestation_stasis|Gestation Stasis|GST|R|+-|Y|gest|Pregnancy pauses when hungry or cold
egg_smooth|Smooth Egg|EGG|C|.|Y|egg|meta: hatch 3 Months
egg_speckled|Speckled Egg|EGG|C|.|Y|egg|meta: hatch 3 Months; camouflage
egg_banded|Banded Egg|EGG|C|.|Y|egg|meta: hatch 3 Months
egg_gelled|Gelled Egg|EGG|C|.|Y|egg|meta: hatch 3 Months; laid in water
egg_stalked|Stalked Egg|EGG|U|.|Y|egg|meta: hatch 4 Months; watches nearby
egg_pearl|Pearl Egg|EGG|U|.|Y|egg|meta: hatch 6 Months
egg_husk|Husk Egg|EGG|U|.|Y|egg|meta: hatch 6 Months; armour +5
egg_geode|Geode Egg|EGG|R|.|Y|egg|meta: hatch 10 Months; armour +8
egg_rime|Rime Egg|EGG|R|.|Y|egg|meta: hatch 8 Months; chills ground
egg_cinder|Cinder Egg|EGG|R|.|Y|egg|meta: hatch 6 Months; sparks on hatch
egg_sporepod|Sporepod Egg|EGG|R|.|Y|egg|meta: hatch 5 Months; releases spores
egg_sugar|Sugar Egg|EGG|U|.|Y|egg|meta: hatch 3 Months; sweet scent
egg_floatsac|Floatsac Egg|EGG|U|.|Y|egg|meta: hatch 1 Month; drifts
egg_squash|Squash Egg|EGG|U|.|Y|egg|meta: hatch 5 Months
skin_spots|Spotted Skin|SKN|U|+-|R|skin|Cosmetic overlay; luck +2%
skin_stripes|Striped Skin|SKN|U|+-|R|skin|Cosmetic overlay; speed +3%
skin_crest|Crested Skin|SKN|U|+-|R|skin|Cosmetic crest; Parley +1 for Folk
skin_patches|Patched Skin|SKN|U|+-|R|skin|Cosmetic overlay; stealth +3%
skin_spined|Spined Skin|SKN|U|+-|R|skin|Cosmetic spines; reflect 1
skin_glossy|Glossy Skin|SKN|U|+-|R|skin|Cosmetic shine; water slowdown -10%
skin_fluffy|Fluffy Skin|SKN|U|+-|R|skin|Cosmetic fluff; cold damage -10%
skin_plated|Plated Skin|SKN|U|+-|R|skin|Cosmetic plates; armour +1
skin_glow|Glowing Skin|SKN|R|+-|R|skin|Emits light; harder to hide
skin_ribbed|Ribbed Skin|SKN|U|+-|R|skin|Cosmetic ribs; hp +3%
photo_sip|Photo-sip|ADP|R|+-|Y||Feeds on sunlight; hunger -50% by day
wet_averse|Wet-averse|ADP|U|+-|Y||Lose hp in water; flee from rain
ember_core|Ember Core|ADP|R|+-|Y||Fire-proof; heals slowly near flame
frost_coat|Frost Coat|ADP|U|+-|Y||Chill-proof
webbed_stride|Webbed Stride|ADP|U|+-|Y||Swims at full speed; mud slowdown ignored
water_hoarder|Water Hoarder|ADP|U|+-|Y||Thirst-proof; desert speed x1
cave_sight|Cave Sight|ADP|U|+-|Y||Sees in dark
salt_tolerance|Salt Tolerance|ADP|U|+-|Y||Thrives on strand and shoal
mud_walker|Mud Walker|ADP|U|+-|Y||Ignores bog slowdown
thin_air|Thin Air|ADP|U|+-|Y||Climbs knoll/crag without stamina drain
short_line|Short Line|FAT|R|+|N|fate|Strain dies out after 8 generations
ascendant_line|Ascendant Line|FAT|M|.|N|fate|Eligible for uplift into a Folk lineage
rooted_line|Rooted Line|FAT|U|+|Y|fate|Never migrates beyond its biome
fading_line|Fading Line|FAT|R|+|N|fate|meta: litter shrinks 1 each generation
elect_line|Elect Line|FAT|M|.|N|fate|All stats +10%; boon only
hue_dawn|Dawn Hue|PHE|C|.|Y|hue|Skin palette: warm rose
hue_dusk|Dusk Hue|PHE|C|.|Y|hue|Skin palette: violet grey
hue_moss|Moss Hue|PHE|C|.|Y|hue|Skin palette: green
hue_clay|Clay Hue|PHE|C|.|Y|hue|Skin palette: terracotta
hue_slate|Slate Hue|PHE|C|.|Y|hue|Skin palette: grey blue
hue_ivory|Ivory Hue|PHE|C|.|Y|hue|Skin palette: pale cream
hue_ember|Ember Hue|PHE|U|.|Y|hue|Skin palette: orange red (biome cinderfields)
hue_frost|Frost Hue|PHE|U|.|Y|hue|Skin palette: icy blue (biome rimewaste)
hue_mire|Mire Hue|PHE|U|.|Y|hue|Skin palette: dark olive (biome sodden_hollow)
hue_plum|Plum Hue|PHE|U|.|Y|hue|Skin palette: purple (biome skyhaven)`;

/** Effects the sim can express now (05 section 3 sources). Keys are trait ids. */
const BEING_FX: Record<string, TraitFx> = {
  quickwit: { flat: { wit: 4 } },
  dullard: { flat: { wit: -3 } },
  luminary: { flat: { wit: 8, rapport: 2 } },
  sharptongue: { flat: { rapport: 4 } },
  bluntspeech: { flat: { rapport: -3 } },
  fiery_temper: { flat: { valor: 1 } },
  aspiring: { flat: { valor: 1, wit: 1 } },
  sage: { flat: { wit: 5, rapport: 3 } },
  towering: { mult: { vitality: 0.3, pace: -0.1 } },
  diminutive: { mult: { vitality: -0.25, pace: 0.1 } },
  thickhide: { flat: { plating: 4 } },
  thinhide: { flat: { plating: -3 } },
  hardy_stock: { mult: { vitality: 0.15 } },
  sickly: { mult: { vitality: -0.2 } },
  swiftfoot: { mult: { pace: 0.2 } },
  leadfoot: { mult: { pace: -0.2 } },
  hollow_bones: { mult: { vitality: -0.1, pace: 0.15 } },
  brawny: { mult: { might: 0.2 } },
  ironclad: { flat: { plating: 2 } },
  prolific: { flat: { brood: 4, litter: 1 } },
  robust_vigor: { mult: { vitality: 0.4 } },
  frail_vigor: { mult: { vitality: -0.4 } },
  longlived: { mult: { span: 0.5 } },
  shortlived: { mult: { span: -0.5 } },
  slow_burn: { mult: { metabolism: -0.3 } },
  glutton: { mult: { metabolism: 0.5 } },
  campaign_hardened: { flat: { valor: 3 } },
  limping: { mult: { pace: -0.25 } },
  missing_hand: { mult: { might: -0.3 } },
  scarred: { flat: { valor: 1 }, mult: { vitality: -0.05 } },
  soot_lung: { mult: { pace: -0.1 } },
  hexmarked: { mult: { might: -0.2 } },
  seasoned: { flat: { valor: 1 }, mult: { might: 0.1 } },
  ruler_slayer: { flat: { valor: 2 } },
  wyrm_slayer: { flat: { valor: 3 } },
  caster_slayer: { flat: { wit: 2 } },
  tyrant: { flat: { valor: 4, wit: 2 } },
  barren: {},
  quarrelsome: {},
  pair_bond: {},
};

const STRAIN_FX: Record<string, TraitFx> = {
  teeming_kin: { flat: { litter: -1 } },
  pair_bond: { flat: { litter: 1 } },
  gestation_blink: { meta: { gestationMonths: 1 } },
  gestation_brief: { meta: { gestationMonths: 2 } },
  gestation_mid: { meta: { gestationMonths: 4 } },
  gestation_extended: { meta: { gestationMonths: 7 } },
  gestation_vlong: { meta: { gestationMonths: 12 } },
  swift_growth: { meta: { maturation: 0.7 } },
  slow_growth: { meta: { maturation: 1.4 } },
  wild_genes: { meta: { mutation: 1 } },
  stable_genes: { meta: { mutation: -1 } },
  light_frame: { mult: { vitality: -0.1, pace: 0.1 } },
  dense_frame: { mult: { vitality: 0.1, pace: -0.1 } },
  elect_line: { mult: { vitality: 0.1, might: 0.1, pace: 0.1 } },
};

function parseRows<T>(text: string, build: (cols: string[]) => T): T[] {
  return text.split('\n').map((line) => build(line.split('|')));
}

function num(s: string | undefined): number | null {
  return s === undefined || s === '-' || s === '' ? null : Number(s);
}

/** The 144 being traits of 18b section 1 (marks). Frozen at module load; the order is the mark index. */
export const BEING_TRAITS: readonly BeingTraitDef[] = parseRows(BEING_ROWS, (c) => {
  const id = c[0] ?? '';
  const fx = BEING_FX[id];
  return {
    id,
    name: c[1] ?? '',
    group: c[2] ?? '',
    rarity: (c[3] ?? 'C') as BeingTraitDef['rarity'],
    src: c[4] ?? '',
    inherit: num(c[5]),
    xg: c[6] ?? '',
    effect: c[7] ?? '',
    ...(fx ? { fx } : {}),
  };
});

/** The 154 strain traits of 18b section 2. */
export const STRAIN_TRAITS: readonly StrainTraitDef[] = parseRows(STRAIN_ROWS, (c) => {
  const id = c[0] ?? '';
  const fx = STRAIN_FX[id];
  return {
    id,
    name: c[1] ?? '',
    group: c[2] ?? '',
    rarity: (c[3] ?? 'C') as StrainTraitDef['rarity'],
    pot: c[4] ?? '',
    inherit: (c[5] ?? 'Y') as StrainTraitDef['inherit'],
    xg: c[6] ?? '',
    effect: c[7] ?? '',
    ...(fx ? { fx } : {}),
  };
});

export const BEING_TRAIT_BY_ID = new Map(BEING_TRAITS.map((t) => [t.id, t]));
export const BEING_TRAIT_INDEX = new Map(BEING_TRAITS.map((t, k) => [t.id, k]));
export const STRAIN_TRAIT_BY_ID = new Map(STRAIN_TRAITS.map((t) => [t.id, t]));

/** Being traits with a birth pot entry (src B), copies by rarity (18b header: C 5, U 3, R 1). */
export const BIRTH_POT: readonly string[] = BEING_TRAITS.flatMap((t) => {
  if (t.src !== 'B') return [];
  const copies = t.rarity === 'C' ? 5 : t.rarity === 'U' ? 3 : 1;
  return Array.from({ length: copies }, () => t.id);
});

/** The four brain organs whose presence awakens a strain (18b section 0, sapience rule). */
export const AWAKENING_TRAITS = ['memory_lobe', 'fear_organ', 'speech_organ', 'planner_lobe'] as const;

/**
 * Strain-level mutation pot for add (`+`) traits, copies by rarity C 10, U 6, R 3, M 1 (18b section 0).
 * Used when a strain's mutation capacity is above zero.
 */
export const STRAIN_MUTATION_POT: readonly string[] = STRAIN_TRAITS.flatMap((t) => {
  if (!t.pot.includes('+')) return [];
  const copies = t.rarity === 'C' ? 10 : t.rarity === 'U' ? 6 : t.rarity === 'R' ? 3 : 1;
  return Array.from({ length: copies }, () => t.id);
});
