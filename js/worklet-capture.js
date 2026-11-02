/* Capture micro hors du fil principal : tampon circulaire de 2 s, un paquet de 20 ms à la fois. */
class CaptureGP extends AudioWorkletProcessor {
  constructor() {
    super();
    this.tampon = new Float32Array(Math.ceil(sampleRate * 2)); this.ecrit = 0; this.lu = 0;
    this.paquet = Math.round(sampleRate * .02);
  }
  process(entrees) {
    const canal = entrees[0] && entrees[0][0]; if (!canal) return true;
    const T = this.tampon, L = T.length;
    for (let i = 0; i < canal.length; i++) T[(this.ecrit + i) % L] = canal[i];
    this.ecrit += canal.length;
    let perdus = 0; if (this.ecrit - this.lu > L) { perdus = this.ecrit - this.lu - L; this.lu = this.ecrit - L; }
    while (this.ecrit - this.lu >= this.paquet) {
      const x = new Float32Array(this.paquet); for (let i = 0; i < this.paquet; i++) x[i] = T[(this.lu + i) % L];
      this.lu += this.paquet;
      // t : fin du paquet, sur l'horloge du contexte audio
      this.port.postMessage({ x, t: currentTime + (canal.length - (this.ecrit - this.lu)) / sampleRate, perdus }, [x.buffer]); perdus = 0;
    }
    return true;
  }
}
registerProcessor('capture-gp', CaptureGP);
