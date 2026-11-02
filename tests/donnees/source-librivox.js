'use strict';
/* Télécharge des recueils LibriVox chantés (domaine public) depuis archive.org, en MP3 64 kb/s, et écrit leur inventaire.
   Usage : node tests/donnees/source-librivox.js <dossier de sortie> <identifiant archive.org>...
   Inventaire : manifeste.json, une entrée par piste { id, recueil, fichier, titre, lecteur, duree }. Les fichiers ne vont jamais dans le dépôt. */
const fs = require('fs'), path = require('path');

const PARALLELE = 6;
const secondes = l => (l == null ? null : String(l).includes(':') ? String(l).split(':').reduce((s, x) => s * 60 + +x, 0) : +l || null); // archive.org : « 254.3 » ou « 04:14 »

async function piste(dossier, ident, meta, f, manifeste) {
  const nom = path.basename(f.name), cible = path.join(dossier, ident, nom);
  for (let essai = 0; essai < 3 && !(fs.existsSync(cible) && fs.statSync(cible).size === +f.size); essai++) {
    const r = await fetch(`https://archive.org/download/${ident}/${encodeURIComponent(f.name)}`).catch(e => ({ ok: false, status: e.message }));
    if (r.ok) fs.writeFileSync(cible, Buffer.from(await r.arrayBuffer()));
    else console.log('échec', ident, nom, r.status, 'essai', essai + 1);
  }
  if (fs.existsSync(cible) && fs.statSync(cible).size === +f.size)
    manifeste.push({ id: ident + '/' + nom.replace(/_64kb\.mp3$/, ''), recueil: meta.metadata.title, fichier: path.join(ident, nom), titre: f.title || nom, lecteur: f.artist || f.creator || '', duree: secondes(f.length) });
}

async function main(dossier, ids) {
  const fm = path.join(dossier, 'manifeste.json'), manifeste = [], taches = [];
  for (const ident of ids) {
    const meta = await (await fetch('https://archive.org/metadata/' + ident)).json();
    fs.mkdirSync(path.join(dossier, ident), { recursive: true });
    for (const f of (meta.files || []).filter(f => /_64kb\.mp3$/.test(f.name))) taches.push(() => piste(dossier, ident, meta, f, manifeste));
  }
  let i = 0;
  await Promise.all(Array.from({ length: PARALLELE }, async () => { while (i < taches.length) await taches[i++](); }));
  manifeste.sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(fm, JSON.stringify(manifeste, null, 1));
  console.log('pistes', manifeste.length, 'durée', (manifeste.reduce((s, p) => s + (p.duree || 0), 0) / 3600).toFixed(1), 'h');
}

if (require.main === module) main(process.argv[2], process.argv.slice(3));
