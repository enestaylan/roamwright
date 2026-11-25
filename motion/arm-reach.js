import * as THREE from 'three';
import { clamp } from '../math/scalar.js';

/**
 * `createArmReach({elbowDirection,minBend,maxBend})` returns a solver for a negative-Y upper arm with an X-hinged
 * forearm. Call it with the upper arm, forearm, hand, item rest offset, local grip, world target, side (−1 or 1) and
 * blend weight (0–1) after updating the shoulder parent’s world matrix. Bend limits are radians. The elbow direction
 * is in the shoulder parent’s frame, mirrored by side on X.
 */
export function createArmReach({ elbowDirection, minBend, maxBend }) {
  const _to = new THREE.Vector3(), // scratch
    _end = new THREE.Vector3(),
    _g = new THREE.Vector3(),
    _elbow = new THREE.Vector3(),
    _want = new THREE.Vector3(),
    _a = new THREE.Vector3(),
    _b = new THREE.Vector3(),
    _size = new THREE.Vector3(),
    _hand = new THREE.Matrix4(),
    _item = new THREE.Matrix4(),
    _inv = new THREE.Matrix4(),
    _q = new THREE.Quaternion(),
    _swivel = new THREE.Quaternion(),
    _x = new THREE.Quaternion(),
    NONE = new THREE.Quaternion(),
    X_AXIS = new THREE.Vector3(1, 0, 0);

  // Turns the upper arm `arm` and the forearm `fore` of one side (s: 1 the right, -1 the left) by weight k toward the pose in which
  // the point `grip` (in the own space of the bone of what the hand `hand` holds, taken at its place `rest` and unturned)
  // comes to `target` in the world. The arm's parent's world matrix must be current.
  function reachArm(arm, fore, hand, rest, grip, target, s, k) {
    if (k <= 0) return;
    // the target from the shoulder, in the frame the arm hangs in
    _inv.copy(arm.parent.matrixWorld).invert();
    _to.copy(target).applyMatrix4(_inv).sub(arm.position);
    // what the hand holds at `grip`, in the forearm's frame: through the hand as it is turned, and the held bone as it rests
    hand.updateMatrix();
    _item.compose(rest, NONE, _size.setScalar(1 / hand.scale.x)); // what is held keeps its own size in a larger hand, shown or not
    _g.copy(grip).applyMatrix4(_item).applyMatrix4(_hand.copy(hand.matrix));
    // the elbow's bend that puts the grip as far from the shoulder as the target is (or as far as the arm reaches)
    const l1 = -fore.position.y,
      rho = Math.hypot(_g.y, _g.z),
      phi = Math.atan2(_g.z, _g.y);
    if (l1 <= 0 || rho <= Number.EPSILON) return;
    const far = _to.length(),
      c = clamp((_g.x * _g.x + l1 * l1 + rho * rho - far * far) / (2 * l1 * rho), -1, 1),
      turn = Math.acos(c);
    let bend = turn - phi;
    bend = Math.atan2(Math.sin(bend), Math.cos(bend));
    if (bend > maxBend || bend < minBend) {
      const other = Math.atan2(Math.sin(-turn - phi), Math.cos(-turn - phi));
      if (Math.abs(other - (maxBend + minBend) / 2) < Math.abs(bend - (maxBend + minBend) / 2)) bend = other;
    }
    bend = clamp(bend, minBend, maxBend);
    // the end of the arm so bent, in the upper arm's own frame, turned onto the target, then swung about the line to the target
    // until the elbow is as near as it gets to where an elbow goes
    _x.setFromAxisAngle(X_AXIS, bend);
    _end.copy(_g).applyQuaternion(_x).add(fore.position);
    _q.setFromUnitVectors(_a.copy(_end).normalize(), _b.copy(_to).normalize());
    _elbow.copy(fore.position).applyQuaternion(_q);
    _want.set(s * elbowDirection[0], elbowDirection[1], elbowDirection[2]);
    _elbow.addScaledVector(_b, -_elbow.dot(_b));
    _want.addScaledVector(_b, -_want.dot(_b));
    if (_elbow.lengthSq() > 1e-10 && _want.lengthSq() > 1e-10) {
      _elbow.normalize();
      _want.normalize();
      const swing = Math.atan2(_a.crossVectors(_elbow, _want).dot(_b), _elbow.dot(_want));
      _q.premultiply(_swivel.setFromAxisAngle(_b, swing));
    }
    arm.quaternion.slerp(_q, k);
    fore.rotation.x += (bend - fore.rotation.x) * k;
  }
  return reachArm;
}
