import * as THREE from 'three';
import { createShadowSnap } from './shadow-alignment.js';

// Opt in before compiling standard materials. The first shadow-casting directional light provides
// direct light, and the second carries its far shadow map. The fragment float sunSeen is available
// to additional lighting code after lights_fragment_begin.
export function installFarShadowShader({nearDepth: NEAR_DEPTH, farDepth: FAR_DEPTH, chunks = THREE.ShaderChunk}) {
  if (chunks.shadowmap_pars_fragment.includes('float sunShadow()')) throw Error('Far shadow shader already installed');
  const SUN_SHADOW = /* glsl */ `
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
    float farSunShadow( out float gap ) {
      DirectionalLightShadow fs = directionalLightShadows[ 1 ];
      vec3 c = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
      c.z += fs.shadowBias;
      gap = 0.0;
      if ( any( lessThan( c, vec3( 0.0 ) ) ) || any( greaterThan( c, vec3( 1.0 ) ) ) ) return 1.0;
      vec2 t = c.xy * fs.shadowMapSize - 0.5, b = floor( t ), k = t - b, uv = ( b + 0.5 ) * ( 1.0 / fs.shadowMapSize );
      vec4 d = vec4(
        unpackRGBAToDepth( texture2D( directionalShadowMap[ 1 ], uv ) ),
        unpackRGBAToDepth( textureOffset( directionalShadowMap[ 1 ], uv, ivec2( 1, 0 ) ) ),
        unpackRGBAToDepth( textureOffset( directionalShadowMap[ 1 ], uv, ivec2( 0, 1 ) ) ),
        unpackRGBAToDepth( textureOffset( directionalShadowMap[ 1 ], uv, ivec2( 1, 1 ) ) ) );
      vec4 lit = step( vec4( c.z ), d );
      gap = ( c.z - min( min( d.x, d.y ), min( d.z, d.w ) ) ) * ${FAR_DEPTH.toFixed(1)};
      return mix( 1.0, mix( mix( lit.x, lit.y, k.x ), mix( lit.z, lit.w, k.x ), k.y ), fs.shadowIntensity );
    }
    float sunShadow() {
      float gap, farS = farSunShadow( gap );
      vec4 nc = vDirectionalShadowCoord[ 0 ];
      vec2 edge = abs( nc.xy / nc.w - 0.5 ) * 2.0;
      float inner = ( 1.0 - smoothstep( 0.8, 0.97, max( edge.x, edge.y ) ) ) * step( nc.z, 1.0 );
      if ( inner <= 0.0 ) return farS;
      DirectionalLightShadow ns = directionalLightShadows[ 0 ];
      float nearS = getShadow( directionalShadowMap[ 0 ], ns.shadowMapSize, ns.shadowIntensity, ns.shadowBias, ns.shadowRadius, nc );
      float reach = nc.z * ${NEAR_DEPTH.toFixed(1)};
      return mix( farS, min( nearS, mix( 1.0, farS, smoothstep( reach - 25.0, reach, gap ) ) ), inner );
    }
  #elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    float sunShadow() {
      DirectionalLightShadow ns = directionalLightShadows[ 0 ];
      return getShadow( directionalShadowMap[ 0 ], ns.shadowMapSize, ns.shadowIntensity, ns.shadowBias, ns.shadowRadius, vDirectionalShadowCoord[ 0 ] );
    }
  #endif
  `;
  const nativeDepth = /* glsl */ `
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
    float farVisibility(vec4 coord) {
      DirectionalLightShadow farLight = directionalLightShadows[1];
      return getShadow(directionalShadowMap[1], farLight.shadowMapSize, farLight.shadowIntensity,
        farLight.shadowBias, farLight.shadowRadius, coord);
    }
    float sunShadow() {
      vec4 nearCoord = vDirectionalShadowCoord[0], farCoord = vDirectionalShadowCoord[1];
      vec3 nd = nearCoord.xyz / nearCoord.w;
      vec2 edge = abs(nd.xy - 0.5) * 2.0;
      float inside = (1.0 - smoothstep(0.8, 0.97, max(edge.x, edge.y))) * step(0.0,nd.z) * step(nd.z,1.0);
      float distant = farVisibility(farCoord);
      if (inside <= 0.0) return distant;
      DirectionalLightShadow ns = directionalLightShadows[0];
      float close = getShadow(directionalShadowMap[0], ns.shadowMapSize, ns.shadowIntensity, ns.shadowBias, ns.shadowRadius, nearCoord);
      // A second depth comparison sees only blockers beyond the near camera's first plane. Native
      // comparison samplers support this test without exposing the stored depth.
      #ifdef USE_REVERSED_DEPTH_BUFFER
        farCoord.z += farCoord.w * (1.0 - nd.z) * ${NEAR_DEPTH.toFixed(1)} / ${FAR_DEPTH.toFixed(1)};
      #else
        farCoord.z -= farCoord.w * nd.z * ${NEAR_DEPTH.toFixed(1)} / ${FAR_DEPTH.toFixed(1)};
      #endif
      return mix(distant, min(close, farVisibility(farCoord)), inside);
    }
  #elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    float sunShadow() {
      DirectionalLightShadow ns = directionalLightShadows[0];
      return getShadow(directionalShadowMap[0], ns.shadowMapSize, ns.shadowIntensity, ns.shadowBias, ns.shadowRadius, vDirectionalShadowCoord[0]);
    }
  #endif
  `;
  const OWN_LOOP = /* glsl */ `float sunSeen = 1.0;
  #if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
    DirectionalLight directionalLight;
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      #if NUM_DIR_LIGHT_SHADOWS < 2 || UNROLLED_LOOP_INDEX != 1
      directionalLight = directionalLights[ i ];
      getDirectionalLightInfo( directionalLight, directLight );
      #if defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX == 0 && NUM_DIR_LIGHT_SHADOWS > 0
      sunSeen = ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 ) ? sunShadow() : 1.0;
      directLight.color *= sunSeen;
      #endif
      RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      #endif
    }
    #pragma unroll_loop_end
  #endif
  #if ( NUM_RECT_AREA_LIGHTS > 0 )`;
  const dirLoop = /#if \( NUM_DIR_LIGHTS > 0 \) && defined\( RE_Direct \)[\s\S]*?#if \( NUM_RECT_AREA_LIGHTS > 0 \)/;
  if (!dirLoop.test(chunks.lights_fragment_begin)) throw new Error('far-shadow: Three.js lighting chunk not as expected');
  chunks.lights_fragment_begin = chunks.lights_fragment_begin.replace(dirLoop, OWN_LOOP);
  chunks.shadowmap_pars_fragment += Number(THREE.REVISION) <= 170 ? SUN_SHADOW : nativeDepth;

}

