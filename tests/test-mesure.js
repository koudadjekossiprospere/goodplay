'use strict';
/* Contrôle anti-faux chiffres : le banc doit tourner sans erreur et imprimer de vrais chiffres. Usage : node tests/test-mesure.js */
const assert = require('assert'), { spawnSync } = require('child_process'), path = require('path');
const r = spawnSync(process.execPath, [path.join(__dirname, 'mesure.js'), '--rapide'], { encoding: 'utf8', timeout: 300000 });
assert.strictEqual(r.status, 0, 'node tests/mesure.js --rapide a échoué : ' + r.stderr);
assert(/CONTRÔLE, chants impairs/.test(r.stdout) && /RÉGLAGE, chants pairs/.test(r.stdout), 'les deux moitiés doivent être imprimées');
assert(/CRITÈRES/.test(r.stdout) && (r.stdout.match(/\b(PASS|FAIL)\b/g) || []).length === 5, 'cinq critères');
const c = r.stdout.split('CRITÈRES')[1];
assert(!/NaN|undefined/.test(c), 'chiffre manquant dans les critères');
console.log('test-mesure : le banc tourne');
