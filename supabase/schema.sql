-- ═══════════════════════════════════════════════════════════════════
--  Cartridge Vault — Supabase schema
--  Run once in Supabase → SQL Editor → New query → Run.
--  Safe to re-run: objects are created only if missing.
-- ═══════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  approved    boolean not null default false,
  is_admin    boolean not null default false,
  theme       text not null default 'cardinal',
  created_at  timestamptz not null default now()
);

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  system      text not null check (system in ('gb', 'gbc', 'gba', 'snes', 'n64')),
  rom_path    text not null,
  rom_name    text not null,
  rom_size    bigint not null default 0,
  cover_path  text,
  cover_url   text,
  last_played timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists games_user_idx on public.games (user_id);

create table if not exists public.saves (
  game_id     uuid primary key references public.games (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  save_path   text not null,
  hash        text,
  size        integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists saves_user_idx on public.saves (user_id);

-- ── Helper functions ────────────────────────────────────────────────

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select approved from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin and approved from public.profiles where id = auth.uid()), false);
$$;

-- Create a profile for every new account. The very first account becomes
-- an approved admin; everyone after that waits for approval.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  first_user boolean;
  uname text;
begin
  select not exists (select 1 from public.profiles) into first_user;
  uname := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  insert into public.profiles (id, username, approved, is_admin)
  values (new.id, uname, first_user, first_user);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Admin functions (called from the admin panel) ───────────────────

create or replace function public.admin_list_users()
returns table (id uuid, username text, approved boolean, is_admin boolean,
               created_at timestamptz, game_count bigint, rom_bytes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  return query
    select p.id, p.username, p.approved, p.is_admin, p.created_at,
           count(g.id), coalesce(sum(g.rom_size), 0)::bigint
    from public.profiles p
    left join public.games g on g.user_id = p.id
    group by p.id
    order by p.approved, p.created_at;
end;
$$;

create or replace function public.admin_set_approved(target uuid, value boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if target = auth.uid() then
    raise exception 'cannot change your own approval';
  end if;
  update public.profiles set approved = value where id = target;
end;
$$;

-- Removes an account that was never approved (it owns no files).
-- Approved accounts with games are removed from the Supabase dashboard.
create or replace function public.admin_remove_pending(target uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'admin only';
  end if;
  if exists (select 1 from public.profiles where id = target and approved) then
    raise exception 'only pending accounts can be removed here';
  end if;
  delete from auth.users where id = target;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_approved(uuid, boolean) from public, anon;
revoke all on function public.admin_remove_pending(uuid) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_approved(uuid, boolean) to authenticated;
grant execute on function public.admin_remove_pending(uuid) to authenticated;

-- ── Row-level security ──────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.games    enable row level security;
alter table public.saves    enable row level security;

-- Profiles: read your own (admins read all). Users may change only their theme.
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke update on public.profiles from authenticated, anon;
grant update (theme) on public.profiles to authenticated;

-- Games and saves: approved users manage only their own rows.
drop policy if exists "games: own rows" on public.games;
create policy "games: own rows" on public.games
  for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

drop policy if exists "saves: own rows" on public.saves;
create policy "saves: own rows" on public.saves
  for all to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (user_id = auth.uid() and public.is_approved());

-- ── Storage buckets (private) ───────────────────────────────────────
-- Files live at <bucket>/<user id>/<game id>.<ext>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('roms',   'roms',   false, 52428800, null),                                    -- 50 MB
  ('covers', 'covers', false, 2097152,  array['image/jpeg', 'image/png', 'image/webp']), -- 2 MB
  ('saves',  'saves',  false, 2097152,  null)                                     -- 2 MB
on conflict (id) do nothing;

drop policy if exists "vault: read own files" on storage.objects;
create policy "vault: read own files" on storage.objects
  for select to authenticated
  using (bucket_id in ('roms', 'covers', 'saves')
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_approved());

drop policy if exists "vault: add own files" on storage.objects;
create policy "vault: add own files" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('roms', 'covers', 'saves')
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_approved());

drop policy if exists "vault: replace own files" on storage.objects;
create policy "vault: replace own files" on storage.objects
  for update to authenticated
  using (bucket_id in ('roms', 'covers', 'saves')
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_approved())
  with check (bucket_id in ('roms', 'covers', 'saves')
              and (storage.foldername(name))[1] = auth.uid()::text
              and public.is_approved());

drop policy if exists "vault: delete own files" on storage.objects;
create policy "vault: delete own files" on storage.objects
  for delete to authenticated
  using (bucket_id in ('roms', 'covers', 'saves')
         and (storage.foldername(name))[1] = auth.uid()::text
         and public.is_approved());
