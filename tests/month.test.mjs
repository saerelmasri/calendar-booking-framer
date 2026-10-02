// Tests for the public calendar's month logic.
//
// Run with:  npm test
// Beirut is UTC+3 in summer and UTC+2 in winter, and changes its clocks at midnight
// on the last Sunday of March and of October. Those months are tested on purpose.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addDays,
  buildMonth,
  calendarDay,
  dayLabel,
  fetchRange,
  fillIn,
  formatTime,
  luminance,
  monthTitle,
  parseColour,
  placesNote,
  shadeFor,
  upcoming,
  weekdayNames,
  weekdayOf,
  whatsappLink,
} from "../framer/month.ts"

const BEIRUT = "Asia/Beirut"
const MON_TO_SAT = [0, 1, 2, 3, 4, 5]
const at = (iso) => new Date(iso)

// A session as Supabase returns it: times in UTC.
const session = (title, startsUtc) => ({
  id: `${title} ${startsUtc}`,
  title,
  starts_at: startsUtc,
  ends_at: startsUtc,
  location: null,
  details: {},
  places_left: null,
})

// The month as the website would show it at `now`. By default: Monday 28 September 2026, 9 AM in Beirut.
const month = (sessions, { now = "2026-09-28T06:00:00Z", days = MON_TO_SAT } = {}) =>
  buildMonth(sessions, { now: at(now), timeZone: BEIRUT, days })

// One day of the grid, found by its date.
const day = (m, key) => m.weeks.flat().find((d) => d.key === key)

// ------------------------------------------------------------------
//  Dates and times in the calendar's timezone
// ------------------------------------------------------------------

test("a moment belongs to the calendar's date, not UTC's", () => {
  // 21:30 UTC on Monday is 12:30 AM on Tuesday in Beirut
  assert.equal(calendarDay(at("2026-09-28T21:30:00Z"), BEIRUT), "2026-09-29")
})

test("adding days crosses months and years", () => {
  assert.equal(addDays("2026-09-28", 7), "2026-10-05")
  assert.equal(addDays("2026-12-28", 7), "2027-01-04")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
})

test("weekdays count from Monday", () => {
  assert.equal(weekdayOf("2026-09-28"), 0) // Monday
  assert.equal(weekdayOf("2026-10-04"), 6) // Sunday
})

test("the 12-hour clock around midnight and noon", () => {
  assert.equal(formatTime(0, "30"), "12:30 AM")
  assert.equal(formatTime(9, "05"), "9:05 AM")
  assert.equal(formatTime(12, "00"), "12:00 PM")
  assert.equal(formatTime(23, "45"), "11:45 PM")
})

test("spring: the midnight that doesn't exist (29 March 2026)", () => {
  // At 22:00 UTC on Saturday, Beirut's clocks jump from midnight straight to 1 AM on Sunday
  assert.equal(calendarDay(at("2026-03-28T21:59:00Z"), BEIRUT), "2026-03-28") // 11:59 PM Saturday
  assert.equal(calendarDay(at("2026-03-28T22:00:00Z"), BEIRUT), "2026-03-29") // 1:00 AM Sunday
})

test("autumn: the hour before midnight that happens twice (24 October 2026)", () => {
  // At midnight on Sunday clocks go back to 11 PM on Saturday, so 20:30 and 21:30 UTC are both 11:30 PM Saturday
  assert.equal(calendarDay(at("2026-10-24T20:30:00Z"), BEIRUT), "2026-10-24")
  assert.equal(calendarDay(at("2026-10-24T21:30:00Z"), BEIRUT), "2026-10-24")
  assert.equal(calendarDay(at("2026-10-24T22:00:00Z"), BEIRUT), "2026-10-25") // midnight, Sunday
})

// ------------------------------------------------------------------
//  Which month, and its grid
// ------------------------------------------------------------------

test("at 1:30 AM on 1 October in Beirut it's October, though UTC is still in September", () => {
  const m = month([], { now: "2026-09-30T22:30:00Z" })
  assert.deepEqual([m.year, m.month], [2026, 10])
})

test("the grid runs in whole weeks, from the Monday before the 1st", () => {
  const m = month([])
  assert.equal(m.weeks.length, 5)
  assert.deepEqual(m.weeks[0].map((d) => d.date), [31, 1, 2, 3, 4, 5])
  assert.deepEqual(m.weeks[4].map((d) => d.date), [28, 29, 30, 1, 2, 3])
})

test("days outside the month are left blank", () => {
  const m = month([])
  assert.deepEqual(m.weeks[0].map((d) => d.inMonth), [false, true, true, true, true, true])
  assert.deepEqual(m.weeks[4].map((d) => d.inMonth), [true, true, true, false, false, false])
})

