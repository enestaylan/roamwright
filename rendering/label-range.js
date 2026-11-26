import { Vector3 } from 'three';
import { sstep } from '../math/scalar.js';

/** Fade world labels between two camera distances, in world units. */
export function createLabelRange(near, far) {
  if (!(near >= 0 && near < far && Number.isFinite(far))) throw new RangeError('Label distances must satisfy 0 <= near < far');
  const screen = new Vector3();

  // A subject may have a shorter reading range with the same relative fade.
  function opacity(distance, limit = far) {
    const end = Math.min(limit, far);
    return end > 0 ? sstep(end, end * (near / far), distance) : 0;
  }

  /** One selection per group. Offer members as they are positioned for the current frame. */
  function selection() {
    let lastFrame, nearestSq = Infinity;
    return {
      // Rank by the subject's position and test the label's attachment point against the camera frustum.
      // The caller keeps the accepted subject. A tie retains the first one offered.
      accept(frame, camera, x, y, z, labelY = y) {
        const eye = camera.matrixWorld.elements;
        const dx = x - eye[12], dy = y - eye[13], dz = z - eye[14];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= far * far || (frame === lastFrame && d2 >= nearestSq)) return false;
        screen.set(x, labelY, z).project(camera);
        if (Math.abs(screen.x) >= 1 || Math.abs(screen.y) >= 1 || Math.abs(screen.z) >= 1) return false;
        lastFrame = frame;
        nearestSq = d2;
        return true;
      },
      distance(frame) {
        return frame === lastFrame ? Math.sqrt(nearestSq) : Infinity;
      },
    };
  }
  return { far, opacity, selection };
}
