'use strict';
/* Vraie parole pour apprendre à la Raison à ne rien conclure d'une annonce : sections de recueils collectifs LibriVox (domaine public),
   un extrait par lecteur, français d'abord, puis d'autres langues. Seul le début de chaque section est téléchargé (requête partielle) ;
   il passe dans la vraie oreille (js/moteur.js). Les lecteurs viennent de l'API LibriVox (archive.org ne donne que l'auteur du texte).
   node tests/donnees/source-parole.js <dossier donnees> <max par recueil> <identifiant de livre LibriVox>... [--part w/W]
   Écrit brut/parole/<livre>__<section>.json : { lecteur, langue, notes: [[midi, début, fin]] } (notes de l'oreille, rien d'autre). Le PCM est effacé. */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const OCTETS = 1600000; // environ 3 min 20 en 64 kb/s

async function main(dossier, maxParRecueil, ids, w, W) {
  const { ecouter } = require('../vraies-voix.js'), dst = path.join(dossier, 'brut', 'parole'), tmp = path.join(os.tmpdir(), `goodplay-parole-${w}`);
  fs.mkdirSync(dst, { recursive: true });
  const taches = [], lecteurs = new Set();
  for (const id of ids) {
    const j = await (await fetch(`https://librivox.org/api/feed/audiobooks/?id=${id}&extended=1&format=json`)).json().catch(() => ({}));
    const b = (j.books || [])[0]; if (!b) { console.log('livre introuvable : ' + id); continue; }
    // Le français d'abord (les annonces de l'église le seront souvent), puis les autres langues ; un lecteur n'apparaît qu'une fois en tout.
    const secs = (b.sections || []).filter(s => s.listen_url && (s.readers || []).length).sort((x, y) => (y.language === 'French') - (x.language === 'French'));
    let n = 0;
    for (const s of secs) {
      const lecteur = s.readers[0].display_name; if (lecteurs.has(lecteur)) continue;
      lecteurs.add(lecteur); taches.push({ id, num: s.section_number, url: s.listen_url, lecteur, langue: s.language }); if (++n >= maxParRecueil) break;
    }
  }
  let n = 0;
  for (const [i, t] of taches.entries()) {
    if (i % W !== w) continue;
    const cible = path.join(dst, `lv${t.id}__${t.num}.json`); if (fs.existsSync(cible)) continue;
    const r = await fetch(t.url.replace('http://', 'https://'), { headers: { Range: `bytes=0-${OCTETS}` } }).catch(() => null);
    if (!r || !(r.ok || r.status === 206)) continue;
    fs.writeFileSync(tmp + '.mp3', Buffer.from(await r.arrayBuffer()));
    const d = spawnSync(process.execPath, [path.join(__dirname, '..', 'decode-pcm.js'), tmp + '.mp3', tmp + '.f32'], { encoding: 'utf8', timeout: 300000 });
    if (d.status !== 0 || !fs.existsSync(tmp + '.f32')) { fs.rmSync(tmp + '.mp3', { force: true }); continue; }
    const b = fs.readFileSync(tmp + '.f32'), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
    fs.rmSync(tmp + '.f32', { force: true }); fs.rmSync(tmp + '.mp3', { force: true });
    const e = ecouter(x, 48000);
    fs.writeFileSync(cible, JSON.stringify({ lecteur: t.lecteur, langue: t.langue, livre: t.id, notes: e.ev.note.map(z => [Math.round(z.midi), +z.debut.toFixed(3), +z.fin.toFixed(3)]) }));
    n++;
  }
  console.log(`processus ${w} : ${n} extraits sur ${taches.filter((_, i) => i % W === w).length} prévus`);
}

if (require.main === module && process.argv[4]) {
  const a = process.argv.slice(2), part = a.indexOf('--part'), [w, W] = part >= 0 ? a[part + 1].split('/').map(Number) : [0, 1];
  main(a[0], +a[1], a.slice(2, part >= 0 ? part : undefined), w, W).catch(e => { console.error(e); process.exit(1); });
}
