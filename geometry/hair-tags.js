const HAIR_FAR = 0.42,
  HAIR_NEAR = 3,
  STRANDS = { span: 0.115, period: 0.25, clumps: 64 }, // clumps: how many locks' widths of strands there are to one of the fraction
  TAG_SLACK = 0.01, // how near a point's tag is to the far hair's to be hair
  isHair = tag => tag >= HAIR_NEAR || Math.abs(tag - HAIR_FAR) < TAG_SLACK;
export { HAIR_FAR, HAIR_NEAR, STRANDS, isHair };
