'use strict';
/* Publie la Bibliothèque : donnees/bibliotheque/chants.jsonl (construite hors du dépôt, licence par chant) vers bibliotheque.json (lu par l'appli)
   et appwrite/chants_base.csv (à importer dans la table chants_base d'Appwrite). node tests/donnees/publier-bibliotheque.js <chants.jsonl>
   Règle de droits, plus stricte que la construction : un air dit « traditionnel » par la seule personne qui a déposé la partition n'entre pas,
   sauf vérification à part (preuve « vérifié »). Chaque chant repasse par js/chant.js : un texte illisible n'est pas publié. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const R = path.join(__dirname, '..', '..');
require(path.join(R, 'js', 'theorie.js')); require(path.join(R, 'js', 'chant.js'));
const C = globalThis.GP.Chant;

const garder = c => !/air traditionnel déclaré/.test(c.preuve_licence || '') || /vérifié/.test(c.preuve_licence || '');
const CHAMPS = [ // les colonnes de la table chants_base (appwrite/LISEZMOI.md) ; id y devient $id
  'id', 'titre', 'auteurs', 'genre', 'annee', 'tonalite', 'mesure', 'bpm', 'texte', 'licence', 'preuve_licence', 'source', 'source_url', 'accords_source', 'paroles', 'melodie'];
const cellule = v => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
assert.strictEqual(cellule('a "b", c\nd'), '"a ""b"", c\nd"'); assert.strictEqual(cellule({ x: 1 }), '"{""x"":1}"'); assert.strictEqual(cellule(null), '');

function publier(source) {
  const tous = fs.readFileSync(source, 'utf8').trim().split('\n').map(l => JSON.parse(l)), refus = { droits: 0, lecture: 0 };
  const l = tous.filter(c => {
    if (!garder(c) || !c.licence) { refus.droits++; return false; }
    if (C.lireTexte(c.texte, { mesure: c.mesure }).erreurs.length) { refus.lecture++; return false; }
    return true;
  }).map(c => Object.fromEntries(CHAMPS.map(k => [k, c[k] ?? null])));
  fs.writeFileSync(path.join(R, 'bibliotheque.json'), JSON.stringify(l));
  fs.mkdirSync(path.join(R, 'appwrite'), { recursive: true });
  fs.writeFileSync(path.join(R, 'appwrite', 'chants_base.csv'), [CHAMPS.map(k => (k === 'id' ? '$id' : k)).join(','), ...l.map(c => CHAMPS.map(k => cellule(c[k])).join(','))].join('\n') + '\n');
  const g = {}; for (const c of l) g[c.genre] = (g[c.genre] || 0) + 1;
  console.log(`${l.length} chants publiés sur ${tous.length} (refusés : ${refus.droits} pour les droits, ${refus.lecture} illisibles). ${JSON.stringify(g)} ; avec paroles ${l.filter(c => c.paroles).length}.`);
}
if (require.main === module && process.argv[2]) publier(process.argv[2]);
