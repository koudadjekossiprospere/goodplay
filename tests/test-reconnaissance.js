'use strict';
/* Reconnaissance du chant : node tests/test-reconnaissance.js [--base] [--audio] [--pcm fichier.f32]
   Par défaut, des événements `note` tirés de tests/banc/synth.js, sans audio : rapide et indépendant du moteur.
   --base mesure toute la base de cantiques, plusieurs minutes. --audio passe les chants synthétisés dans le vrai GP.Moteur. --pcm passe un vrai enregistrement (voir tests/decode-pcm.js).
   Ces chiffres, et seulement eux, s'annoncent. La voix de synthèse est plus régulière qu'une vraie : ils sont optimistes. */
const assert = require('assert'), fs = require('fs');
require('../js/reconnaissance.js');
const GP = globalThis.GP, S = require('./banc/synth.js');
const corpus = S.lireCorpus(), A = process.argv.slice(2), opt = n => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : null; };
try { require('../js/base-hymnes.js'); } catch (e) { /* la base de cantiques est facultative */ }
const hymnes = GP.baseHymnes || [];
const mod = n => ((n % 12) + 12) % 12, med = a => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : NaN), pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const ev = c => c.notes.map(n => ({ midi: n.midi, debut: n.start, fin: n.start + n.dur }));
const ORN = { pMelisme: .5, pExt: .25 };

/* Tirages neufs : le réglage a utilisé d'autres graines. */
const GR = 1000;
function chante(c, i, o = {}) {
  let ch = S.chantCorpus({ ...c, notes: c.notes || c.melodie }, { transpose: o.transpose || 0, couplets: o.couplets || 2, bpm: (c.bpm || 80) * (o.tempo || 1), rubato: .05, graine: GR + i });
  if (o.orn) ch = S.ornemente(ch, { ...ORN, graine: GR + i });
  let n = ev(ch);
  if (o.milieu) { const t0 = ch.duree / (o.couplets || 2) * o.milieu; n = n.filter(x => x.debut >= t0); }
  return n;
}
function joue(r, notes) {
  const res = { rec: [], perdus: [], n: 0 }, t0 = notes[0].debut;
  r.ecouteurs = {}; r.on('chantReconnu', e => res.rec.push({ ...e, n: res.n, dt: e.t - t0 })).on('chantPerdu', e => res.perdus.push({ ...e, n: res.n }));
  for (const n of notes) { res.n++; r.note(n); }
  return res;
}
const SCENES = {
  'tel quel': {}, 'autre tonalité (+5)': { transpose: 5 }, 'plus lent (x0,6)': { tempo: .6 }, 'plus vite (x1,4)': { tempo: 1.4 },
  'ornements': { orn: 1 }, 'depuis le milieu': { milieu: .5 }, 'milieu, ornements, +3': { milieu: .5, orn: 1, transpose: 3 }
};
function banc(nom, liste, base, scene, sortie) {
  let ok = 0, ts = [], ns = [], tonFaux = 0, pertes = 0; const confus = [], rien = [];
  liste.forEach((c, i) => {
    const res = joue(new GP.Reconnaissance({ chants: base }), chante(c, i, scene)), f = res.rec[0];
    if (!f) { rien.push(c.titre); return; }
    if (f.titre !== c.titre) { confus.push(c.titre + ' pris pour ' + f.titre); return; }
    ok++; ts.push(f.dt); ns.push(f.n); pertes += res.perdus.length;
    if (f.tonique !== mod(c.tonique + (scene.transpose || 0))) tonFaux++;
  });
  const l = { ok, total: liste.length, confus: confus.length, medT: med(ts), p90T: ts.length ? pct(ts, .9) : NaN, medN: med(ns), tonFaux, pertes, rien, confusions: confus };
  console.log(`  ${nom.padEnd(24)} ${ok}/${liste.length}  confondus ${confus.length}  ${l.medT.toFixed(1)} s (p90 ${l.p90T.toFixed(1)})  ${l.medN} notes  ton faux ${tonFaux}  pertes ${pertes}${rien.length ? '  rien : ' + rien.slice(0, 12).join(', ') : ''}${confus.length ? '  ' + confus.slice(0, 12).join(', ') : ''}`);
  sortie[nom] = l;
  return l;
}