// Fit a coarse, texel-aligned directional shadow volume over sampled terrain ahead of the camera.
export function createFarShadow({scene, camera, direction, ground, config: FAR, mapSize, active = () => true}) {
  const FAR_DEPTH = FAR.lift + FAR.back - 1;
  const farSun = new THREE.DirectionalLight(0x000000, 0);
  farSun.castShadow = true;
  farSun.shadow.mapSize.set(mapSize, mapSize);
  farSun.shadow.autoUpdate = false;
  farSun.shadow.bias = -FAR.bias / FAR_DEPTH;
  farSun.shadow.normalBias = FAR.normalBias;
  farSun.shadow.camera.near = 1;
  farSun.shadow.camera.far = FAR_DEPTH + 1;
  scene.add(farSun);
  scene.add(farSun.target);

  const drawn = { x: NaN, z: NaN, dir: new THREE.Vector3(), age: 0 };
  function setFarShadow(size) {
    const on = size > 0;
    if (farSun.castShadow !== on) farSun.castShadow = on;
    if (on && farSun.shadow.mapSize.x !== size) {
      farSun.shadow.mapSize.set(size, size);
      if (farSun.shadow.map) {
        farSun.shadow.map.dispose();
        farSun.shadow.map = null;
      }
    }
    drawn.x = NaN;
  }
  const RELIEF_STEPS = 8,
    SPAN_STEP = FAR.range / 4;
  const snapToTexels = createShadowSnap();
  function fitFar(x, z) {
    const L = direction,
      sinE = Math.max(0.05, L.y),
      cosE = Math.sqrt(1 - sinE * sinE),
      R = FAR.range,
      baseHeight = ground(x, z),
      y0 = Number.isFinite(baseHeight) ? baseHeight : 0;
    let low = y0,
      high = y0;
    for (let i = 0; i <= RELIEF_STEPS; i++)
      for (let j = 0; j <= RELIEF_STEPS; j++) {
        const h = ground(x + R * ((2 * i) / RELIEF_STEPS - 1), z + R * ((2 * j) / RELIEF_STEPS - 1));
        if (!Number.isFinite(h)) continue;
        if (h < low) low = h;
        else if (h > high) high = h;
      }
    const bottom = Math.max(-R, -R * sinE + (low - y0) * cosE - 10),
      top = Math.min(R, R * sinE + (high + FAR.above - y0) * cosE),
      span = Math.min(2 * R, Math.ceil((top - bottom) / SPAN_STEP) * SPAN_STEP),
      size = farSun.shadow.mapSize.x,
      across = (2 * R) / size,
      upward = span / size;
    const shadowCamera = farSun.shadow.camera;
    shadowCamera.left = -R;
    shadowCamera.right = R;
    shadowCamera.bottom = Math.round((top + bottom - span) / 2 / upward) * upward;
    shadowCamera.top = shadowCamera.bottom + span;
    shadowCamera.updateProjectionMatrix();
    snapToTexels(farSun.target.position, x, y0, z, L, across, upward);
    farSun.position.copy(farSun.target.position).addScaledVector(L, FAR.lift);
  }
  function updateFarShadow(deltaSeconds) {
    if (!farSun.castShadow || !active()) return;
    drawn.age += deltaSeconds;
    const yaw = camera.rotation.y,
      x = camera.position.x - Math.sin(yaw) * FAR.range * FAR.lead,
      z = camera.position.z - Math.cos(yaw) * FAR.range * FAR.lead;
    const moved = !(Math.hypot(x - drawn.x, z - drawn.z) < FAR.step),
      turned = direction.dot(drawn.dir) < FAR.turn;
    if (!moved && !turned && drawn.age < FAR.every) return;
    fitFar(x, z);
    drawn.x = x;
    drawn.z = z;
    drawn.dir.copy(direction);
    drawn.age = 0;
    farSun.shadow.needsUpdate = true;
  }

  function dispose() {
    farSun.removeFromParent();
    farSun.target.removeFromParent();
    farSun.shadow.dispose();
  }
  return {light: farSun, setSize: setFarShadow, update: updateFarShadow, dispose};
}
