/* Compte goodplay (Appwrite) : connexion Google, mes travaux en ligne, partage par lien. Sans configuration (js/config.js), rien ne se charge.
   Les droits vivent dans Appwrite (appwrite/LISEZMOI.md) : chaque ligne de travaux n'est lisible et modifiable que par son auteur ;
   un partage est une copie figée lisible par tous, ouverte par son identifiant.
   shortcut: Appwrite ne sépare pas « lire une ligne » de « lister la table » : qui sait se servir de l'API peut lister les partages.
   Une fonction serveur qui lit un partage par son identifiant fermera ce point si le besoin vient. */
(function () {
  'use strict';
  const GP = globalThis.GP = globalThis.GP || {}, cfg = GP.config && GP.config.appwrite;
  const Compte = GP.Compte = { configure: !!(cfg && cfg.endpoint && cfg.projet), utilisateur: null, ecouteurs: [], on(fn) { this.ecouteurs.push(fn); } };
  if (!Compte.configure) return;
  const LIB = 'https://cdn.jsdelivr.net/npm/appwrite@28.3.0/dist/iife/sdk.js', BASE = cfg.base || 'goodplay';
  let AW = null, compte = null, tables = null;

  Compte.demarrer = async () => {
    if (AW) return Compte.utilisateur;
    await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = LIB; s.onload = ok; s.onerror = () => ko(new Error('service en ligne injoignable')); document.head.append(s); });
    AW = globalThis.Appwrite;
    const client = new AW.Client().setEndpoint(cfg.endpoint).setProject(cfg.projet);
    compte = new AW.Account(client); tables = new AW.TablesDB(client);
    try { Compte.utilisateur = await compte.get(); } catch (e) { Compte.utilisateur = null; } // pas de session : on n'est pas connecté
    return Compte.utilisateur;
  };
  // Google renvoie sur la même page : la session se lit au démarrage suivant.
  Compte.connecter = () => { const ici = location.origin + location.pathname; return compte.createOAuth2Session({ provider: AW.OAuthProvider.Google, success: ici, failure: ici }); };
  Compte.deconnecter = async () => { await compte.deleteSession({ sessionId: 'current' }); Compte.utilisateur = null; for (const f of Compte.ecouteurs) f(null); };
  Compte.nom = () => (Compte.utilisateur && (Compte.utilisateur.name || Compte.utilisateur.email)) || '';

  const ligne = c => ({ titre: c.titre, texte: c.texte, ton: c.ton ? JSON.stringify(c.ton) : null, mesure: c.mesure, bpm: c.bpm, base_id: typeof c.base === 'string' ? c.base : null });
  const lue = r => ({ id: r.$id, base_id: r.base_id || null, titre: r.titre, texte: r.texte, ton: r.ton ? JSON.parse(r.ton) : null, mesure: r.mesure, bpm: r.bpm });
  const aMoi = () => { const u = AW.Role.user(Compte.utilisateur.$id); return [AW.Permission.read(u), AW.Permission.update(u), AW.Permission.delete(u)]; };
  const t = tableId => ({ databaseId: BASE, tableId });

  Compte.travaux = async () => (await tables.listRows({ ...t('travaux'), queries: [AW.Query.orderDesc('$updatedAt'), AW.Query.limit(1000)] })).rows.map(lue);
  Compte.enregistrer = async c => {
    if (c.dbId) { await tables.updateRow({ ...t('travaux'), rowId: c.dbId, data: ligne(c) }); return c.dbId; }
    return (await tables.createRow({ ...t('travaux'), rowId: AW.ID.unique(), data: ligne(c), permissions: aMoi() })).$id;
  };
  Compte.supprimer = async c => { if (c.dbId) await tables.deleteRow({ ...t('travaux'), rowId: c.dbId }); };
  Compte.partager = async c => (await tables.createRow({ ...t('partages'), rowId: AW.ID.unique(), data: ligne(c), permissions: [AW.Permission.read(AW.Role.any()), AW.Permission.delete(AW.Role.user(Compte.utilisateur.$id))] })).$id;
  Compte.lirePartage = async j => { try { return lue(await tables.getRow({ ...t('partages'), rowId: j })); } catch (e) { if (e.code === 404) return null; throw e; } };
})();