/* ---------- Mélodies absentes de la base ---------- */
const fond = []; corpus.forEach(c => { const v = c.notes.filter(x => x[0] != null).map(x => x[0]); for (let i = 1; i < v.length; i++) if (v[i] !== v[i - 1]) fond.push(v[i] - v[i - 1]); });
const GAM = [0, 2, 4, 5, 7, 9, 11];
function melodie(n, tonique, type, r) {
  let m = 60 + tonique, t = 0; const ns = [];
  for (let i = 0; i < n; i++) {
    const d = [.3, .4, .6, .8, 1.2][Math.floor(r() * 5)];
    ns.push({ midi: m, debut: t, fin: t + d * .95 }); t += d;
    if (type === 'uni') { m += Math.floor(r() * 15) - 7; if (m < 50) m += 12; if (m > 84) m -= 12; } else for (let k = 0; k < 20; k++) { const x = m + fond[Math.floor(r() * fond.length)]; if (GAM.includes(mod(x - tonique)) && x > 55 && x < 80) { m = x; break; } }
  }
  return ns;
}
function fauxPositifs(base, nb, nom) {
  const r = S.alea(GR + 77), ex = []; let fp = 0, notes = 0;
  for (const type of ['uni', 'markov']) for (let g = 0; g < nb; g++) {
    const res = joue(new GP.Reconnaissance({ chants: base }), melodie(120, g % 12, type, r)); notes += 120;
    if (res.rec.length) { fp++; ex.push(type + ' => ' + res.rec[0].titre); }
  }
  console.log(`  ${nom} : ${fp} faux positifs sur ${nb * 2} mélodies de 120 notes${ex.length ? ' : ' + ex.slice(0, 5).join(', ') : ''}`);
  return fp;
}
function unRetire(liste, base, nom, doublons = []) {
  const ex = []; let fp = 0, essais = 0;
  liste.forEach((c, i) => {
    // Retirer un chant, c'est aussi retirer sa copie écartée comme doublon : la reconnaître serait juste, pas un faux positif.
    const copies = new Set(doublons.filter(d => d.de === c.titre).map(d => d.titre)), sans = base.filter(x => x.titre !== c.titre && !copies.has(x.titre));
    for (const orn of [0, 1]) { essais++; const res = joue(new GP.Reconnaissance({ chants: sans }), chante(c, i, { couplets: 3, orn })); if (res.rec.length) { fp++; ex.push(c.titre + ' => ' + res.rec[0].titre); } }
  });
  console.log(`  ${nom} : ${fp} faux positifs sur ${essais}${ex.length ? ' : ' + ex.slice(0, 8).join(', ') : ''}`);
  return fp;
}

console.log('Base de ' + corpus.length + ' chants, événements note simulés :');
const B15 = {}; for (const [n, o] of Object.entries(SCENES)) banc(n, corpus, corpus, o, B15);
for (const [n, l] of Object.entries(B15)) { assert.ok(l.ok >= 14, n + ' : part reconnue trop basse ' + l.ok); assert.strictEqual(l.confus, 0, n + ' : ' + l.confusions); assert.strictEqual(l.tonFaux, 0, n + ' : tonalité'); }
assert.strictEqual(fauxPositifs(corpus, 150, 'absentes'), 0);
assert.strictEqual(unRetire(corpus, corpus, 'chaque chant retiré à tour de rôle'), 0);

