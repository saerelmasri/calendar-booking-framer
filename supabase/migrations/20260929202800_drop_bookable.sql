-- The website no longer asks whether a session is bookable: sessions with a setup
-- problem aren't shown at all (see …_hide_problem_sessions.sql). Removing the
-- column also removes the public's permission to read it.
alter table public.sessions drop column bookable;
