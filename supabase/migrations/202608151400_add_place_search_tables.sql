-- Documenta no repositório as tabelas de prospecção via Google Maps/Places,
-- que já existiam no banco de produção mas nunca tinham sido versionadas.
-- Escrita com "if not exists" para ser segura tanto em bancos novos quanto no atual.

create table if not exists public.place_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  place_id text not null check (char_length(trim(place_id)) between 1 and 255),
  keyword text not null check (char_length(trim(keyword)) between 2 and 80),
  locality text not null check (char_length(trim(locality)) between 2 and 100),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, place_id)
);

create table if not exists public.place_search_usage (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  keyword text not null check (char_length(trim(keyword)) between 2 and 80),
  locality text not null check (char_length(trim(locality)) between 2 and 100),
  requested_at timestamptz not null default now()
);

alter table public.place_references enable row level security;
alter table public.place_search_usage enable row level security;

drop trigger if exists place_references_set_updated_at on public.place_references;
create trigger place_references_set_updated_at
  before update on public.place_references
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_references' and policyname = 'place_references_select_own') then
    create policy place_references_select_own on public.place_references for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_references' and policyname = 'place_references_insert_own') then
    create policy place_references_insert_own on public.place_references for insert to authenticated with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_references' and policyname = 'place_references_update_own') then
    create policy place_references_update_own on public.place_references for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_references' and policyname = 'place_references_delete_own') then
    create policy place_references_delete_own on public.place_references for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_usage' and policyname = 'place_search_usage_select_own') then
    create policy place_search_usage_select_own on public.place_search_usage for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_usage' and policyname = 'place_search_usage_insert_own') then
    create policy place_search_usage_insert_own on public.place_search_usage for insert to authenticated with check ((select auth.uid()) = owner_id);
  end if;
end $$;