/* ---------- Position, saut au refrain, chants qui s'enchaînent, silence ---------- */
{
  let bons = 0, tot = 0;
  corpus.forEach((c, i) => {
    const r = new GP.Reconnaissance({ chants: corpus }), ch = S.chantCorpus(c, { couplets: 2, rubato: .05, graine: GR + i }), notes = ev(ch);
    let cour = null; r.on('chantReconnu', e => { cour = e.iCase; }).on('position', e => { cour = e.iCase; });
    notes.forEach((n, k) => {
      r.note(n); if (cour == null || !notes[k + 1]) return;
      // La vérité : la case de la note qui suit, celle qui attaque quand l'événement arrive.
      const v = ch.accords.find(a => notes[k + 1].debut + .01 >= a.start && notes[k + 1].debut + .01 < a.start + a.dur); if (!v) return;
      tot++; if (v.ib === cour) bons++;
    });
  });
  console.log(`  position : la bonne case ${(100 * bons / tot).toFixed(1)} % du temps une fois reconnu (${tot} notes)`);
  assert.ok(bons / tot > .9, 'suivi de position');
}
{
  // Le chantre saute du début au dernier tiers : combien de notes pour que la position suive, sans perdre le chant ?
  const sauts = []; let perdus = 0, suivis = 0;
  corpus.forEach((c, i) => {
    const r = new GP.Reconnaissance({ chants: corpus }), ch = S.chantCorpus(c, { couplets: 2, graine: GR + i }), notes = ev(ch), L = ch.duree / 2;
    const a = notes.filter(n => n.debut < L), b = notes.filter(n => n.debut >= L * 1.6);
    let e = null, p = null; r.on('chantReconnu', x => { e = x.entree; p = x.position; }).on('position', x => { p = x.position; }).on('chantPerdu', () => { perdus++; });
    a.slice(0, Math.floor(a.length * .7)).forEach(n => r.note(n)); if (!e) return;
    suivis++;
    const t0 = b[0].debut - L, bt = ch.bt;
    for (let k = 0; k + 1 < b.length; k++) { r.note(b[k]); if (Math.abs(p * bt - (b[k + 1].debut - L)) < bt * 1.1) { sauts.push(k + 1); break; } }
  });
  console.log(`  saut en avant : position retrouvée en ${med(sauts)} notes (médiane, ${sauts.length}/${suivis}), ${perdus} pertes du chant`);
}
{
  // Deux chants sans silence : le premier se perd, le second est reconnu.
  let ok = 0, tot = 0; const delais = [];
  corpus.forEach((c, i) => {
    const d = corpus[(i + 5) % corpus.length], n1 = chante(c, i, { couplets: 1 }), fin = n1[n1.length - 1].fin + 1, n2 = chante(d, i, { couplets: 2, transpose: 2 }).map(n => ({ ...n, debut: n.debut + fin, fin: n.fin + fin }));
    const res = joue(new GP.Reconnaissance({ chants: corpus }), [...n1, ...n2]), u = res.rec.find(x => x.titre === d.titre); tot++;
    if (res.rec.length && res.rec[0].titre === c.titre && u && u.tonique === mod(d.tonique + 2)) { ok++; delais.push(u.t - fin); }
  });
  console.log(`  deux chants enchaînés sans silence : ${ok}/${tot}, second reconnu en ${med(delais).toFixed(1)} s`);
  assert.ok(ok >= 12, 'enchaînement');
}
{
  // Au silence rien n'avance : sans note, aucun événement, la position ne bouge pas.
  const r = new GP.Reconnaissance({ chants: corpus }), notes = chante(corpus[0], 0); let n2 = 0;
  notes.slice(0, 40).forEach(n => r.note(n)); assert.ok(r.cur, 'reconnu avant le silence');
  const pos = r.pos; r.on('position', () => n2++).on('chantPerdu', () => n2++);
  r.note({ midi: 90, debut: 200, fin: 200.05 }); assert.strictEqual(r.pos, pos, 'une note trop brève ne compte pas'); assert.strictEqual(n2, 0);
  // Rejet : perdu et plus proposé jusqu'au prochain chant.
  let perdu = null, re = 0; r.on('chantPerdu', e => { perdu = e; }).on('chantReconnu', () => re++); r.rejeter(); assert.strictEqual(perdu.raison, 'musicien'); assert.strictEqual(r.cur, null);
  notes.slice(40).forEach(n => r.note(n)); assert.strictEqual(re, 0, 'un chant rejeté ne revient pas');
  r.nouveauChant(); notes.forEach(n => r.note(n)); assert.ok(re > 0, 'de nouveau proposé après un nouveau chant');
}

