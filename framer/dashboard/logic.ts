// logic.ts — what the owner's dashboard works out from owner_sessions(): which
// classes it lists, how full each one is, and what needs the owner's attention.
//
// No screen and no network here, so the tests can load it directly.

export interface Booking {
  id: string
  name: string
  phone: string
  created_at: string
  told_at: string | null              // when the owner ticked "told" about a change
}

export interface OwnerSession {            // one class, as owner_sessions() returns it
  id: string
  title: string
  starts_at: string
  ends_at: string
  location: string | null
  details: Record<string, string>         // the lines visitors see
  fields: Record<string, string>          // every "Label: value" line, for the filters
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
      if (s.bookings.some((b) => !b.told_at)) items.push({ kind: "cancelled", session: s })
    } else if (s.problem) {
      items.push({ kind: "problem", session: s })
    } else if (wasMoved(s) && s.bookings.some((b) => !b.told_at)) {
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

// A number as WhatsApp needs it, with the country code. "+961 70…" and "00961 70…" are
// already international; "70 123 456" or "03 123 456" gets the client's country code,
// without the leading 0. With no country code set, the number is left as it is.
export function internationalPhone(phone: string, countryCode: string): string {
  const trimmed = phone.trim()
  const code = countryCode.replace(/\D/g, "")
  if (trimmed.startsWith("+")) return trimmed
  if (trimmed.startsWith("00")) return `+${trimmed.slice(2)}`
  if (!code) return trimmed
  return `+${code}${trimmed.replace(/\D/g, "").replace(/^0+/, "")}`
}

// The owner's search: a class name, a description value ("camila"), a person's name,
// or (3+ digits) part of a phone number, however it's typed: "70123", "+961 70 123" and
// "070 123" all find 70 123 456. Capitals and accents don't matter. Each match lists the
// people who matched, so the list can name them under the class.
export function findClasses(sessions: OwnerSession[], query: string, countryCode = ""): { session: OwnerSession; people: Booking[] }[] {
  const text = plain(query)
  if (!text) return []
  const code = countryCode.replace(/\D/g, "")
  const digits = query.replace(/\D/g, "").replace(/^0+/, "")
  const asked = digits.length >= 3 ? phoneForms(digits, code) : []
  const matches: { session: OwnerSession; people: Booking[] }[] = []
  for (const s of sessions) {
    const people = s.bookings.filter((b) => {
      if (plain(b.name).includes(text)) return true
      const stored = [
        ...phoneForms(b.phone.replace(/\D/g, "").replace(/^0+/, ""), code),
        internationalPhone(b.phone, code).replace(/\D/g, ""),
      ]
      return asked.some((a) => stored.some((p) => p.includes(a)))
    })
    const described = Object.values(s.fields ?? {}).some((v) => plain(v).includes(text))
    if (people.length > 0 || plain(s.title).includes(text) || described) matches.push({ session: s, people })
  }
  return matches
}

// A number's digits as written, and without the local 0 after the country code
// ("96103123456" → also "9613123456"), so both ways of writing it match.
function phoneForms(digits: string, code: string): string[] {
  if (!code || !digits.startsWith(code)) return [digits]
  return [digits, code + digits.slice(code.length).replace(/^0+/, "")]
}

// "  Joëlle  HADDAD " → "joelle haddad"
function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ")
}

// A way to narrow the class list: the location, or any "Label: value" line written in
// the class descriptions (Instructor, Level, Room…), so the client decides what can be
// filtered just by writing it in Google Calendar. Labels match whatever their capitals.
// Only offered when it has 2+ values, so it actually narrows something.
export interface Filter { key: string; label: string; values: string[] }

export function filterOptions(sessions: OwnerSession[]): Filter[] {
  const keys = [{ key: "location", label: "Location" }]
  for (const s of sessions)
    for (const label of Object.keys(s.fields ?? {}))
      if (!keys.some((k) => k.key === `field:${label.toLowerCase()}`)) keys.push({ key: `field:${label.toLowerCase()}`, label })
  return keys
    .map(({ key, label }) => ({
      key, label,
      values: [...new Set(sessions.map((s) => valueOf(s, key)).filter((v): v is string => !!v))].sort(),
    }))
    .filter((f) => f.values.length >= 2)
}

