import * as THREE from 'three';
import { DOF_COC, QUAD_VS } from './post-shaders.js';

// ════════════════════════════════════════════════════════════════════════
//  Depth of field, as a long lens has it in a scene's closer shot: the subject sharp, what stands behind softening the further
//  it lies, and what passes close before the lens soft too. A scene's shot names its focus each frame (focusOn); with none named this frame the pass is skipped and costs nothing. The picture is gathered at half size, each
//  pixel from a disk of samples as wide as its circle of confusion, each sample counting only as far as its own circle reaches
//  this pixel (so a sharp subject does not smear over the blurred ground behind it); the final pass mixes that in by the circle.
// ════════════════════════════════════════════════════════════════════════
const DOF_BLUR = 0.0045, // the circle of confusion far behind the subject, as a share of the picture's height (a 30-degree lens near f/2.8)
  DOF_MOST = 0.009, //     the widest circle, as a share of the picture's height (what passes close before the lens)
  TAPS = 16; //        samples in the gather's disk, laid out on a golden-angle spiral

const DOF_FS = `/* glsl */ uniform sampler2D tScene, tDepth; uniform vec4 uDof; uniform vec2 uNF, uPx; varying vec2 vUv;
  float viewDepth(vec2 uv){ return -uNF.x * uNF.y / ((uNF.y - uNF.x) * texture2D(tDepth, uv).x - uNF.y); }
  ${DOF_COC}
  void main(){
    float r = cocAt(viewDepth(vUv));
    vec3 sum = texture2D(tScene, vUv).rgb; float wsum = 1.0;
    for (int i = 1; i < ${TAPS}; i++) {
      float f = float(i) / ${TAPS}.0, a = float(i) * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * sqrt(f) * max(r, 0.5);
      vec2 uv = vUv + o * uPx;
      float rs = cocAt(viewDepth(uv)), d = length(o);
      float w = clamp(min(rs, r) - d + 1.0, 0.0, 1.0);  // a sample counts as far as its own circle, and this one's, reach here
      sum += clamp(texture2D(tScene, uv).rgb, 0.0, 48.0) * w; wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }`;
export function createDepthOfField() {
  const dof = {
    target: null,
    material: new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: QUAD_VS,
      fragmentShader: DOF_FS,
      uniforms: {
        tScene: { value: null },
        tDepth: { value: null },
        uDof: { value: new THREE.Vector4() },
        uNF: { value: new THREE.Vector2() },
        uPx: { value: new THREE.Vector2() },
      },
    }),
    focus: 0, // metres to what the lens is focused on, while a shot names one
    named: -1, // the frame it was last named on
    weight: 0, // eased in and out, so the background softens as the shot settles
  };
  // The shot's focus for this frame: the distance from the lens to its subject.
  function focusOn(metres, frame) {
    dof.focus = metres;
    dof.named = frame;
  }

  return { dof, focusOn };
}

export { DOF_BLUR, DOF_MOST };
