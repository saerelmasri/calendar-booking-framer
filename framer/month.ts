// month.ts — the logic behind the public calendar: which month, which days, which
// classes on each day, the phone's list of upcoming classes, places left and the
// waiting-list link, and each class's shade of the site's colour.
//
// No screen and no network here, so the tests can load it directly.
// Every date and time is worked out in the calendar's timezone, never the visitor's.

export interface CalendarSession {    // one class, as the website reads it from Supabase
  id: string
  title: string
  starts_at: string
  ends_at: string
  location: string | null
  details: Record<string, string>
  places_left: number | null          // null = no limit
}

export type DayKey = string           // a date in the calendar's timezone, like "2026-09-28"

export interface PlacedSession extends CalendarSession {
  day: DayKey                         // its date on the calendar's clock
  time: string                        // start time on the calendar's clock, like "4:30 PM"
  past: boolean                       // started already, so greyed out
}

export interface Day {
  key: DayKey
  date: number                        // day of the month
  inMonth: boolean                    // false for the grid's days before the 1st or after the last: left blank
  isToday: boolean
  isPast: boolean                     // the whole day is over, so greyed out
  sessions: PlacedSession[]           // in time order
}

export interface Month {
  year: number
  month: number                       // 1 = January … 12 = December
  weekdays: number[]                  // the columns: 0 = Monday … 6 = Sunday
  weeks: Day[][]                      // the rows, one Day per column
}

// ------------------------------------------------------------------
//  Dates and times in the calendar's timezone
// ------------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>()

// The calendar's date and clock at a moment: { day: "2026-09-30", hour: 16, minute: "30" }
function clock(moment: Date, timeZone: string) {
  if (!formats.has(timeZone)) {
    formats.set(timeZone, new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }))
  }
  const parts: Record<string, string> = {}
  for (const p of formats.get(timeZone)!.formatToParts(moment)) parts[p.type] = p.value
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: parts.minute }
}

export function calendarDay(moment: Date, timeZone: string): DayKey {
  return clock(moment, timeZone).day
}

// A moment's time on the calendar's clock: timeOf(moment, "Asia/Beirut") is "4:30 PM".
export function timeOf(moment: Date, timeZone: string): string {
  const { hour, minute } = clock(moment, timeZone)
  return formatTime(hour, minute)
}

