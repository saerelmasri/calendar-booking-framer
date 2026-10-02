-- ============================================================
--  The owner's dashboard: who may use it, and what it can do.
--
--  Owners are Supabase accounts on the owners list (added by the
--  agency at onboarding; public sign-ups are off). Everything the
--  dashboard does goes through the functions below, which refuse
--  anyone who isn't an owner. Visitors keep their own two doors:
--  book_session() and places_left().
-- ============================================================

create table public.owners (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;
revoke all on public.owners from anon, authenticated;

create function public.is_owner() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from owners where user_id = auth.uid()) $$;


-- ------------------------------------------------------------
--  Remember a session's first time when Google moves it, so the
--  dashboard can say who needs telling.
-- ------------------------------------------------------------

alter table public.sessions add column moved_from timestamptz;

create function public.remember_move() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.starts_at <> old.starts_at then
    new.moved_from := coalesce(old.moved_from, old.starts_at);
  end if;
  return new;
end;
$$;

create trigger sessions_remember_move before update of starts_at on public.sessions
for each row execute function public.remember_move();


-- ------------------------------------------------------------
--  One booking routine, shared by visitors and the owner.
-- ------------------------------------------------------------

-- A phone number with spaces, dashes, brackets and dots removed; null if it isn't one.
create function public.clean_phone(p text) returns text
language sql immutable
as $$
  select case when x ~ '^\+?[0-9]{7,15}$' then x end
    from (select regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') as x) t
$$;

-- One booking, with every check. Not callable from outside: visitors use
-- book_session(), the owner owner_add(). Only the owner may add someone to a class
-- that has started (a walk-in at the door).
create function public.add_booking(p_session uuid, p_name text, p_phone text, p_after_start boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_phone   text := clean_phone(p_phone);
  v_session sessions%rowtype;
  v_left    int;
begin
  if length(v_name) not between 1 and 80 then
    return jsonb_build_object('status', 'invalid_name');
  end if;
  if v_phone is null then
    return jsonb_build_object('status', 'invalid_phone');
  end if;

  select * into v_session from sessions where id = p_session for update;

  if not found or v_session.cancelled_at is not null or v_session.problem is not null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_session.starts_at <= now() and not p_after_start then
    return jsonb_build_object('status', 'started');
  end if;

  select v_session.places - count(*) into v_left from bookings where session_id = p_session;
  if v_left < 0 then v_left := 0; end if;

  if exists (select 1 from bookings where session_id = p_session and phone = v_phone) then
    return jsonb_build_object('status', 'already_booked', 'places_left', v_left);
  end if;
  if v_left = 0 then
    return jsonb_build_object('status', 'full', 'places_left', 0);
  end if;

  insert into bookings (session_id, name, phone) values (p_session, v_name, v_phone);
  return jsonb_build_object('status', 'booked', 'places_left', v_left - 1);
end;
$$;

-- The website's booking now uses the shared routine; it behaves exactly as before.
create or replace function public.book_session(p_session uuid, p_name text, p_phone text)
returns jsonb
language sql security definer set search_path = public
as $$ select add_booking(p_session, p_name, p_phone, false) $$;


-- ------------------------------------------------------------
--  The owner's actions.
-- ------------------------------------------------------------

-- Add someone who phoned, messaged or walked in. Refused when the class is full.
create function public.owner_add(p_session uuid, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  return add_booking(p_session, p_name, p_phone, true);
end;
$$;

-- Remove a booking. The record goes entirely, and the place reappears on the site at once.
create function public.owner_cancel(p_booking uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  delete from bookings where id = p_booking;
  return jsonb_build_object('status', case when found then 'cancelled' else 'not_found' end);
end;
$$;

-- One person out, another in, in a single step: the place is never free in between.
create function public.owner_replace(p_booking uuid, p_name text, p_phone text) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_phone   text := clean_phone(p_phone);
  v_session uuid;
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  if length(v_name) not between 1 and 80 then
    return jsonb_build_object('status', 'invalid_name');
  end if;
  if v_phone is null then
    return jsonb_build_object('status', 'invalid_phone');
  end if;

  select session_id into v_session from bookings where id = p_booking for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if exists (select 1 from bookings where session_id = v_session and phone = v_phone and id <> p_booking) then
    return jsonb_build_object('status', 'already_booked');
  end if;

  update bookings set name = v_name, phone = v_phone, created_at = now() where id = p_booking;
  return jsonb_build_object('status', 'replaced');
end;
$$;


-- ------------------------------------------------------------
--  What the dashboard reads.
-- ------------------------------------------------------------

-- Everything the dashboard shows, in one call: classes in the range (cancelled and
-- flagged ones included, with the reason), each with its bookings; and the sync's health.
create function public.owner_sessions(p_from timestamptz, p_to timestamptz) returns jsonb
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
               'location', s.location, 'details', s.details, 'places', s.places,
               'problem', s.problem, 'cancelled_at', s.cancelled_at, 'moved_from', s.moved_from,
               'bookings', coalesce((
                 select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'phone', b.phone,
                                                     'created_at', b.created_at) order by b.created_at)
                   from bookings b where b.session_id = s.id), '[]'::jsonb)
             ) order by s.starts_at)
        from sessions s
       where s.starts_at >= p_from and s.starts_at < p_to
    ), '[]'::jsonb)
  );
end;
$$;


-- Doors: the owner's functions need a logged-in account (and check it's an owner);
-- the helpers aren't callable from outside at all.
revoke all on function public.is_owner() from public, anon, authenticated;
revoke all on function public.clean_phone(text) from public, anon, authenticated;
revoke all on function public.add_booking(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.remember_move() from public, anon, authenticated;
revoke all on function public.owner_add(uuid, text, text) from public, anon;
revoke all on function public.owner_cancel(uuid) from public, anon;
revoke all on function public.owner_replace(uuid, text, text) from public, anon;
revoke all on function public.owner_sessions(timestamptz, timestamptz) from public, anon;
grant execute on function public.owner_add(uuid, text, text) to authenticated;
grant execute on function public.owner_cancel(uuid) to authenticated;
grant execute on function public.owner_replace(uuid, text, text) to authenticated;
grant execute on function public.owner_sessions(timestamptz, timestamptz) to authenticated;
