'use strict';
/* Mes chants (export de Labs, « Exporter pour l'entraînement ») vers le format du jeu d'entraînement.
   node tests/donnees/source-goodplay.js <dossier donnees>   lit brut/mes-chants/*.json, écrit jeu/goodplay.jsonl ; relancer ensuite assembler.js.
   La mélodie vient de la vraie oreille (pas de bruit simulé à ajouter) ; la grille est celle du moteur, corrigée par le musicien là où il l'a touchée.
   Une grille jamais corrigée reste la sortie du moteur : elle est gardée, marquée, et chaque case dit si elle a été corrigée.
   Données personnelles : elles restent dans Goodplay/donnees, jamais dans le dépôt. Les exports ne contiennent ni son ni paroles. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const B = require('../genere-base-hymnes.js');
const mod12 = x => ((x % 12) + 12) % 12, r3 = x => Math.round(x * 1000) / 1000;
const FIN_PHRASE = .75; // silence d'au moins 3/4 de temps après une note : fin de phrase

function enJeu(c) {
  const sig = c.signature;
  if (!sig || !Array.isArray(sig.notes) || sig.notes.length < 8 || !Array.isArray(sig.cases) || !sig.cases.length) return { motif: 'sans mélodie (enregistré depuis Labs)' };
  const tonique = c.ton.tonic, mode = c.ton.mode, fin = sig.duree;
  const notes = sig.notes.map(([h, t, d], i) => {
    const suiv = sig.notes[i + 1], dur = d != null ? d : (suiv ? suiv[1] : fin) - t; // les chants enregistrés avant l'ajout de la durée tenue : jusqu'à la note suivante
    return [h, r3(t), r3(Math.max(.05, dur)), null, !suiv || suiv[1] - (t + dur) >= FIN_PHRASE ? 1 : 0];
  });
  const cases = sig.cases.map((x, i) => {
    const t1 = i + 1 < sig.cases.length ? sig.cases[i + 1].t0 : fin, rel = mod12(x.dec + x.rel);
    return { t: x.t0, d: Math.max(0, t1 - x.t0), rel, q: x.q, relBasse: mod12(x.dec + x.relBasse), deg: B.degre(mod12(tonique + rel), tonique), corrige: !!x.corrige, dec: x.dec };
  }).filter(x => x.d > 0);
  const squelette = [];
  for (const x of cases) { const s = squelette[squelette.length - 1]; if (s && s[2] === x.deg && s[3] === x.rel) s[1] = r3(s[1] + x.d); else squelette.push([r3(x.t), r3(x.d), x.deg, x.rel]); }
  const corrigees = cases.filter(x => x.corrige).length, alertes = [];
  if (!corrigees) alertes.push('grille du moteur, aucune case corrigée');
  if (cases.some(x => x.dec)) alertes.push('modulation dans le chant');
  return {
    id: 'mc-' + c.id, source: 'Mes chants (export de Labs)', licence: 'enregistrement personnel, ne pas publier', droits: { statut: 'personnel', preuve: 'chanté et enregistré par le propriétaire' },
    style: ['mon-repertoire'], titre: c.titre, compositeur: '', ton: { tonique, mode, modal: false }, mesure: [c.mesure || 4, 4], bpm: c.bpm || null,
    notes, accords: cases.map(x => [r3(x.t), r3(x.d), x.rel, x.q, x.relBasse]), squelette,
    origine: 'mes-chants', notesDeLOreille: true, validation: { cases: cases.length, corrigees, parCase: cases.map(x => (x.corrige ? 1 : 0)) },
    accordAnalyse: null, texture: null, phrases: 'silences', marques: notes.filter(n => n[4]).length, alertes
  };
}

function main(dossier) {
  const src = path.join(dossier, 'brut', 'mes-chants'), dst = path.join(dossier, 'jeu', 'goodplay.jsonl');
  if (!fs.existsSync(src)) { console.log(`Rien à convertir : dépose les fichiers exportés depuis Labs dans ${src}.`); return; }
  const parId = new Map(), motifs = {};
  for (const f of fs.readdirSync(src).filter(f => f.endsWith('.json')).sort()) {
    let p; try { p = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8')); } catch (e) { motifs['fichier illisible'] = (motifs['fichier illisible'] || 0) + 1; continue; }
    if (p.format !== 'goodplay-mes-chants' || !Array.isArray(p.chants)) { motifs['pas un export de Mes chants'] = (motifs['pas un export de Mes chants'] || 0) + 1; continue; }
    for (const c of p.chants) { const d = parId.get(c.id); if (!d || p.exporte > d.quand) parId.set(c.id, { c, quand: p.exporte }); } // le même chant dans deux exports : le plus récent
  }
  const lignes = [];
  for (const { c } of parId.values()) { const r = enJeu(c); if (r.motif) { motifs[r.motif] = (motifs[r.motif] || 0) + 1; continue; } lignes.push(JSON.stringify(r)); }
  fs.writeFileSync(dst, lignes.join('\n') + (lignes.length ? '\n' : ''));
  const recs = lignes.map(l => JSON.parse(l)), cor = recs.reduce((s, r) => s + r.validation.corrigees, 0), tot = recs.reduce((s, r) => s + r.validation.cases, 0);
  console.log(`chants ${parId.size}, convertis ${recs.length}, cases corrigées ${cor} sur ${tot}`);
  for (const [m, n] of Object.entries(motifs)) console.log(`  ${n}\t${m}`);
}

{ // un chant en Sol, 9 notes, trois cases dont une corrigée et une sur le 5 du ton voisin (dec 7, rel 0 : Ré, le 5 de Sol)
  const c = { id: 'm1', titre: 'Esprit de Dieu', ton: { tonic: 7, mode: 'maj' }, bpm: 70, mesure: 4,
    signature: { notes: [[67, 0, .9], [69, 1, .9], [71, 2, 1.8], [72, 4, .9], [71, 5, .9], [69, 6, .9], [67, 8, 1.9], [69, 10, .9], [67, 11, 2]], duree: 13,
      cases: [{ deg: 1, q: 'maj', rel: 0, relBasse: 0, dec: 0, mode: 'maj', t0: 0 }, { deg: 4, q: 'maj', rel: 5, relBasse: 5, dec: 0, mode: 'maj', t0: 4, corrige: true }, { deg: 1, q: 'maj', rel: 0, relBasse: 0, dec: 7, mode: 'maj', t0: 8 }] } };
  const r = enJeu(c);
  assert.deepStrictEqual(r.squelette.map(s => s[2]), [1, 4, 5]); assert.deepStrictEqual(r.validation.parCase, [0, 1, 0]);
  assert.strictEqual(r.notes[5][4], 1); assert.strictEqual(r.notes[2][4], 0); // silence d'un temps après la 6e note
  assert.ok(r.alertes.includes('modulation dans le chant'));
  assert.strictEqual(enJeu({ ...c, signature: null }).motif, 'sans mélodie (enregistré depuis Labs)');
  // sans durée tenue (ancien enregistrement) : jusqu'à la note suivante
  assert.strictEqual(enJeu({ ...c, signature: { ...c.signature, notes: c.signature.notes.map(([h, t]) => [h, t]) } }).notes[0][2], 1);
}

if (require.main === module && process.argv[2]) main(process.argv[2]);
module.exports = { enJeu };
