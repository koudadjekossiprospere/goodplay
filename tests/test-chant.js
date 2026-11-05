/* Chant écrit (js/chant.js) : noms d'accords, texte en cases, tonalité, Transpose. node tests/test-chant.js
   Chants du domaine public seulement : aucune parole protégée dans le dépôt. */
const assert = require('assert');
require('../js/theorie.js'); require('../js/chant.js');
const { Chant: C } = globalThis.GP;
const ac = (racine, q, basse = racine) => ({ racine, q, basse });

// Noms d'accords, en français et en anglais ; un nom illisible n'est jamais deviné.
for (const [s, a] of [['Do', ac(0, 'maj')], ['Lam', ac(9, 'min')], ['Sol7', ac(7, '7')], ['Si♭7M', ac(10, 'maj7')], ['Sib', ac(10, 'maj')], ['Rém7', ac(2, 'm7')], ['Re', ac(2, 'maj')],
  ['Mi°7', ac(4, 'dim7')], ['Fa#m', ac(6, 'min')], ['Do/Mi', ac(0, 'maj', 4)], ['Fasus4', ac(5, 'sus4')], ['C', ac(0, 'maj')], ['Am', ac(9, 'min')], ['F#m7', ac(6, 'm7')],
  ['Bb/D', ac(10, 'maj', 2)], ['Dm', ac(2, 'min')], ['Fadd9', ac(5, 'add9')], ['Gmaj7', ac(7, 'maj7')], ['Ebm', ac(3, 'min')], ['Bm7b5', ac(11, 'm7b5')], ['Asus', ac(9, 'sus4')]])
  assert.deepStrictEqual(C.lireAccord(s), a, s);
for (const s of ['', 'Xyz', 'Lam/Q', 'Hm', 'Do quelque']) assert.strictEqual(C.lireAccord(s), null, s);

// Le texte en cases : paroles sous leur accord, une mesure par défaut, durées, levée sans accord, ligne vide gardée.
const AG = '[Sol]Amazing [Sol7]grace, how [Do]sweet the [Sol]sound\nThat [Sol:½]saved a [Ré:½]wretch like [Mix]me\n\n[Sol:2]I once was lost';
const { lignes, erreurs } = C.lireTexte(AG, { mesure: 3 });
assert.deepStrictEqual(lignes.map(l => l.map(c => [c.accord && c.accord.racine, c.temps, c.paroles])), [
  [[7, 3, 'Amazing '], [7, 3, 'grace, how '], [0, 3, 'sweet the '], [7, 3, 'sound']],
  [[null, 0, 'That '], [7, 1.5, 'saved a '], [2, 1.5, 'wretch like '], [null, 3, 'me']],
  [],
  [[7, 6, 'I once was lost']]
]);
assert.deepStrictEqual(erreurs, [{ ligne: 2, texte: 'Mix' }], 'un accord illisible est signalé');

// Mélodie : ♪ sous la ligne, une case par |, octave la plus proche, durées partagées ou écrites.
const avecMel = C.lireTexte('[Do]Do-ré-mi [Sol]sol\n♪ do ré mi | sol:2 la4', { mesure: 4 }).lignes[0];
assert.deepStrictEqual(avecMel[0].melodie, [[60, 0, 1.333], [62, 1.333, 1.333], [64, 2.666, 1.333]]);
assert.deepStrictEqual(avecMel[1].melodie, [[67, 0, 2], [69, 2, 2]]);

// Les cases reviennent au texte sans rien perdre : c'est ainsi qu'une case modifiée retourne dans le chant.
for (const t of [AG.replace('Mix', 'Mim'), '[Do]Do-ré-mi [Sol]sol\n♪ do:1 ré:1 mi:2 | sol:2 la:2']) {
  const l1 = C.lireTexte(t, { mesure: 3 }).lignes, t2 = C.texteDe(l1, { mesure: 3 }), l2 = C.lireTexte(t2, { mesure: 3 }).lignes;
  assert.deepStrictEqual(l2.map(l => l.map(c => [c.accord, c.temps, c.paroles, c.melodie])), l1.map(l => l.map(c => [c.accord, c.temps, c.paroles, c.melodie])), t2);
}

// Tonalité écrite : majeure, mineure, et le relatif tranché par le premier et le dernier accord.
const ton = t => C.tonaliteDe(C.lireTexte(t).lignes);
assert.deepStrictEqual(ton(AG), { tonic: 7, mode: 'maj' }, 'Amazing Grace en Sol');
assert.deepStrictEqual(ton('[Do][Fa][Sol7][Do][Lam][Rém][Sol][Do]'), { tonic: 0, mode: 'maj' });
assert.deepStrictEqual(ton('[Lam][Rém][Mi7][Lam][Fa][Sol][Mi][Lam]'), { tonic: 9, mode: 'min' });
assert.deepStrictEqual(ton('[Sim][La][Sol][Sim][La][Sol][Sim]'), { tonic: 11, mode: 'min' }, 'boucle mineure sans 5 majeur');
assert.deepStrictEqual(ton('[Dom][Fam][Sol7][Dom][La♭][Si♭][Mi♭][Dom]'), { tonic: 0, mode: 'min' });
assert.strictEqual(ton('juste des paroles'), null);

