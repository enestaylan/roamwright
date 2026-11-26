// ════════════════════════════════════════════════════════════════════════
//  An instance's matrix written straight into an instanced mesh's matrices (16 numbers starting at `offset`), for code that places
//  thousands of instances a frame (crowds, herds, flocks). The transform places each instance at (x, y, z), of size s, turned by ry about
//  the vertical and then rx and rz in Three.js's 'YXZ' order, as TRS(x, y, z, s, s, s, ry, rx, rz) composes it, without its
//  Euler angles and quaternion on the way. The placement is an object the caller makes once and fills in for each instance:
//  numbers handed over one by one to a function the engine does not take into its caller whole are made anew at every call.
// ════════════════════════════════════════════════════════════════════════
const placement = () => ({ x: 0, y: 0, z: 0, s: 1, ry: 0, rx: 0, rz: 0 });

// Turned and tipped (rx), not rolled: a person of a crowd, standing or fallen, a beast of a herd.
function placeAt(matrices, offset, transform) {
  const scale = transform.s,
    scaledCosPitch = Math.cos(transform.rx) * scale,
    sinPitch = Math.sin(transform.rx),
    cosYaw = Math.cos(transform.ry),
    sinYaw = Math.sin(transform.ry);
  matrices[offset] = cosYaw * scale;
  matrices[offset + 1] = 0;
  matrices[offset + 2] = -sinYaw * scale;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = sinYaw * sinPitch * scale;
  matrices[offset + 5] = scaledCosPitch;
  matrices[offset + 6] = cosYaw * sinPitch * scale;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = scaledCosPitch * sinYaw;
  matrices[offset + 9] = -sinPitch * scale;
  matrices[offset + 10] = scaledCosPitch * cosYaw;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = transform.x;
  matrices[offset + 13] = transform.y;
  matrices[offset + 14] = transform.z;
  matrices[offset + 15] = 1;
}
// Turned, tipped and rolled (rz): a bird banking into its turn.
function placeBankedAt(matrices, offset, transform) {
  const scale = transform.s,
    cosPitch = Math.cos(transform.rx),
    sinPitch = Math.sin(transform.rx),
    cosYaw = Math.cos(transform.ry),
    sinYaw = Math.sin(transform.ry),
    cosRoll = Math.cos(transform.rz),
    sinRoll = Math.sin(transform.rz),
    yawRollCosines = cosYaw * cosRoll,
    cosYawSinRoll = cosYaw * sinRoll,
    sinYawCosRoll = sinYaw * cosRoll,
    yawRollSines = sinYaw * sinRoll;
  matrices[offset] = (yawRollCosines + yawRollSines * sinPitch) * scale;
  matrices[offset + 1] = cosPitch * sinRoll * scale;
  matrices[offset + 2] = (cosYawSinRoll * sinPitch - sinYawCosRoll) * scale;
  matrices[offset + 3] = 0;
  matrices[offset + 4] = (sinYawCosRoll * sinPitch - cosYawSinRoll) * scale;
  matrices[offset + 5] = cosPitch * cosRoll * scale;
  matrices[offset + 6] = (yawRollSines + yawRollCosines * sinPitch) * scale;
  matrices[offset + 7] = 0;
  matrices[offset + 8] = cosPitch * sinYaw * scale;
  matrices[offset + 9] = -sinPitch * scale;
  matrices[offset + 10] = cosPitch * cosYaw * scale;
  matrices[offset + 11] = 0;
  matrices[offset + 12] = transform.x;
  matrices[offset + 13] = transform.y;
  matrices[offset + 14] = transform.z;
  matrices[offset + 15] = 1;
}

export { placeAt, placeBankedAt, placement };
