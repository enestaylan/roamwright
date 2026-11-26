import { LEVELS } from './quality-store.js';

const FRAME_MS = 1000 / 60, // the target: sixty frames a second
  SLOW_FPS = 57, // fewer frames than this in a second miss it
  HELD_BACK = 2.5, // frames that come this many times slower than they cost are held back by the browser (a page not in front, a power saver), not by the work
  ROOM = 0.8, // a preset that costs less than this share of a frame holds the target with room to spare
  PROBE_MS = 1000, // how often a frame is timed
  WINDOW = 6, // the timed frames a verdict is drawn from (their median)
  VERDICTS = 2, // the verdicts in a row that step the preset down: one heavy view or one hitch does not
  TRIAL_VERDICTS = 3, // and the roomy ones in a row before the next preset up is tried
  CEILING_MS = 180000, // a drawn size that missed the target is not tried again for this long: the miss may have been a passing load
  // Back off repeated preset trials, since reconfiguring a renderer can itself cause slow frames.
  PRESET_CEILINGS_MS = [60000, 180000, 600000],
  SETTLE_MS = 3000, // allow uploads and shader compilation to settle after reconfiguration
  ARRIVAL_SETTLE_MS = 10000, // initial asset uploads may take longer than a preset change
  SCALES = [1, 0.85, 0.75, 0.67]; // render resolution as a fraction of each viewport dimension
