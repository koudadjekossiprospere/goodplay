'use strict';
/* La barre à battre : sur les vraies voix calées (jeu/vraies-voix), part du temps chanté où la basse proposée est la bonne.
   On compare des notes de basse (classe de hauteur), pas des degrés : si la tonalité est fausse, le degré l'est aussi, et c'est la basse que le pianiste joue.
   Moteur actuel : les notes de l'oreille rejouées dans un GP.Moteur neuf, au rythme de ses tics (sans refaire MPM).
   node tests/donnees/eval-vraies-voix.js <dossier donnees> [--controle-oreille | --symbolique]
   --controle-oreille : contrôle indépendant de l'oreille simulée, sur ces voix d'église (part des notes calées, nombre de notes rendues). */
const fs = require('fs'), path = require('path'), assert = require('assert');
require('../../js/theorie.js'); require('../../js/moteur.js');
const GP = globalThis.GP;
const { caler } = require('./vraies-voix-jeu.js');
const { simuler } = require('./oreille-simulee.js');
const mod12 = x => ((x % 12) + 12) % 12, med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

/* Rejoue des notes [midi, début, fin] dans un moteur neuf ; renvoie la grille (cases avec début, fin et fondamentale). */
const AVANT = .5; // un peu de silence d'abord : sinon le moteur prend la première note pour le bruit de fond et n'entend plus rien
function moteurSur(notes) {
  const m = new GP.Moteur({ sr: 16000 }), fin = notes.length ? notes[notes.length - 1][2] + 1 : 0;
  let j = 0;
  for (let t = .02; t <= fin + AVANT + 1e-9; t += .02) {
    const u = t - AVANT;
    while (j < notes.length && notes[j][2] < u) j++;
    const n = notes[j] && notes[j][1] <= u ? notes[j] : null;
    m.hauteur(t, n ? n[0] : null, n ? 1 : 0, n ? .05 : .001);
  }
  return m.grille.map((c, i, g) => ({ debut: c.t - AVANT, fin: (i + 1 < g.length ? g[i + 1].t : fin + AVANT) - AVANT, racine: c.racine, alternatives: (c.alternatives || []).map(a => a.racine) }));
}
const caseA = (g, t) => { for (const c of g) if (t >= c.debut && t < c.fin) return c; return null; };

/* Score d'une prédiction : part du temps des notes calées où la basse est juste, et où elle figure parmi les propositions affichées. */
/* « juste » : basse affichée au début de la note (ce que le débutant joue en même temps que le chant).
   « aTemps » : basse affichée à la fin de la note (décidée avant la note suivante, plus proche du « au plus tard en fin de phrase »). */
function score(vv, grille) {
  let tout = 0, juste = 0, parmi = 0, aTemps = 0;
  for (const [, debut, fin, deg, rel] of vv.verite.notes) {
    if (deg === null) continue;
    const d = fin - debut, c = caseA(grille, debut + .01), cf = caseA(grille, Math.max(debut + .01, fin - .01)), vrai = mod12(vv.verite.tonique + rel);
    tout += d;
    if (c && c.racine === vrai) { juste += d; parmi += d; } else if (c && c.alternatives.includes(vrai)) parmi += d;
    if (cf && cf.racine === vrai) aTemps += d;
  }
  return { tout, juste, parmi, aTemps };
}

/* Même mesure sur le test symbolique figé (jeu/exemples), notes parfaites puis oreille simulée, par style. */
function symbolique(dossier) {
  for (const v of ['parfait', 'oreille']) {
    const f = path.join(dossier, 'jeu', 'exemples', `test-${v}.jsonl`), parStyle = {};
    for (const l of fs.readFileSync(f, 'utf8').trim().split('\n')) {
      const e = JSON.parse(l), notes = e.notes.map(x => [x[1], x[2], x[3]]);
      const vv = { verite: { tonique: e.ton.tonique, notes: e.notes.map((x, i) => [x[1], x[2], x[3], e.etiquettes[i][0], e.etiquettes[i][1]]) } };
      const s = score(vv, moteurSur(notes));
      // « un » : toujours le 1, la référence la plus bête
      const un = vv.verite.notes.reduce((z, n) => z + (n[4] === 0 ? n[2] - n[1] : 0), 0);
      for (const st of ['tout', ...e.style, 'origine ' + e.origine]) { const a = parStyle[st] = parStyle[st] || { tout: 0, juste: 0, parmi: 0, aTemps: 0, un: 0, n: 0 }; a.tout += s.tout; a.juste += s.juste; a.parmi += s.parmi; a.aTemps += s.aTemps; a.un += un; a.n++; }
    }
    console.log(`\nTest symbolique, ${v === 'parfait' ? 'notes parfaites' : 'oreille simulée'} | chants | basse juste au début de la note | à la fin de la note | juste ou en choix | toujours le 1 |\n|---|---|---|---|---|---|`);
    const p = (a, k) => (100 * a[k] / a.tout).toFixed(1) + ' %';
    for (const [st, a] of Object.entries(parStyle).sort((x, y) => y[1].n - x[1].n)) console.log(`| ${st} | ${a.n} | ${p(a, 'juste')} | ${p(a, 'aTemps')} | ${p(a, 'parmi')} | ${p(a, 'un')} |`);
  }
}

