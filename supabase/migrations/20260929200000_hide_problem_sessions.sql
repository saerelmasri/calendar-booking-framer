-- ============================================================
--  Classes with a setup problem (e.g. no "Capacity" line) are not
--  shown on the website at all — decided 29 September 2026.
--  Replaces the row rule from the public calendar migration. The
--  owner will see these classes, with the reason, on the dashboard.
-- ============================================================

drop policy "Visitors see sessions that aren't cancelled" on public.sessions;

create policy "Visitors see sessions that aren't cancelled or flagged"
  on public.sessions for select
  to anon, authenticated
  using (cancelled_at is null and problem is null);