/** Set adaptiveResolution to false to fit quality presets at the application’s native output size. Saved scales are preserved. */
export function createQualityFit({ state, post, cardBlocks, cardDone, store, deviceQuality, applyQuality, setDrawScale, warmShaders, emit, noteLog, adaptiveResolution = true }) {
  const { keepChoice, keepFit, keepScale, keptChoice, keptFit, keptOnce, keptScale } = store;
  const fit = {
    running: false,
    chosen: null, // the preset chosen by hand, if it is not the suggested one
    suggested: 'high',
    ceiling: LEVELS.length - 1, // the highest preset worth trying for now, and when the presets above it may be tried again
    ceilingUntil: 0,
    misses: 0, // how often a preset has missed the target in this visit
    costs: [], // the timed frames of the window, in milliseconds
    timing: null, // the frame being timed: when its script began, and when the card had finished what came before it
    frames: 0, // the frames drawn since the window began, and when it began
    since: 0,
    next: 0, // when the next frame is timed
    slow: 0, // verdicts in a row that the preset is too heavy, and that it leaves room
    roomy: 0,
    scaleAt: 0, // the index in SCALES of the share the world is drawn at
    scaleTop: 0, // the largest share worth trying for now (its index), and when the larger ones may be tried again
    scaleTopUntil: 0,
  };

  // Applies a preset, drawn at SCALES[scaleAt], and begins timing afresh once the world has been made again for it.
  function change(name, scaleAt = 0) {
    fit.scaleAt = adaptiveResolution ? scaleAt : 0;
    if (adaptiveResolution) setDrawScale(SCALES[fit.scaleAt], true); // applyQuality sizes the picture
    applyQuality(name);
    if (adaptiveResolution) keepScale(name, SCALES[fit.scaleAt]);
    warmShaders();
    rest();
  }
  // The world is drawn at SCALES[at] of each side.
  function setScale(at) {
    fit.scaleAt = at;
    keepScale(state.quality, SCALES[at]);
    setDrawScale(SCALES[at]); // a resize, which begins the timing afresh
  }
  // May the fit draw the world smaller rather than step down? Where post-processing draws it, at Medium, or at a preset chosen by hand.
  const scalable = () => adaptiveResolution && post.on && (!!fit.chosen || state.quality === 'medium');
  function rest() {
    fit.timing = null;
    fit.costs.length = 0;
    fit.frames = 0;
    fit.slow = fit.roomy = 0;
    fit.next = performance.now() + SETTLE_MS;
  }
  // Exclude initial uploads and compilation from steady-state frame timings.
  function settleQuality() {
    rest();
    fit.next = performance.now() + ARRIVAL_SETTLE_MS;
  }
  // A picture of another size is another load, and the change itself costs frames (a phone turned on its side): what was
  // timed before it is forgotten.

  // Opens with the preset chosen by hand, else the one that fitted last time, else the guess from the device; or, on a page that
  // loaded itself afresh because the card dropped its picture, with the lower one that page asked for, for this page only.
  function startQuality() {
    const chosen = keptChoice();
    fit.suggested = keptFit() ?? deviceQuality();
    fit.chosen = chosen;
    fit.running = true;
    const name = keptOnce(true) ?? fit.chosen ?? fit.suggested;
    fit.scaleAt = adaptiveResolution ? Math.max(0, SCALES.indexOf(keptScale(name))) : 0;
    if (adaptiveResolution) setDrawScale(SCALES[fit.scaleAt], true);
    applyQuality(name);
    rest();
  }
  // The preset suggested for this device.
  const suggestedQuality = () => fit.suggested;
  // A preset chosen by hand is kept in the browser and holds on every later visit, whatever the device is found to hold and
  // whichever build is out; null goes back to following the device.
  function chooseQuality(name) {
    fit.chosen = name;
    keepChoice(name);
    change(name ?? fit.suggested);
  }
  // How long the graphics card worked on the frame timed last, in milliseconds; null until one has been timed.
  const cardTime = () => fit.card ?? null;
  // The preset chosen by hand, if one was.
  const chosenQuality = () => fit.chosen;
  // Stops or resumes the fitting, for a measurement that must keep one preset.
  function holdQuality(held) {
    fit.running = !held;
    rest();
  }
  // The suggestion moves to LEVELS[level]: applied, unless another preset was chosen by hand.
  function suggest(level) {
    const name = LEVELS[level];
    if (name === fit.suggested) return;
    fit.suggested = name;
    keepFit(name);
    if (fit.chosen || state.quality === name)
      emit('quality', state.quality); // only the suggestion shown beside it changes
    else if (level > LEVELS.indexOf(state.quality) && name === 'medium')
      change(name, SCALES.length - 1); // Medium is tried from below at its smallest, and drawn larger as frames allow
    else change(name);
  }
  // Called at the start of every frame: is this one to be timed? If so, a fence goes into the card's queue before it.
  function probeDue(now) {
    if (!fit.running) return false;
    if (fit.frames++ === 0) fit.since = now;
    if (now < fit.next || fit.timing) return false;
    fit.timing = { began: performance.now(), before: cardDone() };
    return true;
  }
  // A timed frame has been handed over (it began at `now` on the frame clock). Its cost is known once the card has drawn it:
  // from when the script began, or from when the card was free of earlier frames if that came later, until the card was done.
  function probed(now) {
    const timing = fit.timing,
      handed = performance.now();
    Promise.all([timing.before, cardDone()]).then(([before, after]) => {
      if (fit.timing !== timing) return; // the fitting was stopped or begun afresh meanwhile
      fit.timing = null;
      if (before.gaveUp || after.gaveUp) {
        fit.next = now + PROBE_MS; // no answer from the card this time: nothing is learnt from this frame
        return;
      }
      const script = handed - timing.began,
        // where the wait stops the script, the time between the two waits is the script's work and then the card's
        card = cardBlocks() ? after.at - before.at - script : after.at - (before.prompt ? timing.began : before.at);
      fit.card = Math.max(0, card);
      verdict(Math.max(script, card), now);
    });
  }
  // Frames too slow for the preset: a performance problem in the page's log, with what was measured and what the fit does.
  function slowNoted(cost, fps, at) {
    const does =
      scalable() && fit.scaleAt < SCALES.length - 1
        ? `drawn smaller, at ${SCALES[fit.scaleAt + 1]} of each side`
        : at > 0
          ? `stepped down to ${LEVELS[at - 1]}${fit.chosen ? ' as suggested (the preset chosen by hand stays)' : ''}`
          : 'already at the lowest preset';
    noteLog(
      'perf',
      `frames too slow: ${cost.toFixed(1)} ms a frame, ${fps.toFixed(0)} shown a second, at ${state.quality} drawn at ${SCALES[fit.scaleAt]}: ${does}`,
    );
  }
  // A timed frame's cost joins the window. When the window is full, its verdict.
  function verdict(frameCost, now) {
    fit.costs.push(frameCost);
    fit.next = now + PROBE_MS;
    if (fit.costs.length < WINDOW) return;
    const cost = fit.costs.sort((firstCost, secondCost) => firstCost - secondCost)[WINDOW >> 1],
      fps = ((fit.frames - 1) * 1000) / (now - fit.since),
      at = LEVELS.indexOf(state.quality);
    fit.costs.length = 0;
    fit.frames = 0;
    // too heavy: fewer than sixty frames are being shown, and not because the browser holds back frames that cost little
    fit.slow = cost > FRAME_MS * ROOM && fps < SLOW_FPS && 1000 / fps < cost * HELD_BACK ? fit.slow + 1 : 0;
    fit.roomy = cost < FRAME_MS * ROOM ? fit.roomy + 1 : 0;
    if (now > fit.ceilingUntil) fit.ceiling = LEVELS.length - 1;
    if (now > fit.scaleTopUntil) fit.scaleTop = 0;
    if (fit.slow >= VERDICTS) slowNoted(cost, fps, at);
    if (fit.slow >= VERDICTS && scalable() && fit.scaleAt < SCALES.length - 1) {
      fit.slow = 0;
      fit.scaleTop = fit.scaleAt + 1;
      fit.scaleTopUntil = now + CEILING_MS;
      setScale(fit.scaleAt + 1);
    } else if (fit.slow >= VERDICTS) {
      fit.slow = 0;
      fit.ceiling = Math.max(0, at - 1);
      fit.ceilingUntil = now + PRESET_CEILINGS_MS[Math.min(fit.misses++, PRESET_CEILINGS_MS.length - 1)];
      suggest(Math.min(LEVELS.indexOf(fit.suggested), fit.ceiling));
    } else if (fit.roomy >= TRIAL_VERDICTS && fit.scaleAt > fit.scaleTop) {
      fit.roomy = 0;
      setScale(fit.scaleAt - 1);
    } else if (fit.chosen) {
      if (cost <= FRAME_MS && at > LEVELS.indexOf(fit.suggested)) suggest(at); // chosen by hand above the suggestion, and it holds
    } else if (fit.roomy >= TRIAL_VERDICTS && at < fit.ceiling && fit.scaleAt === 0) {
      fit.roomy = 0;
      suggest(at + 1);
    }
  }
  return { cardTime, chooseQuality, chosenQuality, holdQuality, probeDue, probed, settleQuality, startQuality, suggestedQuality, rest };
}
