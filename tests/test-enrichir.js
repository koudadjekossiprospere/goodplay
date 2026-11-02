'use strict';
/* Catalogue et suggestions live. Usage : node tests/test-enrichir.js */
const assert = require('assert'), fs = require('fs'), path = require('path');
require('../js/theorie.js'); require('../js/doigtes.js'); require('../js/catalogue.js'); require('../js/enrichir.js');
const GP = globalThis.GP, C = GP.catalogue;

/* Catalogue : accents, qualités connues, identifiants uniques */
assert(C.length >= 143); assert.strictEqual(new Set(C.map(e => e.id)).size, C.length);
assert(C.some(e => /é|è|à/.test(e.pourquoi)), 'accents perdus'); assert(!/Ã.|â€|�/.test(JSON.stringify(C)), 'mojibake');
C.forEach(e => e.accords.forEach(a => assert(GP.Q[a.q], `qualité inconnue ${a.q} dans ${e.id}`)));
const src = path.join(__dirname, '..', 'docs', 'recherche', 'catalogue-gospel.json');
if (fs.existsSync(src)) assert.deepStrictEqual(C, JSON.parse(fs.readFileSync(src, 'utf8')), 'relancer node tests/genere-catalogue.js');

/* Peu de propositions, jamais à chaque case, de la variété */
const suite = [1, 4, 5, 1, 6, 2, 5, 1, 4, 1, 5, 6, 4, 5, 1];
for (const [mode, degs] of [['maj', suite], ['min', [1, 4, 5, 1, 6, 7, 3, 4, 5, 1]]]) for (const niveau of [1, 2, 3]) {
  const vus = []; let n = 0, vides = 0, suites = 0, avant = false; const ids = new Set();
  for (let i = 0; i < 400; i++) {
    const deg = degs[i % degs.length], suivant = degs[(i + 1) % degs.length], r = GP.suggestions({ deg, suivant, mode, style: null, niveau, dejaVus: vus });
    assert(r.length <= 2, '2 propositions au plus');
    r.forEach(e => { assert(e.live, 'live seulement'); assert.strictEqual(e.mode, mode); assert(e.niveau <= niveau, 'niveau'); ids.add(e.id); assert(e.quand.sur === deg || (e.quand.de === deg && e.quand.vers === suivant), 'hors contexte'); });
    if (r.length) { n++; if (avant) suites++; avant = true; } else { vides++; avant = false; }
  }
  assert(n > 0 && n < 400 / 3 + 1, `trop de propositions : ${n}/400`); assert.strictEqual(suites, 0, 'deux cases de suite');
  assert(ids.size >= 5, `peu de variété : ${ids.size}`);
}
/* Réglages : niveau 0 et style */
assert.deepStrictEqual(GP.suggestions({ deg: 1, suivant: 4, niveau: 0, dejaVus: [] }), []);
const sv = []; for (let i = 0; i < 60; i++) GP.suggestions({ deg: 1, suivant: 4, style: 'jazz', niveau: 3, dejaVus: sv }).forEach(e => assert(e.style.includes('jazz')));
/* Note chantée : jamais d'accord qui ne la contient pas, jamais de 7M sur la tonique tenue */
for (let i = 0; i < 300; i++) { const vus = [null, null, null, null]; const r = GP.suggestions({ deg: 1, suivant: 4, niveau: 3, dejaVus: vus, noteChantee: 0 }); assert(r.length, 'ce test doit recevoir une proposition'); r.forEach(e => { const a = e.accords[0]; assert(GP.Q[a.q].some(x => GP.mod(x + a.rac) === 0) || GP.mod(a.basse) === 0, e.id); assert(!['maj7', 'maj9', 'maj13'].includes(a.q) || a.rac !== 0, e.id); }); }

