import * as THREE from 'three';

// A directional panorama keeps the cloud banks fixed over the mountains as the camera turns.
export function valleySky(noise) {
  const width = 768, height = 384;
  const pixels = new Uint8Array(width * height * 4);
  const sun = new THREE.Vector3(-0.78, 0.32, -0.54).normalize();
  for (let y = 0; y < height; y++) {
    const latitude = Math.PI * ((y + 0.5) / height - 0.5);
    const up = Math.sin(latitude), ring = Math.cos(latitude);
    const blue = THREE.MathUtils.smoothstep(up, -0.05, 0.78);
    for (let x = 0; x < width; x++) {
      const longitude = 2 * Math.PI * ((x + 0.5) / width - 0.5);
      const east = ring * Math.cos(longitude), north = ring * Math.sin(longitude);
      const air = Math.max(0.09, up);
      const cloud = noise.fbm(east / air * 1.35, north / air * 2.8, 4, 71);
      const veil = THREE.MathUtils.smoothstep(cloud, 0.53, 0.76) * THREE.MathUtils.smoothstep(up, 0, 0.13);
      const glow = Math.pow(Math.max(0, east * sun.x + up * sun.y + north * sun.z), 32);
      const i = (y * width + x) * 4;
      pixels[i] = Math.min(255, (202 - blue * 116) * (1 - veil) + 249 * veil + 31 * glow);
      pixels[i + 1] = Math.min(255, (218 - blue * 60) * (1 - veil) + 237 * veil + 18 * glow);
      pixels[i + 2] = Math.min(255, (220 - blue * 15) * (1 - veil) + 213 * veil + 5 * glow);
      pixels[i + 3] = 255;
    }
  }
  const sky = new THREE.DataTexture(pixels, width, height);
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.mapping = THREE.EquirectangularReflectionMapping;
  sky.minFilter = sky.magFilter = THREE.LinearFilter;
  sky.needsUpdate = true;
  return sky;
}

// An irregular skirt and an offset apex give each whorl a recognizable branch silhouette.
export function branchWhorl() {
  const points = [];
  const rim = [];
  for (let i = 0; i < 14; i++) {
    const angle = i * Math.PI / 7;
    const radius = i % 2 ? 0.34 : 0.5;
    rim.push([radius * Math.cos(angle), i % 2 ? 0.16 : 0.03 * Math.sin(3 * angle), radius * Math.sin(angle)]);
  }
  for (let i = 0; i < rim.length; i++) {
    const next = rim[(i + 1) % rim.length];
    points.push(...rim[i], 0.02, 1, -0.02, ...next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function alpineRiver(channel, elevation, noise) {
  const grid = new THREE.PlaneGeometry(38, 385, 36, 385).rotateX(-Math.PI / 2).translate(0, 0, -24.5);
  const position = grid.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const shallows = new THREE.Color(0x83aea1), deep = new THREE.Color(0x236c73);
  const tint = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i), x = position.getX(i) + channel(z);
    const depth = THREE.MathUtils.smoothstep(-elevation(x, z), -0.3, 2);
    position.setX(i, x);
    tint.copy(shallows).lerp(deep, depth).multiplyScalar(0.88 + 0.19 * noise.vnoise(x * 0.6, z * 0.21, 92)).toArray(colors, i * 3);
  }
  grid.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vRiver;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRiver = position.xz;');
    shader.fragmentShader = 'varying vec2 vRiver;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float eddy = sin(vRiver.x * 0.73 + sin(vRiver.y * 0.47)) + sin(vRiver.y * 0.32 + vRiver.x * 0.31);
      float flow = vRiver.y + 0.72 * eddy;
      float ripple = sin(flow * 8.3 + sin(flow * 2.3)) + 0.45 * sin(vRiver.x * 2.35 - flow * 1.4 + eddy);
      float visible = 1.0 - smoothstep(0.07, 0.55, fwidth(flow));
      diffuseColor.rgb += vec3(0.12, 0.19, 0.18) * smoothstep(0.96, 1.44, ripple) * smoothstep(-0.8, 1.5, eddy) * visible;
    `);
  };
  const river = new THREE.Mesh(grid, material);
  river.receiveShadow = true;
  return river;
}
