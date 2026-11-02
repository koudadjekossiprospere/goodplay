'use strict';
/* Mesure 3 : limites sur notes parfaites, sans audio. Rapide. Usage : node tests/banc/mesure-limites.js
   A. Tonalité selon le temps chanté et le profil.  B. Accord selon le temps écoulé après son début, frontières connues.
   Ces chiffres sont un plafond : aucune erreur de hauteur, frontières d'accords données par la vérité. */
const { chantCorpus, ornemente, lireCorpus, DEG, mod12 } = require('./synth.js');
const { PROFILS, apprendTransitions } = require('./proto.js');
const { rankKeys, keyCorr } = require('./moteur-actuel.js');
const corpus = lireCorpus();

function logP(nom, plancher) { return PROFILS[nom].map(p => { const s = p.reduce((a, b) => a + b, 0), q = p.map(v => Math.max(v / s, plancher)), z = q.reduce((a, b) => a + b, 0); return q.map(v => Math.log(v / z)); }); }
const ver = c => ({ tonic: c.tonalites[0].tonic, mode: c.tonalites[0].mode });

function tableTonalite() {
  console.log('== A. Part de chants où la tonalité trouvée est juste, selon le temps chanté (15 chants x 12 transpositions, notes parfaites) ==');
  const V = [3, 4, 6, 8, 10, 12, 15, 20, 30];
  const methodes = {
    'Krumhansl corrélation (actuel, x1.7 fin)': (ev) => { const h = new Array(12).fill(0); ev.forEach(e => h[mod12(e.midi)] += e.dur * (e.fin ? 1.7 : 1)); const r = rankKeys(h)[0]; return { tonic: r.tonic, mode: r.mode }; }
  };
  const corrP = nom => ev => { const h = new Array(12).fill(0), P = PROFILS[nom]; ev.forEach(e => h[mod12(e.midi)] += e.dur * (e.fin ? 1.7 : 1)); let b = -2, bk = null; for (let t = 0; t < 12; t++) for (let m = 0; m < 2; m++) { const x = h.map((_, i) => h[(i + t) % 12]); let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += x[i]; mb += P[m][i]; } ma /= 12; mb /= 12; let s = 0, sa = 0, sb = 0; for (let i = 0; i < 12; i++) { const u = x[i] - ma, v = P[m][i] - mb; s += u * v; sa += u * u; sb += v * v; } const r = s / Math.sqrt(sa * sb || 1); if (r > b) { b = r; bk = { tonic: t, mode: m ? 'min' : 'maj' }; } } return bk; };
  for (const nom of ['TKP', 'AE']) methodes[`corrélation ${nom} (seul le profil change)`] = corrP(nom);
  for (const nom of ['KS', 'TKP', 'BB', 'AE']) {
    const lp = logP(nom, .012);
    methodes[`vraisemblance ${nom}`] = (ev) => { let b = -1e9, bk = null; for (let t = 0; t < 12; t++) for (let m = 0; m < 2; m++) { let L = 0; ev.forEach(e => { L += Math.min(e.dur, 1) * (e.fin ? 1.5 : 1) * lp[m][mod12(e.midi - t)]; }); if (L > b) { b = L; bk = { tonic: t, mode: m ? 'min' : 'maj' }; } } return bk; };
    methodes[`vraisemblance ${nom} + indices début et fin de phrase`] = (ev) => {
      let b = -1e9, bk = null, prem = ev[0]; for (let t = 0; t < 12; t++) for (let m = 0; m < 2; m++) { let L = 0; ev.forEach(e => { L += Math.min(e.dur, 1) * (e.fin ? 1.5 : 1) * lp[m][mod12(e.midi - t)]; }); const d = mod12(prem.midi - t); if (d === 0 || d === 7 || d === (m ? 3 : 4)) L += 1.5; const fins = ev.filter(e => e.fin); if (fins.length && mod12(fins[fins.length - 1].midi - t) === 0) L += 1.5; if (L > b) { b = L; bk = { tonic: t, mode: m ? 'min' : 'maj' }; } } return bk; };
  }
  console.log('méthode'.padEnd(58) + V.map(v => (v + ' s').padStart(6)).join(''));
  for (const orne of [false, true]) {
    console.log(orne ? '-- avec vocalises --' : '-- mélodie nue --');
    for (const nom in methodes) {
      const res = V.map(() => [0, 0]);
      corpus.forEach((e, i) => { for (let tr = 0; tr < 12; tr++) {
        let c = chantCorpus(e, { transpose: tr - 5, couplets: 3 }); if (orne) c = ornemente(c, { graine: i * 13 + tr });
        const k = ver(c), ev = c.notes.map(n => ({ midi: n.midi, dur: n.dur, fin: n.fin, end: n.start + n.dur })); let t = 0, j = 0, cum = [];
        ev.forEach(x => { t += x.dur; cum.push(t); });
        V.forEach((v, iv) => { const n = cum.findIndex(x => x >= v); if (n < 0) return; const r = methodes[nom](ev.slice(0, n + 1)); res[iv][1]++; if (r.tonic === k.tonic && r.mode === k.mode) res[iv][0]++; });
      } });
      console.log(nom.padEnd(58) + res.map(([a, b]) => (b ? (100 * a / b).toFixed(0) + '%' : '-').padStart(6)).join(''));
    }
  }
}

