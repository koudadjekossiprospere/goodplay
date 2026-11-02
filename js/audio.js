/* Sources audio (micro, fichier, démo), écoute d'un accord, voix. Seule l'API audio du navigateur est touchée, pas le DOM.
   Le moteur fait lui-même la décimation vers 16 kHz : audio.js lui donne le signal brut et le taux du contexte (m.definirSr). */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {};
  const CONTRAINTES = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
  const REOUVERTURE_MS = 1200;

  /* Démo : Amazing Grace (domaine public), deux fois en Sol puis une fois montée en La. */
  const DEMO = [[62, 1, 'A-'], [67, 2, 'ma-'], [71, .5, 'zing'], [67, .5, ''], [71, 2, 'grace,'], [69, 1, 'how'], [67, 2, 'sweet'], [64, 1, 'the'], [62, 2, 'sound'], [62, 1, 'that'],
    [67, 2, 'saved'], [71, .5, 'a'], [67, .5, ''], [71, 2, 'wretch'], [69, 1, 'like'], [74, 3, 'me.'], [null, 1.5, ''],
    [71, 1, 'I'], [74, 2, 'once'], [71, .5, 'was'], [67, .5, ''], [71, 2, 'lost,'], [69, 1, 'but'], [67, 2, 'now'], [64, 1, 'am'], [62, 2, 'found,'], [62, 1, 'was'],
    [67, 2, 'blind'], [71, .5, 'but'], [67, .5, ''], [71, 2, 'now'], [69, 1, 'I'], [67, 3, 'see.'], [null, 2, '']];
  const DEMO_PASSES = [0, 0, 2], DEMO_BPM = 88;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  const A = {
    urlWorklet: 'js/worklet-capture.js',
    ctx: null, moteur: null, mode: null, capture: null, flux: null, piste: null, noeuds: [], minuteurs: [], journal: [], lecture: [],
    surEtat: null, // surEtat({type,...}) : micro coupé, rouvert, perdu. Pour l'interface.
    d: null,

    contexte() {
      if (!A.ctx) { const C = globalThis.AudioContext || globalThis.webkitAudioContext; if (!C) throw new Error('audio indisponible'); A.ctx = new C(); }
      if (A.ctx.resume) A.ctx.resume();
      return A.ctx;
    },
    _note(texte, donnees) { A.journal.push({ t: Date.now(), texte, ...donnees }); if (A.journal.length > 200) A.journal.shift(); if (A.surEtat) A.surEtat({ type: texte, ...donnees }); },

    /* ---------- Capture commune ---------- */
    _preparer(moteur, mode) {
      A.arreter(); const ctx = A.contexte();
      A.moteur = moteur; A.mode = mode;
      if (moteur.definirSr && moteur.sr !== ctx.sampleRate) moteur.definirSr(ctx.sampleRate);
      A.d = { rms: 0, ecartMs: 0, ecartMaxMs: 0, analyseMs: 0, perdus: 0, reouvertures: 0, dernier: null };
      if (!moteur._gpNiveau) { moteur._gpNiveau = true; moteur.on('niveau', n => { if (A.d) A.d.rms = n.rms; }); }
      return ctx;
    },
    _donne(x, t) {
      const d = A.d, m0 = performance.now();
      if (d.dernier != null) { d.ecartMs = m0 - d.dernier; if (d.ecartMs > d.ecartMaxMs) d.ecartMaxMs = d.ecartMs; }
      d.dernier = m0;
      A.moteur.trame(x, t);
      d.analyseMs += .05 * ((performance.now() - m0) - d.analyseMs);
    },
    /* AudioWorklet si possible, sinon analyseur lu par minuteur. Le nœud reste branché à une sortie muette : sans cela, certains navigateurs ne le font pas tourner. */
    async _brancher(ctx, entree) {
      if (ctx.audioWorklet && globalThis.AudioWorkletNode) {
        try {
          await ctx.audioWorklet.addModule(A.urlWorklet);
          const n = new AudioWorkletNode(ctx, 'capture-gp', { numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' }), z = ctx.createGain(); z.gain.value = 0;
          n.port.onmessage = e => { if (e.data.perdus) A.d.perdus += e.data.perdus; A._donne(e.data.x, e.data.t); };
          entree.connect(n); n.connect(z); z.connect(ctx.destination);
          A.noeuds.push(n, z); A.capture = 'worklet'; A.point = n;
          return;
        } catch (err) { A._note('worklet-indisponible', { erreur: String(err) }); }
      }
      // 4096 échantillons couvrent 85 ms : un retard du minuteur de 40 ms ne fait pas perdre de signal, contrairement à 2048.
      const an = ctx.createAnalyser(); an.fftSize = 4096; entree.connect(an);
      const b = new Float32Array(an.fftSize); let tPrec = ctx.currentTime;
      const tic = setInterval(() => {
        const t = ctx.currentTime, n = Math.round((t - tPrec) * ctx.sampleRate); if (n <= 0) return; tPrec = t;
        if (n > b.length) A.d.perdus += n - b.length;
        an.getFloatTimeDomainData(b); A._donne(b.slice(b.length - Math.min(n, b.length)), t);
      }, 40);
      A.minuteurs.push({ arret: () => clearInterval(tic) }); A.noeuds.push(an); A.capture = 'analyseur'; A.point = an;
    },

    /* ---------- Micro ---------- */
    async micro(moteur) {
      if (!globalThis.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('micro indisponible');
      const flux = await navigator.mediaDevices.getUserMedia(CONTRAINTES), ctx = A._preparer(moteur, 'micro');
      A._ouvrirFlux(flux, ctx);
      await A._brancher(ctx, A.source);
      return A.diagnostic();
    },
    _ouvrirFlux(flux, ctx) {
      A.flux = flux; const p = A.piste = flux.getAudioTracks()[0];
      A.source = ctx.createMediaStreamSource(flux); A.noeuds.push(A.source);
      const reglages = p && p.getSettings ? p.getSettings() : {}; A._note('micro-ouvert', { reglages }); A.d.reglages = reglages;
      if (!p) return;
      // iOS peut couper la piste : on écoute mute et ended, et on rouvre le micro.
      let attente = null;
      p.onmute = () => { A._note('micro-coupe'); attente = setTimeout(() => A._rouvrir('mute'), REOUVERTURE_MS); };
      p.onunmute = () => { clearTimeout(attente); A._note('micro-revenu'); };
      p.onended = () => { if (A.mode === 'micro') A._rouvrir('ended'); };
    },
    async _rouvrir(cause) {
      if (A.mode !== 'micro') return;
      try {
        const flux = await navigator.mediaDevices.getUserMedia(CONTRAINTES), ctx = A.contexte(), av = A.source;
        if (A.flux) A.flux.getTracks().forEach(t => { t.onmute = t.onunmute = t.onended = null; t.stop(); });
        A._ouvrirFlux(flux, ctx); if (A.point) A.source.connect(A.point);
        try { av.disconnect(); } catch (e) { /* déjà débranché */ }
        A.d.reouvertures++; A._note('micro-rouvert', { cause });
      } catch (err) { A._note('micro-perdu', { cause, erreur: String(err) }); }
    },

    /* ---------- Fichier ---------- */
    async fichier(fich, moteur, o = {}) {
      const ctx = A._preparer(moteur, 'fichier'), tampon = await ctx.decodeAudioData(await fich.arrayBuffer());
      const src = ctx.createBufferSource(); src.buffer = tampon; A.noeuds.push(src);
      const sortie = ctx.createGain(); sortie.gain.value = o.volume ?? 1; src.connect(sortie); sortie.connect(ctx.destination); A.noeuds.push(sortie);
      await A._brancher(ctx, src);
      src.onended = () => { if (A.mode === 'fichier') { A.arreter(); if (o.surFin) o.surFin(); } };
      src.start();
      return { duree: tampon.duration };
    },

    /* ---------- Démo ---------- */
    /* Vraie voix sans instrument : Vera Hall, Dock Reed et Jesse Allison, Alabama, 1937 (domaine public selon Wikimedia Commons). */
    async demoVoix(moteur, o = {}) {
      A.contexte(); // reste dans le geste de l'utilisateur, avant le téléchargement
      const r = await fetch('audio/amazing-grace-1937.ogg'); if (!r.ok) throw new Error('voix absente');
      return A.fichier(r, moteur, o);
    },
    async demo(moteur, o = {}) {
      const ctx = A._preparer(moteur, 'demo'), bus = ctx.createGain(), sortie = ctx.createGain();
      sortie.gain.value = o.volume ?? .35; bus.connect(sortie); sortie.connect(ctx.destination); A.noeuds.push(bus, sortie);
      await A._brancher(ctx, bus);
      const temps = 60 / (o.bpm || DEMO_BPM); let t = ctx.currentTime + .4;
      DEMO_PASSES.forEach(mt => DEMO.forEach(([m, b, syl]) => {
        const dur = b * temps;
        if (m != null) {
          const os = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
          os.type = 'triangle'; os.frequency.value = hz(m + mt); vib.frequency.value = 5.2; vg.gain.value = 1.6; vib.connect(vg); vg.connect(os.frequency);
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.5, t + .04); g.gain.setValueAtTime(.5, t + dur - .1); g.gain.linearRampToValueAtTime(0, t + dur - .04);
          os.connect(g); g.connect(bus); os.start(t); os.stop(t + dur); vib.start(t); vib.stop(t + dur); A.noeuds.push(os, vib, g, vg);
          if (syl) { const h = setTimeout(() => { if (A.mode === 'demo') { if (o.surMots) o.surMots(syl); else if (moteur.ajouterMots) moteur.ajouterMots(syl); } }, Math.max(0, (t - ctx.currentTime) * 1000 + 250)); A.minuteurs.push({ arret: () => clearTimeout(h) }); }
        }
        t += dur;
      }));
      const fin = setTimeout(() => { if (A.mode === 'demo') { A.arreter(); if (o.surFin) o.surFin(); } }, (t - ctx.currentTime + 1) * 1000); A.minuteurs.push({ arret: () => clearTimeout(fin) });
      return { duree: t - ctx.currentTime };
    },

    arreter() {
      A.minuteurs.forEach(m => m.arret()); A.minuteurs = [];
      A.noeuds.forEach(n => { try { if (n.port) n.port.onmessage = null; if (n.stop) n.stop(); } catch (e) { /* déjà arrêté */ } try { n.disconnect(); } catch (e) { /* déjà débranché */ } }); A.noeuds = [];
      if (A.flux) { A.flux.getTracks().forEach(t => { t.onmute = t.onunmute = t.onended = null; t.stop(); }); A.flux = null; }
      A.piste = null; A.source = null; A.point = null; A.mode = null; A.capture = null;
    },
    /* Mode diagnostic pour le vrai téléphone (audio.md) */
    diagnostic() {
      const d = A.d || {};
      return { mode: A.mode, capture: A.capture, sr: A.ctx ? A.ctx.sampleRate : null, etat: A.ctx ? A.ctx.state : null, rms: d.rms, ecartMs: d.ecartMs, ecartMaxMs: d.ecartMaxMs, analyseMs: d.analyseMs, perdus: d.perdus, muted: A.piste ? A.piste.muted : null, reouvertures: d.reouvertures, reglages: d.reglages || null, journal: A.journal.slice(-20) };
    },

    /* ---------- Écouter un accord : piano additif, jamais envoyé au moteur ---------- */
    _maitre() {
      const ctx = A.contexte();
      if (!A.bus || A.bus.context !== ctx) {
        A.bus = ctx.createGain(); A.bus.gain.value = .8;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 4800;
        const c = ctx.createDynamicsCompressor(); A.bus.connect(f); f.connect(c); c.connect(ctx.destination);
      }
      return A.bus;
    },
    _notePiano(m, t, dur, vel) {
      const ctx = A.ctx, B = m < 48 ? 3e-4 : 1e-4, f0 = hz(m), arret = t + dur + .3, env = ctx.createGain(), tau = 2.8 * Math.pow(.97, m - 48);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vel, t + .004); env.gain.setTargetAtTime(vel * .28, t + .004, tau * .22); env.gain.setTargetAtTime(0, t + dur, .09);
      const ns = [[1, 1], [2, .46], [3, .22], [4, .1], [5, .05], [6, .025]].filter(([k]) => k * f0 < 7000).flatMap(([k, a]) => {
        const f = k * f0 * Math.sqrt(1 + B * k * k), g = ctx.createGain(); g.gain.setValueAtTime(a, t); g.gain.setTargetAtTime(a * .25, t, tau / (1 + .55 * k));
        g.connect(env);
        // Deux cordes légèrement désaccordées : le timbre s'anime sans bruit de phase.
        return [-.7, .7].map(c => { const o = ctx.createOscillator(); o.frequency.value = f; o.detune.value = c; o.connect(g); o.start(t); o.stop(arret); return o; });
      });
      env.connect(A._maitre());
      return { ns, env };
    },
    /* Valeur du bouton Transpose : on voit et on touche les notes jouées, on entend la tonalité du chant. */
    decalage: 0,
    jouerAccord(midis, o = {}) {
      const ctx = A.contexte(), dur = o.dur ?? 1.4, vel = (o.volume ?? .5) / Math.sqrt(Math.max(1, midis.length)), t = o.quand ?? ctx.currentTime + .02;
      const v = midis.slice().sort((a, b) => a - b).map((m, i) => A._notePiano(m + A.decalage, t + i * .009, dur, vel * (i ? .85 : 1)));
      A.lecture.push(...v);
      return { fin: t + dur, arreter: () => v.forEach(x => x.ns.forEach(n => { try { n.stop(); } catch (e) { /* déjà arrêté */ } })) };
    },
    /* accords : [{midis} ou {mg,md}, dur optionnelle]. surAccord(i) suit la lecture. */
    jouerSuite(accords, o = {}) {
      const ctx = A.contexte(), t0 = ctx.currentTime + .05, dur = o.dur ?? 1.2; let t = t0; const poignees = [], tics = [];
      accords.forEach((a, i) => {
        const midis = a.midis || [...(a.mg || []), ...(a.md || [])], d = a.dur ?? dur;
        poignees.push(A.jouerAccord(midis, { dur: d * .95, quand: t, volume: o.volume }));
        if (o.surAccord) tics.push(setTimeout(() => o.surAccord(i), (t - ctx.currentTime) * 1000));
        t += d;
      });
      return { fin: t, arreter: () => { tics.forEach(clearTimeout); poignees.forEach(p => p.arreter()); } };
    },

    /* ---------- Voix : speak peut couper la piste micro sur iOS (WebKit 218815), jamais sur téléphone par défaut ---------- */
    telephone() { const n = globalThis.navigator; if (!n) return false; return /iPhone|iPad|iPod|Android/i.test(n.userAgent || '') || (/Macintosh/.test(n.userAgent || '') && n.maxTouchPoints > 1); },
    voixPermise(o = {}) { return !!globalThis.speechSynthesis && (!A.telephone() || o.surTelephone === true); },
    dire(texte, o = {}) {
      if (!A.voixPermise(o)) return false;
      try { const u = new SpeechSynthesisUtterance(texte); u.lang = 'fr-FR'; u.rate = 1.15; const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.toLowerCase().startsWith('fr')); if (v) u.voice = v; speechSynthesis.speak(u); return true; } catch (e) { return false; }
    }
  };
  GP.Audio = A;
  GP.DEMO_CHANT = DEMO;
})();
