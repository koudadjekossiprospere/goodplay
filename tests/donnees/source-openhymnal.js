'use strict';
/* Open Hymnal vers le format commun du jeu d'entraînement (celui de lire_musicxml.py), avec les règles de droits de la base de cantiques.
   Usage : node tests/donnees/source-openhymnal.js <OpenHymnal2014.06.abc> <dossier des partitions lues> <meta.json>
   Temps en noires. La première voix porte la mélodie, comme pour js/base-hymnes.js. Aucune parole n'est lue. */
const fs = require('fs'), path = require('path');
const B = require('../genere-base-hymnes.js');

function versCommun(corps) {
  const lignes = corps.map(l => (/^%/.test(l) ? '' : l.replace(/%.*$/, '')));
  const entete = lignes.filter(l => /^[A-Za-z]:/.test(l));
  const M = B.champ(entete, /^M:\s*(.*)$/), Lc = B.champ(entete, /^L:\s*(.*)$/), K = B.champ(entete, /^K:\s*(\S+)/), Q = B.champ(entete, /^Q:\s*(.*)$/);
  const mM = M.match(/^(\d+)\/(\d+)/);
  if (!(K in B.ARMURES) || !mM) return null;
  const mesure = +mM[1], den = +mM[2], mL = Lc.match(/^1\/(\d+)/), L = mL ? 1 / +mL[1] : .125, f = 4 / den;
  const textes = new Map();
  for (const l of lignes) { const m = l.match(/^\s*\[V:\s*([^\]\s]+)\s*\](.*)$/); if (m) textes.set(m[1], (textes.get(m[1]) || '') + ' ' + m[2]); }
  if (textes.size < 2) return null;
  const sig = B.armure(B.ARMURES[K]), ids = [...textes.keys()];
  const vs = [...textes.values()].map(t => B.lireVoix(t, L, den, sig));
  const ref = vs.reduce((a, b) => (b.barres.length > a.barres.length ? b : a)), total = vs[0].total;
  const debuts = [0, ...ref.barres.filter(t => t > 1e-6 && t < total - 1e-6)];
  const q = (Q.match(/1\/4\s*=\s*(\d+)/) || [])[1] || vs[0].q;
  return {
    tempo: q ? +q : null,
    mesures: debuts.map((t, i) => ({ t: t * f, duree: ((i + 1 < debuts.length ? debuts[i + 1] : total) - t) * f, sig: [mesure, den], quintes: B.ARMURES[K], mode: null })),
    voix: vs.map((v, i) => ({ cle: 'P1/' + ids[i] + '/1', nom: i === 0 ? 'Melodie' : '', syllabes: i === 0 ? v.evts.length : 0, evts: v.evts.map(e => ({ t: e.t * f, d: e.d * f, p: e.p, lie: e.lie, point: !!e.point })) })),
    harmonies: [], respirations: [], reprises: vs.some(v => v.reprises), voltas: vs.some(v => v.variantes), changeMesure: vs.some(v => v.changeMesure)
  };
}

function main(abc, dossier, metaChemin) {
  fs.mkdirSync(dossier, { recursive: true });
  const airs = B.preparer(B.decouper(B.lireTexte(fs.readFileSync(abc))).filter(a => a.corps.some(l => /^T:/.test(l))));
  const meta = {}, motifs = {};
  for (const a of airs) {
    if (a.droit.motif) { motifs['droits : ' + a.droit.motif] = (motifs['droits : ' + a.droit.motif] || 0) + 1; continue; }
    const x = versCommun(a.corps);
    if (!x || x.changeMesure) { motifs['illisible ou mesure changeante'] = (motifs['illisible ou mesure changeante'] || 0) + 1; continue; }
    const id = 'oh' + a.num, titre = a.droit.motsProteges ? (a.droit.air || '').replace(/`/g, "'") : a.titre;
    if (!titre) { motifs['paroles protégées et pas de nom d\'air'] = (motifs['paroles protégées et pas de nom d\'air'] || 0) + 1; continue; }
    fs.writeFileSync(path.join(dossier, id + '.json'), JSON.stringify({ id, titre, ...x }));
    meta[id] = { source: 'Open Hymnal 2014.06', licence: 'domaine public (mention du fichier, droit américain)', droits: { statut: a.droit.libere ? 'libere' : 'regles-base', preuve: 'règles de docs/recherche/base-chants.md' + (a.arrangeurInconnu ? ', arrangeur inconnu' : '') }, style: ['cantique'], titre, compositeur: a.noms.join('; ') };
  }
  fs.writeFileSync(metaChemin, JSON.stringify(meta, null, 0));
  console.log(`airs ${airs.length}, convertis ${Object.keys(meta).length}`);
  for (const [m, n] of Object.entries(motifs).sort((p, q) => q[1] - p[1])) console.log(`  ${n}\t${m}`);
}

if (require.main === module) main(process.argv[2], process.argv[3], process.argv[4]);
module.exports = { versCommun };
