/* goodplay : services en ligne. Vide : tout reste dans le navigateur (Mes chants), sans compte ni partage par lien.
   Supabase : l'adresse du projet et sa clé « anon public » (Réglages du projet, API). Cette clé est publique par conception :
   ce sont les règles de la base (supabase/schema.sql) qui protègent les données de chacun. Ne jamais mettre ici la clé « service_role ». */
globalThis.GP = globalThis.GP || {};
GP.config = { supabase: { url: '', cle: '' } };
