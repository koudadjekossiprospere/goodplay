# Comptes goodplay (Supabase)

Sans cette mise en place, goodplay marche quand même : les chants restent dans le navigateur (Mes chants), sans compte ni partage par lien.

## 1. Créer le projet
1. Sur https://supabase.com, créer un compte, puis un projet (gratuit). Noter le mot de passe de la base dans un endroit sûr.
2. Dans le projet : **SQL Editor**, coller tout `supabase/schema.sql`, puis **Run**.
   - Ce script crée trois tables : chants de base, travaux, partages.
   - Il pose aussi les règles d'accès : chacun ne lit et ne modifie que ses travaux, personne ne modifie les chants de base, et un partage se lit seulement avec son lien.
3. Si `supabase/chants_base.sql` existe, le coller et l'exécuter de la même façon : il charge les chants de base.

## 2. Connexion Google
1. Sur https://console.cloud.google.com, dans un projet Google, ouvrir **API et services, Identifiants**, puis **Créer des identifiants, ID client OAuth, Application Web**.
   - Origines JavaScript autorisées : `https://koudadjekossiprospere.github.io`
   - URI de redirection autorisés : `https://<ton-projet>.supabase.co/auth/v1/callback` (l'adresse exacte est affichée dans Supabase, à l'étape suivante).
2. Dans Supabase, ouvrir **Authentication, Providers, Google** : activer, puis coller l'ID client et le secret client de Google.
3. Dans Supabase, ouvrir **Authentication, URL Configuration** :
   - Site URL : `https://koudadjekossiprospere.github.io/goodplay/`
   - Redirect URLs : la même adresse.

## 3. Brancher l'appli
Dans Supabase, **Project Settings, API** : copier l'adresse du projet (Project URL) et la clé **anon public**, et les mettre dans `js/config.js` :

```js
GP.config = { supabase: { url: 'https://<ton-projet>.supabase.co', cle: '<clé anon public>' } };
```

- **La clé anon public** est faite pour être publique : ce sont les règles de la base qui protègent les données.
- **Ne jamais mettre la clé `service_role`** dans l'appli ni dans le dépôt.

## Ce que ça donne
- Un bouton **Se connecter** (Google) en haut. Une fois connecté, Mes chants est gardé dans le compte et se retrouve sur tous les appareils. Les chants faits avant de se connecter y montent tout seuls.
- **Partager** (en haut d'un chant) :
  - pour un chant de la Bibliothèque, le lien est son adresse ;
  - pour un de mes chants, c'est une copie figée en ligne. Qui ouvre le lien voit le chant et peut le **Garder dans Mes chants** : il devient le sien, modifiable à sa guise.
