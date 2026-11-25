// Flow-local coordinates are in metres. Skew and warp the ripples so the crests
// stay in short, staggered patches as they travel downstream.
export const STREAM_FLOW_GLSL = /* glsl */ `
  float streamWaveDetail(float footprint, float frequency) {
    return 1.0 - smoothstep(1.05, 2.8, footprint * frequency);
  }

  vec4 streamFlow(vec3 flow, float acrossMetres, float depth, float travel, float distanceToEye, float footprint) {
    vec2 q = vec2(acrossMetres, flow.y - travel);
    footprint = max(footprint, max(length(dFdx(q)), length(dFdy(q))));
    vec2 broad = vec2(0.78, 0.24), middle = vec2(-1.35, 0.43), fine = vec2(2.4, 1.22);
    vec2 broadWarp = vec2(0.33, -0.22), middleWarp = vec2(0.38, 0.28), fineWarp = vec2(-0.58, 0.63);
    float a = dot(q, broadWarp), b = dot(q, middleWarp), c = dot(q, fineWarp);
    float broadPhase = dot(q, broad) + 1.55 * sin(a);
    float middlePhase = dot(q, middle) + 1.35 * cos(b);
    float finePhase = dot(q, fine) + 0.9 * sin(c);
    vec2 broadRate = broad + 1.55 * cos(a) * broadWarp;
    vec2 middleRate = middle - 1.35 * sin(b) * middleWarp;
    vec2 fineRate = fine + 0.9 * cos(c) * fineWarp;
    float broadDetail = streamWaveDetail(footprint, length(broadRate));
    float middleDetail = streamWaveDetail(footprint, length(middleRate));
    float fineDetail = streamWaveDetail(footprint, length(fineRate));
    float packet = 0.5 + 0.5 * sin(dot(q, vec2(0.23, -0.19)) + 0.9 * sin(b));
    vec2 slope = 0.085 * broadRate * cos(broadPhase) * broadDetail * (0.38 + 0.62 * packet)
               + 0.048 * middleRate * cos(middlePhase) * middleDetail * (1.0 - 0.55 * packet)
               + 0.016 * fineRate * cos(finePhase) * fineDetail;
    float fleck = smoothstep(0.66, 0.98, sin(middlePhase)) * smoothstep(0.54, 0.95, packet)
                * (0.08 + 0.32 * flow.z) * middleDetail;
    float broken = smoothstep(0.32, 0.84, 0.55 * packet + 0.45 * (0.5 + 0.5 * sin(broadPhase)));
    float even = max(smoothstep(45.0, 220.0, distanceToEye), 1.0 - broadDetail);
    float rapid = smoothstep(0.28, 0.8, flow.z) * mix(broken, 0.38, even)
                * max(1.0 - 0.5 * flow.x * flow.x, 0.0) * smoothstep(0.3, 1.6, depth);
    float bank = 1.0 - 0.65 * smoothstep(0.62, 1.0, abs(flow.x));
    return vec4(slope * bank, fleck * bank, rapid);
  }
`;
