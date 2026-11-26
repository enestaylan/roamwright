import {ShaderChunk} from 'three';

// Skip direct-light evaluation for dark point and spot lights and point shadow reads for back-facing surfaces.
// Call before warming or drawing materials. The optional chunks object can be used for independent shader builds.
export function installLocalLightCulling(chunks = ShaderChunk) {
  if (chunks.lights_fragment_begin.includes('if ( directLight.visible ) RE_Direct(')) return;
  const CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );',
    SHADOW_READ = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow(',
    SHADOW_TURNED =
      'directLight.color *= ( directLight.visible && receiveShadow && dot( geometryNormal, directLight.direction ) > 0.0 ) ? getPointShadow(';
  function loopOf(text, from, to) {
    const start = text.indexOf(from),
      end = text.indexOf(to, start);
    if (start < 0 || end < 0 || !text.slice(start, end).includes(CALL))
      throw new Error('local-lights: Three.js lighting chunk not as expected');
    return [start, end];
  }
  let text = chunks.lights_fragment_begin;
  for (const [from, to, light, info] of [
    ['#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', 'pointLight', 'getPointLightInfo'],
    ['#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', 'spotLight', 'getSpotLightInfo'],
  ]) {
    const [start, end] = loopOf(text, from, to);
    const lookup = `${info}( ${light}, geometryPosition, directLight );`;
    const loop = text.slice(start, end);
    if (!loop.includes(lookup)) throw new Error('local-lights: Three.js light lookup not as expected');
    // Attenuation is zero beyond a finite cutoff. Keep cookie sampling outside this
    // branch so texture derivatives at the edge of a spotlight have their usual values.
    const culled = `if ( ${light}.color == vec3( 0.0 ) || ( ${light}.distance > 0.0 &&
      distance( ${light}.position, geometryPosition ) > ${light}.distance ) ) {
        directLight.color = vec3( 0.0 );
        directLight.visible = false;
        directLight.direction = vec3( 0.0 );
      } else { ${lookup} }`;
    let shaded = loop.replace(lookup, culled).replace(CALL, 'if ( directLight.visible ) ' + CALL);
    if (light === 'pointLight') {
      // Three orders shadow casters first. Leave their shadow reads and light arithmetic together.
      // For other points the uniform colour can bypass the entire unrolled light evaluation.
      const assign = 'pointLight = pointLights[ i ];';
      if (!shaded.includes(assign)) throw new Error('local-lights: Three.js point light assignment not as expected');
      const unshadowed = '#if UNROLLED_LOOP_INDEX >= NUM_POINT_LIGHT_SHADOWS';
      const begin = `${assign}
${unshadowed}
if (pointLight.color != vec3(0.0)) {
#endif
`;
      const end = `${CALL}
${unshadowed}
}
#endif
`;
      shaded = shaded.replace(assign, begin).replace(CALL, end);
    }
    text = text.slice(0, start) + shaded + text.slice(end);
  }
  if (!text.includes(SHADOW_READ)) throw new Error('local-lights: Three.js point shadow not as expected');
  chunks.lights_fragment_begin = text.replace(SHADOW_READ, SHADOW_TURNED);
}