/* ---------- Apprentissage ---------- */
{
  // Un chant inconnu : enregistré après un passage, reconnu dans une autre tonalité et un autre tempo.
  const rr = S.alea(GR + 5), n0 = melodie(60, 0, 'markov', rr), ton = { tonic: 0, mode: 'maj' };
  const cases = [0, 8, 16, 24].map((t, i) => { const deg = [1, 4, 5, 1][i], a = GP.accordDeDegre(ton, deg); return { deg, racine: a.racine, q: a.q, basse: a.basse, t, ton, ...(i === 2 ? { corrige: true } : {}) }; });
  const sig = GP.signatureLive(n0, cases, ton, 80); assert.ok(sig && sig.notes.length >= 50);
  // La durée tenue part avec la note, en temps : elle sert au jeu d'entraînement (export de Labs)
  assert.ok(Math.abs(sig.notes[0][2] - (n0[0].fin - n0[0].debut) * 80 / 60) < .01, 'durée tenue');
  const ch = { id: 'm1', titre: 'Mon chant', ton, bpm: 80, mesure: 4, melodie: null, cases: [], signature: sig };
  const r = new GP.Reconnaissance({ chants: corpus }); r.definirAppris([ch]);
  const res = joue(r, n0.map(n => ({ midi: n.midi + 3, debut: n.debut * 1.3, fin: n.fin * 1.3 })));
  assert.strictEqual(res.rec[0] && res.rec[0].id, 'm1', 'chant appris reconnu'); assert.strictEqual(res.rec[0].tonique, 3, 'dans la tonalité chantée');
  const g = GP.grilleChant(res.rec[0].entree, 3); assert.strictEqual(g[1].deg, 4); assert.strictEqual(g[1].racine, 8); assert.ok(g[2].corrige);
  // Une version corrigée d'un chant de la base le remplace : deux airs identiques n'auraient jamais d'avance l'un sur l'autre.
  const e0 = GP.depuisCorpus(corpus[0], 0), v = { id: 'm2', titre: 'Grace, ma version', ton: { tonic: 7, mode: 'maj' }, bpm: 84, remplace: 'c0', signature: { notes: e0.notes, cases: e0.cases.map(c => ({ ...c, deg: c.deg === 4 ? 6 : c.deg })), duree: e0.duree } };
  const r2 = new GP.Reconnaissance({ chants: corpus }); r2.definirAppris([v]);
  assert.strictEqual(joue(r2, chante(corpus[0], 0)).rec[0].id, 'm2', 'la version corrigée prend la place');
  r2.reinit(); r2.definirAppris([]); assert.strictEqual(joue(r2, chante(corpus[0], 0)).rec[0].id, 'c0', 'supprimée, le chant de la base revient');
  console.log('  apprentissage : chant appris reconnu en ' + res.rec[0].dt.toFixed(1) + ' s, ' + res.rec[0].n + ' notes, autre tonalité et autre tempo');
}
{
  // Un même air sous un autre titre ne double pas, une entrée mal formée est écartée.
  const r = new GP.Reconnaissance({ chants: corpus }), n = r.base.length;
  r.ajouterBase([{ ...corpus[0], id: 'h1', titre: 'New Britain', notes: undefined, melodie: corpus[0].notes }, { id: 'h2', titre: 'Sans basse', tonique: 0, mode: 'maj', melodie: [[60, 1]], basse: [] }]);
  assert.strictEqual(r.base.length, n); assert.strictEqual(r.doublons[0].de, 'Amazing Grace');
}

/* ---------- Coût : une base de 500 chants, complétée par des mélodies simulées qui ne quittent pas ce test ---------- */
function leurres(nb) {
  const r = S.alea(GR + 9), l = [];
  for (let i = 0; i < nb; i++) {
    const t = i % 12, n = melodie(40 + Math.floor(r() * 50), t, 'markov', r), notes = n.map((x, k) => [x.midi, ((n[k + 1] ? n[k + 1].debut : x.fin) - x.debut)]), tot = notes.reduce((a, x) => a + x[1], 0);
    l.push({ id: 'l' + i, titre: 'Leurre ' + i, tonique: t, mode: 'maj', bpm: 60, melodie: notes, basse: [[1, tot / 2], [5, tot / 2]] });
  }
  return l;
}
{
  const debut = process.hrtime.bigint(), base = [...corpus, ...hymnes, ...leurres(Math.max(0, 500 - corpus.length - hymnes.length))], r0 = new GP.Reconnaissance({ chants: base }), ms0 = Number(process.hrtime.bigint() - debut) / 1e6;
  const tps = [], notes = chante(corpus[3], 3);
  for (const n of notes) { const a = process.hrtime.bigint(); r0.note(n); tps.push(Number(process.hrtime.bigint() - a) / 1e6); }
  console.log(`Coût à ${r0.actifs.length} chants (${r0.actifs.reduce((a, c) => a + c.n, 0)} positions) : ${med(tps).toFixed(2)} ms par note en médiane, ${Math.max(...tps).toFixed(2)} ms au pire, construction ${ms0.toFixed(0)} ms`);
  assert.ok(med(tps) < 15, 'coût par note'); // borne large : la machine peut être chargée, le chiffre affiché est celui qui compte
  console.log('Base de ' + r0.actifs.length + ' chants (cantiques : ' + hymnes.length + ', le reste simulé) :');
  const B500 = {}; for (const n of ['tel quel', 'ornements', 'milieu, ornements, +3']) banc(n, corpus, base, SCENES[n], B500);
  for (const [n, l] of Object.entries(B500)) { assert.ok(l.ok >= 8, n + ' à 500 : ' + l.ok); assert.strictEqual(l.confus, 0, n + ' à 500 : ' + l.confusions); }
  assert.strictEqual(fauxPositifs(base, 25, 'absentes, à 500'), 0);
}
if (hymnes.length) {
  // Long : toute la base, un chant retiré à tour de rôle. --base pour tout mesurer, sinon le tirage se limite à une scène.
  const avecId = corpus.map((c, i) => ({ ...c, id: 'c' + i })), base = [...avecId, ...hymnes], r0 = new GP.Reconnaissance({ chants: base }), actifs = new Set(r0.actifs.map(c => c.e.id)), liste = base.filter(c => actifs.has(c.id));
  console.log(`Toute la vraie base : ${r0.actifs.length} chants, ${r0.doublons.length} doublons écartés :`);
  const BH = {}, scenes = A.includes('--base') ? ['tel quel', 'autre tonalité (+5)', 'plus lent (x0,6)', 'ornements', 'depuis le milieu', 'milieu, ornements, +3'] : ['tel quel'];
  for (const n of scenes) banc(n, liste, base, SCENES[n], BH);
  for (const [n, l] of Object.entries(BH)) { assert.ok(l.confus <= 2, n + ' : ' + l.confusions.slice(0, 5)); assert.ok(l.ok / l.total >= .7, n); }
  assert.strictEqual(fauxPositifs(base, A.includes('--base') ? 100 : 15, 'absentes'), 0);
  // Look Down (oh111) et Es ist das Heil (oh114) sont le même air, trop variés pour être vus comme doublons : se reconnaître l'un l'autre est juste. 4 essais sur 390.
  if (A.includes('--base')) assert.ok(unRetire(liste, base, 'chaque chant retiré à tour de rôle', r0.doublons) <= 4, 'faux positifs');
}

