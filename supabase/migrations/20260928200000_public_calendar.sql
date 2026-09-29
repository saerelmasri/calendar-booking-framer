-- ============================================================
--  Public calendar: what the website's public key may read.
--
--  The key is visible in the site's code, so these rules are the
--  real protection: sessions that aren't cancelled, only the
--  columns a visitor should see, and the calendar's timezone.
--  Nothing can be written.
-- ============================================================

-- Yes/no, kept up to date by Postgres itself: yes when there is
-- no problem note. Visitors get this instead of the note.
alter table public.sessions
  add column bookable boolean generated always as (problem is null) stored;

-- Which rows: sessions that aren't cancelled.
create policy "Visitors see sessions that aren't cancelled"
  on public.sessions for select
  to anon, authenticated
  using (cancelled_at is null);

-- Which columns. Supabase lets the public key do anything to a table
-- and relies on row-level security to hold it back. Take it all away,
-- then give back reading these columns only.
revoke all on public.sessions from anon, authenticated;
grant select (id, title, starts_at, ends_at, location, details, bookable)
  on public.sessions to anon, authenticated;

-- The same for sync_status: the timezone and nothing else.
create policy "Visitors see the calendar's timezone"
  on public.sync_status for select
  to anon, authenticated
  using (true);

revoke all on public.sync_status from anon, authenticated;
grant select (time_zone) on public.sync_status to anon, authenticated;
