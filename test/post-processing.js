import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { createPostProcessing } from 'roamwright/rendering/post.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function pixel(gl, x, y) {
  const rgba = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return rgba;
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
  let frame = 0;
  const pipeline = createPostProcessing({
    renderer,
    scene,
    camera,
    fxScene,
    skyMask,
    getFrame: () => frame,
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
    return results.join('\n');
  } finally {
    renderer.dispose();
  }
}
