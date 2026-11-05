/* Compte goodplay (Supabase) : connexion Google, mes travaux en ligne, partage par lien. Sans configuration (js/config.js), rien ne se charge.
   Les règles d'accès vivent dans la base (supabase/schema.sql) : chacun ne lit et n'écrit que ses travaux ; un partage se lit par son jeton. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {}, cfg = GP.config && GP.config.supabase;
  const Compte = GP.Compte = { configure: !!(cfg && cfg.url && cfg.cle), utilisateur: null, ecouteurs: [], on(fn) { this.ecouteurs.push(fn); } };
  if (!Compte.configure) return;
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  let sb = null;
  const verifier = ({ data, error }) => { if (error) throw error; return data; };

  Compte.demarrer = async () => {
    if (sb) return Compte.utilisateur;
    await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = LIB; s.onload = ok; s.onerror = () => ko(new Error('service en ligne injoignable')); document.head.append(s); });
    sb = globalThis.supabase.createClient(cfg.url, cfg.cle);
    const { data } = await sb.auth.getSession();
    Compte.utilisateur = (data.session && data.session.user) || null;
    sb.auth.onAuthStateChange((_, session) => {
      const u = (session && session.user) || null;
      if ((u && u.id) === (Compte.utilisateur && Compte.utilisateur.id)) return;
      Compte.utilisateur = u; for (const f of Compte.ecouteurs) f(u);
    });
    return Compte.utilisateur;
  };
  // Google renvoie sur la même page : la session se retrouve au démarrage suivant.
  Compte.connecter = () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  Compte.deconnecter = () => sb.auth.signOut();
  Compte.nom = () => { const u = Compte.utilisateur, m = (u && u.user_metadata) || {}; return m.full_name || m.name || (u && u.email) || ''; };

  const ligne = c => ({ titre: c.titre, texte: c.texte, ton: c.ton || null, mesure: c.mesure, bpm: c.bpm, base_id: typeof c.base === 'string' ? c.base : null });
  Compte.travaux = async () => verifier(await sb.from('travaux').select('id, base_id, titre, texte, ton, mesure, bpm, modifie').order('modifie', { ascending: false }));
  Compte.enregistrer = async c => {
    if (c.dbId) { verifier(await sb.from('travaux').update({ ...ligne(c), modifie: new Date().toISOString() }).eq('id', c.dbId)); return c.dbId; }
    return verifier(await sb.from('travaux').insert(ligne(c)).select('id').single()).id;
  };
  Compte.supprimer = async c => { if (c.dbId) verifier(await sb.from('travaux').delete().eq('id', c.dbId)); };
  Compte.partager = async c => verifier(await sb.from('partages').insert(ligne(c)).select('jeton').single()).jeton;
  Compte.lirePartage = async j => { const d = verifier(await sb.rpc('lire_partage', { j })); return (d && d[0]) || null; };
})();