function main(dossier, controle) {
  const dir = path.join(dossier, 'jeu', 'vraies-voix'), chants = new Map(fs.readFileSync(path.join(dossier, 'jeu', 'test.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.id, r]));
  const pistes = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'bilan.json').map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(v => v.verite && v.verite.fiable);
  let T = 0, J = 0, P = 0, A = 0, U = 0; const lignes = [], ctl = { vraie: [], simulee: [], rv: [], rs: [] };
  for (const vv of pistes) {
    const s = score(vv, moteurSur(vv.notes));
    T += s.tout; J += s.juste; P += s.parmi; A += s.aTemps;
    U += vv.verite.notes.reduce((z, n) => z + (n[3] !== null && n[4] === 0 ? n[2] - n[1] : 0), 0);
    lignes.push(`| ${vv.titre} | ${(100 * vv.verite.partAlignee).toFixed(0)} % | ${s.tout ? (100 * s.juste / s.tout).toFixed(0) : '-'} % | ${s.tout ? (100 * s.aTemps / s.tout).toFixed(0) : '-'} % | ${s.tout ? (100 * s.parmi / s.tout).toFixed(0) : '-'} % |`);
    if (controle) {
      // Même chant, mêmes couplets, au tempo de la piste : les notes parfaites passées dans l'oreille simulée se calent-elles comme les vraies ?
      const chant = chants.get(vv.chant), mel = chant.notes.filter(n => n[0] !== null), q = mel[mel.length - 1][1] + mel[mel.length - 1][2];
      const cal = vv.verite.notes.filter(n => n[3] !== null), duree = cal.length ? cal[cal.length - 1][2] - cal[0][1] : 0, s = duree / (q * vv.verite.couplets);
      if (!(s > 0)) continue;
      const parfaites = []; for (let k = 0; k < vv.verite.couplets; k++) for (const [h, t, d] of mel) parfaites.push({ midi: h + vv.verite.tonique - chant.ton.tonique, debut: (k * q + t) * s, fin: (k * q + t + d) * s });
      const sim = simuler(parfaites, undefined, 7), cs = caler(sim, chant);
      ctl.vraie.push(vv.verite.partAlignee); ctl.simulee.push(cs ? cs.part : 0);
      ctl.rv.push(vv.notes.length / parfaites.length); ctl.rs.push(sim.length / parfaites.length);
    }
  }
  console.log(`Moteur actuel (règles et Viterbi) sur ${pistes.length} vraies voix calées, part du temps chanté calé : basse juste au début de la note ${(100 * J / T).toFixed(1)} %, à la fin de la note ${(100 * A / T).toFixed(1)} %, juste ou proposée en choix ${(100 * P / T).toFixed(1)} % ; toujours le 1 : ${(100 * U / T).toFixed(1)} %.`);
  console.log('| piste | notes calées | basse juste au début | à la fin | juste ou en choix |\n|---|---|---|---|---|\n' + lignes.join('\n'));
  if (controle) console.log(`\nContrôle de l'oreille simulée sur ces voix d'église (médianes) : notes calées, vraie ${(100 * med(ctl.vraie)).toFixed(0)} %, simulée ${(100 * med(ctl.simulee)).toFixed(0)} % ; notes rendues par note chantée, vraie ${med(ctl.rv).toFixed(2)}, simulée ${med(ctl.rs).toFixed(2)}. (Les notes chantées comptent les couplets estimés par le calage.)`);
}

{ // une basse juste puis fausse : 50 % ; la fausse figure dans les choix : 100 %
  const vv = { verite: { tonique: 0, notes: [[60, 0, 1, 1, 0], [67, 1, 2, 5, 7]] } };
  const g = [{ debut: 0, fin: 1, racine: 0, alternatives: [] }, { debut: 1, fin: 3, racine: 9, alternatives: [7] }];
  const s = score(vv, g); assert.strictEqual(s.juste / s.tout, .5); assert.strictEqual(s.parmi / s.tout, 1);
}

if (require.main === module && process.argv[2]) {
  if (process.argv.includes('--symbolique')) symbolique(process.argv[2]);
  else main(process.argv[2], process.argv.includes('--controle-oreille'));
}
module.exports = { moteurSur, score };
