-- ============================================================
--  Bookings: who booked which session.
--
--  Nobody outside can read or write this table. The website books
--  through book_session(), which checks everything and enforces
--  the number of places, and reads places left through
--  places_left(), which returns numbers only — never names.
-- ============================================================

create table public.bookings (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id),
  name        text not null check (length(name) between 1 and 80),
  phone       text not null check (phone ~ '^\+?[0-9]{7,15}$'),   -- spaces and dashes removed
  created_at  timestamptz not null default now(),
  unique (session_id, phone)                                        -- one booking per phone per session
);

alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;


-- ------------------------------------------------------------
--  Booking a place — the website's only way in.
-- ------------------------------------------------------------

create function public.book_session(p_session uuid, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer                 -- runs with the owner's rights, so the table can stay closed
set search_path = public
as $$
declare
  v_name    text := btrim(coalesce(p_name, ''));
  v_phone   text := regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g');
  v_session sessions%rowtype;
  v_left    int;
begin
  if length(v_name) not between 1 and 80 then
    return jsonb_build_object('status', 'invalid_name');
  end if;
  if v_phone !~ '^\+?[0-9]{7,15}$' then
    return jsonb_build_object('status', 'invalid_phone');
  end if;

  -- Lock the session. Anyone booking it at the same moment waits here a few
  -- milliseconds, then counts again and sees the truth.
  select * into v_session from sessions where id = p_session for update;

  -- Cancelled and flagged sessions aren't on the website, but refuse them here too
  if not found or v_session.cancelled_at is not null or v_session.problem is not null then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if v_session.starts_at <= now() then
    return jsonb_build_object('status', 'started');
  end if;

  -- Places left, counted from the bookings; null when there's no limit
  select v_session.places - count(*) into v_left from bookings where session_id = p_session;
  if v_left < 0 then v_left := 0; end if;          -- the owner lowered the limit below the bookings

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


-- ------------------------------------------------------------
--  Places left, for the public calendar: numbers only.
--  Sessions with no limit aren't listed.
-- ------------------------------------------------------------

create function public.places_left(p_from timestamptz, p_to timestamptz)
returns table (session_id uuid, places_left int)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, greatest(s.places - count(b.id)::int, 0)
    from sessions s
    left join bookings b on b.session_id = s.id
   where s.cancelled_at is null
     and s.problem is null
     and s.places is not null
     and s.starts_at >= p_from and s.starts_at < p_to
   group by s.id, s.places;
$$;


-- The website (public key) may run these two functions, and nothing else here.
revoke all on function public.book_session(uuid, text, text) from public;
revoke all on function public.places_left(timestamptz, timestamptz) from public;
grant execute on function public.book_session(uuid, text, text) to anon, authenticated;
grant execute on function public.places_left(timestamptz, timestamptz) to anon, authenticated;
