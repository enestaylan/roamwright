import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { createPostProcessing } from 'roamwright/rendering/post.js';
import { LOW_LIGHT_REFLECTANCE } from 'roamwright/rendering/low-light.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function pixel(gl, x, y) {
  const rgba = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return rgba;
}

function checkMaterialResponse(renderer, camera) {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    depthTest: false,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: LOW_LIGHT_REFLECTANCE + `
      void main() {
        vec3 dye = vec3(0.8, 0.04, 0.015);
        if (gl_FragCoord.x < 40.0) gl_FragColor = vec4(lowLightReflectance(dye, 0.0), 1.0);
        else if (gl_FragCoord.x < 80.0) gl_FragColor = vec4(lowLightReflectance(dye, 1.0), 1.0);
        else if (gl_FragCoord.x < 120.0) gl_FragColor = vec4(diffuseTextileBounce(dye, vec3(0.0), 0.6), 1.0);
        else gl_FragColor = vec4(diffuseTextileBounce(dye, vec3(0.2, 0.6, 0.7), 0.6), 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const day = pixel(gl, 20, 24),
    night = pixel(gl, 60, 24),
    unlit = pixel(gl, 100, 24),
    bounced = pixel(gl, 140, 24);
  check(day[0] > 190 && day[1] < 20, 'Zero adaptation changed the albedo');
  check(night[0] === night[1] && night[1] === night[2] && night[1] > 45 && night[1] < 57, 'Adapted color lost its luminance');
  check(unlit[0] === 0 && unlit[1] === 0 && unlit[2] === 0, 'Fabric glowed without light');
  check(bounced[1] > 35 && bounced[2] > 40, 'Fabric did not scatter the local light');
  quad.geometry.dispose();
  material.dispose();
}

function checkContactResponse(renderer, camera, scene, pipeline, render, setStrength) {
  const { post } = pipeline;
  const material = new THREE.MeshBasicMaterial({ color: 0x777777 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  scene.add(floor);
  camera.position.set(2.9, 1.7, 5);
  camera.lookAt(0, -0.5, 0);
  pipeline.setPost(true, 0, false);
  post.scale = 1;
  pipeline.sizePost(160, 96);

  const copyScene = new THREE.Scene();
  const copyMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: post.aoRT.texture } },
    vertexShader: 'varying vec2 uv0; void main() { uv0 = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 uv0; void main() { gl_FragColor = vec4(vec3(texture2D(map, uv0).r), 1.0); }',
    depthTest: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
  quad.frustumCulled = false;
  copyScene.add(quad);
  const target = new THREE.WebGLRenderTarget(post.aoRT.width, post.aoRT.height);
  function sample(strength) {
    setStrength(strength);
    render();
    const draws = renderer.info.render.calls;
    renderer.setRenderTarget(target);
    renderer.render(copyScene, camera);
    const pixels = new Uint8Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
    renderer.setRenderTarget(null);
    return { draws, pixels };
  }
  const baseline = sample(0);
  const contact = sample(1.5);
  check(baseline.draws === contact.draws, 'Close ambient occlusion added a draw');
  let darkened = 0;
  for (let i = 0; i < baseline.pixels.length; i += 4) {
    const delta = baseline.pixels[i] - contact.pixels[i];
    check(delta >= 0, 'Close ambient occlusion brightened the scene');
    if (delta > 2) darkened++;
  }
  check(darkened > 8 && darkened < target.width * target.height * 0.3, 'Contact did not stay local to corners');
  scene.remove(floor);
  floor.geometry.dispose();
  material.dispose();
  quad.geometry.dispose();
  copyMaterial.dispose();
  target.dispose();
  return darkened;
}

export function run(canvas) {
  const width = 160,
    height = 96;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setSize(width, height, false);
  renderer.info.autoReset = false;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error([gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment)].join('\n'));
  };
  const gl = renderer.getContext();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.006, 0.012, 0.02);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.03, 0.015) })));
  const fxScene = new THREE.Scene();
  const particle = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x207fff, transparent: true }));
  particle.position.set(-2.5, 0, 0);
  fxScene.add(particle);

  const skyMask = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: null }, uPx: { value: new THREE.Vector2() } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader:
        'uniform sampler2D tDepth; uniform vec2 uPx; void main() { float d = texture2D(tDepth, gl_FragCoord.xy * uPx).r; gl_FragColor = vec4(vec3(1. - step(.9999, d)), 1.); }',
    }),
  );
  let frame = 0, contactStrength = 0;
  const pipeline = createPostProcessing({
    renderer,
    scene,
    camera,
    fxScene,
    skyMask,
    getFrame: () => frame,
    contactRadius: 0.3,
    contactStrength: () => contactStrength,
    createComposer: target => new EffectComposer(renderer, target),
  });
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x00ff00, depthWrite: false }));
  marker.scale.setScalar(0.35);
  marker.position.z = 1.2;
  pipeline.drawnAtFullSize(marker);
  const { post, temporalAA, depthOfField, eyeAdaptation } = pipeline;
  const results = ['Three.js r' + THREE.REVISION];
  function render() {
    frame++;
    depthOfField.focusOn(4, frame);
    const previousEye = eyeAdaptation.eye.level;
    renderer.info.reset();
    post.composer.render(1 / 60);
    pipeline.drawOverlay();
    check(
      eyeAdaptation.eye.level !== previousEye && eyeAdaptation.eye.level === post.final.uniforms.tEye.value,
      'Exposure did not advance',
    );
    check(pipeline.sceneDepth.uSoft.value === (post.samples ? 0 : 1), 'Particle depth mode');
    check(depthOfField.dof.weight > 0, 'Depth of field did not engage');
    check(!gl.isContextLost() && gl.getError() === gl.NO_ERROR, 'WebGL error');
  }

  try {
    for (const [name, taa, scale, samples] of [
      ['native', false, 1, 0],
      ['TAA', true, 1, 0],
      ['TAA + upscale', true, 0.625, 0],
      ['upscale', false, 0.625, 0],
      ['restored native MSAA', false, 1, 4],
    ]) {
      pipeline.setPost(true, samples, taa);
      post.scale = scale;
      pipeline.sizePost(width, height);
      post.final.uniforms.uRay.value = 0.1;
      post.final.uniforms.uAspect.value = camera.aspect;
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      post.final.uniforms.uTan.value.set(tan * camera.aspect, tan);
      const [low, full] = pipeline.upscaleTargets();
      check(scale < 1 ? low.width === width * scale && full.width === width : !low && !full, 'Upscale target sizes');
      check(temporalAA.taaTargets().length === (taa ? 2 : 0), 'Temporal target count');
      const projection = camera.projectionMatrix.clone();
      render();
      if (taa) {
        check(temporalAA.taaUniforms.uFresh.value === 1, 'New history did not start fresh');
        const first = temporalAA.historyNow();
        render();
        check(temporalAA.historyNow() !== first && temporalAA.taaUniforms.uFresh.value === 0, 'History did not accumulate');
        check(camera.projectionMatrix.equals(projection), 'Jitter remained on the camera');
        temporalAA.dropHistory();
        render();
        check(temporalAA.taaUniforms.uFresh.value === 1, 'History survived a cut');
      }
      const center = pixel(gl, width / 2, height / 2);
      const box = pixel(gl, width / 2 + 12, height / 2);
      const background = pixel(gl, 6, 6);
      check(center[1] > center[0] + 50, name + ': overlay missing');
      check(box[0] > box[1] + 50 && box[0] > background[0] + 75, name + ': scene missing');
      results.push(name + ' passed (' + renderer.info.render.calls + ' draws, ' + renderer.info.render.triangles + ' triangles)');
      marker.position.z = -1;
      render();
      const hidden = pixel(gl, width / 2, height / 2);
      check(hidden[0] > hidden[1] + 50, name + ': overlay drew through scene depth');
      marker.position.z = 1.2;
    }
    results.push('Local ambient occlusion changed ' + checkContactResponse(renderer, camera, scene, pipeline, render, value => { contactStrength = value; }) + ' depth samples without adding a draw');
    checkMaterialResponse(renderer, camera);
    results.push('Dim light and reflected textile light passed');
    return results.join('\n');
  } finally {
    renderer.dispose();
  }
}
