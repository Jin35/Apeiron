/** World-unit grid spacing that lands near `targetPx` on screen. */
export function gridStep(scale: number, targetPx = 96): number {
  const safe = scale > 0 && Number.isFinite(scale) ? scale : 1;
  const target = targetPx / safe;
  const mag = 10 ** Math.floor(Math.log10(target));
  const n = target / mag;
  const mult = n <= 1.5 ? 1 : n <= 3.5 ? 2 : n <= 7.5 ? 5 : 10;
  return mult * mag;
}
