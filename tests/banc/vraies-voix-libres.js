'use strict';
/* Le moteur, avec MPM ou une oreille neuronale, sur de vrais enregistrements libres qui ont une vérité. L'audio ne vit pas dans le projet.
   node tests/banc/vraies-voix-libres.js [--vocadito <dossier>] [--librivox <dossier de .f32 48 kHz>] [--ia <dossier>] [--candidats mpm,swift2k2.agc,crepe] [--sortie x.json]
   vocadito (zenodo.org/records/5578807, CC BY 4.0) : 40 extraits de voix seule, notes relevées par deux musiciens (A1 sert de vérité, A2 donne le plafond humain).
     Tonalité de référence : celle que le moteur donne quand on lui passe les notes relevées. On mesure donc ce que l'oreille fait perdre, pas la justesse de la raison.
   LibriVox « Favorite Hymns 01 » (archive.org, domaine public) : cantiques chantés après une annonce parlée. Le chant attendu est connu ;
     tonique de référence : celle de la mélodie connue calée par la reconnaissance sur la passe MPM. Estimée, pas validée par une oreille humaine. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const { ecouter } = require('../vraies-voix.js');
const { CAND, brancher } = require('./compare-ia.js'); // charge aussi la reconnaissance et la base
const { lireCorpus } = require('./synth.js');
const GP = globalThis.GP;

const A = process.argv.slice(2), opt = n => { const i = A.indexOf(n); return i >= 0 ? A[i + 1] : null; };
const hzMidi = f => 69 + 12 * Math.log2(f / 440), med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const nomTon = k => k ? GP.nomNote(k.tonic, k) + (k.mode === 'maj' ? ' maj' : ' min') : 'aucune';
const meme = (a, b) => !!a && !!b && a.tonic === b.tonic && a.mode === b.mode;

function lisWav(f) {
  const b = fs.readFileSync(f); let p = 12, sr = 0, ch = 1, bits = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === 'data') { assert.strictEqual(bits, 16, f); const k = Math.floor(n / 2 / ch), x = new Float32Array(k); for (let i = 0; i < k; i++) { let s = 0; for (let c = 0; c < ch; c++) s += b.readInt16LE(p + 8 + 2 * (i * ch + c)); x[i] = s / ch / 32768; } return { x, sr }; }
    p += 8 + n + (n & 1);
  }
  throw new Error('pas de données audio : ' + f);
}
const lisF32 = f => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length >> 2); };

const oreille = async (nom, x, sr) => CAND[nom] ? CAND[nom](new GP.Moteur({ sr }).dec(x), x) : null;
const passe = (x, sr, det) => ecouter(x, sr, {}, m => { if (det) brancher(m, det); });

/* Part du temps entre t0 et fin où la tonalité affichée est ref ; avant le premier verrou, rien n'est juste. */
function partJuste(ks, ref, t0, fin) {
  let j = 0; ks.forEach((k, i) => { const a = Math.max(t0, k.t), b = Math.min(fin, i + 1 < ks.length ? ks[i + 1].t : fin); if (b > a && meme(k, ref)) j += b - a; });
  return 100 * j / (fin - t0);
}
const changements = ks => ks.filter((k, i) => i && !meme(k, ks[i - 1])).length;

const relevees = f => fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map(l => l.split(',').map(Number)).filter(v => v.length >= 3 && v[1] > 0).map(([d, hz, du]) => ({ debut: d, fin: d + du, midi: hzMidi(hz) }));
/* Classe de hauteur dans un accordage donné, pas dans le La 440. Un chanteur à un quart de ton entre deux touches se nomme des deux côtés :
   on nomme donc la vérité dans l'accordage final de l'oreille jugée, sinon tout un chant compterait faux d'un demi-ton. */
const nommer = (n, acc) => n.map(e => ({ ...e, pc: GP.mod(Math.round(e.midi - acc), 12) }));
const accordageDe = n => { let zr = 0, zi = 0; for (const e of n) { const ph = 2 * Math.PI * (e.midi % 1); zr += Math.cos(ph); zi += Math.sin(ph); } return Math.atan2(zi, zr) / (2 * Math.PI); };
const decale = (k, d) => k && { ...k, tonic: GP.mod(k.tonic + d, 12) };
const recouvre = (a, b) => Math.max(0, Math.min(a.fin, b.fin) - Math.max(a.debut, b.debut));
/* Notes justes : part du temps relevé où l'oreille tient la même classe. Temps faux : part du temps de note de l'oreille sans note relevée de cette classe dessous. */
function compareNotes(vrai, vues) {
  const tv = vrai.reduce((s, e) => s + e.fin - e.debut, 0), tn = vues.reduce((s, e) => s + e.fin - e.debut, 0);
  let j = 0, ok = 0; for (const v of vrai) for (const e of vues) if (e.pc === v.pc) j += recouvre(v, e);
  for (const e of vues) for (const v of vrai) if (e.pc === v.pc) ok += recouvre(v, e);
  return { justes: tv ? 100 * j / tv : 0, faux: tn ? 100 * (tn - ok) / tn : 0 };
}
/* Le moteur nourri des notes relevées, au rythme de ses tics : la tonalité qu'il donnerait avec une oreille parfaite. */
function oracle(vrai, duree) {
  const m = new GP.Moteur({ sr: 16000 }), ks = []; m.on('tonalite', k => ks.push(k));
  let i = 0; for (let t = .02; t <= duree + 1e-9; t += .02) { while (i < vrai.length && vrai[i].fin < t) i++; const v = vrai[i] && vrai[i].debut <= t ? vrai[i] : null; m.hauteur(t, v ? v.midi : null, v ? 1 : 0, v ? .05 : .001); }
  return { ks, acc: m.accordage };
}

