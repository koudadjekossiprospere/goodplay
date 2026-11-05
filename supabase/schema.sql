-- goodplay : comptes, travaux et partages (Supabase). À coller une fois dans l'éditeur SQL du projet.
-- Les règles d'accès sont dans la base (Row Level Security) : l'appli ne peut rien faire de plus que ce qu'elles permettent.
create extension if not exists pgcrypto with schema extensions;

-- Chants de base : tout le monde les lit, personne ne les modifie depuis l'appli (seul le propriétaire du projet les charge, par supabase/chants_base.sql).
create table if not exists public.chants_base (
  id text primary key,
  titre text not null,
  auteurs jsonb not null default '{}'::jsonb,
  genre text not null default 'cantique',
  tonalite jsonb,
  mesure int not null default 4,
  bpm int not null default 72,
  texte text not null,
  licence text not null,
  preuve_licence text,
  source text,
  source_url text,
  paroles boolean not null default false,
  melodie boolean not null default false
);
alter table public.chants_base enable row level security;
drop policy if exists "chants de base : lecture pour tous" on public.chants_base;
create policy "chants de base : lecture pour tous" on public.chants_base for select using (true);
-- Aucune règle d'écriture : insert, update et delete sont refusés par l'API publique.

-- Travaux : chaque utilisateur ne voit et ne modifie que les siens. Une version d'un chant de base garde son base_id.
create table if not exists public.travaux (
  id uuid primary key default gen_random_uuid(),
  proprietaire uuid not null default auth.uid() references auth.users(id) on delete cascade,
  base_id text, -- sans clé étrangère : une version reste enregistrable même si la base en ligne n'a pas encore ce chant
  titre text not null check (char_length(titre) between 1 and 80),
  texte text not null check (char_length(texte) <= 20000),
  ton jsonb,
  mesure int not null default 4 check (mesure in (2, 3, 4, 6)),
  bpm int not null default 72 check (bpm between 30 and 240),
  cree timestamptz not null default now(),
  modifie timestamptz not null default now()
);
create index if not exists travaux_proprietaire on public.travaux (proprietaire);
alter table public.travaux enable row level security;
drop policy if exists "mes travaux" on public.travaux;
create policy "mes travaux" on public.travaux for all
  using (proprietaire = auth.uid()) with check (proprietaire = auth.uid());

-- Partages : une copie figée d'un travail, lisible seulement par qui a le lien (jeton imprévisible).
-- Pas de lecture directe de la table (on ne liste pas les partages des autres) : une fonction rend un partage par son jeton.
create table if not exists public.partages (
  jeton text primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  auteur uuid not null default auth.uid() references auth.users(id) on delete cascade,
  base_id text,
  titre text not null check (char_length(titre) between 1 and 80),
  texte text not null check (char_length(texte) <= 20000),
  ton jsonb,
  mesure int not null default 4 check (mesure in (2, 3, 4, 6)),
  bpm int not null default 72 check (bpm between 30 and 240),
  cree timestamptz not null default now()
);
alter table public.partages enable row level security;
drop policy if exists "partager mes travaux" on public.partages;
create policy "partager mes travaux" on public.partages for insert with check (auteur = auth.uid());
drop policy if exists "retirer mes partages" on public.partages;
create policy "retirer mes partages" on public.partages for delete using (auteur = auth.uid());

create or replace function public.lire_partage(j text)
returns table (titre text, texte text, ton jsonb, mesure int, bpm int, base_id text)
language sql stable security definer set search_path = public as $$
  select p.titre, p.texte, p.ton, p.mesure, p.bpm, p.base_id from public.partages p where p.jeton = j
$$;
revoke all on function public.lire_partage(text) from public;
grant execute on function public.lire_partage(text) to anon, authenticated;
