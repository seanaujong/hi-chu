// Real per-move targeting that `@smogon/calc` doesn't carry — `damage.ts`'s
// `evaluateMoveFailure` corrects the calc's `Move.target` with this before handing a target
// string to `movefails.ts`.
//
// @smogon/calc has no notion of move targeting beyond a handful of entries it added for its
// own doubles spread-damage multiplier (Earthquake and a few others) — every other move,
// Status-category ones included, reads back `target: 'any'` (opponent-directed) regardless of
// what it actually does. That's simply wrong for most Status moves: a self-buff (Swords
// Dance), a heal (Recover), a screen (Reflect), a hazard (Stealth Rock) never reaches the
// defender `evaluateMoveFailure` asks about. Read at face value, the calc's 'any' plants a
// false type/status immunity on the tooltip whenever the move's own TYPE happens to sit on one
// of the type chart's few 0x pairs (Ghost↔Normal, Fighting→Ghost, Electric→Ground,
// Poison→Steel, Psychic→Dark, Dragon→Fairy) and the foe actually being hovered carries the
// immune type — first caught on Curse (Ghost-typed, self-targeting for every non-Ghost user),
// then again on Dragon Dance (Dragon-typed, always self-targeting) misreading "no effect" into
// a Fairy-type foe.
//
// MEASURED against Showdown's own dex across every gen this codebase calcs for (`npm run
// status-move-data`), the same discipline `movefails.ts`'s INFLICTS_STATUS/POWDER_MOVES tables
// and `choiceitems.ts`'s PAIRS_WITH_CHOICE hold themselves to — a rarity and a hand-recalled
// omission look identical from the outside. A handful of moves (Conversion, Mirror Move,
// Nature Power) target the opponent in some gens and not others; each is included here, so an
// old-gen reading of one goes quiet rather than risking a false claim in the modern gen most
// hovers are actually in — "prefer missing a rule-out to making a false one" cuts the same way
// here as it does for `deductions.ts`'s behavioural rule-outs.
//
// Curse is deliberately ABSENT: its real target is `'normal'` (opponent-directed) in the base
// case, and its actual self-targeting is conditional on the USER's own type — no static
// per-move table can express that, so it's handled separately by `damage.ts`'s `curseTarget`.
export const NON_OPPONENT_TARGET_MOVES: ReadonlySet<string> = new Set([
  'acidarmor', 'acupressure', 'agility', 'allyswitch', 'amnesia', 'aquaring', 'aromatherapy',
  'aromaticmist', 'assist', 'auroraveil', 'autotomize', 'banefulbunker', 'barrier', 'batonpass',
  'bellydrum', 'bulkup', 'burningbulwark', 'calmmind', 'camouflage', 'celebrate', 'charge',
  'chillyreception', 'clangoroussoul', 'coaching', 'coil', 'conversion', 'copycat',
  'corrosivegas', 'cosmicpower', 'cottonguard', 'courtchange', 'craftyshield', 'defendorder',
  'defensecurl', 'destinybond', 'detect', 'doubleteam', 'dragoncheer', 'dragondance',
  'electricterrain', 'endure', 'extremeevoboost', 'fairylock', 'filletaway', 'flowershield',
  'focusenergy', 'followme', 'gearup', 'geomancy', 'grassyterrain', 'gravity', 'growth',
  'grudge', 'hail', 'happyhour', 'harden', 'haze', 'healbell', 'healingwish', 'healorder',
  'helpinghand', 'holdhands', 'honeclaws', 'howl', 'imprison', 'ingrain', 'iondeluge',
  'irondefense', 'junglehealing', 'kingsshield', 'laserfocus', 'lifedew', 'lightscreen',
  'luckychant', 'lunarblessing', 'lunardance', 'magiccoat', 'magicroom', 'magneticflux',
  'magnetrise', 'matblock', 'maxguard', 'meditate', 'metronome', 'milkdrink', 'minimize',
  'mirrormove', 'mist', 'mistyterrain', 'moonlight', 'morningsun', 'mudsport', 'nastyplot',
  'naturepower', 'noretreat', 'obstruct', 'perishsong', 'powershift', 'powertrick', 'protect',
  'psychicterrain', 'quickguard', 'quiverdance', 'ragepowder', 'raindance', 'recover', 'recycle',
  'reflect', 'refresh', 'rest', 'revivalblessing', 'rockpolish', 'roost', 'rototiller',
  'safeguard', 'sandstorm', 'sharpen', 'shedtail', 'shellsmash', 'shelter', 'shiftgear',
  'shoreup', 'silktrap', 'slackoff', 'sleeptalk', 'snatch', 'snowscape', 'softboiled', 'spikes',
  'spikyshield', 'splash', 'stealthrock', 'stickyweb', 'stockpile', 'stuffcheeks', 'substitute',
  'sunnyday', 'swallow', 'swordsdance', 'synthesis', 'tailglow', 'tailwind', 'takeheart',
  'teatime', 'teeterdance', 'teleport', 'tidyup', 'toxicspikes', 'trickroom', 'victorydance',
  'watersport', 'wideguard', 'wish', 'withdraw', 'wonderroom', 'workup',
]);
