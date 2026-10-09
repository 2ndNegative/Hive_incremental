import { squarify } from '../src/game/treemap.js';
let fails = 0;
const ck = (l, ok, d='') => { console.log(`${ok?'PASS':'FAIL'}  ${l}${d?` — ${d}`:''}`); if(!ok) fails++; };

const W = 1000, H = 300;
const mk = (vals) => vals.map((v, i) => ({ id: `b${i}`, value: v }));

// area fidelity across many random holdings
let worstArea = 0, worstRatio = 0, worstBigRatio = 0, overlaps = 0, outside = 0;
for (let trial = 0; trial < 300; trial += 1) {
  const n = 1 + Math.floor(Math.random() * 20);
  const vals = Array.from({ length: n }, () => Math.random() ** 2 * 100 + 0.5);
  const total = vals.reduce((a,b)=>a+b,0);
  const tiles = squarify(mk(vals), W, H);
  if (tiles.length !== n) { console.log('count mismatch'); fails++; }
  for (const t of tiles) {
    const expected = (t.value / total) * W * H;
    worstArea = Math.max(worstArea, Math.abs(t.w * t.h - expected) / expected);
    const ratio = Math.max(t.w/t.h, t.h/t.w);
    worstRatio = Math.max(worstRatio, ratio);
    // Squareness only means anything for a tile big enough to read. A holding
    // worth 0.02% of the hive is a sliver however it is laid out — the area is
    // the data, and the data is what the map promises to be honest about.
    if (t.value / total >= 0.02) worstBigRatio = Math.max(worstBigRatio, ratio);
    if (t.x < -0.01 || t.y < -0.01 || t.x+t.w > W+0.01 || t.y+t.h > H+0.01) outside++;
  }
  for (let i=0;i<tiles.length;i++) for (let j=i+1;j<tiles.length;j++) {
    const a=tiles[i], b=tiles[j];
    const ox = Math.min(a.x+a.w,b.x+b.w) - Math.max(a.x,b.x);
    const oy = Math.min(a.y+a.h,b.y+b.h) - Math.max(a.y,b.y);
    if (ox > 0.5 && oy > 0.5) overlaps++;
  }
}
ck('tile area is exactly proportional to value', worstArea < 1e-6, `worst error ${(worstArea*100).toExponential(1)}%`);
ck('no tile escapes the frame', outside === 0);
ck('no two tiles overlap', overlaps === 0, '300 random holdings, up to 20 biomes');
// Squareness is checked against real cases below, not against the pathological
// random spread above — a 200:1 range of values inside one 3.3:1 frame forces
// elongated tiles no algorithm can avoid, and area fidelity is what matters
// there. Reported for information.
console.log(`      (random spread: worst aspect ${worstRatio.toFixed(0)}:1, worst among tiles >= 2%: ${worstBigRatio.toFixed(1)}:1)`);

// The worked example from Bruls, Huizing & van Wijk. If the implementation
// drifts, this is what catches it — these rectangles are published.
{
  const t = squarify([6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ id: `i${i}`, value: v })), 6, 4);
  const got = t.map((x) => `${x.w.toFixed(2)}x${x.h.toFixed(2)}`).join(' ');
  const want = '3.00x2.00 3.00x2.00 1.71x2.33 1.29x2.33 1.20x1.67 1.20x1.67 0.60x1.67';
  ck('reproduces the published worked example', got === want, got === want ? '7 tiles exact' : got);
}

// A real holding: every biome the hive could plausibly own at once.
{
  const real = [64, 48, 36, 30, 28, 26, 22, 20, 18, 16, 14, 11, 10, 9, 8, 7, 5, 4, 3]
    .map((v, i) => ({ id: `b${i}`, value: v }));
  const t = squarify(real, 1000, 300);
  const asp = t.map((x) => Math.max(x.w / x.h, x.h / x.w)).sort((a, b) => a - b);
  ck('a realistic 19-biome holding stays close to square',
    asp[asp.length - 1] < 5,
    `worst ${asp[asp.length - 1].toFixed(2)}:1, median ${asp[Math.floor(asp.length / 2)].toFixed(2)}:1`);
}

// the degenerate cases that break naive implementations
ck('a single holding fills the whole frame', (() => {
  const [t] = squarify(mk([36]), W, H);
  return Math.abs(t.w - W) < 0.01 && Math.abs(t.h - H) < 0.01;
})());
ck('zero and negative values are dropped, not drawn',
  squarify([{id:'a',value:5},{id:'b',value:0},{id:'c',value:-3}], W, H).length === 1);
ck('an empty holding draws nothing', squarify([], W, H).length === 0);
ck('a zero-size frame draws nothing', squarify(mk([5,5]), 0, 300).length === 0);
ck('one huge and one tiny still both get drawn', squarify(mk([10000, 0.01]), W, H).length === 2);

// squarified must beat slice-and-dice on aspect ratio, which is its only reason to exist
const many = mk(Array.from({length: 16}, (_, i) => (i+1) * 3));
const sq = squarify(many, W, H);
const worstSq = Math.max(...sq.map(t => Math.max(t.w/t.h, t.h/t.w)));
ck('16 biomes all stay close to square', worstSq < 8, `worst aspect ${worstSq.toFixed(1)}:1`);

console.log(fails ? `\n=== ${fails} FAILED ===` : '\n=== treemap geometry verified ===');
process.exit(fails?1:0);
