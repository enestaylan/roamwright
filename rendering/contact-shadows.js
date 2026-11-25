import * as THREE from 'three';

// Soft contact shadows on horizontal receivers. Supply the height of the receiving
// surface in mesh-local coordinates. One quad per contact, in one draw.
export class ContactShadows {
  constructor({ capacity, opacity = 0.4, lift = 0.015 }) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.capacity = capacity;
    this.count = 0;
    this.contacts = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const quad = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setIndex(quad.index);
    geometry.setAttribute('contact', this.contacts);
    geometry.setAttribute('intensity', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -2, polygonOffsetUnits: -6,
      uniforms: { opacityScale: { value: opacity }, lift: { value: lift } },
      vertexShader: `
        attribute vec4 contact;
        attribute float intensity;
        uniform float lift;
        varying vec2 offset;
        varying float weight;
        void main() {
          offset = position.xz;
          weight = intensity;
          vec3 p = contact.xyz + vec3(position.x * contact.w, lift, position.z * contact.w);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float opacityScale;
        varying vec2 offset;
        varying float weight;
        void main() {
          float fall = 1.0 - smoothstep(0.0, 1.0, length(offset));
          gl_FragColor = vec4(0.0, 0.0, 0.0, opacityScale * weight * fall * fall);
        }`,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  begin() {
    this.count = 0;
  }

  add(x, y, z, radius, intensity = 1) {
    if (this.count >= this.capacity) return false;
    this.contacts.setXYZW(this.count, x, y, z, radius);
    this.mesh.geometry.attributes.intensity.setX(this.count, intensity);
    this.count++;
    return true;
  }

  end() {
    const geometry = this.mesh.geometry;
    geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    this.updateRange(this.contacts);
    this.updateRange(geometry.attributes.intensity);
  }

  updateRange(attribute) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, this.count * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
