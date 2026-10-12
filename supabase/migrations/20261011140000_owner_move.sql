-- ============================================================
--  Move someone to another class, in one step: booked there and
--  removed here, or nothing changes. For "I can't make the new
--  time" after a class moves, or "can I switch to Thursday?".
--  The other class's places are checked exactly as for Add, so a
--  class that fills up on the website in between refuses the move
--  and the person keeps their place here.
-- ============================================================

create function public.owner_move(p_booking uuid, p_session uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_old    bookings;
  v_answer jsonb;
begin
  if not is_owner() then
    raise exception 'Only the owner can do this' using errcode = '42501';
  end if;

  select * into v_old from bookings where id = p_booking for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Book them on the other class: full, already booked, unavailable… stop here.
  v_answer := add_booking(p_session, v_old.name, v_old.phone, true);
  if v_answer->>'status' <> 'booked' then
    return v_answer;
  end if;

  delete from bookings where id = p_booking;
  return jsonb_build_object('status', 'moved');
end;
$$;

revoke all on function public.owner_move(uuid, uuid) from public, anon;
grant execute on function public.owner_move(uuid, uuid) to authenticated;
