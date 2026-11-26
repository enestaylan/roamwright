/**
 * Forward playback of cues in chronological order, including ties in their authored order.
 * Each cue is an array starting with its timestamp in seconds. The caller owns the cue list
 * and the clock. Use a separate cursor per playback and reset it before replay or a new list.
 */
export class CueCursor {
  /** Index of the next cue, also available to handlers that look ahead during dispatch. */
  nextIndex = 0;

  /** Restart at the first cue. */
  reset() {
    this.nextIndex = 0;
  }

  /** Deliver undelivered cues through `seconds`, advancing the cursor before each callback. */
  advance(cues, seconds, dispatch) {
    while (this.nextIndex < cues.length && cues[this.nextIndex][0] <= seconds) {
      dispatch(cues[this.nextIndex++]);
    }
  }
}
