-- ============================================================================
-- Migration: ministry events (church-scoped, real)
-- Purpose: Store ministry events so staff can create them and members can
--          view them read-only. Replaces the hard-coded mock event list.
--          Members never write to this table; write access is staff-only.
-- ============================================================================

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null,
  date date not null,
  time text,
  location text,
  kind text not null default 'Gathering' check (kind in ('Service', 'Rehearsal', 'Gathering')),
  color text not null default 'violet' check (color in ('primary', 'sky', 'violet')),
  attendees integer not null default 0 check (attendees >= 0),
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_events_church_date on public.events (church_id, date);

alter table public.events enable row level security;

-- Everyone in the church can read events (staff and members).
drop policy if exists "Users can view events in their church" on public.events;
create policy "Users can view events in their church"
  on public.events
  for select
  using (church_id = get_user_church_id());

-- Only staff (admins/coordinators) can create, update, or delete events.
drop policy if exists "Staff can manage events in their church" on public.events;
create policy "Staff can manage events in their church"
  on public.events
  for all
  using (
    exists (
      select 1 from public.users u
      where u.auth_id = auth.uid()
        and u.is_active = true
        and u.role in ('admin', 'coordinator')
        and u.church_id = public.events.church_id
    )
  )
  with check (
    exists (
      select 1 from public.users u
      where u.auth_id = auth.uid()
        and u.is_active = true
        and u.role in ('admin', 'coordinator')
        and u.church_id = public.events.church_id
    )
  );

-- Delivery is scoped by the SELECT policy above, so members (and staff)
-- only receive changes for their own church.
alter publication supabase_realtime add table public.events;