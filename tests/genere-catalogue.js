'use strict';
/* Génère js/catalogue.js depuis docs/recherche/catalogue-gospel.json et vérifie les accents. Usage : node tests/genere-catalogue.js */
const fs = require('fs'), path = require('path'), assert = require('assert');
const racine = path.join(__dirname, '..'), src = path.join(racine, 'docs', 'recherche', 'catalogue-gospel.json'), dst = path.join(racine, 'js', 'catalogue.js');
const texte = fs.readFileSync(src, 'utf8'), cat = JSON.parse(texte);
assert(!/Ã.|â€|Â./.test(texte), 'accents abîmés dans la source');
assert(!texte.includes('�'), 'caractère de remplacement dans la source');
const sortie = '/* Généré par tests/genere-catalogue.js depuis docs/recherche/catalogue-gospel.json. Ne pas éditer à la main. */\n(globalThis.GP = globalThis.GP || {}).catalogue = ' + JSON.stringify(cat) + ';\n';
fs.writeFileSync(dst, sortie, 'utf8');
const relu = fs.readFileSync(dst, 'utf8');
assert(relu.includes('é') && !/Ã.|â€|�/.test(relu), 'accents abîmés dans la sortie');
delete globalThis.GP; require(dst);
assert.deepStrictEqual(globalThis.GP.catalogue, cat, 'le catalogue généré diffère de la source');
console.log(`catalogue : ${cat.length} entrées, ${cat.filter(e => e.live).length} live, accents vérifiés`);