// The classes that match every chosen filter. chosen: { "field:instructor": "Camila M." }
export function applyFilters(sessions: OwnerSession[], chosen: Record<string, string>): OwnerSession[] {
  const active = Object.entries(chosen).filter(([, value]) => value)
  return sessions.filter((s) => active.every(([key, value]) => valueOf(s, key) === value))
}

function valueOf(s: OwnerSession, key: string): string | null {
  if (key === "location") return s.location
  const wanted = key.slice("field:".length)
  const label = Object.keys(s.fields ?? {}).find((l) => l.toLowerCase() === wanted)
  return label ? s.fields[label] : null
}

// "+96170123456" → "+961 70 123 456": the client's country code, then the rest in threes
// from the end. Other countries' numbers are shown as typed.
export function readablePhone(phone: string, countryCode: string): string {
  const code = countryCode.replace(/\D/g, "")
  const full = internationalPhone(phone, code)
  if (!code || !full.startsWith(`+${code}`)) return phone.trim()
  const rest = full.slice(code.length + 1).replace(/\D/g, "")
  const groups = rest.match(/\d{1,3}(?=(\d{3})*$)/g) ?? [rest]
  return `+${code} ${groups.join(" ")}`
}

// Where someone from a cancelled class was booked instead: the same phone number on
// another class still to come (the earliest, if several). null when they weren't.
export function rebookedOn(b: Booking, cancelled: OwnerSession, sessions: OwnerSession[], now: Date): OwnerSession | null {
  const digits = b.phone.replace(/\D/g, "")
  return sessions
    .filter((o) => o.id !== cancelled.id && !o.cancelled_at && Date.parse(o.starts_at) > now.getTime()
      && o.bookings.some((x) => x.phone.replace(/\D/g, "") === digits))
    .sort((x, y) => Date.parse(x.starts_at) - Date.parse(y.starts_at))[0] ?? null
}

// What to do about a class hidden by a setup problem, in the owner's words. The sync
// writes the reason; this turns it into the fix, with the client's own label.
export function fixHint(problem: string): string {
  const missing = problem.match(/^No "(.+)" line in the description/)
  if (missing) return `Add a line like "${missing[1]}: 10" to the event's description in Google Calendar.`
  const notNumber = problem.match(/^"(.+)" says ".*", which isn't a number/)
  if (notNumber) return `Write a number on the "${notNumber[1]}" line, like "${notNumber[1]}: 10", in Google Calendar.`
  if (problem.startsWith("No number of places set")) return "Ask your website team to set a number of places for this calendar."
  return "Fix it in Google Calendar."
}

// The class the owner is about to teach: today, not over, not cancelled or hidden. The
// first one under way, else the next to start. null when today's classes are done.
// dayOf: the calendar day a time falls on, in the studio's time zone.
export function nextClass(sessions: OwnerSession[], now: Date, today: string, dayOf: (iso: string) => string): OwnerSession | null {
  return ownerClasses(sessions, now).find((s) => !s.problem && dayOf(s.starts_at) === today) ?? null
}

// "in 25 min", "in 2 h", or null once it has started.
export function startsIn(startsAt: string, now: Date): string | null {
  const minutes = Math.ceil((Date.parse(startsAt) - now.getTime()) / 60_000)
  if (minutes <= 0) return null
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`
}

// Classes someone could be moved or booked onto: still to come, on the site (not cancelled
// or hidden), with a free place, and not the one they're leaving or one they're already on.
export function classesToMoveTo(b: Booking, from: OwnerSession, sessions: OwnerSession[], now: Date): OwnerSession[] {
  const digits = b.phone.replace(/\D/g, "")
  return sessions.filter((o) =>
    o.id !== from.id && !o.cancelled_at && !o.problem && Date.parse(o.starts_at) > now.getTime()
    && (o.places === null || o.bookings.length < o.places)
    && !o.bookings.some((x) => x.phone.replace(/\D/g, "") === digits))
}
