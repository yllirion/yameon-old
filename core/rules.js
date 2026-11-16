// Tunable rule switches. Every place where the design doc is ambiguous is a flag here.
export const RULES = {
  pilotDice: 6,
  maxOverheat: 6,
  arcDegrees: 120,            // confirmed: front arc = 120°
  arcBoundaryInclusive: true, // OPEN: is a target exactly on the ±60° line inside the arc?
  tieBreakFirstPlayer: 1,     // confirmed: tie in class → player 1 activates first
  bands: { short: [1, 2], medium: [3, 5], long: [6, 9] },
  backStepCost: 3,
  allowedStepOffsets: [-1, 0, 1], // OPEN: which hexes ahead a mech may step into (relative to facing)
  critAddsDamage: false,          // confirmed: a crit is only a crit (no extra damage point)
  discardedDiceStoreEvade: true,  // confirmed: a discarded die keeps its evade (only its main value is lost)
  buildingDamageAccumulates: false, // OPEN: the doc says building damage does not accumulate → 4 damage in ONE attack needed
  ignoreEvadeCorrection: false,   // hidden in the UI: spending a correction to ignore one evade token (engine mode 'ignoreEvade' is kept)
  gaMaxRadius: 4,                 // ASSUMPTION: GA radius is chosen 1..4
  gaOverheatTokens: true,         // OPEN: GA radius → overheat TOKENS at once (user's wording); false → plain heat of the activation (design doc wording)
  blindRangePenalty: 2,           // each blind token shortens the maximum range by 2
  overheatForcesShutdown: true,   // OPEN: overflow (>6) forces emergency shutdown next activation
};
