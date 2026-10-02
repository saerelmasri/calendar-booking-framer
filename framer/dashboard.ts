// dashboard.ts — what the owner's dashboard works out from owner_sessions(): which
// classes it lists, how full each one is, and what needs the owner's attention.
//
// No screen and no network here, so the tests can load it directly.

export interface Booking {
  id: string
  name: string
  phone: string
  created_at: string
}

export interface OwnerSession {            // one class, as owner_sessions() returns it
  id: string
  title: string
  starts_at: string
  ends_at: string
  location: string | null
  details: Record<string, string>
  places: number | null                    // null = no limit (or a setup problem)
  problem: string | null                   // set = hidden from the site; the reason
  cancelled_at: string | null              // set = gone from Google Calendar
  moved_from: string | null                // the first time, when Google moved it
  bookings: Booking[]
}

export type Attention =
  | { kind: "sync"; lastSync: string | null }        // the calendar hasn't synced lately
  | { kind: "problem"; session: OwnerSession }       // hidden from the site, with the reason
  | { kind: "cancelled"; session: OwnerSession }     // gone from Google; people to tell
  | { kind: "moved"; session: OwnerSession }         // new time; people to tell

const SYNC_LATE = 2.5 * 60 * 60 * 1000     // the timer runs hourly; two missed runs is a problem

// What the owner should look at first. Only classes still to come: once a class is
// over, there's nothing left to do about it, so it drops off on its own.
export function needsAttention(sessions: OwnerSession[], lastSync: string | null, now: Date): Attention[] {
  const items: Attention[] = []
  if (!lastSync || now.getTime() - Date.parse(lastSync) > SYNC_LATE) items.push({ kind: "sync", lastSync })

  for (const s of sessions) {
    if (Date.parse(s.starts_at) <= now.getTime()) continue
    if (s.cancelled_at) {
      if (s.bookings.length > 0) items.push({ kind: "cancelled", session: s })
    } else if (s.problem) {
      items.push({ kind: "problem", session: s })
    } else if (wasMoved(s) && s.bookings.length > 0) {
      items.push({ kind: "moved", session: s })
    }
  }
  return items
}

// Moved back to its first time counts as not moved.
export function wasMoved(s: OwnerSession): boolean {
  return s.moved_from !== null && Date.parse(s.moved_from) !== Date.parse(s.starts_at)
}

// The classes the dashboard lists: not cancelled, and not over yet (a class that has
// started stays until it ends, so a walk-in can still be added). In time order.
export function ownerClasses(sessions: OwnerSession[], now: Date): OwnerSession[] {
  return sessions
    .filter((s) => !s.cancelled_at && Date.parse(s.ends_at) > now.getTime())
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
}

// How full a class is: "7/10", or "7 booked" when there's no limit.
export function fullness(s: OwnerSession): { label: string; full: boolean } {
  const booked = s.bookings.length
  if (s.places === null) return { label: `${booked} booked`, full: false }
  return { label: `${booked}/${s.places}`, full: booked >= s.places }
}
