'use strict';
/* Test rapide du vrai moteur sur signal synthétique : note, accordage, tonalité, grille, mémoire, Transpose, doigtés. Usage : node tests/test-moteur.js */
const assert = require('assert'), fs = require('fs'), path = require('path');
require('../js/theorie.js'); require('../js/moteur.js'); require('../js/doigtes.js');
const GP = globalThis.GP;
const { synth, chantCorpus, lireCorpus } = require('./banc/synth.js');

function ecoute(x, sr, o = {}, pas = 960, pilote) {
  const m = new GP.Moteur({ sr, reglages: o }), ev = { note: [], tonalite: [], accord: [], accordCorrige: [], prochain: [], phrase: [], provi: [], tempo: [], grille: [] };
  m.on('note', e => ev.note.push(e)).on('tonalite', e => ev.tonalite.push(e)).on('accord', e => ev.accord.push(e)).on('accordCorrige', e => ev.accordCorrige.push(e)).on('prochain', e => ev.prochain.push(e)).on('phrase', e => ev.phrase.push(e)).on('tonaliteProvisoire', e => ev.provi.push(e)).on('tempo', e => ev.tempo.push(e)).on('grilleRefaite', e => ev.grille.push(e));
  for (let i = 0; i < x.length; i += pas) { const f = x.subarray(i, Math.min(x.length, i + pas)), t = (i + f.length) / sr; if (pilote) pilote(m, t); m.trame(f, t); }
  return { m, ev };
}
const ok = t => console.log('  ok ' + t);

/* Théorie et Transpose */
assert.strictEqual(GP.nomNote(1, { tonic: 8, mode: 'maj' }), 'Ré♭'); assert.strictEqual(GP.nomNote(1, { tonic: 2, mode: 'maj' }), 'Do♯'); assert.strictEqual(GP.nomNote(0, null, 'en'), 'C');
assert.strictEqual(GP.nomAccord(7, 'maj7', { tonic: 7, mode: 'maj' }), 'Sol7M'); assert.strictEqual(GP.SUFFIXE.dim7, '°7'); assert.strictEqual(GP.SUFFIXE.add2, 'add2');
for (let t = 0; t < 12; t++) for (const mode of ['maj', 'min']) {
  const k = { tonic: t, mode }; assert.deepStrictEqual(GP.vue(k, null), { pk: k, sh: 0 });
  for (let j = 0; j < 12; j++) {
    const { pk, sh } = GP.vue(k, j); assert(sh >= -6 && sh <= 6, 'Transpose hors plage');
    assert.strictEqual(GP.mod(pk.tonic + sh), t, 'le clavier doit sonner dans la tonalité du chant');
    assert.strictEqual(pk.mode, mode); assert.strictEqual(pk.tonic, mode === 'maj' ? j : GP.mod(j + 9), 'chant mineur : relative mineure du choix');
  }
}
assert.strictEqual(GP.vue({ tonic: 7, mode: 'maj' }, 0).sh, -5); assert.strictEqual(GP.nomAccord(7, 'maj', { tonic: 7, mode: 'maj' }, 0), 'Do');
assert.strictEqual(GP.nomAccord(4, 'min', { tonic: 4, mode: 'min' }, 0), 'Lam');
ok('noms et Transpose, 12 tonalités, 2 modes');

/* Règle du bassiste : aucune préférence pour la fondamentale */
{ const m = new GP.Moteur(); m._fixeTon({ tonic: 0, mode: 'maj' }, 0, false); const i = m.cands.findIndex(c => c.deg === 1), e = m.E[i]; assert.strictEqual(e[0], e[4]); assert.strictEqual(e[0], e[7]); assert(e[0] > e[2]); }
/* Mineur : la sensible va au 5 majeur */
{ const m = new GP.Moteur(); m._fixeTon({ tonic: 9, mode: 'min' }, 0, false); const v = m.cands.findIndex(c => c.deg === 5), i = m.cands.findIndex(c => c.deg === 1), sens = 8; assert(m.E[v][sens] > m.E[i][sens]); assert.strictEqual(m.cands[v].q, 'maj'); }
/* Matrices identiques à la source quand elle est là */
{ const f = path.join(__dirname, '..', 'docs', 'recherche', 'transitions-basse.json'); if (fs.existsSync(f)) { const s = JSON.parse(fs.readFileSync(f, 'utf8')); assert.deepStrictEqual(GP.TRANSITIONS.maj, s.maj); assert.deepStrictEqual(GP.TRANSITIONS.min, s.min); } }
ok('émissions et matrices');

