-- ============================================================
--  Timer: run calendar-sync every hour, on the hour.
--
--  The project address and the sync token are different for every
--  client, so they are not written here. They are read from Supabase
--  Vault each time the timer fires (see "Setting up a new client").
--
--  Until Google's webhook exists this timer is the only trigger, so a
--  change in Google Calendar reaches the website within an hour.
-- ============================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

select cron.schedule(
  'calendar-sync',                -- the job's name; scheduling it again replaces it
  '0 * * * *',                    -- every hour, on the hour
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/calendar-sync',
    headers := jsonb_build_object(
      'x-sync-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sync_token')
    ),
    timeout_milliseconds := 60000   -- the default is 5 seconds; a sync can take longer
  );
  $$
);