async function vocadito(dir, noms) {
  const res = {}, fichiers = fs.readdirSync(path.join(dir, 'Audio')).filter(f => /^vocadito_\d+\.wav$/.test(f)).sort((a, b) => parseInt(a.slice(9)) - parseInt(b.slice(9)));
  const plafond = [];
  for (const f of fichiers) {
    const id = f.replace('.wav', ''), { x, sr } = lisWav(path.join(dir, 'Audio', f)), duree = x.length / sr;
    const v1 = relevees(path.join(dir, 'Annotations/Notes', id + '_notesA1.csv')), v2 = relevees(path.join(dir, 'Annotations/Notes', id + '_notesA2.csv'));
    const a1 = accordageDe(v1), o = oracle(v1, duree); plafond.push(compareNotes(nommer(v1, a1), nommer(v2, a1)));
    for (const nom of noms) {
      const r = passe(x, sr, await oreille(nom, x, sr)), ks = r.ev.tonalite, c = compareNotes(nommer(v1, r.m.accordage), r.ev.note);
      const ko = o.ks.map(k => decale(k, -Math.round(r.m.accordage - o.acc))), ref = ko[ko.length - 1]; // l'oracle, nommé dans l'accordage de cette passe
      (res[nom] = res[nom] || []).push({ id, duree, ...c, ref: nomTon(ref), vu: nomTon(ks[ks.length - 1]), tonOk: ref ? meme(ks[ks.length - 1], ref) : null, juste: ref ? partJuste(ks, ref, 0, duree) : null, juste0: ref ? partJuste(ko, ref, 0, duree) : null });
    }
  }
  console.log(`\n== vocadito : ${fichiers.length} extraits ; plafond humain (A2 contre A1) : notes justes ${med(plafond.map(p => p.justes)).toFixed(0)} %, temps faux ${med(plafond.map(p => p.faux)).toFixed(0)} % (médianes)`);
  console.log('| oreille | notes justes, médiane | temps faux, médiane | dernière tonalité = référence | tonalité juste, part du temps (oreille parfaite) |\n|---|---|---|---|---|');
  for (const nom of noms) {
    const L = res[nom], R = L.filter(e => e.tonOk != null);
    console.log(`| ${nom} | ${med(L.map(e => e.justes)).toFixed(0)} % | ${med(L.map(e => e.faux)).toFixed(0)} % | ${R.filter(e => e.tonOk).length}/${R.length} | ${(R.reduce((s, e) => s + e.juste * e.duree, 0) / R.reduce((s, e) => s + e.duree, 0)).toFixed(0)} % (${(R.reduce((s, e) => s + e.juste0 * e.duree, 0) / R.reduce((s, e) => s + e.duree, 0)).toFixed(0)} %) |`);
  }
  return res;
}

const ATTENDU = { abidewithme: 'Eventide', alleluiasingtojesus: 'HyFrydol', amazinggrace: 'Amazing Grace', bethoumyvision: 'Be Thou My Vision', holyholyholy: 'Holy, Holy, Holy', howfirmafoundation: 'How Firm A Foundation', nearermygodtothee: 'Nearer, My God, To Thee', ourgodourhelp: 'St. Anne', praisetothelord: 'Praise To The Lord', rockofages: 'Rock of Ages', lovedivine: null };
const reconnaitre = notes => { const rec = new GP.Reconnaissance({ chants: [...lireCorpus(), ...GP.baseHymnes] }), rc = []; rec.on('chantReconnu', e => rc.push(e)); notes.forEach(n => rec.note(n)); return rc; };
/* Début du chant : trois notes tenues (400 ms et plus) en 5 s. L'annonce parlée de LibriVox n'en fait pas. */
const debutChant = notes => { const t = notes.filter(e => e.fin - e.debut >= .4); for (let i = 0; i + 2 < t.length; i++) if (t[i + 2].debut - t[i].debut <= 5) return Math.floor(t[i].debut / .02) * .02; return 0; };

