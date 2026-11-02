'use strict';
/* La raison de tonalité seule, sur les 189 cantiques de la base en notes parfaites : le vrai GP.Moteur nourri par m.hauteur, sans audio ni oreille.
   node tests/banc/tonalite-hymnes.js [--partie reglage|controle|tout] [--params '{"x":1}'] [--jeux '[{},{"x":1}]'] [--liste]
   Réglage : cantiques d'indice pair. Contrôle : impairs, jamais pour régler. Tonalité vraie : celle de la partition (Open Hymnal).
   Notes parfaites, rubato léger : ce qui rate ici ratera aussi avec une vraie oreille. */
const S = require('./synth.js');
require('../../js/theorie.js'); require('../../js/moteur.js'); require('../../js/base-hymnes.js');
const GP = globalThis.GP;
const A = process.argv.slice(2), opt = n => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : null; };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/* Un cantique, deux couplets, transposé d'une quantité fixe par cantique : l'oreille absolue ne doit rien apprendre. */
function joue(c, i, params) {
  const ch = S.chantCorpus({ ...c, notes: c.melodie, basse: c.basse || [] }, { couplets: 2, transpose: (i * 5) % 12 - 5, rubato: .05, graine: 7 + i });
  const m = new GP.Moteur({ sr: 16000, reglages: { params } }), ks = []; m.on('tonalite', k => ks.push(k));
  const n = ch.notes, fin = ch.duree; let j = 0;
  for (let t = .02; t <= fin + .5; t += .02) {
    while (j < n.length && n[j].start + n[j].dur < t) j++;
    const v = n[j] && n[j].start <= t ? n[j] : null;
    m.hauteur(t, v ? v.midi : null, v ? 1 : 0, v ? .05 : .001);
  }
  const vrai = { tonic: ch.tonique, mode: ch.mode }, ok = k => k && k.tonic === vrai.tonic && k.mode === vrai.mode, t0 = n[0].start;
  let juste = 0; ks.forEach((k, x) => { const b = x + 1 < ks.length ? ks[x + 1].t : fin; if (ok(k)) juste += b - Math.max(t0, k.t); });
  const der = ks[ks.length - 1], prem = ks[0], couplet = fin / 2;
  // Fin du premier couplet : ce qu'un musicien sait à ce moment-là
  let k1 = null; for (const k of ks) if (k.t <= couplet) k1 = k;
  return { titre: c.titre, vrai, prem: prem ? { ok: ok(prem), t: prem.t - t0 } : null, k1: ok(k1), der: ok(der), derK: der, juste: 100 * juste / (fin - t0), changements: ks.filter((k, x) => x && (k.tonic !== ks[x - 1].tonic || k.mode !== ks[x - 1].mode)).length, duree: fin - t0 };
}

const nomTon = k => k ? GP.nomNote(k.tonic, k) + (k.mode === 'maj' ? ' maj' : ' min') : 'aucune';
function banc(params, partie) {
  const L = GP.baseHymnes.map((c, i) => ({ c, i })).filter(({ i }) => partie === 'tout' || (partie === 'controle' ? i % 2 : !(i % 2))).map(({ c, i }) => joue(c, i, params));
  const n = L.length, pc = f => (100 * L.filter(f).length / n).toFixed(0);
  return { n, prem: pc(e => e.prem && e.prem.ok), k1: pc(e => e.k1), der: pc(e => e.der), juste: (L.reduce((s, e) => s + e.juste * e.duree, 0) / L.reduce((s, e) => s + e.duree, 0)).toFixed(1), tPrem: med(L.filter(e => e.prem).map(e => e.prem.t)).toFixed(1), chg: (L.reduce((s, e) => s + e.changements, 0) / n).toFixed(2), L };
}

if (require.main === module) {
  const partie = opt('--partie') || 'reglage', jeux = JSON.parse(opt('--jeux') || JSON.stringify([JSON.parse(opt('--params') || '{}')]));
  console.log(`partie ${partie}, notes parfaites. 1re juste : premier verrou ; fin couplet 1 : tonalité affichée à la fin du premier couplet ; finale : dernière tonalité ; part juste : temps pondéré.`);
  console.log('| jeu | n | 1re juste | 1er verrou, médiane | fin couplet 1 | finale | part juste | changements par chant |\n|---|---|---|---|---|---|---|---|');
  for (const j of jeux) {
    const r = banc(j, partie);
    console.log(`| ${JSON.stringify(j)} | ${r.n} | ${r.prem} % | ${r.tPrem} s | ${r.k1} % | ${r.der} % | ${r.juste} % | ${r.chg} |`);
    if (A.includes('--liste')) {
      const deg = (k, v) => { const d = GP.mod(k.tonic - v.tonic, 12); return k.mode === v.mode ? (d === 7 ? 'dominante' : d === 5 ? 'sous-dominante' : 'autre') : (k.mode === 'min' && d === 9 ? 'relatif mineur' : k.mode === 'maj' && d === 3 ? 'relatif majeur' : 'autre mode'); };
      const faux = r.L.filter(e => !e.der), types = {}; faux.forEach(e => { const t = e.derK ? deg(e.derK, e.vrai) : 'aucune'; types[t] = (types[t] || 0) + 1; });
      console.log('  finales fausses :', JSON.stringify(types));
      faux.forEach(e => console.log(`   ${e.titre} : ${nomTon(e.vrai)} vu ${nomTon(e.derK)}`));
    }
  }
}
module.exports = { joue, banc };
