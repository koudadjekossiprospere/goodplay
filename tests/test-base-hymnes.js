'use strict';
/* Contrôle js/base-hymnes.js et l'analyseur ABC. Usage : node tests/test-base-hymnes.js */
const assert = require('assert'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { lireVoix, analyser, droits, intervalles } = require('./genere-base-hymnes.js');
const fichier = path.join(__dirname, '..', 'js', 'base-hymnes.js');
const texte = fs.readFileSync(fichier, 'utf8');
require(fichier);
const base = globalThis.GP.baseHymnes;

assert(Array.isArray(base) && base.length >= 100, 'base trop petite : ' + (base && base.length));
const CHAMPS = new Set(['id', 'titre', 'compositeur', 'tonique', 'mode', 'mesure', 'bpm', 'melodie', 'basse', 'source']);
const ids = new Set(), melodies = new Set();
const somme = l => l.reduce((s, x) => s + x[1], 0);
for (const h of base) {
  const qui = h.id + ' ' + h.titre;
  for (const k of Object.keys(h)) assert(CHAMPS.has(k), qui + ' : champ hors liste ' + k);
  for (const k of CHAMPS) if (k !== 'compositeur') assert(k in h, qui + ' : champ manquant ' + k);
  assert(!ids.has(h.id), 'id en double ' + h.id); ids.add(h.id);
  assert(typeof h.titre === 'string' && h.titre.trim(), qui + ' : titre vide');
  assert(!/[�]|Ã./.test(h.titre + (h.compositeur || '')), qui + ' : accents abîmés');
  assert(Number.isInteger(h.tonique) && h.tonique >= 0 && h.tonique < 12, qui + ' : tonique');
  assert(h.mode === 'maj' || h.mode === 'min', qui + ' : mode');
  assert(Number.isInteger(h.mesure) && h.mesure >= 2 && h.mesure <= 12, qui + ' : mesure');
  assert(h.bpm >= 30 && h.bpm <= 320, qui + ' : bpm');
  assert.strictEqual(h.source, 'Open Hymnal 2014.06');
  for (const [m, d] of h.melodie) {
    assert(d > 0, qui + ' : durée de mélodie');
    if (m !== null) assert(Number.isInteger(m) && m >= 48 && m <= 84, qui + ' : midi hors plage vocale ' + m);
  }
  assert(h.melodie.filter(x => x[0] !== null).length >= 16, qui + ' : moins de 16 notes');
  h.basse.forEach(([deg, d], i) => {
    assert(Number.isInteger(deg) && deg >= 1 && deg <= 7, qui + ' : degré ' + deg);
    assert(d > 0, qui + ' : durée de basse');
    if (i) assert(deg !== h.basse[i - 1][0], qui + ' : degrés voisins non fondus');
  });
  assert(Math.abs(somme(h.melodie) - somme(h.basse)) < .05, qui + ' : mélodie ' + somme(h.melodie) + ', basse ' + somme(h.basse));
  const cle = intervalles(h.melodie).join(',');
  assert(!melodies.has(cle), qui + ' : doublon de mélodie'); melodies.add(cle);
}

// Hors titres, aucune trace de paroles ni de mention de droits, commentaires compris.
const horsTitres = texte.replace(/"titre":"(?:[^"\\]|\\.)*"/g, '""');
for (const mot of ['Lord', 'God', 'Jesus', 'thee', 'thy', 'sing', 'Christ', 'holy', 'praise', 'savior', 'amen', 'alleluia', 'copyright', 'rights reserved', 'public domain', 'lyrics', 'words']) {
  assert(!new RegExp('\\b' + mot + '\\b', 'i').test(horsTitres), 'trace hors titre : ' + mot);
}

