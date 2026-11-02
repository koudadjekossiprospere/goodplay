/* Contrôles de la musique de Labs : node tests/test-labs.js */
const assert = require('assert');
require('../js/labs.js');
const { LECONS, construire, cadre, versionChant, propositions, chantDuCorpus, epeler } = GP.Labs;
const mod = GP.mod, temps = l => l.reduce((s, a) => s + a.n, 0);

// Toutes les entrées et les leçons, dans les 12 tonalités : rien ne casse, le squelette dure autant que le geste, les entrées restent celles de jouerEntree.
let accords = 0;
for (const e of GP.catalogue) for (let t = 0; t < 12; t++) {
  const k = { tonic: t, mode: e.mode }, c = cadre(e), ap = construire(c.apres, k), av = construire(c.avant, k, ap[0]);
  assert.strictEqual(temps(av), temps(ap), e.id);
  const attendu = GP.jouerEntree(e, k), recus = ap.filter(a => a.entree === e.id);
  assert.strictEqual(recus.length, attendu.length, e.id);
  recus.forEach((a, i) => { assert.deepStrictEqual(a.md, attendu[i].md, e.id); assert.deepStrictEqual(a.mg, attendu[i].mg, e.id); assert.deepStrictEqual(a.dd, attendu[i].dd, e.id); });
  accords += ap.length + av.length;
}
assert.strictEqual(LECONS.length, 19);
LECONS.forEach((l, i) => {
  for (const id of [l.id, ...(l.liens || [])].filter(Boolean)) assert.ok(GP.catalogue.find(e => e.id === id), 'id absent : ' + id);
  for (let t = 0; t < 12; t++) {
    const k = { tonic: t, mode: l.mode || 'maj' }, ap = construire(l.apres, k), av = construire(l.avant, k, ap[0]);
    assert.strictEqual(temps(av), temps(ap), 'leçon ' + (i + 1));
    for (const a of [...ap, ...av]) { assert.ok(a.md.length && a.mg.length); assert.strictEqual(mod(a.mg[0]), mod(a.basse), 'leçon ' + (i + 1)); }
  }
});

// Les noms écrits sonnent bien la note, quelle que soit la façon de l'écrire.
const PC = { Do: 0, 'Ré': 2, Mi: 4, Fa: 5, Sol: 7, La: 9, Si: 11 };
const pcDe = n => mod(PC[n.replace(/[♯♭]/g, '')] + (n.includes('♯') ? 1 : 0) - (n.includes('♭') ? 1 : 0));
for (const e of GP.catalogue) for (let t = 0; t < 12; t++) {
  const k = { tonic: t, mode: e.mode };
  for (const a of GP.jouerEntree(e, k)) for (const m of [...a.mg, ...a.md]) assert.strictEqual(pcDe(epeler(m, a, k)), mod(m), e.id);
}
assert.strictEqual(epeler(66, { racine: 2, q: '7' }, { tonic: 5, mode: 'maj' }), 'Fa♯'); // revue : Ré7 sur Fa♯ en Fa majeur
assert.strictEqual(epeler(63, { racine: 8, q: 'maj' }, { tonic: 0, mode: 'maj' }), 'Mi♭'); // La♭ majeur en Do

// Chants : la version enrichie garde la durée du squelette, dans toutes les tonalités, et respecte le Transpose.
GP.chants.map(chantDuCorpus).forEach(ch => {
  const total = ch.cases.reduce((s, c) => s + c.t, 0);
  for (const jeu of [null, 0, 3, 6]) {
    const sq = versionChant(ch, jeu, 0, null), sh = GP.vue(ch.ton, jeu).sh;
    assert.strictEqual(temps(sq), total, ch.titre);
    sq.forEach((a, i) => assert.strictEqual(mod(a.mg[0]), mod(ch.cases[i].basse - sh), ch.titre));
    const gardes = {}; let vides = 0;
    ch.cases.forEach((_, i) => { const p = propositions(ch, i, 'gospel'); if (p.length) gardes[i] = p[0].id; else vides++; });
    assert.ok(Object.keys(gardes).length > 0, 'aucune proposition : ' + ch.titre);
    const v = versionChant(ch, jeu, 0, gardes);
    assert.ok(Math.abs(temps(v) - total) < 1e-9, ch.titre);
    assert.ok(v.length >= sq.length, ch.titre);
  }
});
console.log(`labs : ${GP.catalogue.length} entrées, ${LECONS.length} leçons, ${accords} accords en 12 tonalités, ${GP.chants.length} chants : ok`);
