// Distance (in texture units) from (u, v) to the nearest edge of a tileable pattern of `per` x `per` jittered cells; `site`, when
// given, is told which cell (u, v) lies in, wrapped to the tile.
export function cellEdge(hash2, u, v, per, seed, site) {
  const gx = u * per,
    gz = v * per,
    ix = Math.floor(gx),
    iz = Math.floor(gz);
  let d1 = 9,
    d2 = 9,
    ax = 0,
    az = 0,
    bx = 0,
    bz = 0;
  for (let b = -1; b <= 1; b++)
    for (let a = -1; a <= 1; a++) {
      const cx = ix + a,
        cz = iz + b,
        wx = ((cx % per) + per) % per,
        wz = ((cz % per) + per) % per;
      const sx = cx + 0.15 + 0.7 * hash2(wx, wz, seed),
        sz = cz + 0.15 + 0.7 * hash2(wx, wz, seed + 1),
        d = (sx - gx) ** 2 + (sz - gz) ** 2;
      if (d < d1) {
        if (site) {
          site[0] = wx;
          site[1] = wz;
        }
        d2 = d1;
        bx = ax;
        bz = az;
        d1 = d;
        ax = sx;
        az = sz;
      } else if (d < d2) {
        d2 = d;
        bx = sx;
        bz = sz;
      }
    }
  const ex = bx - ax,
    ez = bz - az,
    l = Math.hypot(ex, ez) || 1;
  return (((ax + bx) * 0.5 - gx) * ex + ((az + bz) * 0.5 - gz) * ez) / l / per;
}