/* Décimation : tout rapport, tout découpage de paquets */
for (const sr of [44100, 48000]) {
  const x = new Float32Array(sr); for (let i = 0; i < sr; i++) x[i] = .02 * Math.sin(2 * Math.PI * 440 * i / sr);
  const hs = [], m = new GP.Moteur({ sr }), av = m.hauteur.bind(m); m.hauteur = (t, md, c, r) => { if (md != null) hs.push(md); av(t, md, c, r); };
  let i = 0, t = 0; while (i < sr) { const n = 128 + (i % 7) * 40, f = x.subarray(i, i + n); i += n; t = i / sr; m.trame(f, t); }
  hs.sort((a, b) => a - b); assert(hs.length > 30 && Math.abs(hs[hs.length >> 1] - 69) < .03, `La 440 à ${sr} Hz : ${hs[hs.length >> 1]}`);
}
ok('MPM et décimation, 44,1 et 48 kHz');

/* Note et accordage : +40 cents, sans erreur de demi-ton, avec le plancher adaptatif à faible niveau */
{
  const notes = [60, 62, 64, 65, 67].map((m, i) => ({ midi: m, start: .3 + i * .6, dur: .55 }));
  const { x } = synth(notes, { sr: 48000, rms: .002, accordage: { cents: 40 }, bruit: { snr: 30 }, graine: 3 });
  const { m, ev } = ecoute(x, 48000);
  assert.deepStrictEqual(ev.note.map(n => n.midi), [60, 62, 64, 65, 67], 'notes');
  assert(Math.abs(m.accordage - .4) < .1, 'accordage ' + m.accordage);
  assert(ev.note.every(n => typeof n.cents === 'number' && n.fin > n.debut));
}
ok('notes justes à RMS .002 et +40 cents');

/* Un chant complet, une reprise */
const corpus = lireCorpus(), e0 = corpus[0], chant = chantCorpus(e0, { couplets: 2 }), { x } = synth(chant.notes, { sr: 48000, rms: .02, bruit: { snr: 35 }, graine: 5, duree: chant.duree + 1 });
{
  const { m, ev } = ecoute(x, 48000);
  const k = ev.tonalite[0]; assert(k && k.tonic === 7 && k.mode === 'maj' && !k.modulation, 'tonalité de Amazing Grace'); assert(ev.tonalite.every(t => !t.modulation), 'aucune modulation');
  assert(ev.provi.length && ev.provi[0].etat === 'provisoire'); assert.strictEqual(k.etat, 'probable'); assert(ev.tonalite.some(t => t.etat === 'sure'), 'la tonalité devient sûre');
  assert(ev.grille.length, 'grilleRefaite au verrouillage');
  // la grille part de la première note chantée, pas du verrouillage (2 s avec la Raison apprise, 5 s avec le profil)
  assert(m.grille[0].t <= ev.note[0].debut + .1 && m.grille[0].t < k.t - 1, 'les notes chantées avant le verrouillage sont réanalysées');
  const c = m.grille[0]; for (const f of ['deg', 'racine', 'q', 'basse', 't', 'dur', 'conf', 'alternatives', 'mots']) assert(f in c, 'case sans ' + f);
  assert(c.alternatives.length && 'p' in c.alternatives[0]);
  assert(m.grille.some(g => g.deg === 4) && m.grille.some(g => g.deg === 5), 'squelette 1 4 5');
  assert(ev.accord.length && ev.accord.every(a => a.racine >= 0 && 'provisoire' in a));
  assert(ev.prochain.some(p => p.appris) && ev.prochain.some(p => !p.appris), 'prochain appris et prévu');
  assert(ev.prochain.filter(p => p.appris).every(p => p.dans >= 0));
  assert(ev.phrase.some(p => p.reprise), 'la reprise est reconnue'); assert(m.grille.some(g => g.lettre), 'lettres de section');
  assert(ev.tempo.length);
  // La grille est le squelette : cases contiguës, la dernière dure, pas de voisines identiques ni de case minuscule une fois le recul pris.
  m.grille.forEach((g, i) => { const s = m.grille[i + 1]; if (s) assert(Math.abs(g.t + g.dur - s.t) < 1e-6, 'cases contiguës ' + i); });
  assert(m.grille[m.grille.length - 1].dur > .1, 'la dernière case dure');
  m.grille.slice(1, -3).forEach((g, i) => { assert(g.dur >= m.P.caseMin, 'case trop brève ' + i); assert(g.deg !== m.grille[i].deg, 'voisines identiques ' + i); });
  // L'accord porte la racine réelle, jamais transposée.
  const a = m.grille.find(g => g.deg === 1); assert.strictEqual(a.racine, 7);
}
ok('tonalité, grille, réanalyse, reprise, lettres');