async function librivox(dir, noms) {
  const res = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.f32')).sort()) {
    const id = f.replace('.f32', ''), x = lisF32(path.join(dir, f)), sr = 48000, duree = x.length / sr, attendu = ATTENDU[id];
    const base = passe(x, sr, null), t0 = debutChant(base.ev.note), rb = reconnaitre(base.ev.note), bon = attendu && rb.find(e => e.titre.startsWith(attendu));
    const ref0 = bon ? { tonic: bon.tonique, mode: 'maj' } : null; // les dix airs attendus sont en majeur dans la base
    // Référence dans le nommage de chaque passe : sa propre reconnaissance du bon chant, sinon celle de la passe MPM recalée sur son accordage.
    const refDe = (r, rc) => { const e = attendu && rc.find(e => e.titre.startsWith(attendu)); return e ? { tonic: e.tonique, mode: 'maj' } : decale(ref0, Math.round(r.m.accordage - base.m.accordage)); };
    for (const nom of noms) {
      const det = await oreille(nom, x, sr), plein = nom === 'mpm' ? base : passe(x, sr, det), refP = refDe(plein, nom === 'mpm' ? rb : reconnaitre(plein.ev.note));
      const xs = x.subarray(Math.round(t0 * sr)), dt = det && { retard: det.retard, lit: t => det.lit(t + t0) }, r = passe(xs, sr, dt), ks = r.ev.tonalite, rc = reconnaitre(r.ev.note), ref = refDe(r, rc);
      const ok = attendu ? rc.find(e => e.titre.startsWith(attendu)) : null, faux = rc.filter(e => !attendu || !e.titre.startsWith(attendu));
      (res[nom] = res[nom] || []).push({ id, t0, duree: duree - t0, ref: nomTon(ref), premiere: ks[0] ? { t: ks[0].t, ton: nomTon(ks[0]), ok: meme(ks[0], ref) } : null, justeT: ref ? (ks.find(k => meme(k, ref)) || {}).t : null, juste: ref ? partJuste(ks, ref, 0, duree - t0) : null, justeAnnonce: refP ? partJuste(plein.ev.tonalite, refP, t0, duree) : null, accordage: r.m.accordage, changements: changements(ks), tons: [...new Set(ks.map(nomTon))].join(' > '), reconnu: ok ? ok.t : null, fauxChants: faux.map(e => e.titre) });
    }
  }
  console.log('\n== LibriVox, mesuré depuis le début du chant (annonce parlée coupée)');
  for (const nom of noms) {
    console.log(`\n${nom}\n| chant | référence | 1re tonalité | tonalité juste dès | part juste | avec l'annonce | changements | chant reconnu à |\n|---|---|---|---|---|---|---|---|`);
    for (const e of res[nom]) console.log(`| ${e.id} | ${e.ref} (${Math.round(100 * e.accordage)} c) | ${e.premiere ? `${e.premiere.ton} à ${e.premiere.t.toFixed(1)} s${e.premiere.ok ? '' : ', fausse'}` : 'aucune'} | ${e.justeT != null ? e.justeT.toFixed(1) + ' s' : '-'} | ${e.juste != null ? e.juste.toFixed(0) + ' %' : '-'} | ${e.justeAnnonce != null ? e.justeAnnonce.toFixed(0) + ' %' : '-'} | ${e.changements} | ${e.reconnu != null ? e.reconnu.toFixed(0) + ' s' : 'non'}${e.fauxChants.length ? ', faux : ' + e.fauxChants.join(', ') : ''} |`);
    const R = res[nom].filter(e => e.ref !== 'aucune');
    console.log(`bilan : 1re tonalité juste ${R.filter(e => e.premiere && e.premiere.ok).length}/${R.length}, juste dès ${med(R.map(e => e.justeT == null ? Infinity : e.justeT)).toFixed(1)} s (médiane), part juste ${(R.reduce((s, e) => s + e.juste * e.duree, 0) / R.reduce((s, e) => s + e.duree, 0)).toFixed(0)} %, avec l'annonce ${(R.reduce((s, e) => s + e.justeAnnonce * e.duree, 0) / R.reduce((s, e) => s + e.duree, 0)).toFixed(0)} %, reconnus ${R.filter(e => e.reconnu != null).length}/${R.length} en ${med(R.filter(e => e.reconnu != null).map(e => e.reconnu)).toFixed(0)} s (médiane), faux chants ${res[nom].reduce((s, e) => s + e.fauxChants.length, 0)}`);
  }
  return res;
}

assert.strictEqual(debutChant([{ debut: 1, fin: 1.1 }, { debut: 2, fin: 2.5 }, { debut: 3, fin: 3.5 }, { debut: 6, fin: 6.5 }]), 2);
assert.deepStrictEqual(compareNotes([{ debut: 0, fin: 1, pc: 0 }], [{ debut: .5, fin: 1.5, pc: 0 }]), { justes: 50, faux: 50 });

(async () => {
  const noms = (opt('--candidats') || 'mpm').split(','), out = {};
  if (opt('--vocadito')) out.vocadito = await vocadito(opt('--vocadito'), noms);
  if (opt('--librivox')) out.librivox = await librivox(opt('--librivox'), noms);
  if (opt('--sortie')) fs.writeFileSync(opt('--sortie'), JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