/* B. Choix de l'accord à partir de la mélodie entre le début de l'accord et L secondes plus tard. Transitions et a priori apprises sur les 14 autres chants. */
function tableAccords() {
  console.log('\n== B. Accord juste à T+L, frontières données, accord précédent donné (plafond). Changements d\'accord seulement ==');
  const Ls = [0, .1, .2, .3, .5, .75, 1, 1.5, 99];
  const meth = {
    'score actuel (decide)': (w, tot, deg, cands, prev) => { let bs = -1e9, b = null; cands.forEach(cd => { const tones = [0, cd.q === 'maj' ? 4 : 3, 7].map(x => mod12(cd.root + x)); let s = 0; for (let pc = 0; pc < 12; pc++) { if (!w[pc]) continue; const x = w[pc] / (tot || 1); s += pc === cd.root ? x * 1.25 : tones.includes(pc) ? x : -x * .7; } s += cd.prior * .18; const FLOW = { '5>1': .08, '4>5': .04, '4>1': .04, '2>5': .07, '6>4': .04, '1>4': .03, '1>5': .03, '6>2': .03, '3>6': .04, '7>3': .04 }; s += FLOW[prev + '>' + cd.deg] || 0; if (cd.deg === prev) s += .06; if (s > bs) { bs = s; b = cd; } }); return b; },
    'bayésien, transitions apprises': (w, tot, deg, cands, prev, app, mode) => { let bs = -1e9, b = null; const row = app.tr[mode][prev] || {}, n = Object.values(row).reduce((a, x) => a + x, 0); cands.forEach(cd => { if (cd.deg === prev) return; const tones = [0, cd.q === 'maj' ? 4 : 3, 7].map(x => mod12(cd.root + x)); let s = Math.log(((row[cd.deg] || 0) + .5) / (n + 3)); for (let pc = 0; pc < 12; pc++) { if (!w[pc]) continue; s += Math.min(w[pc], 2) * (pc === cd.root ? Math.log(.32) : tones.includes(pc) ? Math.log(.24) : Math.log(.04)) * 2; } if (s > bs) { bs = s; b = cd; } }); return b; }
  };
  console.log('méthode'.padEnd(36) + Ls.map(l => (l === 99 ? 'tout' : l + ' s').padStart(7)).join(''));
  for (const nom in meth) {
    const res = Ls.map(() => [0, 0]);
    corpus.forEach((e, i) => {
      const app = apprendTransitions(corpus, i), c = chantCorpus(e, { couplets: 1 }), T = DEG[e.mode], cands = Object.entries(T).map(([d, [st, q]]) => ({ deg: +d, root: mod12(e.tonique + st), q, prior: e.mode === 'maj' ? { 1: 1, 2: .45, 3: .2, 4: .9, 5: .9, 6: .6 }[d] : { 1: 1, 3: .4, 4: .8, 5: .85, 6: .6, 7: .45 }[d] }));
      c.accords.forEach((a, j) => {
        if (!j || c.accords[j - 1].deg === a.deg) return;
        Ls.forEach((L, il) => {
          const t1 = a.start + Math.min(L, a.dur), w = new Array(12).fill(0); let tot = 0;
          c.notes.forEach(n => { const d = Math.min(n.start + n.dur, t1) - Math.max(n.start, a.start); if (d > 0) { w[mod12(n.midi)] += d; tot += d; } });
          const r = meth[nom](w, tot, a.deg, cands, c.accords[j - 1].deg, app, e.mode);
          res[il][1]++; if (r && r.deg === a.deg) res[il][0]++;
        });
      });
    });
    console.log(nom.padEnd(36) + res.map(([x, y]) => ((100 * x / y).toFixed(0) + '%').padStart(7)).join('') + `   (${res[0][1]} changements)`);
  }
}

/* C. Répartition des accords dans le corpus : ce que vaut la devinette seule */
function statsCorpus() {
  console.log('\n== C. Corpus : durée moyenne d\'un accord et part de I, IV, V ==');
  const dur = []; let iv = 0, tot = 0; corpus.forEach(e => { const bt = 60 / e.bpm; e.basse.forEach(([d, b]) => { dur.push(b * bt); tot += b; if (e.mode === 'maj' ? [1, 4, 5].includes(d) : [1, 4, 5].includes(d)) iv += b; }); });
  dur.sort((a, b) => a - b);
  console.log(`  ${dur.length} accords, durée médiane ${dur[dur.length >> 1].toFixed(2)} s, 10e centile ${dur[Math.floor(dur.length * .1)].toFixed(2)} s ; I IV V = ${(100 * iv / tot).toFixed(0)} % du temps`);
  // Durée d'accord contre la fenêtre actuelle de 1.6 s
  console.log(`  accords plus courts que la fenêtre actuelle de 1.6 s : ${(100 * dur.filter(d => d < 1.6).length / dur.length).toFixed(0)} %`);
}
tableTonalite(); tableAccords(); statsCorpus();
