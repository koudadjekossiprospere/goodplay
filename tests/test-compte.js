/* Compte goodplay (js/compte.js) contre un Appwrite simulé : connexion, travaux (créer puis modifier), liste, partage, partage absent, déconnexion.
   node tests/test-compte.js. Le vrai SDK (appwrite@28.3.0) accepte ces appels en objet : voir js/compte.js. */
const assert = require('assert');

const lignes = { travaux: new Map(), partages: new Map() }, journal = [];
let session = { $id: 'u1', name: 'Prospère K.' }, n = 0;
globalThis.Appwrite = {
  Client: class { setEndpoint(e) { this.e = e; return this; } setProject(p) { this.p = p; return this; } },
  Account: class { async get() { if (!session) throw Object.assign(new Error('non connecté'), { code: 401 }); return session; } createOAuth2Session(o) { journal.push(['oauth', o.provider, o.success]); } async deleteSession(o) { journal.push(['deconnexion', o.sessionId]); session = null; } },
  TablesDB: class {
    async listRows({ databaseId, tableId, queries }) { assert.strictEqual(databaseId, 'goodplay'); journal.push(['liste', tableId, queries]); return { total: lignes[tableId].size, rows: [...lignes[tableId].values()] }; }
    async createRow({ tableId, rowId, data, permissions }) { const r = { $id: rowId, ...data, $permissions: permissions }; lignes[tableId].set(rowId, r); return r; }
    async updateRow({ tableId, rowId, data }) { const r = { ...lignes[tableId].get(rowId), ...data }; lignes[tableId].set(rowId, r); return r; }
    async deleteRow({ tableId, rowId }) { lignes[tableId].delete(rowId); }
    async getRow({ tableId, rowId }) { const r = lignes[tableId].get(rowId); if (!r) throw Object.assign(new Error('absent'), { code: 404 }); return r; }
  },
  Permission: { read: r => `read("${r}")`, update: r => `update("${r}")`, delete: r => `delete("${r}")` },
  Role: { user: id => 'user:' + id, any: () => 'any' },
  Query: { orderDesc: k => 'desc:' + k, limit: x => 'limit:' + x },
  ID: { unique: () => 'id' + (++n) },
  OAuthProvider: { Google: 'google' }
};
globalThis.location = { origin: 'https://exemple.org', pathname: '/goodplay/' };
globalThis.document = { createElement: () => ({}), head: { append: s => setTimeout(() => s.onload(), 0) } };
globalThis.GP = { config: { appwrite: { endpoint: 'https://fra.cloud.appwrite.io/v1', projet: 'p1' } } };
require('../js/compte.js');
const K = globalThis.GP.Compte;

(async () => {
  assert.ok(K.configure);
  assert.deepStrictEqual(await K.demarrer(), session, 'session retrouvée au démarrage');
  assert.strictEqual(K.nom(), 'Prospère K.');
  K.connecter(); assert.deepStrictEqual(journal.pop(), ['oauth', 'google', 'https://exemple.org/goodplay/']);

  const c = { titre: 'Mon chant', texte: '[Do]la', ton: { tonic: 0, mode: 'maj' }, mesure: 4, bpm: 80, base: 'oh-171' };
  c.dbId = await K.enregistrer(c);
  const r = lignes.travaux.get(c.dbId);
  assert.deepStrictEqual(r.$permissions, ['read("user:u1")', 'update("user:u1")', 'delete("user:u1")'], 'seul son auteur lit et modifie un travail');
  assert.strictEqual(r.ton, '{"tonic":0,"mode":"maj"}');
  c.texte = '[Sol]la'; assert.strictEqual(await K.enregistrer(c), c.dbId, 'une modification ne crée pas de doublon');
  assert.deepStrictEqual(await K.travaux(), [{ id: c.dbId, base_id: 'oh-171', titre: 'Mon chant', texte: '[Sol]la', ton: { tonic: 0, mode: 'maj' }, mesure: 4, bpm: 80 }]);

  const j = await K.partager(c);
  assert.deepStrictEqual(lignes.partages.get(j).$permissions, ['read("any")', 'delete("user:u1")'], 'un partage se lit par tous, se retire par son auteur');
  assert.strictEqual((await K.lirePartage(j)).texte, '[Sol]la');
  assert.strictEqual(await K.lirePartage('inconnu'), null, 'un partage absent rend null');

  await K.supprimer(c); assert.strictEqual(lignes.travaux.size, 0);
  let vu = 'rien'; K.on(u => { vu = u; }); await K.deconnecter();
  assert.strictEqual(vu, null); assert.strictEqual(K.utilisateur, null);
  console.log('test-compte : tout passe');
})().catch(e => { console.error(e); process.exit(1); });