test("columns: Monday to Saturday by default", () => {
  assert.deepEqual(month([]).weekdays, [0, 1, 2, 3, 4, 5])
})

test("a first row with no day of the month is dropped (March 2026 starts on a hidden Sunday)", () => {
  const m = month([], { now: "2026-03-10T08:00:00Z" })
  assert.equal(m.weeks[0][0].key, "2026-03-02")
})

test("what to fetch: the whole month and the next 30 days, with a day to spare on each side", () => {
  assert.deepEqual(fetchRange(at("2026-09-28T06:00:00Z"), BEIRUT), { from: "2026-08-31", to: "2026-10-30" })
})

// ------------------------------------------------------------------
//  The days and their classes
// ------------------------------------------------------------------

test("each day lists its classes in time order, on the 12-hour clock", () => {
  const m = month([
    session("Barre", "2026-09-30T13:30:00+00:00"),    // 4:30 PM
    session("Mat Flow", "2026-09-30T06:00:00+00:00"), // 9:00 AM
  ])
  assert.deepEqual(day(m, "2026-09-30").sessions.map((s) => `${s.time} ${s.title}`), ["9:00 AM Mat Flow", "4:30 PM Barre"])
})

test("a class at 12:30 AM in Beirut is on Beirut's date, though UTC says the day before", () => {
  const m = month([session("Night Flow", "2026-09-29T21:30:00+00:00")])
  assert.equal(day(m, "2026-09-30").sessions[0].time, "12:30 AM")
  assert.equal(day(m, "2026-09-29").sessions.length, 0)
})

test("the month the clocks change: a 10 AM class says 10 AM before and after", () => {
  // 10 AM on Saturday 28 March is 08:00 UTC (winter); 10 AM on Monday 30 March is 07:00 UTC (summer)
  const m = month(
    [session("Saturday", "2026-03-28T08:00:00+00:00"), session("Monday", "2026-03-30T07:00:00+00:00")],
    { now: "2026-03-10T08:00:00Z" },
  )
  assert.equal(day(m, "2026-03-28").sessions[0].time, "10:00 AM")
  assert.equal(day(m, "2026-03-30").sessions[0].time, "10:00 AM")
})

test("greyed out from the moment a class starts", () => {
  const s = session("Mat Flow", "2026-09-28T06:00:00+00:00")
  assert.equal(day(month([s], { now: "2026-09-28T05:59:00Z" }), "2026-09-28").sessions[0].past, false)
  assert.equal(day(month([s], { now: "2026-09-28T06:00:00Z" }), "2026-09-28").sessions[0].past, true)
})

test("days before today are over, and today is marked", () => {
  const m = month([]) // Monday 28 September
  assert.deepEqual(["2026-09-26", "2026-09-28", "2026-09-29"].map((k) => day(m, k).isPast), [true, false, false])
  assert.deepEqual(m.weeks.flat().filter((d) => d.isToday).map((d) => d.key), ["2026-09-28"])
})

test("a hidden Sunday gets its column when a Sunday has a class that month", () => {
  const m = month([session("Sunday Workshop", "2026-09-20T07:00:00+00:00")])
  assert.deepEqual(m.weekdays, [0, 1, 2, 3, 4, 5, 6])
  assert.equal(day(m, "2026-09-20").sessions[0].title, "Sunday Workshop")
})

test("classes from another month are left out, even in the grid's blank days", () => {
  const m = month([session("August", "2026-08-31T06:00:00+00:00"), session("October", "2026-10-01T06:00:00+00:00")])
  assert.equal(m.weeks.flat().flatMap((d) => d.sessions).length, 0)
})

// ------------------------------------------------------------------
//  The phone list
// ------------------------------------------------------------------

// The phone list at `now`, one line per class. By default: Monday 28 September 2026, 9 AM in Beirut.
const list = (sessions, now = "2026-09-28T06:00:00Z") =>
  upcoming(sessions, { now: at(now), timeZone: BEIRUT }).map((s) => `${s.day} ${s.time} ${s.title}`)

test("the phone list: only classes that haven't started, in time order", () => {
  assert.deepEqual(list([
    session("Tomorrow", "2026-09-29T11:30:00+00:00"),    // Tuesday 2:30 PM
    session("Started", "2026-09-28T05:00:00+00:00"),     // Monday 8:00 AM, an hour ago
    session("Later today", "2026-09-28T13:30:00+00:00"), // Monday 4:30 PM
  ]), ["2026-09-28 4:30 PM Later today", "2026-09-29 2:30 PM Tomorrow"])
})

test("the phone list runs 30 days ahead, into next month", () => {
  assert.deepEqual(list([
    session("28 October", "2026-10-28T12:00:00+00:00"), // 30 days ahead: in (2 PM, winter time)
    session("29 October", "2026-10-29T12:00:00+00:00"), // 31 days ahead: too far
  ]), ["2026-10-28 2:00 PM 28 October"])
})