/* ---------- Avec le vrai moteur ---------- */
function moteurNotes(x, sr) {
  require('../js/moteur.js');
  const m = new GP.Moteur({ sr }), l = [], pas = Math.round(sr * .02);
  m.on('note', e => l.push(e));
  for (let i = 0; i < x.length; i += pas) { const f = x.subarray(i, Math.min(x.length, i + pas)); m.trame(f, (i + f.length) / sr); }
  return l;
}
if (A.includes('--audio')) {
  console.log('Synthèse audio dans le vrai moteur (dépend de js/moteur.js) :');
  for (const [nom, o] of Object.entries(SCENES)) {
    let ok = 0, ts = [], ns = [], tonF = 0; const conf = [], rien = [];
    corpus.forEach((c, i) => {
      let ch = S.chantCorpus(c, { transpose: o.transpose || 0, couplets: 2, bpm: c.bpm * (o.tempo || 1), rubato: .05, graine: GR + i });
      if (o.orn) ch = S.ornemente(ch, { ...ORN, graine: GR + i });
      const t0 = o.milieu ? ch.duree / 2 * o.milieu : 0, ns0 = ch.notes.filter(n => n.start >= t0 && n.start < t0 + 45).map(n => ({ ...n, start: n.start - t0 }));
      const { x, sr } = S.synth(ns0, { sr: 16000, rms: .03, graine: GR + i, duree: ns0[ns0.length - 1].start + 2 });
      const notes = moteurNotes(x, sr), res = joue(new GP.Reconnaissance({ chants: corpus }), notes), f = res.rec[0];
      if (!f) rien.push(c.titre); else if (f.titre !== c.titre) conf.push(c.titre + ' pris pour ' + f.titre); else { ok++; ts.push(f.t - ns0[0].start); ns.push(f.n); if (f.tonique !== mod(c.tonique + (o.transpose || 0))) tonF++; }
    });
    console.log(`  ${nom.padEnd(24)} ${ok}/15  confondus ${conf.length}  ${med(ts).toFixed(1)} s (p90 ${ts.length ? pct(ts, .9).toFixed(1) : '-'})  ${med(ns)} notes  ton faux ${tonF}${rien.length ? '  rien : ' + rien.join(', ') : ''}${conf.length ? '  ' + conf.join(', ') : ''}`);
    assert.strictEqual(conf.length, 0, nom + ' : ' + conf);
  }
}
const pcm = opt('--pcm') || process.env.GOODPLAY_PCM;
if (pcm && fs.existsSync(pcm)) {
  const b = fs.readFileSync(pcm), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2), notes = moteurNotes(x, 48000);
  const r = new GP.Reconnaissance({ chants: [...corpus, ...hymnes] }), res = joue(r, notes);
  console.log(`Vraie voix ${pcm} : ${notes.length} notes, ${res.rec.length ? res.rec.map(e => `reconnu ${e.titre} (${GP.nomTonalite({ tonic: e.tonique, mode: e.mode })}) à ${e.t.toFixed(1)} s, ${e.n} notes`).join(' ; ') : 'rien de reconnu'} ; meilleurs à la fin : ${r.meilleurs.map(c => c.titre + ' ' + c.score.toFixed(1)).join(', ')}`);
}
console.log('reconnaissance : ok');