/* Verrou adaptatif de la Raison « profil » (toujours disponible) : jamais sans assez de notes différentes, jamais sans avance sauf au plafond, et le relatif ne bloque pas */
{
  const chante = (pcs, o = {}) => { const m = new GP.Moteur({ reglages: { params: { raison: 'profil', ...o } } }), ks = []; m.on('tonalite', k => ks.push({ ...k, voise: m.voise })); let t = 0; for (const pc of pcs) { t += 1; m._tonalite({ midi: 60 + pc, pc, fin: t, fin_de_phrase: false, clarteMoy: 1 }, 1); } return ks; };
  const clair = chante([0, 4, 7, 5, 2, 0, 4, 7, 5, 2]); assert(clair.length && clair[0].voise >= 4 && clair[0].voise < 8, 'verrou avant le plafond : ' + (clair[0] && clair[0].voise)); assert.strictEqual(clair[0].etat, 'probable');
  assert.strictEqual(chante([0, 4, 7, 0, 4, 7, 0, 4, 7])[0].voise, 8, 'trois notes différentes : on attend le plafond');
  assert.strictEqual(chante([0, 4, 7, 5, 2, 0, 4, 7, 5, 2], { margeLock: 1e9 })[0].voise, 8, 'sans avance : on attend le plafond');
  const relatif = new GP.Moteur(); relatif.voise = 5; relatif.recentes = [0, 2, 4, 5].map(pc => ({ pc })); relatif.L.fill(-20); relatif.L[0] = 0; relatif.L[9 * 2 + 1] = -.1; assert(relatif._verrouPret(0), 'le relatif ne bloque pas'); relatif.L[7 * 2] = -.1; assert(!relatif._verrouPret(0), 'une autre tonalité trop proche bloque');
}
ok('verrou adaptatif');

/* Correction par le musicien : réutilisée à la reprise */
{
  const debut2 = chant.accords.find(a => a.section === 1).start; let fait = false, idx = null;
  const { m, ev } = ecoute(x, 48000, {}, 960, (mo, t) => {
    if (fait || t < debut2 - 1) return; fait = true;
    idx = mo.grille.findIndex(g => g.deg === 4 && g.t > 5); if (idx < 0) idx = mo.grille.findIndex(g => g.t > 5);
    mo.corriger(idx, 6);
  });
  assert(ev.accordCorrige.some(c => c.parMusicien && c.index === idx), 'événement de correction');
  assert.strictEqual(m.grille[idx].deg, 6); assert.strictEqual(m.grille[idx].racine, GP.mod(7 + 9)); assert.strictEqual(m.grille[idx].q, 'min');
  const t0 = m.grille[idx].t, rep = m.grille.filter(g => g.t > debut2);
  assert(rep.some(g => g.deg === 6), 'la reprise doit reprendre le 6 corrigé (' + t0 + ')');
}
ok('correction réutilisée à la reprise');

/* Tempo tapé, tonalité imposée, nouveau chant */
{
  const m = new GP.Moteur(); const v = []; m.on('tempo', e => v.push(e)); [0, .5, 1, 1.5].forEach(t => m.taperTempo(t)); assert(Math.abs(v[v.length - 1].bpm - 120) < .01 && v[v.length - 1].tape);
  const m2 = new GP.Moteur({ reglages: { tonalite: { tonic: 2, mode: 'min' } } }); assert.strictEqual(m2.etat, 'sure'); assert.strictEqual(m2.cands.length, 6);
  const m3 = new GP.Moteur(); let nc = 0; m3.on('nouveauChant', () => nc++); m3.key = { tonic: 0, mode: 'maj' }; m3._initFiltre(); m3.derniereVoix = 0; m3.hauteur(19.98, null, 0, .001); m3.hauteur(20, 60, .99, .1); assert.strictEqual(nc, 1); assert.strictEqual(m3.key, null);
  m3.reinit(); assert.strictEqual(m3.grille.length, 0);
}
ok('tempo tapé, tonalité imposée, nouveau chant');

/* Basse réelle : réglage explicite seulement */
{ const a = new GP.Moteur(); assert(!a.dec2k); const b = new GP.Moteur({ reglages: { basseReelle: true } }); assert(b.dec2k); }