// The 12-hour clock: formatTime(16, "30") is "4:30 PM", formatTime(0, "15") is "12:15 AM".
export function formatTime(hour: number, minute: string): string {
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`
}

// Counting days on dates alone, with no clock involved, so a clock change
// (Lebanon's happen at midnight) can never shift the answer.
export function addDays(day: DayKey, n: number): DayKey {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function weekdayOf(day: DayKey): number {   // 0 = Monday … 6 = Sunday
  const [y, m, d] = day.split("-").map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

// Today, and the first and last day of the month we're in.
function monthOf(now: Date, timeZone: string) {
  const today = calendarDay(now, timeZone)
  const [year, month] = today.split("-").map(Number)
  const first = `${today.slice(0, 7)}-01`
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)   // day 0 of next month
  return { today, year, month, first, last }
}

// What to ask Supabase for: the whole month (the grid) and the next 30 days (the phone
// list), plus a day on each side, because the calendar's midnight isn't UTC's.
// buildMonth() and upcoming() then keep exactly the right days.
export function fetchRange(now: Date, timeZone: string): { from: DayKey; to: DayKey } {
  const { today, first, last } = monthOf(now, timeZone)
  const listEnd = addDays(today, LIST_DAYS)
  return { from: addDays(first, -1), to: addDays(listEnd > last ? listEnd : last, 2) }
}

// A session with its day, time and state worked out on the calendar's clock.
function place(s: CalendarSession, now: Date, timeZone: string): PlacedSession {
  const start = new Date(s.starts_at)
  const { day, hour, minute } = clock(start, timeZone)
  return { ...s, day, time: formatTime(hour, minute), past: start.getTime() <= now.getTime() }   // greyed from the moment it starts
}

const byStart = (a: PlacedSession, b: PlacedSession) =>
  Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.title.localeCompare(b.title)

// ------------------------------------------------------------------
//  The grid
// ------------------------------------------------------------------

// The month as rows of weeks, Monday to Sunday, with the days before the 1st and after
// the last left blank. `days` is the client's setting (0 = Monday … 6 = Sunday); a day
// that is switched off still gets its column if it has a class this month, so a one-off
// Sunday workshop can't be invisible.
export function buildMonth(
  sessions: CalendarSession[],
  { now, timeZone, days }: { now: Date; timeZone: string; days: number[] },
): Month {
  const { today, year, month, first, last } = monthOf(now, timeZone)

  // Every day from the Monday before the 1st to the Sunday after the last.
  const grid: Day[] = []
  const end = addDays(last, 6 - weekdayOf(last))
  for (let key = addDays(first, -weekdayOf(first)); key <= end; key = addDays(key, 1)) {
    const inMonth = key >= first && key <= last
    grid.push({ key, date: Number(key.slice(8)), inMonth, isToday: key === today, isPast: key < today, sessions: [] })
  }

  for (const s of sessions) {
    const placed = place(s, now, timeZone)
    const cell = grid.find((d) => d.key === placed.day && d.inMonth)
    if (cell) cell.sessions.push(placed)                   // else it belongs to another month
  }
  for (const d of grid) d.sessions.sort(byStart)

  // Columns: the chosen days, plus any day of the week that has a class this month.
  const weekdays = [0, 1, 2, 3, 4, 5, 6].filter((w) =>
    days.includes(w) || grid.some((d, i) => i % 7 === w && d.sessions.length > 0))

  // Rows: one per week, keeping only those columns. A row with no day of this month is dropped.
  const weeks: Day[][] = []
  for (let i = 0; i < grid.length; i += 7) {
    const row = weekdays.map((w) => grid[i + w])
    if (row.some((d) => d.inMonth)) weeks.push(row)
  }

  return { year, month, weekdays, weeks }
}

// ------------------------------------------------------------------
//  The phone list
// ------------------------------------------------------------------

const LIST_DAYS = 30          // the phone list runs from today to 30 days ahead

// The phone view: classes that haven't started yet, from now to 30 days ahead, in time
// order, whatever month they're in. Full classes stay in; the page marks them.
export function upcoming(sessions: CalendarSession[], { now, timeZone }: { now: Date; timeZone: string }): PlacedSession[] {
  const lastDay = addDays(calendarDay(now, timeZone), LIST_DAYS)
  return sessions
    .map((s) => place(s, now, timeZone))
    .filter((s) => !s.past && s.day <= lastDay)
    .sort(byStart)
}

// ------------------------------------------------------------------
//  Places left and the waiting list
// ------------------------------------------------------------------

// What a class shows about its places: "full", the number when only a few are left, or
// nothing. `showFrom` is the client's setting: 3 shows "3 places left" and fewer; 0 never
// shows a number, only "full".
export function placesNote(placesLeft: number | null, showFrom: number): "full" | number | null {
  if (placesLeft === null) return null                  // no limit
  if (placesLeft <= 0) return "full"
  return placesLeft <= showFrom ? placesLeft : null
}

// Puts values into the client's wording: fillIn("See you {day}", { day: "Wed" }) is
// "See you Wed". A name with no value is left as it is.
export function fillIn(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole)
}

// A link that opens WhatsApp with the message ready to send; null when no number is set.
export function whatsappLink(number: string, message: string): string | null {
  const digits = number.replace(/\D/g, "")
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null
}

// ------------------------------------------------------------------
//  Names, in the site's language
// ------------------------------------------------------------------

// A row's date in the phone list: "Tue, Sep 29" in English, "mar. 29 sept." in French.
export function dayLabel(day: DayKey, language: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(Date.UTC(y, m - 1, d))
}

// Short day names, Monday first: ["Mon", "Tue", …] in English, ["lun.", "mar.", …] in French.
export function weekdayNames(language: string): string[] {
  const format = new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" })
  return [0, 1, 2, 3, 4, 5, 6].map((i) => format.format(Date.UTC(2026, 8, 28 + i)))   // 28 Sep 2026 was a Monday
}

// The month's title: "September 2026", or "septembre 2026" in French.
export function monthTitle(year: number, month: number, language: string): string {
  return new Intl.DateTimeFormat(language, { month: "long", year: "numeric", timeZone: "UTC" })
    .format(Date.UTC(year, month - 1, 1))
}

// ------------------------------------------------------------------
//  Colour: each class name gets a tint of the site's main colour
// ------------------------------------------------------------------

const SHADES = 5              // how many tints; with more class names than this, some share
const LIGHTEST = 0.12         // how much of the main colour is in the lightest tint (the rest is white)
const DEEPEST = 0.55          // ...and in the deepest, unless that would make text hard to read
const MIN_LUMINANCE = 0.45    // lighter than this, dark text on the card stays easy to read

// The class's tint of the main colour: the same name always gets the same tint.
export function shadeFor(title: string, mainColour: string): string {
  const main = parseColour(mainColour) ?? [136, 136, 136]   // unreadable setting: grey

  // A very dark main colour can't go as deep, or text on it gets hard to read.
  let deepest = DEEPEST
  while (deepest > LIGHTEST && luminance(tint(main, deepest)) < MIN_LUMINANCE) deepest -= 0.01

  const step = hash(title.trim().toLowerCase()) % SHADES
  const [r, g, b] = tint(main, LIGHTEST + ((deepest - LIGHTEST) * step) / (SHADES - 1))
  return `rgb(${r}, ${g}, ${b})`
}

// Mix a colour with white. share 0 = white, 1 = the colour itself.
function tint(colour: number[], share: number): number[] {
  return colour.map((c) => Math.round(255 - (255 - c) * share))
}

// How light a colour looks, from 0 (black) to 1 (white). The formula accessibility checks use.
export function luminance(colour: number[]): number {
  const [r, g, b] = colour.map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Framer gives colours as "#6b7a3a", "rgb(107, 122, 58)", "hsla(75, 36%, 35%, 0.5)" (when
// the colour has transparency), or, for a colour style, "var(--token-…, rgb(107, 122, 58))".
// Reads the first colour it finds.
export function parseColour(value: string): number[] | null {
  const rgb = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i)
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((c) => Math.round(Number(c)))

  const hsl = value.match(/hsla?\(\s*(-?\d+(?:\.\d+)?)(?:deg)?[\s,]+(\d+(?:\.\d+)?)%[\s,]+(\d+(?:\.\d+)?)%/i)
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100)

  const hex = value.match(/#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i)
  if (!hex) return null
  const digits = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1].slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16))
}

// Hue in degrees, saturation and lightness from 0 to 1, to [red, green, blue] from 0 to 255.
function hslToRgb(hue: number, s: number, l: number): number[] {
  const h = ((hue % 360) + 360) % 360
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [channel(0), channel(8), channel(4)]
}

// Turns a name into a number, the same on every device (FNV-1a).
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
