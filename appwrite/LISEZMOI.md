# Comptes goodplay (Appwrite)

Sans cette mise en place, goodplay marche quand même : les chants restent dans le navigateur (Mes chants), sans compte ni partage par lien.

## 1. Le projet
1. Sur https://cloud.appwrite.io, créer un compte (offre gratuite), puis un projet nommé `goodplay`. Choisir une région proche, par exemple Francfort.
2. Noter deux valeurs publiques, affichées dans les réglages du projet :
   - l'**API Endpoint** (par exemple `https://fra.cloud.appwrite.io/v1`) ;
   - le **Project ID**.
3. **Add platform**, puis **Web**. Nom : `goodplay`. Hostname : `koudadjekossiprospere.github.io`. Ajouter aussi `localhost` pour les essais.

## 2. Connexion Google
1. Dans Appwrite, ouvrir **Auth**, puis **Settings**, puis **Google** dans les fournisseurs OAuth2, et l'activer. Appwrite affiche une adresse de retour (URI) à copier :
   `https://<region>.cloud.appwrite.io/v1/account/sessions/oauth2/callback/google/<Project ID>`.
2. Sur https://console.cloud.google.com :
   - **Écran de consentement OAuth** : externe, nom de l'appli, e-mail d'assistance, puis publier.
   - **API et services, Identifiants**, puis **ID client OAuth**, puis **Application Web** :
     - Origines JavaScript autorisées : `https://koudadjekossiprospere.github.io`
     - URI de redirection autorisés : l'adresse de retour copiée dans Appwrite.
3. Revenir dans Appwrite, sur l'écran Google, et coller l'**ID client** et le **secret client** donnés par Google.

## 3. La base
**Databases**, puis **Create database**, avec l'ID `goodplay`. Créer ensuite trois tables, en donnant à chacune l'ID indiqué (onglet **Columns** pour les colonnes, **Settings** pour les droits).

### `travaux` : le travail de chacun
| Colonne | Type | Réglage |
|---|---|---|
| titre | string | taille 100, obligatoire |
| texte | string | taille 20000, obligatoire |
| ton | string | taille 60 |
| mesure | integer | min 2, max 6, défaut 4 |
| bpm | integer | min 30, max 240, défaut 72 |
| base_id | string | taille 60 |

Droits (**Settings, Permissions**) : rôle **Users**, case **Create** seulement. Activer **Row security** : chaque ligne n'est lisible et modifiable que par son auteur, et l'appli pose ces droits à la création.

### `partages` : les copies partagées
- Mêmes colonnes que `travaux`.
- Droits : rôle **Users**, **Create** seulement. Activer **Row security** : l'appli rend chaque partage lisible par tous, et supprimable par son auteur.

### `chants_base` : la Bibliothèque, en lecture seule
| Colonne | Type | Réglage |
|---|---|---|
| titre | string | taille 200, obligatoire |
| auteurs | string | taille 1000 |
| genre | string | taille 20 |
| annee | integer | |
| tonalite | string | taille 60 |
| mesure | integer | |
| bpm | integer | |
| texte | string | taille 20000, obligatoire |
| licence | string | taille 40, obligatoire |
| preuve_licence | string | taille 1000 |
| source | string | taille 100 |
| source_url | string | taille 500 |
| accords_source | string | taille 20 |
| paroles | boolean | |
| melodie | boolean | |

- Droits : rôle **Any**, case **Read** seulement. Personne ne la modifie depuis l'appli.
- Remplir la table : onglet **Rows**, **Import**, **CSV**, puis choisir `appwrite/chants_base.csv`. Il contient les 1 166 chants libres de droits et se refait avec `node tests/donnees/publier-bibliotheque.js <chants.jsonl>`.

## 4. Brancher l'appli
Mettre l'API Endpoint et le Project ID dans `js/config.js`, ou les envoyer pour qu'ils y soient mis :

```js
GP.config = { appwrite: { endpoint: 'https://fra.cloud.appwrite.io/v1', projet: '<Project ID>', base: 'goodplay' } };
```

- **Ces deux valeurs sont publiques :** ce sont les droits posés dans Appwrite qui protègent les données.
- **Ne jamais mettre une clé d'API (API key)** dans l'appli ni dans le dépôt.

## Ce que ça donne
- Un bouton **Se connecter** (Google) en haut. Une fois connecté, Mes chants est gardé dans le compte et se retrouve sur tous les appareils. Les chants faits avant de se connecter y montent tout seuls.
- **Partager** (en haut d'un chant) :
  - pour un chant de la Bibliothèque, le lien est son adresse ;
  - pour un de mes chants, c'est une copie figée en ligne. Qui ouvre le lien voit le chant et peut le **Garder dans Mes chants** : il devient le sien, modifiable à sa guise.

## Limites connues
- **Partages :** Appwrite ne sépare pas « lire un partage » de « lister les partages ». Quelqu'un qui sait se servir de l'API pourrait donc lister les chants partagés. Une fonction serveur fermera ce point si le besoin vient.
- **Safari et iPhone :** la connexion Google peut demander de passer par un domaine à soi (domaine personnalisé dans Appwrite), parce que Safari bloque les cookies d'un autre site. À vérifier au premier essai sur iPhone.
