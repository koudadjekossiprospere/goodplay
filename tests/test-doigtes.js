'use strict';
/* Voicing : 12 tonalités, toutes les qualités. Usage : node tests/test-doigtes.js */
const assert = require('assert');
require('../js/theorie.js'); require('../js/doigtes.js');
const GP = globalThis.GP, Qs = Object.keys(GP.Q);
assert.strictEqual(Qs.length, 28);
let n = 0, pouceNoir = 0, signales = 0;
for (let r = 0; r < 12; r++) for (const q of Qs) for (const b of [r, GP.mod(r + GP.Q[q][1]), GP.mod(r + 7)]) for (const niveau of [0, 1, 2]) {
  let prec = null;
  for (const pas of [0, 5, 7]) {
    const v = GP.voicing(GP.mod(r + pas), q, { prec, niveau, basse: pas ? GP.mod(r + pas) : b }); n++; prec = v;
    assert(v.md.length >= 2 && v.md.length <= 5, `${r} ${q} : ${v.md.length} notes à droite`);
    assert.strictEqual(v.dd.length, v.md.length); assert.strictEqual(v.dg.length, v.mg.length);
    assert(v.md.every((m, i) => !i || m > v.md[i - 1]) && v.mg.every((m, i) => !i || m > v.mg[i - 1]), 'notes croissantes');
    assert(v.md[0] > v.mg[v.mg.length - 1], `les mains se croisent : ${r} ${q}`);
    assert(v.md[v.md.length - 1] <= 84 && v.mg[0] >= 36, 'registre');
    assert(GP.controleEcarts(v.md, v.dd).max <= 0, `écart impossible à droite : ${r} ${q} ${v.md}`);
    assert(GP.controleEcarts(v.mg, v.dg).max <= 0, `écart impossible à gauche : ${r} ${q} ${v.mg}`);
    assert.strictEqual(GP.mod(v.mg[0]), pas ? GP.mod(r + pas) : b, 'la main gauche joue la basse demandée');
    for (let i = 1; i < v.mg.length; i++) if (v.mg[i] - v.mg[i - 1] <= 4) assert(v.mg[i - 1] >= 48, 'pas de tierce sous Do3');
    const toutes = [...GP.notesAccord(GP.mod(r + pas), q)]; assert(v.md.every(m => toutes.includes(GP.mod(m))), 'note étrangère');
    // Pouce sur une noire : seulement signalé, ou accord tout en noires.
    [[v.md, v.dd], [v.mg, v.dg]].forEach(([ms, ds]) => { if (!ms.every(GP.toucheNoire) && ms.some((m, i) => ds[i] === 1 && GP.toucheNoire(m))) { pouceNoir++; assert(v.alertes.includes('pouce-noire'), 'pouce noir non signalé'); } });
    if (v.alertes.length) signales++;
  }
}
/* Doigtés enseignés : Do majeur */
const tr = GP.voicing(0, 'maj'); assert.deepStrictEqual(tr.dd, GP.doigter(tr.md, 'd'));
assert.deepStrictEqual(GP.doigter([64, 67, 72], 'd'), [1, 2, 5], 'premier renversement'); assert.deepStrictEqual(GP.doigter([67, 72, 76], 'd'), [1, 3, 5], 'second renversement');
assert.deepStrictEqual(GP.doigter([60, 62, 67], 'd'), [1, 2, 5], 'sus2'); assert.deepStrictEqual(GP.doigter([48, 50, 55], 'g'), [5, 4, 1], 'sus2 à gauche');
assert.deepStrictEqual(GP.doigter([60, 64, 67, 71], 'd'), [1, 2, 3, 5], '7M fondamentale'); assert.deepStrictEqual(GP.doigter([48, 52, 55, 59], 'g'), [5, 3, 2, 1]);
assert.deepStrictEqual(GP.doigter([64, 67, 71, 72], 'd'), [1, 2, 4, 5], 'auriculaire serré');
/* Le voicing suit la main : peu de déplacement d'un accord au suivant */
const a = GP.voicing(0, 'maj'), b = GP.voicing(5, 'maj', { prec: a }), c = GP.voicing(7, 'maj', { prec: b });
const bouge = (x, y) => x.md.reduce((s, m) => s + Math.min(...y.md.map(v => Math.abs(v - m))), 0) / x.md.length;
assert(bouge(b, a) <= 2 && bouge(c, b) <= 3, `déplacement ${bouge(b, a)} ${bouge(c, b)}`);
/* 1 sur 3 : Mi à gauche */
assert.strictEqual(GP.mod(GP.voicing(0, 'maj', { basse: 4 }).mg[0]), 4);
assert.throws(() => GP.voicing(0, 'inconnue'));
/* Revue du pianiste (docs/recherche/revue-pianiste.md) : chaque erreur corrigée garde son cas */
// Trois notes serrées : la main se ferme, le 5 ne vient pas
assert.deepStrictEqual(GP.doigter([62, 64, 67], 'd'), [1, 2, 4], 'Ré Mi Sol'); assert.deepStrictEqual(GP.doigter([65, 67, 71], 'd'), [1, 2, 4], 'Fa Sol Si'); assert.deepStrictEqual(GP.doigter([64, 67, 69], 'd'), [1, 3, 4], 'Mi Sol La'); assert.deepStrictEqual(GP.doigter([60, 62, 64], 'd'), [1, 2, 3], 'Do Ré Mi');
assert.deepStrictEqual(GP.doigter([55, 57, 60], 'g'), [4, 3, 1], 'miroir à gauche'); assert.deepStrictEqual(GP.doigter([60, 65, 67], 'd'), [1, 4, 5], 'sus4 inchangé');
// Enseigné et gardé : 5-3-1 et 5-2-1 à gauche
assert.deepStrictEqual(GP.doigter([52, 55, 60], 'g'), [5, 3, 1]); assert.deepStrictEqual(GP.doigter([55, 60, 64], 'g'), [5, 2, 1]); assert.deepStrictEqual(GP.doigter([48, 55, 60], 'g'), [5, 2, 1], '1-5-8');
// L'octave de gauche ne pousse plus la droite : Do puis Fa garde le Do commun (avant : La Do Fa)
const do1 = GP.voicing(0, 'maj', { niveau: 1 }), fa1 = GP.voicing(5, 'maj', { niveau: 1, prec: do1 });
assert.deepStrictEqual(do1.mg, [36, 48]); assert.deepStrictEqual(fa1.md, [65, 69, 72]); assert.deepStrictEqual(fa1.dd, [1, 3, 5]);
// Ré majeur démarre pouce sur le Ré, pas sur le Fa dièse
assert.deepStrictEqual(GP.voicing(2, 'maj', { niveau: 1 }).md, [62, 66, 69]);
// Registre sur les trois enchaînements : la droite ne dérive pas (avant : Ré5 Fa♯5 La5 en Sol mineur), la gauche reste sous Do4
for (const mode of ['maj', 'min']) for (let t = 0; t < 12; t++) for (const p of mode === 'maj' ? [[1, 4, 5, 1], [1, 6, 2, 5, 1], [1, 5, 6, 4]] : [[1, 4, 5, 1], [1, 6, 4, 5, 1], [1, 5, 6, 4]]) for (const niveau of [0, 1, 2]) {
  let prec = null;
  for (const d of p) {
    const a = GP.accordDeDegre({ tonic: t, mode }, d), v = GP.voicing(a.racine, a.q, { prec, niveau }); prec = v;
    const centre = v.md.reduce((x, y) => x + y, 0) / v.md.length;
    assert(centre >= 58 && centre <= 76, `droite hors registre : ${t} ${mode} ${p} ${v.md}`); if (niveau) assert(v.mg[v.mg.length - 1] <= 59, 'gauche trop haute');
  }
}
// Le pouce sur noire coûte plus cher que le 5 sur noire
assert(GP.coutTouches([61, 64, 69], [1, 2, 5]) > GP.coutTouches([64, 69, 73], [1, 3, 5]));
// Add2 garde sa tonique, comme au catalogue
assert(GP.voicing(0, 'add2').md.map(GP.mod).includes(0)); assert.strictEqual(GP.voicing(0, 'add2').md.length, 4);
// Qualités riches : la droite garde tierce et septième
for (const [q, t3, t7] of [['7', 4, 10], ['9', 4, 10], ['m7', 3, 10], ['maj7', 4, 11], ['maj9', 4, 11], ['m9', 3, 10], ['13', 4, 10], ['7b9', 4, 10], ['7s9', 4, 10], ['m7b5', 3, 10]]) for (let r = 0; r < 12; r++) { const v = GP.voicing(r, q).md.map(GP.mod); assert(v.includes(GP.mod(r + t3)) && v.includes(GP.mod(r + t7)), `${r} ${q} sans tierce ou septième`); }
console.log(`test-doigtes : ${n} voicings passent, pouce sur noire signalé ${pouceNoir} fois (${signales} voicings avec alerte)`);
