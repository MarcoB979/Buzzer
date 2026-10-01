-- =====================================================================
-- Buzzer social layer (friends, presence, messaging)
-- Run this ONCE in the Supabase project's SQL editor.
-- Then enable Auth -> Sign In / Up -> "Allow anonymous sign-ins".
-- =====================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  friend_code text unique not null,
  display_name text not null default 'Player',
  created_at timestamptz not null default now()
);

create table if not exists public.friendships (
  requester uuid not null references public.profiles(id) on delete cascade,
  addressee uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender uuid not null references public.profiles(id) on delete cascade,
  recipient uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists public.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen timestamptz not null default now()
);

create index if not exists friendships_addressee_idx on public.friendships (addressee, status);
create index if not exists messages_recipient_idx on public.messages (recipient, created_at desc);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.messages enable row level security;
alter table public.presence enable row level security;

-- profiles: readable by anyone (needed for friend-code lookup), editable only by owner
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- friendships: only the two parties
create policy "friendships_select" on public.friendships for select using (auth.uid() = requester or auth.uid() = addressee);
create policy "friendships_insert" on public.friendships for insert with check (auth.uid() = requester);
create policy "friendships_update" on public.friendships for update using (auth.uid() = addressee); -- only the addressee can accept
create policy "friendships_delete" on public.friendships for delete using (auth.uid() = requester or auth.uid() = addressee);

-- messages: only sender and recipient
create policy "messages_select" on public.messages for select using (auth.uid() = sender or auth.uid() = recipient);
create policy "messages_insert" on public.messages for insert with check (auth.uid() = sender);
create policy "messages_update" on public.messages for update using (auth.uid() = recipient);

-- presence: heartbeats
create policy "presence_select" on public.presence for select using (true);
create policy "presence_insert" on public.presence for insert with check (auth.uid() = user_id);
create policy "presence_update" on public.presence for update using (auth.uid() = user_id);

-- live chat delivery (Realtime postgres_changes on messages)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
