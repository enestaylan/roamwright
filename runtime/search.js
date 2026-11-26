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

// Edits (a letter changed, added, dropped, or two swapped) between the source and target words, or most + 1 once it is sure to be more than most
function slips(source, target, most) {
  if (Math.abs(source.length - target.length) > most) return most + 1;
  let prev2 = null,
    prev = Array.from({ length: target.length + 1 }, (_, j) => j);
  for (let i = 1; i <= source.length; i++) {
    const row = [i];
    let least = i;
    for (let j = 1; j <= target.length; j++) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      let editCost = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && source[i - 1] === target[j - 2] && source[i - 2] === target[j - 1]) editCost = Math.min(editCost, prev2[j - 2] + 1);
      row.push(editCost);
      if (editCost < least) least = editCost;
    }
    if (least > most) return most + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[target.length];
}

// How well one query word matches one word of the text: 0 for not at all
function wordMatch(queryWord, word) {
  if (word === queryWord) return EXACT;
  if (word.startsWith(queryWord)) return START;
  if (queryWord.length >= INSIDE_LEAST && word.includes(queryWord)) return INSIDE;
  const most = slipsAllowed(queryWord.length);
  if (!most) return 0;
  // against the whole word, and against its start as long as the query (a word still being typed)
  const distance = Math.min(slips(queryWord, word, most), word.length > queryWord.length ? slips(queryWord, word.slice(0, queryWord.length), most) : most + 1);
  return distance <= most ? NEAR - SLIP * (distance - 1) : 0;
}

// How well a query matches a text given as its title's words and the rest's (from searchWords): 0 when some word of the query
// matches nothing; else the sum over the query's words of each one's best match, a match in the title counting twice.
function fuzzyScore(query, titleWords, restWords) {
  let total = 0;
  for (const queryWord of query) {
    let best = 0;
    for (const word of titleWords) best = Math.max(best, 2 * wordMatch(queryWord, word));
    if (best < 2 * EXACT) for (const word of restWords) best = Math.max(best, wordMatch(queryWord, word));
    if (!best) return 0;
    total += best;
  }
  return total;
}

export { fuzzyScore, searchWords };
