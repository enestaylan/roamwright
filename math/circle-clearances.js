// Largest radii that leave a fraction of each centre-to-centre distance clear.
// Positions are in the x-z plane. Calculate once when laying out a group.
// A lone centre has unlimited clearance. Coincident centres have none.
export function circleClearances(centres, gapFraction = 0) {
  if (!(gapFraction >= 0 && gapFraction < 1)) throw new RangeError('gapFraction must be in [0, 1)');
  const nearestSq = new Float64Array(centres.length).fill(Infinity);
  for (let i = 0; i < centres.length; i++) {
    const a = centres[i];
    for (let j = i + 1; j < centres.length; j++) {
      const b = centres[j];
      const distanceSq = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
      nearestSq[i] = Math.min(nearestSq[i], distanceSq);
      nearestSq[j] = Math.min(nearestSq[j], distanceSq);
    }
  }
  const share = (1 - gapFraction) / 2;
  for (let i = 0; i < nearestSq.length; i++) nearestSq[i] = Math.sqrt(nearestSq[i]) * share;
  return nearestSq;
}
