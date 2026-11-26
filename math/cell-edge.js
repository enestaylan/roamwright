// Distance (in texture units) from (u, v) to the nearest edge of a tileable pattern of `period` jittered cells per side; `site`, when
// given, is told which cell (u, v) lies in, wrapped to the tile.
export function cellEdge(hash2, u, v, period, seed, site) {
  const gx = u * period,
    gz = v * period,
    ix = Math.floor(gx),
    iz = Math.floor(gz);
  let d1 = 9,
    d2 = 9,
    ax = 0,
    az = 0,
    bx = 0,
    bz = 0;
  for (let offsetZ = -1; offsetZ <= 1; offsetZ++)
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const cx = ix + offsetX,
        cz = iz + offsetZ,
        wx = ((cx % period) + period) % period,
        wz = ((cz % period) + period) % period;
      const sx = cx + 0.15 + 0.7 * hash2(wx, wz, seed),
        sz = cz + 0.15 + 0.7 * hash2(wx, wz, seed + 1),
        distanceSquared = (sx - gx) ** 2 + (sz - gz) ** 2;
      if (distanceSquared < d1) {
        if (site) {
          site[0] = wx;
          site[1] = wz;
        }
        d2 = d1;
        bx = ax;
        bz = az;
        d1 = distanceSquared;
        ax = sx;
        az = sz;
      } else if (distanceSquared < d2) {
        d2 = distanceSquared;
        bx = sx;
        bz = sz;
      }
    }
  const ex = bx - ax,
    ez = bz - az,
    l = Math.hypot(ex, ez) || 1;
  return (((ax + bx) * 0.5 - gx) * ex + ((az + bz) * 0.5 - gz) * ez) / l / period;
}
