-- ============================================================
--  Fields: every "Label: value" line in a class's description
--  (Instructor, Level, Room…), for the owner's filters on the
--  dashboard. Owner only: visitors can read just the columns
--  granted to them, and this isn't one of them.
-- ============================================================

alter table public.sessions add column fields jsonb not null default '{}';

-- The sync's save: as before, also saving fields.
create or replace function public.apply_sync(p_sessions jsonb, p_cancelled text[], p_time_zone text)
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
                        places, details, fields, problem, cancelled_at, last_synced_at)
  select s.google_event_id, s.title, s.starts_at, s.ends_at, s.location,
         s.places, coalesce(s.details, '{}'), coalesce(s.fields, '{}'), s.problem, null, now()
    from jsonb_to_recordset(p_sessions) as s(
           google_event_id text, title text, starts_at timestamptz, ends_at timestamptz,
           location text, places integer, details jsonb, fields jsonb, problem text)
  on conflict (google_event_id) do update set
    title          = excluded.title,
    starts_at      = excluded.starts_at,
    ends_at        = excluded.ends_at,
    location       = excluded.location,
    places         = excluded.places,
    details        = excluded.details,
    fields         = excluded.fields,
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

-- What the dashboard reads: as before, with each class's fields.
create or replace function public.owner_sessions(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'time_zone',  (select time_zone from sync_status),
    'last_sync',  (select last_success_at from sync_status),
    'sync_error', (select last_error from sync_status),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
               'location', s.location, 'details', s.details, 'fields', s.fields, 'places', s.places,
               'problem', s.problem, 'cancelled_at', s.cancelled_at, 'moved_from', s.moved_from,
               'bookings', coalesce((
                 select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'phone', b.phone,
                                                     'created_at', b.created_at, 'told_at', b.told_at)
                                  order by b.created_at)
                   from bookings b where b.session_id = s.id), '[]'::jsonb)
             ) order by s.starts_at)
        from sessions s
       where s.starts_at >= p_from and s.starts_at < p_to
    ), '[]'::jsonb)
  );
end;
$$;

-- create or replace keeps the existing permissions; restated so this file stands alone.
revoke all on function public.apply_sync(jsonb, text[], text) from public, anon, authenticated;
grant execute on function public.apply_sync(jsonb, text[], text) to service_role;
