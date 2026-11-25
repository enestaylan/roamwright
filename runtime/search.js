// Token scoring for searchable place names, titles and descriptions.
const EXACT = 4,
  START = 3,
  INSIDE = 2, // a query word of INSIDE_LEAST letters or more found inside a word (a fragment inside a longer name)
  INSIDE_LEAST = 3,
  NEAR = 1.6, // a word one slip away; each further slip costs SLIP
  SLIP = 0.5;

// A text as the search reads it: its words, lower case, without accents
const searchWords = text =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

// The slips a word of `n` letters may have and still match: none under four letters, one up to six, two from seven
const slipsAllowed = n => (n < 4 ? 0 : n < 7 ? 1 : 2);

// Edits (a letter changed, added, dropped, or two swapped) between a and b, or most + 1 once it is sure to be more than most
function slips(a, b, most) {
  if (Math.abs(a.length - b.length) > most) return most + 1;
  let prev2 = null,
    prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
      if (d < least) least = d;
    }
    if (least > most) return most + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

// How well one query word matches one word of the text: 0 for not at all
function wordMatch(q, w) {
  if (w === q) return EXACT;
  if (w.startsWith(q)) return START;
  if (q.length >= INSIDE_LEAST && w.includes(q)) return INSIDE;
  const most = slipsAllowed(q.length);
  if (!most) return 0;
  // against the whole word, and against its start as long as the query (a word still being typed)
  const d = Math.min(slips(q, w, most), w.length > q.length ? slips(q, w.slice(0, q.length), most) : most + 1);
  return d <= most ? NEAR - SLIP * (d - 1) : 0;
}

// How well a query matches a text given as its title's words and the rest's (from searchWords): 0 when some word of the query
// matches nothing; else the sum over the query's words of each one's best match, a match in the title counting twice.
function fuzzyScore(query, titleWords, restWords) {
  let total = 0;
  for (const q of query) {
    let best = 0;
    for (const w of titleWords) best = Math.max(best, 2 * wordMatch(q, w));
    if (best < 2 * EXACT) for (const w of restWords) best = Math.max(best, wordMatch(q, w));
    if (!best) return 0;
    total += best;
  }
  return total;
}

export { fuzzyScore, searchWords };
