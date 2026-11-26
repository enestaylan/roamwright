// An index of upright instanced obstacles. Instance transforms, camera and subject
// use the same coordinate frame; register meshes before releasing CPU geometry.
export function createInstanceSight({ widthFraction = 0.7, nearSubject = 0.6 } = {}) {
  const bySpace = new Map(), // space id -> [{ mesh, body }]
    bodies = new WeakMap(); // a model's position attribute -> its body

  // The body of a model, read off its bounds: `from`, the share of its height where its crown begins (0 for a bush or a rock);
  // `trunk`, the trunk's radius in the model's units. Worked out while the model's arrays are there (before its first draw), and
  // from its bounding sphere if they are gone.
  function bodyOf(geometry, from, trunk) {
    const key = geometry.attributes.position,
      known = bodies.get(key);
    if (known && known.frac === from && known.trunk === trunk) return known;
    let x0, x1, y0, y1, z0, z1;
    if (key.array) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      ({
        min: { x: x0, y: y0, z: z0 },
        max: { x: x1, y: y1, z: z1 },
      } = geometry.boundingBox);
    } else {
      const { center: localCenter, radius: localRadius } = geometry.boundingSphere;
      [x0, x1, y0, y1, z0, z1] = [localCenter.x - localRadius * 0.7, localCenter.x + localRadius * 0.7, 0, localCenter.y + localRadius * 0.7, localCenter.z - localRadius * 0.7, localCenter.z + localRadius * 0.7];
    }
    const top = Math.max(y1, 0),
      body = {
        frac: from,
        x: (x0 + x1) / 2,
        z: (z0 + z1) / 2,
        r: (widthFraction * Math.max(x1 - x0, z1 - z0)) / 2,
        from: Math.max(y0, 0) + from * (top - Math.max(y0, 0)),
        top,
        trunk,
      };
    bodies.set(key, body);
    return body;
  }
  // Files instanced mesh `mesh` (its bounding sphere worked out) as plants that can stand in a line of sight in space `spaceId`.
  function addSightPlants(spaceId, mesh, from = 0, trunk = 0) {
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    const list = bySpace.get(spaceId) ?? bySpace.set(spaceId, []).get(spaceId);
    list.push({ mesh, body: bodyOf(mesh.geometry, from, trunk) });
  }

  // True if a plant of space `spaceId` stands in the middle of the picture a lens at p takes of its subject at `at` (points with
  // x, y, z): across the line of sight, or within `spread` of it (a tangent: the share of the picture round its middle that must
  // be clear, as the angle it takes from the lens), or round the lens itself. A bush beside the line a few metres from the lens
  // fills the foreground as surely as one on it.
  function plantInTheWay(spaceId, p, at, spread) {
    const list = bySpace.get(spaceId);
    if (!list) return false;
    const dx = at.x - p.x,
      dy = at.y - p.y,
      dz = at.z - p.z,
      flat2 = dx * dx + dz * dz,
      flat = Math.sqrt(flat2),
      reach = Math.sqrt(flat2 + dy * dy),
      mx = (p.x + at.x) / 2,
      my = (p.y + at.y) / 2,
      mz = (p.z + at.z) / 2;
    for (let k = 0; k < list.length; k++) {
      const { mesh, body } = list[k],
        s = mesh.boundingSphere;
      if (Math.hypot(s.center.x - mx, s.center.y - my, s.center.z - mz) > s.radius + reach * (0.5 + spread)) continue; // the batch is nowhere near
      const matrices = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count * 16; i += 16) {
        const wide = Math.hypot(matrices[i], matrices[i + 1], matrices[i + 2]),
          tall = Math.hypot(matrices[i + 4], matrices[i + 5], matrices[i + 6]),
          x = matrices[i + 12] + matrices[i] * body.x + matrices[i + 8] * body.z,
          z = matrices[i + 14] + matrices[i + 2] * body.x + matrices[i + 10] * body.z,
          u = flat2 > 1e-6 ? Math.min(1, Math.max(0, ((x - p.x) * dx + (z - p.z) * dz) / flat2)) : 0;
        if ((1 - u) * flat < nearSubject) continue;
        const room = u * flat * spread, // how far the middle of the picture reaches round the line of sight there, in metres
          aside = Math.hypot(p.x + dx * u - x, p.z + dz * u - z) - room,
          rise = p.y + dy * u - matrices[i + 13], // the line's height over the plant's foot where it passes nearest
          crown = body.from * tall;
        if (aside < body.r * wide && rise + room > crown && rise - room < body.top * tall) return true;
        if (aside < body.trunk * wide && rise - room < crown && rise + room > 0) return true;
      }
    }
    return false;
  }
  return { add: addSightPlants, obstructed: plantInTheWay, clear: spaceId => bySpace.delete(spaceId) };
}
