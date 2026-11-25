export function createDailyClock({ getFrame, getHour, jumpHours = 0.05 }) {
  const clock = { frame: -1, hour: 0, cut: true };

  // The hour shown this frame, worked out once a frame, and whether the clock was turned since the last (a cut: what follows the clock
  // may then change in view).
  function now() {
    const frame = getFrame();
    if (clock.frame !== frame) {
      const hour = getHour();
      let moved = Math.abs(hour - clock.hour);
      if (moved > 12) moved = 24 - moved;
      clock.cut = clock.frame < 0 || moved > jumpHours;
      clock.hour = hour;
      clock.frame = frame;
    }
    return clock;
  }
  const hourNow = () => now().hour;
  const clockTurned = () => now().cut;

  // A span of the day from one ramp to another, as the hours of the one that comes first and goes first (rank 0) and of the last
  // (rank 1); one that runs over midnight is counted on into the next day.
  function spanOf(from, to, h, rank) {
    const a = from[0] + rank * (from[1] - from[0]);
    let b = to[0] + rank * (to[1] - to[0]);
    if (b < a) {
      b += 24;
      if (h < a) h += 24;
    }
    return h >= a && h < b;
  }
  // Whether one of rank `rank` is out now in a span [from, to] of ramps, and will still be out `ahead` hours from now (one that
  // needs that long to get in goes in so much sooner).
  function isOut(from, to, rank, ahead = 0) {
    const h = hourNow();
    return spanOf(from, to, h, rank) && spanOf(from, to, (h + ahead) % 24, rank);
  }
  // The share of a kind that is out at hour h: from none before `from` begins to all once it ends, and back to none over `to`.
  function shareOut(from, to, h = hourNow()) {
    const up = from[1] - from[0] || 1e-3,
      down = to[1] - to[0] || 1e-3;
    let t = h,
      end = to[0];
    if (end < from[0]) {
      end += 24;
      if (t < from[0]) t += 24;
    }
    const came = Math.min(1, Math.max(0, (t - from[0]) / up)),
      gone = Math.min(1, Math.max(0, (t - end) / down));
    return came - gone;
  }

  // The hours between two hours of the day, the short way round.
  const hoursApart = (a, b) => {
    const d = Math.abs(a - b) % 24;
    return d > 12 ? 24 - d : d;
  };
  return { hourNow, clockTurned, isOut, shareOut, hoursApart };
}
