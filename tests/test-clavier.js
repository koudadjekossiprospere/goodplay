'use strict';
/* La géométrie du clavier : chaque noire sur la fente entre ses deux blanches, Do juste à gauche de deux noires. Usage : node tests/test-clavier.js */
const assert = require('assert');
require('../js/clavier.js');
const x = globalThis.GP.Clavier.xTouche, W = 24, NOIRES = [1, 3, 6, 8, 10];
for (let m = 36; m <= 84; m++) {
  if (!NOIRES.includes(m % 12)) continue;
  const fente = (x(m - 1) + x(m + 1)) / 2;
  assert(Math.abs(x(m) - fente) <= .2 * W, 'noire ' + m + ' hors de sa fente : ' + x(m) + ' contre ' + fente);
}
// Entre Mi et Fa, entre Si et Do : aucune noire, donc deux blanches voisines.
for (const m of [40, 47, 52, 59, 64, 71]) assert.strictEqual(x(m + 1) - x(m), W);
assert.strictEqual(x(38) - x(36), W, 'Do et Ré sont deux blanches voisines');
console.log('test-clavier : tout passe');
