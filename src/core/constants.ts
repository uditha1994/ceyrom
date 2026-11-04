/**
 * Board geometry and physical constants, in millimetres / grams / seconds.
 * Dimensions follow the international (ICF) board that Sri Lankan clubs play on.
 * Origin is the board centre, +x to the right, +y towards the bottom player.
 */
export const BOARD = {
  /** Half the playing surface (74 cm square). */
  half: 370,
  /** Visual frame width around the surface. */
  frame: 64,
  /** Pocket radius (4.45 cm diameter). */
  pocketR: 22.25,
  /** Distance from centre to the striker's baseline centre line. */
  baseline: 370 - 101.5 - 15.9,
  /** Half length of the striker's allowed travel along the baseline (between base-circle centres). */
  baseHalf: 235 - 15.9,
  /** Half width of the baseline strip. */
  baseStrip: 15.9,
  centreR: 15.9,
  outerR: 85,
} as const;

export const POCKET_CENTRE = BOARD.half - BOARD.pocketR;

export const POCKETS: ReadonlyArray<{ x: number; y: number }> = [
  { x: -POCKET_CENTRE, y: -POCKET_CENTRE },
  { x: POCKET_CENTRE, y: -POCKET_CENTRE },
  { x: POCKET_CENTRE, y: POCKET_CENTRE },
  { x: -POCKET_CENTRE, y: POCKET_CENTRE },
];

export const COIN_R = 15.5;
export const COIN_MASS = 5.5;
export const STRIKER_R = 20.6;
export const STRIKER_MASS = 15;

export const PHYS = {
  /** Fixed simulation step (seconds). */
  dt: 1 / 240,
  /** Max distance a body may travel in one sub-step (continuous collision safety). */
  maxTravel: 3,
  /** Sliding friction deceleration on a powdered board (mm/s²). */
  friction: 980,
  /** Small velocity-proportional drag (1/s). */
  drag: 0.12,
  /** Angular velocity decay (1/s). */
  spinDecay: 2.6,
  restitutionCoin: 0.9,
  restitutionStriker: 0.86,
  restitutionWall: 0.76,
  /** Tangential friction coefficient at contacts (gives spin + slight throw). */
  contactFriction: 0.06,
  wallFriction: 0.1,
  /** Bodies slower than this stop (mm/s). */
  stopSpeed: 4,
  /** Striker top speed at full power (mm/s). */
  maxShotSpeed: 5000,
  minShotSpeed: 200,
  /** Hard cap on one shot's simulated duration (seconds). */
  maxShotTime: 25,
} as const;

/** Maps the 0..1 power value to launch speed; slightly convex so low power is controllable. */
export function powerToSpeed(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return PHYS.minShotSpeed + (PHYS.maxShotSpeed - PHYS.minShotSpeed) * (0.35 * p + 0.65 * p * p);
}

/** Inverse of powerToSpeed (for the AI). */
export function speedToPower(speed: number): number {
  const s = (speed - PHYS.minShotSpeed) / (PHYS.maxShotSpeed - PHYS.minShotSpeed);
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  // 0.65p² + 0.35p - s = 0
  return (-0.35 + Math.sqrt(0.35 * 0.35 + 4 * 0.65 * s)) / (2 * 0.65);
}