// Tonalité chantée vers grille : même mode, ou relatif (même armure : rien ne bouge).
assert.strictEqual(C.decalage({ tonic: 0, mode: 'maj' }, { tonic: 2, mode: 'maj' }), 2);
assert.strictEqual(C.decalage({ tonic: 0, mode: 'maj' }, { tonic: 9, mode: 'min' }), 0, 'La mineur entendu pour un chant en Do majeur');
assert.strictEqual(C.decalage({ tonic: 9, mode: 'min' }, { tonic: 0, mode: 'maj' }), 0);
assert.strictEqual(C.decalage({ tonic: 0, mode: 'maj' }, { tonic: 10, mode: 'maj' }), -2);
assert.strictEqual(C.decalage({ tonic: 7, mode: 'maj' }, { tonic: 4, mode: 'min' }), 0);

// Transpose : pianiste à l'aise en Do majeur.
assert.strictEqual(C.texteJeu({ tonic: 9, mode: 'maj' }, 0), 'Tu joues en Do majeur. Transpose −3.');
assert.strictEqual(C.texteJeu({ tonic: 0, mode: 'min' }, 0), 'Tu joues en La mineur (touches de Do majeur). Transpose +3.');
assert.strictEqual(C.texteJeu({ tonic: 0, mode: 'maj' }, 0), 'Tu joues en Do majeur, sans Transpose.');
assert.strictEqual(C.texteJeu({ tonic: 2, mode: 'maj' }, null), 'Tu joues en Ré majeur, sans Transpose.');

// À plat : seules les cases qui durent, avec leur place en temps.
assert.deepStrictEqual(C.aPlat(lignes).map(x => [x.l, x.i, x.t0]), [[0, 0, 0], [0, 1, 3], [0, 2, 6], [0, 3, 9], [1, 1, 12], [1, 2, 13.5], [3, 0, 15]]);

// Un chant de l'ancien Live : accords et mélodie gardés, quatre mesures par ligne.
const ancien = C.depuisAncien({ titre: 'x', bpm: 80, mesure: 4, melodie: [[60, 2], [null, 2], [64, 4]], cases: [{ racine: 0, q: 'maj', basse: 0, t: 4 }, { racine: 7, q: '7', basse: 7, t: 4 }] });
const la = C.lireTexte(ancien.texte).lignes[0];
assert.deepStrictEqual(la.map(c => [c.accord.racine, c.accord.q, c.temps, c.melodie]), [[0, 'maj', 4, [[60, 0, 2]]], [7, '7', 4, [[64, 0, 4]]]]);

// Mélodie chantée : chaque note dans sa case, au quart de temps, ramenée à l'écrit (chanté un ton plus haut) ;
// une note à peine en avance compte pour la case qui vient, celles d'après la fin ne comptent pas, une case sans note devient muette.
{
  const ls = C.lireTexte('[Do]a [Sol]b [Fa]c\n♪ do | ré | mi', { mesure: 4 }).lignes, p = C.aPlat(ls);
  C.placerMelodie([[62, .1, 1.02], [64, 1.05, .9], [66, 3.95, 1.4], [69, 9, 1]], p, { depart: 0, jusque: 1, decal: 2 });
  assert.deepStrictEqual(p.map(x => x.c.melodie), [[[60, 0, 1], [62, 1, 1]], [[64, 0, 1.5]], [[64, 0, 4]]]);
  C.placerMelodie([], p, { depart: 1, jusque: 1 });
  assert.deepStrictEqual(p[1].c.melodie, [], 'case muette');
}

// Poser un accord sur un mot : la case se partage ; au début de la case, l'accord change ; sur une levée, elle devient une case.
{
  const ls = C.lireTexte('Was [Sol]blind, but now I see', { mesure: 4 }).lignes, l = ls[0], fa = ac(5, 'maj'), re7 = ac(2, '7');
  assert.strictEqual(C.poserAccord(l, 1, 'blind, but '.length, re7, 4), 2);
  assert.deepStrictEqual(l.map(c => [c.accord && c.accord.racine, c.temps, c.paroles]), [[null, 0, 'Was '], [7, 4, 'blind, but '], [2, 4, 'now I see']]);
  C.poserAccord(l, 0, 0, fa, 4);
  assert.deepStrictEqual(l[0].accord, fa); assert.strictEqual(l[0].temps, 4, 'une levée devient une case d\'une mesure');
  // Retirer : paroles et durée reviennent à la case d'avant ; en tête de ligne, levée.
  C.retirerAccord(l, 2);
  assert.deepStrictEqual(l.map(c => [c.accord && c.accord.racine, c.temps, c.paroles]), [[5, 4, 'Was '], [7, 8, 'blind, but now I see']]);
  C.retirerAccord(l, 0);
  assert.deepStrictEqual([l[0].accord, l[0].temps], [null, 0]);
  assert.strictEqual(C.texteDe(ls, { mesure: 4 }), 'Was [Sol:2]blind, but now I see');
}

// Un cantique d'Open Hymnal (mélodie et basse par degrés) devient un chant lisible, accords déduits.
{
  const h = { id: 'oh0', titre: 'Essai', compositeur: 'x', tonique: 7, mode: 'maj', mesure: 4, bpm: 90, melodie: [[67, 2], [71, 2], [74, 4]], basse: [[1, 4], [5, 4]], source: 'Open Hymnal' };
  const e = C.depuisHymne(h), l2 = C.lireTexte(e.texte, { mesure: 4 });
  assert.deepStrictEqual([e.id, e.tonalite, e.genre, l2.erreurs.length], ['oh0', { tonic: 7, mode: 'maj' }, 'cantique', 0]);
  assert.deepStrictEqual(l2.lignes[0].map(c => [c.accord.racine, c.melodie.map(n => n[0])]), [[7, [67, 71]], [2, [74]]]);
}

console.log('test-chant : tout passe');
