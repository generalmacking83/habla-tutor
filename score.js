// Word-level "was it understood?" scoring for pronunciation drills.
// It compares what the browser's speech recognizer heard with the target sentence.
// This measures intelligibility to a recognizer, NOT accent or individual sounds.
(function (root) {
"use strict";

const EN_ONES = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const EN_TENS = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
const ES_LOW = ["cero","uno","dos","tres","cuatro","cinco","seis","siete","ocho","nueve","diez","once","doce","trece","catorce","quince","dieciseis","diecisiete","dieciocho","diecinueve","veinte","veintiuno","veintidos","veintitres","veinticuatro","veinticinco","veintiseis","veintisiete","veintiocho","veintinueve"];
const ES_TENS = ["","","","treinta","cuarenta","cincuenta","sesenta","setenta","ochenta","noventa"];

function numWords(n, L) {
  if (L === "es") {
    if (n < 30) return ES_LOW[n];
    return ES_TENS[Math.floor(n / 10)] + (n % 10 ? " y " + ES_LOW[n % 10] : "");
  }
  if (n < 20) return EN_ONES[n];
  return EN_TENS[Math.floor(n / 10)] + (n % 10 ? " " + EN_ONES[n % 10] : "");
}

// Expanded on both sides, so "I'm" and "I am" count as the same words.
const CONTR = {
  "i'm":"i am","you're":"you are","we're":"we are","they're":"they are","he's":"he is","she's":"she is",
  "it's":"it is","that's":"that is","what's":"what is","there's":"there is","here's":"here is","let's":"let us",
  "i've":"i have","you've":"you have","we've":"we have","they've":"they have",
  "i'll":"i will","you'll":"you will","we'll":"we will","they'll":"they will","it'll":"it will",
  "i'd":"i would","you'd":"you would","we'd":"we would","they'd":"they would",
  "can't":"can not","cannot":"can not","won't":"will not","don't":"do not","doesn't":"does not","didn't":"did not",
  "isn't":"is not","aren't":"are not","wasn't":"was not","weren't":"were not","haven't":"have not","hasn't":"has not",
  "couldn't":"could not","shouldn't":"should not","wouldn't":"would not"
};

function normWords(s, L) {
  s = String(s || "").toLowerCase().replace(/[’‘`´]/g, "'")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // á→a, ñ→n: recognizers vary on these
    .replace(/[-–—_/]/g, " ")
    .replace(/[^a-z0-9'\s]/g, " ");
  const out = [];
  for (let t of s.split(/\s+/)) {
    t = t.replace(/^'+|'+$/g, "");
    if (!t) continue;
    if (/^\d+$/.test(t) && +t < 100) { out.push(...numWords(+t, L).split(" ")); continue; }
    if (L !== "es" && CONTR[t]) { out.push(...CONTR[t].split(" ")); continue; }
    t = t.replace(/'/g, "");
    if (t) out.push(t);
  }
  return out;
}

// Longest common subsequence: which target words appear, in order, in what was heard.
function lcsMatch(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hitA = new Array(n).fill(false), hitB = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { hitA[i] = hitB[j] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return { hitA, hitB, count: dp[0][0] };
}

// target: the sentence shown. heard: one recognizer transcript.
// Returns a 0-100 score plus each displayed word marked ok / part / miss.
function scoreOne(target, heard, L) {
  const display = String(target).split(/\s+/).filter(Boolean);
  const flat = [], owner = [];
  display.forEach((tok, di) => normWords(tok, L).forEach(w => { flat.push(w); owner.push(di); }));
  const got = normWords(heard, L);
  if (!flat.length) return { score: 0, words: [], extra: got, heard };
  const { hitA, hitB, count } = lcsMatch(flat, got);
  const words = display.map((tok, di) => {
    const idx = owner.map((o, k) => o === di ? k : -1).filter(k => k >= 0);
    if (!idx.length) return { w: tok, st: "na" };
    const h = idx.filter(k => hitA[k]).length;
    return { w: tok, st: h === idx.length ? "ok" : h ? "part" : "miss" };
  });
  const extra = got.filter((_, k) => !hitB[k]);
  // Dice/F1 overlap: missing words and extra words both lower the score.
  const score = Math.round(200 * count / (flat.length + got.length));
  return { score, words, extra, heard };
}

// alternatives: the recognizer's candidate transcripts. Uses the most favourable one.
function scoreBest(target, alternatives, L) {
  const alts = (alternatives || []).filter(a => a && a.trim());
  if (!alts.length) return null;
  return alts.map(h => scoreOne(target, h, L)).sort((x, y) => y.score - x.score)[0];
}

const api = { normWords, scoreOne, scoreBest, numWords };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.HablaScore = api;
})(typeof window !== "undefined" ? window : this);
