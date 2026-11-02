'use strict';
/* Balayage de paramètres du prototype sur les trames gardées par mesure-moteur.js.
   Usage : node tests/banc/balayage.js <0|1|tout> '<json {param:[valeurs]}>' 'scène,scène'
   0 = chants pairs (réglage), 1 = chants impairs (contrôle). Chaque ligne cumule les scènes demandées. */
const { SCENES, chants, analyse, metriques, cumule, protoSur } = require('./mesure-moteur.js');
const moitie = process.argv[2] === 'tout' ? null : +process.argv[2], grille = JSON.parse(process.argv[3] || '{}'), noms = (process.argv[4] || 'simple, studio;vocalises 9e 11e, salle').split(';');
const graine = +(process.env.GRAINE || 1), base = JSON.parse(process.env.BASE || '{}');
const donnees = noms.map(s => { const cs = chants(graine, SCENES[s]); return cs.map((c, i) => (moitie != null && i % 2 !== moitie) ? null : { c, i, res: analyse(s, i, graine) }).filter(Boolean); });
const cles = Object.keys(grille);
const f = (v, d = 0) => Number.isFinite(v) ? v.toFixed(d) : '-';
function essai(o) {
  const parScene = donnees.map(l => cumule(l.map(({ c, i, res }) => metriques(c, protoSur(res, { ...base, ...o }, i, c)))));
  return parScene.map(s => `verrou ${f(s.lockMed, 1)} s juste ${f(s.lockOk)} % temps ${f(s.tempsJuste)} % fausses ${s.fausses} | couv ${f(s.couv)} % T+.3 ${f(s.a300)} % T+1 ${f(s.a1s)} % lat ${f(s.latMed, 2)} p90 ${f(s.latP90, 2)} ratés ${f(s.rates)} %` + (s.det ? ` | mod ${s.detOk}/${s.det} en ${f(s.detMed, 1)} s` : '')).join('  ||  ');
}
(function rec(i, o) {
  if (i === cles.length) { console.log(JSON.stringify(o).padEnd(34) + essai(o)); return; }
  grille[cles[i]].forEach(v => rec(i + 1, { ...o, [cles[i]]: v }));
})(0, {});