// L'analyseur, sur des phrases inventées pour ce test.
{
  const sig = { F: 1 }, v = lireVoix('F =F F | F ^G G2 | A>B c/2 (3DEF [Ec]2 | C2- | C2 |', .25, 4, sig);
  const h = v.evts.map(e => e.p[e.p.length - 1]);
  assert.deepStrictEqual(h.slice(0, 6), [66, 65, 65, 66, 68, 68], 'armure et altérations, remises à zéro à la barre');
  assert.strictEqual(v.evts[6].d, 1.5, 'rythme pointé');
  assert.strictEqual(v.evts[7].d, .5, 'rythme pointé, seconde note');
  assert(Math.abs(v.evts[9].d - 2 / 3) < 1e-9, 'triolet');
  assert.deepStrictEqual(v.evts[12].p, [64, 72], 'accord');
  assert(v.evts[13].lie, 'liaison');
  assert.strictEqual(v.barres.length, 5, 'barres');
}
const air = (K, voix) => [`M: 4/4`, `L: 1/4`, `K: ${K}`, ...voix.map((t, i) => `[V: S${i}] ${t}`)];
{
  // Do/Mi au deuxième demi-temps : la tierce à la basse donne le degré 1, pas 3. Sol/Ré : quinte à la basse, la basse reste.
  const r = analyser(air('C', [
    'c2 c2 | c2 c2 | d2 d2 | c2 c2 | e2 e2 | e2 e2 | d2 d2 | c2 c2 |',
    'G2 G2 | G2 G2 | G2 G2 | G2 G2 | c2 c2 | c2 c2 | B2 B2 | G4 |',
    'E2 E2 | E2 E2 | B,2 B,2 | E2 E2 | G2 G2 | G2 G2 | G2 G2 | E4 |',
    'C2 C2 | E,2 E,2 | G,2 G,2 | C2 C2 | C2 C2 | E,2 E,2 | G,2 G,2 | C,4 |'
  ]));
  assert(!r.motif, r.motif);
  assert.deepStrictEqual([r.tonique, r.mode, r.mesure], [0, 'maj', 4]);
  assert.deepStrictEqual(r.basse, [[1, 8], [5, 4], [1, 12], [5, 4], [1, 4]], 'squelette ' + JSON.stringify(r.basse));
  assert.deepStrictEqual(r.basse.reduce((s, x) => s + x[1], 0), r.melodie.reduce((s, x) => s + x[1], 0));

  // Armure sans altération, finale sur La : la mineur.
  const m = analyser(air('C', ['c2 c2 | B2 B2 | c2 d2 | c2 c2 | e2 e2 | d2 d2 | c2 B2 | A2 A2 |', 'A,4 | G,4 | A,4 | A,4 | A,4 | G,4 | E,4 | A,4 |']));
  assert.deepStrictEqual([m.tonique, m.mode], [9, 'min']);

  // Trop court, mesure libre, voix de longueurs différentes.
  assert.strictEqual(analyser(air('C', ['c4 | c4 | c4 |', 'C4 | C4 | C4 |'])).motif, 'moins de 16 notes');
  assert.strictEqual(analyser(['M: none', 'L: 1/4', 'K: C', '[V: S1] c d', '[V: S2] C D']).motif, 'mesure libre');
  assert.strictEqual(analyser(air('C', ['c4 | c4 |', 'C4 |'])).motif, 'voix désalignées');

  // Modulation : Do majeur, Fa dièse majeur tout du long, retour en Do.
  const gamme = n => Array(12).fill(n).join(' | ') + ' |';
  const mo = analyser(air('C', [gamme('c d e f') + ' ' + gamme('^f ^g ^a b') + ' ' + gamme('c d e f'), gamme('C,4') + ' ' + gamme('^F,4') + ' ' + gamme('C,4')]));
  assert.strictEqual(mo.motif, 'modulation complexe');
}
{
  // Droits : les mentions sont inventées, leur forme suit celle du fichier source.
  const pd = 'copyright: public domain.  This score is a part of the Open Hymnal Project, 2012 Revision.';
  const m = "Music: 'Air' Personne, 1860. Setting: Recueil, 1900.";
  const voir = (c, comp = ['Nom, Prenom (1800-1880)'], arr = [], s = []) => droits([m, c], s, comp, arr).motif;
  assert.strictEqual(voir(pd), null);
  assert.strictEqual(voir('copyright: Words: Copyright 2009, X. All other rights reserved. Music and Setting: public domain.'), null);
  assert.strictEqual(droits(["Music: 'Air' Personne, 1860. Setting: X, 2009.", 'copyright: Words and Music, public domain.  Setting: Copyright 2009 X. May be freely reproduced for worship. All other rights reserved.'], [], [], []).motif, 'arrangement ou air sous licence restreinte au culte');
  assert.strictEqual(droits(["Music: 'Air' Personne, 1860. Setting: Recueil, 1931.", pd], [], [], []).motif, 'air ou arrangement daté de 1931 ou après');
  assert.strictEqual(voir(pd, ['Nom, Prenom (1872-1958)']), 'auteur vivant ou mort depuis moins de 70 ans');
  assert.strictEqual(voir(pd, ['Nom, Prenom (1951-)']), 'auteur vivant ou mort depuis moins de 70 ans');
  assert.strictEqual(voir(pd, [], [], ["Music source: 'Recueil', 1982 Hymn 5."]), 'transcrit depuis un recueil récent, sans contre-vérification ancienne');
  assert.strictEqual(voir(pd, [], [], ["Music source: 'Recueil', 1982 Hymn 5.", 'Music source: "Ancien", 1898.']), null);
  assert.strictEqual(voir('copyright: public domain. All other rights reserved.'), 'mention contradictoire (domaine public et droits réservés)');
  assert.strictEqual(voir('copyright: Music: public domain.'), 'arrangement non couvert par la mention de droits');
  assert(droits([m, 'copyright: Words: Copyright 2009, X. Music and Setting: public domain.'], [], [], []).motsProteges, 'paroles protégées détectées');
}

const brut = Buffer.from(texte, 'utf8'), gz = zlib.gzipSync(brut, { level: 9 }).length;
assert(gz < 64 * 1024, 'trop lourd pour le web : ' + gz);
console.log(`test-base-hymnes : tout passe. ${base.length} chants, ${(brut.length / 1024).toFixed(1)} Ko, gzip ${(gz / 1024).toFixed(1)} Ko`);
