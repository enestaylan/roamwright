// A timer also releases the caller when animation frames are suspended.
export const nextFrame = (maxWaitMs = 50) =>
  new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve();
    };
    const timer = setTimeout(done, maxWaitMs),
      frame = requestAnimationFrame(done);
  });
// A promise kept once the next frame has been painted: a task queued from the frame's own callback runs after its paint. What
// was just put on the page is then on the screen before a long job begins.
export const painted = (maxWaitMs = 50) => nextFrame(maxWaitMs).then(() => new Promise(resolve => setTimeout(resolve, 0)));
