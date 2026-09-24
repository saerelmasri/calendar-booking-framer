-- ============================================================
--  Mirror: sessions copied from Google Calendar, plus the state
--  of the last sync. Nothing here is readable through the public
--  API yet — the calendar display step adds a read-only view.
-- ============================================================

create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  google_event_id text not null unique,
  title           text not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  location        text,
  places          integer check (places >= 0),   -- null = unlimited
  details         jsonb not null default '{}',
  problem         text,                          -- set = can't be booked; the reason
  cancelled_at    timestamptz,                   -- set = gone from Google; kept, never deleted
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index sessions_starts_at_idx on public.sessions (starts_at);

create table public.sync_status (
  id              boolean primary key default true check (id),   -- only one row can exist
  time_zone       text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error      text,
  running_until   timestamptz                    -- set while a sync is running
);

insert into public.sync_status (id) values (true);

alter table public.sessions    enable row level security;
alter table public.sync_status enable row level security;


-- ------------------------------------------------------------
--  Taking turns: only one sync may run at a time.
-- ------------------------------------------------------------

-- Take the lock if no other sync holds it. Returns true if this sync may run.
-- The three-minute expiry frees the lock if a sync crashes without releasing it.
create function public.begin_sync() returns boolean
language sql set search_path = public
as $$
  update sync_status
     set running_until = now() + interval '3 minutes',
         last_attempt_at = now()
   where id and (running_until is null or running_until < now())
  returning true;
$$;

-- Record a failure and release the lock. Sessions are not touched.
create function public.fail_sync(p_error text) returns void
language sql set search_path = public
as $$
  update sync_status set last_error = p_error, running_until = null where id;
$$;


-- ------------------------------------------------------------
--  Writing one sync's results, all in one transaction.
-- ------------------------------------------------------------

create function public.apply_sync(p_sessions jsonb, p_cancelled text[], p_time_zone text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_added     int;
  v_cancelled int;
begin
  -- How many of these are new (counted before inserting them)
  select count(*) into v_added
    from jsonb_to_recordset(p_sessions) as s(google_event_id text)
   where not exists (select 1 from sessions t where t.google_event_id = s.google_event_id);

  -- Add new sessions and refresh known ones. Seeing a session again clears
  -- cancelled_at, so an event restored in Google comes back with its bookings.
  insert into sessions (google_event_id, title, starts_at, ends_at, location,
                        places, details, problem, cancelled_at, last_synced_at)
  select s.google_event_id, s.title, s.starts_at, s.ends_at, s.location,
         s.places, coalesce(s.details, '{}'), s.problem, null, now()
    from jsonb_to_recordset(p_sessions) as s(
           google_event_id text, title text, starts_at timestamptz, ends_at timestamptz,
           location text, places integer, details jsonb, problem text)
  on conflict (google_event_id) do update set
    title          = excluded.title,
    starts_at      = excluded.starts_at,
    ends_at        = excluded.ends_at,
    location       = excluded.location,
    places         = excluded.places,
    details        = excluded.details,
    problem        = excluded.problem,
    cancelled_at   = null,
    last_synced_at = now();

  -- Confirmed gone from Google: mark cancelled. Never delete — bookings stay attached.
  update sessions
     set cancelled_at = now(), last_synced_at = now()
   where google_event_id = any(p_cancelled)
     and cancelled_at is null;
  get diagnostics v_cancelled = row_count;

  -- Record success and release the lock taken by begin_sync().
  update sync_status
     set time_zone = p_time_zone, last_success_at = now(),
         last_error = null, running_until = null
   where id;

  return jsonb_build_object(
    'added',     v_added,
    'refreshed', jsonb_array_length(p_sessions) - v_added,
    'cancelled', v_cancelled
  );
end;
$$;


-- ------------------------------------------------------------
--  Only the sync function may run these. Supabase lets the public
--  call new functions by default; these lines take that away.
-- ------------------------------------------------------------

revoke all on function public.begin_sync()                    from public, anon, authenticated;
revoke all on function public.apply_sync(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.fail_sync(text)                 from public, anon, authenticated;
grant execute on function public.begin_sync()                    to service_role;
grant execute on function public.apply_sync(jsonb, text[], text) to service_role;
grant execute on function public.fail_sync(text)                 to service_role;