test("full classes stay in the list", () => {
  const full = { ...session("Reformer", "2026-09-30T11:00:00+00:00"), places_left: 0 }
  const [s] = upcoming([full], { now: at("2026-09-28T06:00:00Z"), timeZone: BEIRUT })
  assert.equal(s.places_left, 0)
})

// ------------------------------------------------------------------
//  Places left and the waiting list
// ------------------------------------------------------------------

test("places: the number shows only when few are left", () => {
  assert.equal(placesNote(8, 3), null)      // plenty: nothing shown
  assert.equal(placesNote(3, 3), 3)
  assert.equal(placesNote(1, 3), 1)
  assert.equal(placesNote(0, 3), "full")
})

test("places: no limit shows nothing; 0 as the setting shows only full", () => {
  assert.equal(placesNote(null, 3), null)
  assert.equal(placesNote(1, 0), null)
  assert.equal(placesNote(0, 0), "full")
})

test("wording: values go into the client's sentence", () => {
  assert.equal(fillIn("You're in, {name}! See you {day} at {time}.", { name: "Sara", day: "Wed, Sep 30", time: "6:00 PM" }),
    "You're in, Sara! See you Wed, Sep 30 at 6:00 PM.")
  assert.equal(fillIn("{n} places left", { n: "2" }), "2 places left")
  assert.equal(fillIn("Hello {nobody}", {}), "Hello {nobody}")
})

test("the waiting-list link opens WhatsApp with the message ready", () => {
  assert.equal(whatsappLink("+961 70 123 456", "Hi & thanks"), "https://wa.me/96170123456?text=Hi%20%26%20thanks")
  assert.equal(whatsappLink("", "Hi"), null)                        // no number: no link
})

// ------------------------------------------------------------------
//  Names, in the site's language
// ------------------------------------------------------------------

test("day and month names in the site's language", () => {
  assert.deepEqual(weekdayNames("en"), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
  assert.equal(monthTitle(2026, 9, "en"), "September 2026")
  assert.equal(weekdayNames("fr")[0], "lun.")
  assert.equal(monthTitle(2026, 9, "fr"), "septembre 2026")
})

test("a row's date in the phone list, in the site's language", () => {
  assert.equal(dayLabel("2026-09-29", "en"), "Tue, Sep 29")
  assert.equal(dayLabel("2026-09-29", "fr"), "mar. 29 sept.")
})

// ------------------------------------------------------------------
//  Colour
// ------------------------------------------------------------------

const OLIVE = "rgb(107, 122, 58)"
const names = Array.from({ length: 40 }, (_, i) => `Class ${i + 1}`)

test("a class keeps its shade: same name, same shade", () => {
  assert.equal(shadeFor("Mat Flow", OLIVE), shadeFor("Mat Flow", OLIVE))
  assert.equal(shadeFor("Mat Flow", OLIVE), shadeFor("  mat flow ", OLIVE))
})

test("five different shades across enough classes", () => {
  assert.equal(new Set(names.map((n) => shadeFor(n, OLIVE))).size, 5)
})

test("dark text stays readable on every shade, whatever the main colour", () => {
  for (const main of ["#000000", "rgb(27, 42, 74)", "#0000ff", OLIVE, "#c0392b", "#f5d90a", "#ffffff"]) {
    for (const n of names) {
      const y = luminance(parseColour(shadeFor(n, main)))
      assert.ok(y >= 0.45, `${n} on ${main}: luminance ${y.toFixed(2)}`)
    }
  }
})

test("every shade stays in the main colour's family", () => {
  // Olive has more green than red, and more red than blue; so does every shade of it
  for (const n of names) {
    const [r, g, b] = parseColour(shadeFor(n, OLIVE))
    assert.ok(g >= r && r >= b, `${n}: rgb(${r}, ${g}, ${b})`)
  }
})

test("reads the colour formats Framer gives", () => {
  assert.deepEqual(parseColour("#6b7a3a"), [107, 122, 58])
  assert.deepEqual(parseColour("#fff"), [255, 255, 255])
  assert.deepEqual(parseColour("rgba(107, 122, 58, 0.5)"), [107, 122, 58])
  assert.deepEqual(parseColour("var(--token-4f1c, rgb(107, 122, 58))"), [107, 122, 58])
  assert.deepEqual(parseColour("hsla(0, 100%, 50%, 0.5)"), [255, 0, 0])
  assert.deepEqual(parseColour("hsl(120, 100%, 25%)"), [0, 128, 0])
})

test("an unreadable colour setting falls back to grey instead of breaking", () => {
  assert.equal(parseColour("olive-ish"), null)
  assert.match(shadeFor("Mat Flow", "olive-ish"), /^rgb\((\d+), \1, \1\)$/)
})
