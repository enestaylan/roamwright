// ════════════════════════════════════════════════════════════════════════
//  An instance's matrix written straight into an instanced mesh's matrices (16 numbers from `at`), for code that places
//  thousands of instances a frame (crowds, herds, flocks). A placement p says where: at (x, y, z), of size s, turned by ry about
//  the vertical and then rx and rz in Three.js's 'YXZ' order, as TRS(x, y, z, s, s, s, ry, rx, rz) composes it, without its
//  Euler angles and quaternion on the way. The placement is an object the caller makes once and fills in for each instance:
//  numbers handed over one by one to a function the engine does not take into its caller whole are made anew at every call.
// ════════════════════════════════════════════════════════════════════════
const placement = () => ({ x: 0, y: 0, z: 0, s: 1, ry: 0, rx: 0, rz: 0 });

// Turned and tipped (rx), not rolled: a person of a crowd, standing or fallen, a beast of a herd.
function placeAt(matrices, at, p) {
  const s = p.s,
    a = Math.cos(p.rx) * s,
    b = Math.sin(p.rx),
    c = Math.cos(p.ry),
    d = Math.sin(p.ry);
  matrices[at] = c * s;
  matrices[at + 1] = 0;
  matrices[at + 2] = -d * s;
  matrices[at + 3] = 0;
  matrices[at + 4] = d * b * s;
  matrices[at + 5] = a;
  matrices[at + 6] = c * b * s;
  matrices[at + 7] = 0;
  matrices[at + 8] = a * d;
  matrices[at + 9] = -b * s;
  matrices[at + 10] = a * c;
  matrices[at + 11] = 0;
  matrices[at + 12] = p.x;
  matrices[at + 13] = p.y;
  matrices[at + 14] = p.z;
  matrices[at + 15] = 1;
}
// Turned, tipped and rolled (rz): a bird banking into its turn.
function placeBankedAt(matrices, at, p) {
  const s = p.s,
    a = Math.cos(p.rx),
    b = Math.sin(p.rx),
    c = Math.cos(p.ry),
    d = Math.sin(p.ry),
    e = Math.cos(p.rz),
    f = Math.sin(p.rz),
    ce = c * e,
    cf = c * f,
    de = d * e,
    df = d * f;
  matrices[at] = (ce + df * b) * s;
  matrices[at + 1] = a * f * s;
  matrices[at + 2] = (cf * b - de) * s;
  matrices[at + 3] = 0;
  matrices[at + 4] = (de * b - cf) * s;
  matrices[at + 5] = a * e * s;
  matrices[at + 6] = (df + ce * b) * s;
  matrices[at + 7] = 0;
  matrices[at + 8] = a * d * s;
  matrices[at + 9] = -b * s;
  matrices[at + 10] = a * c * s;
  matrices[at + 11] = 0;
  matrices[at + 12] = p.x;
  matrices[at + 13] = p.y;
  matrices[at + 14] = p.z;
  matrices[at + 15] = 1;
}

export { placeAt, placeBankedAt, placement };
