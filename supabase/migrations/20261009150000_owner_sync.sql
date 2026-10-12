-- ============================================================
--  Refresh on the dashboard also syncs Google Calendar: the owner
--  starts the same sync the hourly timer runs, so a class moved or
--  deleted in Google shows up straight away.
--
--  The sync's address and token come from the Vault, as for the
--  timer; they never reach the browser. Two syncs can't overlap:
--  the sync's own lock (begin_sync) turns the second one away.
-- ============================================================

create function public.owner_sync() returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/calendar-sync',
    headers := jsonb_build_object(
      'x-sync-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sync_token')
    ),
    timeout_milliseconds := 60000   -- the default is 5 seconds; a sync can take longer
  );
  return jsonb_build_object('status', 'started');
end;
$$;

revoke all on function public.owner_sync() from public, anon;
grant execute on function public.owner_sync() to authenticated;
