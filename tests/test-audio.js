'use strict';
/* GP.Audio avec une fausse API audio : réouverture du micro, repli sur l'analyseur, voix coupée sur téléphone, démo, piano. Usage : node tests/test-audio.js */
const assert = require('assert');
const noeud = () => ({ connect() {}, disconnect() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} }, frequency: { value: 0 }, detune: { value: 0 }, start() {}, stop() {} });
class FauxContexte {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = noeud(); }
  resume() { return Promise.resolve(); }
  createGain() { return noeud(); } createOscillator() { return noeud(); } createBiquadFilter() { return noeud(); } createDynamicsCompressor() { return noeud(); }
  createMediaStreamSource() { return noeud(); } createBufferSource() { return noeud(); }
  createAnalyser() { return { ...noeud(), fftSize: 2048, getFloatTimeDomainData(b) { b.fill(.01); } }; }
  decodeAudioData() { return Promise.resolve({ duration: 3 }); }
}
const pistes = []; let ouvertures = 0;
const fauxFlux = () => { const p = { muted: false, getSettings: () => ({ echoCancellation: false, sampleRate: 48000 }), stop() { p.arretee = true; } }; pistes.push(p); return { getAudioTracks: () => [p], getTracks: () => [p] }; };
globalThis.AudioContext = FauxContexte;
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test', maxTouchPoints: 0, mediaDevices: { getUserMedia: async c => { ouvertures++; assert.deepStrictEqual(c.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false }); return fauxFlux(); } } }, configurable: true, writable: true });
require('../js/theorie.js'); require('../js/moteur.js'); require('../js/audio.js');
const A = globalThis.GP.Audio;
const attend = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const m = new globalThis.GP.Moteur({ sr: 16000 }); let trames = 0; const av = m.trame.bind(m); m.trame = (x, t) => { trames++; assert(x.length > 0 && t >= 0); av(x, t); };
  // Sans AudioWorkletNode : repli sur l'analyseur
  const d = await A.micro(m); assert.strictEqual(A.capture, 'analyseur'); assert.strictEqual(d.sr, 48000); assert.strictEqual(m.sr, 48000, 'le moteur reçoit le taux du contexte');
  assert(A.journal.some(j => j.texte === 'micro-ouvert' && j.reglages), 'getSettings journalisé');
  A.ctx.currentTime = .1; await attend(60); assert(trames >= 1, 'le minuteur nourrit le moteur');
  // Piste coupée puis rouverte
  assert.strictEqual(ouvertures, 1); pistes[0].onmute(); pistes[0].muted = true; await attend(1400);
  assert.strictEqual(ouvertures, 2, 'réouverture après mute'); assert(pistes[0].arretee); assert.strictEqual(A.diagnostic().reouvertures, 1);
  // Si le micro revient seul, on ne rouvre pas
  pistes[1].onmute(); pistes[1].onunmute(); await attend(1400); assert.strictEqual(ouvertures, 2);
  // La fin de piste rouvre aussi
  pistes[1].onended(); await attend(20); assert.strictEqual(ouvertures, 3);
  const di = A.diagnostic(); for (const k of ['rms', 'ecartMs', 'analyseMs', 'muted', 'capture', 'reglages']) assert(k in di, 'diagnostic sans ' + k);
  A.arreter(); assert.strictEqual(A.mode, null); assert(pistes[2].arretee); pistes[2].onmute && assert.fail('écouteurs retirés');

  // Démo : les trois passages sont programmés
  const dem = await A.demo(m, { volume: .2 }); assert(dem.duree > 90, 'durée démo ' + dem.duree); assert.strictEqual(A.mode, 'demo');
  const notes = globalThis.GP.DEMO_CHANT.filter(x => x[0]); assert.strictEqual(notes[1][0], 67, 'en Sol'); A.arreter();

  // Écouter un accord, une suite
  const j = A.jouerAccord([48, 60, 64, 67], { dur: 1 }); assert(j.fin > 0); j.arreter();
  // Transpose : la touche Do jouée à -3 doit sonner La
  { const n = A._notePiano, vus = []; A._notePiano = (m, ...r) => { vus.push(m); return n(m, ...r); }; A.decalage = -3; A.jouerAccord([60], { dur: .1 }).arreter(); A.decalage = 0; A._notePiano = n; assert.deepStrictEqual(vus, [57]); }
  const s = A.jouerSuite([{ midis: [60, 64, 67] }, { mg: [41], md: [60, 65, 69], dur: 2 }], { dur: 1 }); assert.strictEqual(s.fin, A.ctx.currentTime + .05 + 3); s.arreter();

  // Voix : jamais sur téléphone par défaut
  let dit = 0; globalThis.speechSynthesis = { speak() { dit++; }, getVoices: () => [] }; globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  assert.strictEqual(A.dire('un'), true); assert.strictEqual(dit, 1, 'PC : voix permise');
  navigator.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)';
  assert.strictEqual(A.telephone(), true); assert.strictEqual(A.dire('deux'), false); assert.strictEqual(dit, 1, 'iPhone : pas de speak');
  assert.strictEqual(A.dire('trois', { surTelephone: true }), true, 'seulement par réglage explicite');
  navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)'; navigator.maxTouchPoints = 5; assert.strictEqual(A.telephone(), true, 'iPad en mode bureau');
  console.log('test-audio : tout passe (API simulée : à vérifier sur un vrai téléphone)');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
