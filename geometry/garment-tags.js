// A negative tag selects a garment type and interpolates between smooth and gathered cloth.
const PLAIN = 0.1,
  CREASED = 0.9,
  HANGS = 0.5, // how creased cloth is that hangs in folds, uncrumpled
  KIND = { wool: 0, linen: 1, silk: 2, leather: 3, plate: 5 }; // 4 is reserved for mail.
// Optional integer attributes store this many steps per unit.
const TAG_STEPS = 16;
// The tag of a garment of a kind, creased by so much (0 to 1).
const garmentTag = (crease, kind = KIND.wool) => -(kind + PLAIN + (CREASED - PLAIN) * Math.min(1, Math.max(0, crease)));

export { CREASED, HANGS, KIND, PLAIN, TAG_STEPS, garmentTag };
