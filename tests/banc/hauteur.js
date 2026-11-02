'use strict';
/* Détecteurs de hauteur comparés par le banc. yinActuel est recopié de index.html sans changement (lignes 542 à 550). */

function yinActuel(x, sr) {
  const W = 1024, minT = Math.floor(sr / 1000), maxT = Math.min(Math.floor(sr / 70), x.length - W - 1), d = new Float32Array(maxT + 1);
  for (let t = 1; t <= maxT; t++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; s += v * v; } d[t] = s; }
  let run = 0; d[0] = 1; for (let t = 1; t <= maxT; t++) { run += d[t]; d[t] = run ? d[t] * t / run : 1; }
  let tau = -1; for (let t = minT; t <= maxT; t++) { if (d[t] < 0.15) { while (t + 1 <= maxT && d[t + 1] < d[t]) t++; tau = t; break; } }
  if (tau < 0) return null;
  let bt = tau; if (tau > 1 && tau < maxT) { const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b; if (den) bt = tau + .5 * (a - c) / den; }
  return { f: sr / bt, conf: 1 - d[tau] };
}

/* Décimation entière avec filtre passe-bas (sinc fenêtré). Coût : taps/facteur multiplications par échantillon d'entrée. */
function creeDecimateur(facteur, taps = 47) {
  const h = new Float64Array(taps), fc = .45 / facteur, c = (taps - 1) / 2; let s = 0;
  for (let i = 0; i < taps; i++) { const u = i - c, sinc = u ? Math.sin(2 * Math.PI * fc * u) / (Math.PI * u) : 2 * fc; h[i] = sinc * (.54 + .46 * Math.cos(Math.PI * u / (c + 1))); s += h[i]; }
  for (let i = 0; i < taps; i++) h[i] /= s;
  return x => { const n = Math.floor((x.length - taps) / facteur), y = new Float32Array(n); for (let k = 0; k < n; k++) { let v = 0; const o = k * facteur; for (let i = 0; i < taps; i++) v += h[i] * x[o + i]; y[k] = v; } return y; };
}

/* YIN paramétrable : seuil absolu puis repli sur le minimum global, rend aussi l'apériodicité */
function yinP(x, sr, o = {}) {
  const W = o.W || Math.floor(x.length * .68), minT = Math.floor(sr / (o.fmax || 1100)), maxT = Math.min(Math.floor(sr / (o.fmin || 70)), x.length - W - 1), seuil = o.seuil ?? .15, d = new Float32Array(maxT + 1);
  for (let t = 1; t <= maxT; t++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[i] - x[i + t]; s += v * v; } d[t] = s; }
  let run = 0; d[0] = 1; for (let t = 1; t <= maxT; t++) { run += d[t]; d[t] = run ? d[t] * t / run : 1; }
  let tau = -1; for (let t = minT; t <= maxT; t++) { if (d[t] < seuil) { while (t + 1 <= maxT && d[t + 1] < d[t]) t++; tau = t; break; } }
  if (tau < 0) { if (o.repli === false) return null; let m = 1; for (let t = minT; t <= maxT; t++) if (d[t] < m) { m = d[t]; tau = t; } if (tau < 0) return null; }
  let bt = tau; if (tau > 1 && tau < maxT) { const a = d[tau - 1], b = d[tau], c = d[tau + 1], den = a + c - 2 * b; if (den) bt = tau + .5 * (a - c) / den; }
  return { f: sr / bt, conf: 1 - d[tau] };
}

/* MPM (McLeod et Wyvill 2005) : fonction NSDF, premier maximum clé au dessus de k fois le plus grand. conf = clarté. */
function mpm(x, sr, o = {}) {
  const N = x.length, maxT = Math.min(Math.floor(sr / (o.fmin || 70)), N - 2), minT = Math.floor(sr / (o.fmax || 1100)), k = o.k ?? .9, n = new Float32Array(maxT + 1);
  for (let t = 0; t <= maxT; t++) { let r = 0, m = 0; const L = N - t; for (let i = 0; i < L; i++) { const a = x[i], b = x[i + t]; r += a * b; m += a * a + b * b; } n[t] = m ? 2 * r / m : 0; }
  const pics = []; let t = 1, max = 0; while (t <= maxT && n[t] > 0) t++;
  while (t < maxT) {
    while (t < maxT && n[t] <= 0) t++;
    let bm = -2, bi = -1; while (t <= maxT && n[t] > 0) { if (n[t] > bm && t < maxT && n[t] >= n[t + 1] && n[t] >= n[t - 1]) { bm = n[t]; bi = t; } t++; }
    if (bi > 0 && bi >= minT) { pics.push(bi); if (bm > max) max = bm; }
  }
  if (!pics.length) return null;
  const tau = pics.find(p => n[p] >= k * max);
  let bt = tau; if (tau > 0 && tau < maxT) { const a = n[tau - 1], b = n[tau], c = n[tau + 1], den = a + c - 2 * b; if (den) bt = tau + .5 * (a - c) / den; }
  return { f: sr / bt, conf: n[tau] };
}

module.exports = { yinActuel, yinP, mpm, creeDecimateur };