/* Doigtés enseignés */
assert.deepStrictEqual(GP.doigter([64, 67, 72], 'd'), [1, 2, 5]); assert.deepStrictEqual(GP.doigter([60, 64, 67], 'd'), [1, 3, 5]); assert.deepStrictEqual(GP.doigter([60, 65, 67], 'd'), [1, 4, 5]);
assert.deepStrictEqual(GP.doigter([48, 52, 55], 'g'), [5, 3, 1]); assert.deepStrictEqual(GP.doigter([55, 60, 64], 'g'), [5, 2, 1]);
ok('doigtés');
/* Sections : une phrase courte ne devient pas « A » parce qu'elle se trouve dans une longue, et deux cadences différentes font deux lettres */
{
  const m = new GP.Moteur({ sr: 16000 }), lettres = []; m.key = { tonic: 0, mode: 'maj' };
  m.on('phrase', p => lettres.push(p.lettre));
  const dit = (...pcs) => { pcs.forEach(pc => m.mel.push({ pc })); m._finPhrase(0); };
  dit(0, 4, 7, 9, 7, 4, 2, 7); dit(0, 4, 7, 9, 7, 4, 2, 0); dit(0, 4, 7, 9, 7, 4, 2, 7); dit(5, 9, 0, 5);
  assert.deepStrictEqual(lettres, ['A', 'B', 'A', 'C']);
  ok('lettres de section');
}
/* Vraies voix : ronflement, octave, respiration */
{
  const nts = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 67, 64, 60, 62, 64, 60].map((m, i) => ({ midi: m + 12, start: .5 + i * .6, dur: .55 })), { x: v } = synth(nts, { sr: 16000, rms: .004, bruit: { snr: 35 }, graine: 7 });
  const y = Float32Array.from(v, (s, i) => s + .012 * Math.sin(2 * Math.PI * 122 * i / 16000)), avec = ecoute(y, 16000).m, sans = ecoute(v, 16000).m;
  assert(avec.rf.lignes.length === 1 && Math.abs(avec.rf.lignes[0] - 122) < 2, 'raie à 122 Hz : ' + avec.rf.lignes); assert.strictEqual(sans.rf.lignes.length, 0, "une voix seule n'est pas un ronflement");
  assert(avec.notes.every(n => n.midi > 55), 'aucune note de ronflement ne reste');
  const m = new GP.Moteur({ sr: 16000 }), ns = []; m.on('note', n => ns.push(n.midi)); let t = 0; const c = md => { for (let i = 0; i < 20; i++) { t += .02; m.hauteur(t, md, .95, .1); } };
  m.hauteur(.01, null, 0, .0001); c(72); c(84); c(74); c(62); c(67); assert.deepStrictEqual(ns, [72, 74], 'octave repliée, classe gardée');
  const p = new GP.Moteur({ sr: 16000 }); let nb = 0, u = 0; p.on('phrase', () => nb++); const chante = (s, md) => { for (let k = 0; k < s / .02; k++) { u += .02; p.hauteur(u, md, .95, .1); } }, tait = s => { for (let k = 0; k < s / .02; k++) { u += .02; p.hauteur(u, null, 0, .0001); } };
  tait(.04); chante(4, 72); tait(.06); chante(4, 74); tait(.14); chante(.6, 76); assert.strictEqual(nb, 0, 'une respiration brève ne termine pas une phrase'); tait(1); assert.strictEqual(nb, 1, 'une vraie pause termine la phrase');
}
ok('ronflement, octave, respiration');
/* Déterminisme : mêmes entrées, mêmes sorties, y compris après reinit sur la même instance. Hypothèses et ambiguïté présentes. */
{
  const un = mo => { const j = []; for (const n of ['note', 'tonalite', 'tonaliteProvisoire', 'tonaliteHypotheses', 'accord', 'accordCorrige', 'grilleRefaite', 'prochain', 'phrase', 'tempo', 'temps']) mo.on(n, e => j.push([n, e])); return j; };
  const passe = (mo, j) => { j.length = 0; for (let i = 0; i < x.length; i += 960) { const f = x.subarray(i, i + 960); mo.trame(f, (i + f.length) / 48000); } return JSON.stringify([j, mo.grille]); };
  const a = new GP.Moteur({ sr: 48000 }), ja = un(a), b = new GP.Moteur({ sr: 48000 }), jb = un(b), ra = passe(a, ja);
  assert.strictEqual(ra, passe(b, jb), 'deux moteurs, mêmes sorties');
  a.reinit(); assert.strictEqual(passe(a, ja), ra, 'après reinit, mêmes sorties');
  const hy = ja.filter(e => e[0] === 'tonaliteHypotheses').map(e => e[1]); assert(hy.length && hy.every(h => h.liste.length && h.liste.every(k => k.p > 0 && k.p <= 1 && 'tonic' in k && 'mode' in k)), 'hypothèses de tonalité');
  const ac = ja.filter(e => e[0] === 'accord').map(e => e[1]); assert(ac.every(c => typeof c.ambigu === 'boolean' && Array.isArray(c.alternatives)), 'ambigu sur chaque accord');
}
ok('déterminisme, hypothèses, ambigu');
/* Principe 4 : l'octave ne pèse pas dans la tonalité */
{
  const L = (dec, raison) => { const m = new GP.Moteur({ sr: 16000, reglages: { params: { raison } } }); let t = 0; m.hauteur(.01, null, 0, .0001); for (const md of [67, 72, 76, 72, 76, 74, 72, 69, 67]) for (let i = 0; i < 25; i++) { t += .02; m.hauteur(t, md + dec, .95, .1); } for (let i = 0; i < 30; i++) { t += .02; m.hauteur(t, null, 0, .0001); } return { L: [...m.L], k: m.key, etat: m.etat }; };
  const r = L(0, 'profil'); for (const d of [-12, 12]) assert.deepStrictEqual(L(d, 'profil'), r, 'même tonalité à une octave de distance');
  // Raison apprise : le registre l'aide à reconnaître la basse d'un accompagnement. Commun aux 12 toniques, il ne favorise aucune tonalité ;
  // à une octave près, même tonalité, confiance à 2 points près, et même état sauf si les deux confiances encadrent le seuil « sûre ».
  const a = L(0, 'apprise'), pS = GP.raisonPoids.params.pSure;
  for (const d of [-12, 12]) { const x = L(d, 'apprise'), px = Math.exp(x.L[0]), pa = Math.exp(a.L[0]); assert.deepStrictEqual(x.k, a.k, 'Raison apprise : même tonalité à une octave'); assert(Math.abs(px - pa) < .02, 'Raison apprise : même confiance à une octave'); if ((px >= pS) === (pa >= pS)) assert.strictEqual(x.etat, a.etat, 'Raison apprise : même état à une octave'); }
}
ok('octave sans effet sur la tonalité');
/* Silence : ni case ni accord quand personne ne chante, 60 s après une phrase comprises, et la voix reste entendue à bas niveau. tests/banc/silence.js */
{
  const S = require('./banc/silence.js');
  for (const n in S.SCENES) {
    const r = S.ecoute(S.SCENES[n]());
    assert.strictEqual(r.cases, 0, n + ' : cases nées dans le silence'); assert.strictEqual(r.accords, 0, n + ' : accords annoncés dans le silence');
    assert(r.notes <= (/^bourdon/.test(n) ? 3 : 0), n + ' : notes dans le silence ' + r.notes); // shortcut: un bourdon riche passe encore pour une note avant sa détection, 6 s ; à revoir si un mémo réel le montre
    if (/^phrase/.test(n)) assert(r.notesChant >= 20, n + ' : voix perdue, ' + r.notesChant + ' notes');
  }
}
ok('silence : aucune case, aucun accord');

/* Raison de tonalité en notes parfaites, cantiques impairs (contrôle) : 78 % de finales justes avec l'ancien profil d'Essen, 89 % avec celui des cantiques.
   St. Anne n'a jamais de 4e degré naturel, seulement le 4e haussé : par la seule gamme c'est la dominante, le musicien entend la tonique.
   Juste 9 % du temps avec l'ancien profil, 62 % avec le nouveau ; sa 2e phrase passe vraiment à la dominante et la finale y retombe encore. */
{
  const H = require('./banc/tonalite-hymnes.js'), r = H.banc({}, 'controle');
  assert(+r.der >= 88, 'finales justes au contrôle : ' + r.der + ' %'); assert(+r.juste >= 75, 'part juste au contrôle : ' + r.juste + ' %');
  const i = GP.baseHymnes.findIndex(c => c.titre === 'St. Anne'), sa = H.joue(GP.baseHymnes[i], i, {}); assert(sa.juste >= 50, 'St. Anne juste ' + sa.juste.toFixed(0) + ' % du temps');
}
ok('tonalité des cantiques en notes parfaites');
console.log('test-moteur : tout passe');
