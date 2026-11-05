/* goodplay : services en ligne. Vide : tout reste dans le navigateur (Mes chants), sans compte ni partage par lien.
   Appwrite : l'adresse de l'API (endpoint) et l'identifiant du projet (Project ID), tous deux publics (voir appwrite/LISEZMOI.md).
   Ce sont les droits posés dans Appwrite qui protègent les données de chacun. Ne jamais mettre ici une clé d'API (API key). */
globalThis.GP = globalThis.GP || {};
GP.config = { appwrite: { endpoint: '', projet: '', base: 'goodplay' } };
