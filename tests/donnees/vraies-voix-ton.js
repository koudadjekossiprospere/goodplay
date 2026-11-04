'use strict';
/* Tonalité sur vraies voix, de bout en bout : chaque enregistrement LibriVox calé de façon fiable (jeu/ton/vraies-voix.jsonl) est décodé,
   puis écouté par le vrai moteur deux fois, Raison actuelle (profil) et Raison apprise. Aucun rejeu de notes : le moteur part de l'audio.
   node tests/donnees/vraies-voix-ton.js <dossier donnees> [w W]   écrit jeu/ton/vraies-voix-ton-<w>.json ; plusieurs processus en parallèle possibles.
   node tests/donnees/vraies-voix-ton.js <dossier donnees> bilan   réunit et imprime. Vérité : tonique du chant calé, annonce comprise dans l'audio. */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');

function main(dossier, w = 0, W = 1) {
  const { ecouter } = require('../vraies-voix.js'), { mesurer } = require('./eval-tonalite.js');
  const items = fs.readFileSync(path.join(dossier, 'jeu', 'ton', 'vraies-voix.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const manif = new Map(JSON.parse(fs.readFileSync(path.join(dossier, 'brut', 'librivox', 'manifeste.json'), 'utf8')).map(p => [p.id, p]));
  const tmp = path.join(os.tmpdir(), `goodplay-ton-${w}.f32`), out = [];
  items.forEach((it, i) => {
    if (i % W !== w) return;
    const p = manif.get(it.id); if (!p) return;
    const d = spawnSync(process.execPath, [path.join(__dirname, '..', 'decode-pcm.js'), path.join(dossier, 'brut', 'librivox', p.fichier), tmp], { encoding: 'utf8', timeout: 300000 });
    if (d.status !== 0 || !fs.existsSync(tmp)) return;
    const b = fs.readFileSync(tmp), x = new Float32Array(b.buffer, b.byteOffset, b.length >> 2); fs.rmSync(tmp, { force: true });
    const ref = { debut: it.debut, notes: [[0, it.debut, x.length / 48000]], verite: it.verite };
    for (const raison of ['profil', 'apprise']) {
      const r = ecouter(x, 48000, { raison }), aff = r.ev.tonalite.map(k => [k.t, k.tonic, k.mode, k.etat || 'probable']);
      out.push({ id: it.id, raison, ...mesurer(ref, aff) });
    }
    console.log(`processus ${w} : ${it.id}`);
  });
  fs.writeFileSync(path.join(dossier, 'jeu', 'ton', `vraies-voix-ton-${w}.json`), JSON.stringify(out));
}

function bilanFinal(dossier) {
  const { bilan, ligne, ENTETE } = require('./eval-tonalite.js'), J = path.join(dossier, 'jeu', 'ton');
  const res = fs.readdirSync(J).filter(f => /^vraies-voix-ton-\d+\.json$/.test(f)).flatMap(f => JSON.parse(fs.readFileSync(path.join(J, f), 'utf8')));
  console.log(ENTETE);
  for (const raison of ['profil', 'apprise']) console.log(ligne(`vraies voix, ${raison}`, bilan(res.filter(r => r.raison === raison))));
}

if (require.main === module && process.argv[2]) {
  if (process.argv[3] === 'bilan') bilanFinal(process.argv[2]);
  else main(process.argv[2], +(process.argv[3] || 0), +(process.argv[4] || 1));
}
