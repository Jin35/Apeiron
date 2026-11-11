/** The front finishes fading at `1 / INTERNALS_SCALE` of the opening fit. */
export const INTERNALS_SCALE = 0.625;

/** Shared end of every reveal range, and the `?into=1` multiplier. */
export const REVEAL_END = 1 / INTERNALS_SCALE;

export const REVEAL = [1, REVEAL_END] as const;
