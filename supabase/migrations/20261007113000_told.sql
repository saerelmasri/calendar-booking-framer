-- ============================================================
--  "Told": the owner ticks each person they've let know about a
--  cancelled or moved class. The class leaves Needs attention once
--  everyone is ticked; if it moves again or gets cancelled, the
--  ticks reset, because those people need telling again.
-- ============================================================

alter table public.bookings add column told_at timestamptz;

-- A class that moves again, or gets cancelled, needs telling again.
create function public.forget_told() returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.starts_at <> old.starts_at or (new.cancelled_at is not null and old.cancelled_at is null) then
    update bookings set told_at = null where session_id = new.id;
  end if;
  return new;
end;
$$;

create trigger sessions_forget_told after update of starts_at, cancelled_at on public.sessions
for each row execute function public.forget_told();

-- Tick or untick "told" for one booking.
create function public.owner_mark_told(p_booking uuid, p_told boolean) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;
  update bookings set told_at = case when p_told then now() end where id = p_booking;
  return jsonb_build_object('status', case when found then 'done' else 'not_found' end);
end;
$$;

-- What the dashboard reads: as before, with each booking's told_at.
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
               'location', s.location, 'details', s.details, 'places', s.places,
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

revoke all on function public.forget_told() from public, anon, authenticated;
revoke all on function public.owner_mark_told(uuid, boolean) from public, anon;
grant execute on function public.owner_mark_told(uuid, boolean) to authenticated;