/* jouerEntree : accords réels et midi, pour toutes les tonalités */
let alertes = 0, total = 0, trop = 0;
for (const e of C) for (let t = 0; t < 12; t++) {
  const k = { tonic: t, mode: e.mode }, r = GP.jouerEntree(e, k); assert.strictEqual(r.length, e.accords.length);
  r.forEach((a, i) => {
    total++; const s = e.accords[i];
    assert.strictEqual(a.racine, GP.mod(t + s.rac)); assert.strictEqual(a.basse, GP.mod(t + s.basse)); assert.strictEqual(a.q, s.q);
    assert.strictEqual(a.dd.length, a.md.length); assert.strictEqual(a.dg.length, a.mg.length);
    assert.deepStrictEqual(a.md.map(GP.mod).sort(), s.rh.map(v => GP.mod(t + v)).sort(), `forme droite de ${e.id}`);
    assert(a.md[0] > a.mg[a.mg.length - 1], `mains croisées dans ${e.id}`);
    for (let j = 1; j < a.mg.length; j++) if (a.mg[j] - a.mg[j - 1] <= 4) assert(a.mg[j - 1] >= 48, `tierce grave dans ${e.id}`);
    if (a.alertes.length) alertes++; if (a.alertes.some(x => x.startsWith('ecart'))) trop++;
  });
}
const ex = GP.jouerEntree(C.find(e => e.id === 'passage-2-5-vers-1'), { tonic: 7, mode: 'maj' });
assert.deepStrictEqual(ex.map(a => a.racine), [9, 2]); assert.deepStrictEqual(ex.map(a => a.q), ['m7', '7']);
/* Revue du pianiste (docs/recherche/revue-pianiste.md) : chaque erreur corrigée garde son cas */
const nue = () => [null, null, null, null], un = (deg, suivant, style = 'gospel', noteChantee = null, mode = 'maj', dejaVus = nue()) => GP.suggestions({ deg, suivant, mode, style, niveau: 1, dejaVus, noteChantee });
const E = id => C.find(e => e.id === id);
// Le squelette d'abord : rien sur les 4 premières cases, puis 4 cases de silence
{ const v = []; for (let i = 0; i < 4; i++) assert.deepStrictEqual(GP.suggestions({ deg: 1, suivant: 4, niveau: 1, dejaVus: v }), []); assert(GP.suggestions({ deg: 1, suivant: 4, niveau: 1, dejaVus: v }).length); for (let i = 0; i < 4; i++) assert.deepStrictEqual(GP.suggestions({ deg: 1, suivant: 4, niveau: 1, dejaVus: v }), []); }
// Chaque geste arrive là où il faut. Avant : le 4 sur 5 et le sus4 ne sortaient jamais devant un 1, écrasés par les liens et la rotation
assert.strictEqual(un(5, 1)[0].id, 'slash-4-sur-5'); assert.strictEqual(un(1, 4)[0].id, 'slash-1-sur-3'); assert.strictEqual(un(4, 5)[0].id, 'passage-dim-sharp4'); assert.strictEqual(un(1, 2)[0].id, 'passage-dim-sharp1'); assert.strictEqual(un(4, 1)[0].id, 'sub-4m-avant-1'); assert.strictEqual(un(1, 6)[0].id, 'slash-5-sur-7');
// Une grille qui tourne fait tout entendre, sans se bloquer sur une seule case
{ const v = [], vus = new Set(), g = [1, 4, 1, 5]; for (let i = 0; i < 200; i++) GP.suggestions({ deg: g[i % 4], suivant: g[(i + 1) % 4], style: 'gospel', niveau: 1, dejaVus: v }).forEach(e => vus.add(e.id)); for (const id of ['slash-4-sur-5', 'couleur-sus4-sur-5', 'slash-1-sur-3', 'couleur-add2-sur-1']) assert(vus.has(id), id + ' jamais proposé'); }
// Note chantée : le sol tenu va avec le 4 sur 5 grâce à la basse ; la sensible tenue refuse le 4 sur 5 et le sus4
assert.strictEqual(un(5, 1, 'gospel', 7)[0].id, 'slash-4-sur-5'); un(5, 1, 'gospel', 11).forEach(e => assert(!['slash-4-sur-5', 'couleur-sus4-sur-5'].includes(e.id), e.id));
// Une couleur n'annonce pas l'accord qui suit
{ const v = []; for (let i = 0; i < 200; i++) GP.suggestions({ deg: 1, suivant: 6, niveau: 1, dejaVus: v }).forEach(e => assert.notStrictEqual(e.id, 'rel-6m-pour-1')); const w = []; for (let i = 0; i < 200; i++) GP.suggestions({ deg: 1, suivant: 5, mode: 'min', niveau: 1, dejaVus: w }).forEach(e => assert.notStrictEqual(e.id, 'min-slash-5-sur-7')); }
// En live : ni fin au milieu du chant, ni groove, ni trait dans le chant ; et aucune entrée impossible à atteindre
for (const id of ['end-b6-b7-1', 'end-add9-final', 'min-end-picardie', 'rythme-octaves-noires', 'rythme-basse-1-5', 'rythme-accord-tenu', 'rythme-croches-pop', 'rythme-arpege-ouvert', 'fill-pentatonique-1', 'min-fill-pentatonique', 'voicing-main-droite-fixe']) assert(!E(id).live, id);
C.filter(e => e.live).forEach(e => { const q = e.quand, six = GP.SIX[e.mode]; if (q.sur != null) assert(six.includes(q.sur), e.id); else { assert(six.includes(q.de) && six.includes(q.vers), e.id + ' : degré absent du moteur'); assert(q.de !== q.vers, e.id + ' : le moteur ne produit jamais deux cases identiques'); } });
assert.deepStrictEqual(E('ta-1-6-2-5').quand, { de: 1, vers: 5 }); assert.deepStrictEqual(E('min-passage-2-5-vers-1').quand, { de: 4, vers: 5 }); assert.deepStrictEqual(E('sub-tritone-5-vers-1').quand, { de: 5, vers: 1 });
// Toute note de droite appartient à l'accord écrit ; la gauche aussi, ou c'est la basse du slash ; la première note de gauche est la basse
C.forEach(e => e.accords.forEach(a => { const qs = GP.Q[a.q].map(i => GP.mod(a.rac + i)); a.rh.forEach(v => assert(qs.includes(GP.mod(v)), `note fausse à droite : ${e.id}`)); a.lh.forEach(v => assert(qs.includes(GP.mod(v)) || GP.mod(v) === GP.mod(a.basse), `note fausse à gauche : ${e.id}`)); assert.strictEqual(GP.mod(a.lh[0]), GP.mod(a.basse), e.id); }));
// Notes et textes : ce qui est écrit correspond à ce qui est joué
assert.strictEqual(E('voicing-main-droite-fixe').accords[1].q, '7sus4', 'La, Ré, Mi, Sol : pas de Do, donc pas un m11');
assert(!/Octave/.test(E('couleur-add9-sur-4').comment), 'la gauche joue une quinte'); assert.deepStrictEqual(E('couleur-13b9-sur-5').accords[0].rh, [8, 11, 16], 'la septième est à gauche');
assert(/deux notes/.test(E('passage-2-5-vers-1').comment), 'Fa La Do vers Fa Sol Si : deux notes changent'); assert(!/deux notes bougent/.test(E('min-couleur-m7-sur-4').comment));
{ const a = E('passage-7-3alt-vers-6').accords[1], am7 = [9, 0, 4, 7]; assert(am7.includes(GP.mod(a.rac + 8)) && am7.includes(GP.mod(a.rac + 15)), 'le dièse 5 et le dièse 9 restent dans le 6 mineur 7'); assert(/restent en place/.test(E('passage-7-3alt-vers-6').comment)); }
assert(!/^Même notes/.test(E('voicing-sans-fondamentale-b').pourquoi)); C.forEach(e => assert(!/majeur 7 avant|majeur 7 avec/.test(e.nom), e.id + ' : se lit comme une septième majeure')); assert(!/—|–/.test(JSON.stringify(C)), 'pas de tiret long');
// Conduite de voix : la marche 1-2-3-4 garde la droite presque immobile ; la marche vers le 5 garde sa note du haut
{ const [x, y] = GP.jouerEntree(E('marche-1-2-3-4'), { tonic: 0, mode: 'maj' }); assert(y.md.reduce((s, m) => s + Math.min(...x.md.map(v => Math.abs(v - m))), 0) / y.md.length <= 1, 'main droite'); }
{ const r = GP.jouerEntree(E('marche-1-3-4-s4-5'), { tonic: 0, mode: 'maj' }); assert.strictEqual(new Set(r.map(a => a.md[a.md.length - 1])).size, 1, 'la note du haut reste'); }
// jouerEntree : la gauche joue bien la forme et la basse, dans toutes les tonalités
for (const e of C) for (let t = 0; t < 12; t++) GP.jouerEntree(e, { tonic: t, mode: e.mode }).forEach((a, i) => { const s = e.accords[i]; assert.deepStrictEqual(a.mg.map(GP.mod), s.lh.slice().sort((x, y) => x - y).map(v => GP.mod(t + v)), e.id); assert.strictEqual(GP.mod(a.mg[0]), a.basse, e.id); });
// Les noires choisissent le renversement : le 4 sur 5 en Mi bémol est Do Mi♭ La♭, pouce sur blanche, mêmes notes. En Do, la forme du catalogue reste.
{ const [a] = GP.jouerEntree(E('slash-4-sur-5'), { tonic: 3, mode: 'maj' }); assert.deepStrictEqual(a.md, [60, 63, 68]); assert.deepStrictEqual(a.dd, [1, 2, 5]); assert.deepStrictEqual(a.alertes, []); assert.strictEqual(a.basse, 10); }
{ const [a] = GP.jouerEntree(E('slash-4-sur-5'), { tonic: 0, mode: 'maj' }); assert.deepStrictEqual(a.md, [65, 69, 72]); assert.deepStrictEqual(a.mg, [43]); assert.deepStrictEqual(a.dd, [1, 3, 5]); }
{ const [a] = GP.jouerEntree(E('passage-dim-sharp1'), { tonic: 0, mode: 'maj' }); assert.deepStrictEqual(a.alertes, [], 'pouce sur Mi'); assert.strictEqual(a.mg[0] % 12, 1); }
// Noms : une fondamentale hors gamme s'écrit par sa fonction ; un diminué de passage monte
const maj = t => ({ tonic: t, mode: 'maj' });
assert.strictEqual(GP.nomAccord(8, 'maj', maj(0)), 'La♭'); assert.strictEqual(GP.nomAccord(10, 'maj', maj(0)), 'Si♭'); assert.strictEqual(GP.nomAccord(1, '7', maj(0)), 'Ré♭7'); assert.strictEqual(GP.nomAccord(6, 'dim7', maj(5)), 'Fa♯°7'); assert.strictEqual(GP.nomAccord(1, 'dim7', maj(0)), 'Do♯°7'); assert.strictEqual(GP.nomAccord(1, 'dim7', { tonic: 2, mode: 'min' }), 'Do♯°7'); assert.strictEqual(GP.nomAccord(6, 'maj', { tonic: 8, mode: 'min' }), 'Fa♯');
console.log(`test-enrichir : ${C.length} entrées, ${total} accords placés, ${alertes} avec alerte, dont ${trop} écarts à rouler`);
