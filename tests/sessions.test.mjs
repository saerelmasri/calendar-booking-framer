// Tests for turning Google Calendar events into session rows.
//
// Run with:  npm test
// No network and no database: sessions.ts is pure, so these run in milliseconds.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
  descriptionText,
  readField,
  readSettings,
  resolvePlaces,
  toSession,
} from "../supabase/functions/calendar-sync/sessions.ts"

const read = (text, label) => readField(descriptionText(text), label)
const places = (text, settings) => resolvePlaces(descriptionText(text), { details: [], ...settings })
const env = (values) => (name) => values[name]

const neroli = { placesField: "Capacity", placesDefault: null }

// ------------------------------------------------------------------
//  Reading one "Label: value" line
// ------------------------------------------------------------------

test("reads a detail", () => {
  assert.equal(read("Capacity: 10\nInstructor: Camila M.", "Instructor"), "Camila M.")
})

test("capitals don't matter", () => {
  assert.equal(read("INSTRUCTOR: Maya", "Instructor"), "Maya")
})

test("French spacing before the colon", () => {
  assert.equal(read("Places : 8\nChef : Nadine", "Chef"), "Nadine")
})

test("the colon is optional", () => {
  assert.equal(read("Capacity 6", "Capacity"), "6")
})

test("labels can be several words", () => {
  assert.equal(read("Meeting point: Martyrs' Square", "Meeting point"), "Martyrs' Square")
})

test("accented labels", () => {
  assert.equal(read("Durée: 2h", "Durée"), "2h")
})

test("labels containing symbols are plain text", () => {
  assert.equal(read("Price ($): 20", "Price ($)"), "20")
})

test("'Guide' does not match a line starting 'Guidelines'", () => {
  assert.equal(read("Guidelines: bring water", "Guide"), null)
})

test("an empty line does not swallow the next one", () => {
  assert.equal(read("Instructor:\nCapacity: 6", "Instructor"), null)
})

test("a word inside a sentence is not a field", () => {
  assert.equal(read("We have capacity for 10 more", "Capacity"), null)
})

test("HTML descriptions are read line by line", () => {
  assert.equal(read("Capacity:&nbsp;10<br>Instructor: Camila", "Instructor"), "Camila")
})

test("lines that aren't asked for are never read", () => {
  assert.equal(read("Door code: 4471\nInstructor: Maya", "Instructor"), "Maya")
})

// ------------------------------------------------------------------
//  Number of places: written value, else default, else flag
// ------------------------------------------------------------------

test("places: the written number", () => {
  assert.deepEqual(places("Capacity: 10", neroli), { places: 10, problem: null })
})

test("places: '10 people' reads as 10", () => {
  assert.deepEqual(places("Capacity: 10 people", neroli), { places: 10, problem: null })
})

test("places: TBD is flagged, not replaced by a default", () => {
  assert.deepEqual(places("Capacity: TBD", { placesField: "Capacity", placesDefault: 15 }), {
    places: null,
    problem: `"Capacity" says "TBD", which isn't a number`,
  })
})

test("places: missing with no default is flagged", () => {
  assert.deepEqual(places("Instructor: Maya", neroli), {
    places: null,
    problem: `No "Capacity" line in the description`,
  })
})

test("places: tours — missing uses the default", () => {
  assert.deepEqual(places("Guide: Karim", { placesField: "Spots", placesDefault: 15 }), { places: 15, problem: null })
})

test("places: tours — a written number overrides the default", () => {
  assert.deepEqual(places("Spots: 25", { placesField: "Spots", placesDefault: 15 }), { places: 25, problem: null })
})

test("places: barber — always the default", () => {
  assert.deepEqual(places("Regular customer", { placesField: null, placesDefault: 1 }), { places: 1, problem: null })
})

test("places: open day — unlimited", () => {
  assert.deepEqual(places("", { placesField: null, placesDefault: "unlimited" }), { places: "unlimited", problem: null })
})

test("places: nothing configured at all is flagged", () => {
  assert.deepEqual(places("", { placesField: null, placesDefault: null }), {
    places: null,
    problem: "No number of places set for this calendar",
  })
})

// ------------------------------------------------------------------
//  Settings
// ------------------------------------------------------------------

test("settings: a comma list becomes separate, trimmed labels", () => {
  const s = readSettings(env({ BOOKING_DETAILS: "Guide,  Language , Meeting point" }))
  assert.deepEqual(s.details, ["Guide", "Language", "Meeting point"])
})

test("settings: 'unlimited' and numbers are understood", () => {
  assert.equal(readSettings(env({ BOOKING_PLACES_DEFAULT: "Unlimited" })).placesDefault, "unlimited")
  assert.equal(readSettings(env({ BOOKING_PLACES_DEFAULT: "15" })).placesDefault, 15)
})

test("settings: nothing set means details off and missing places flagged", () => {
  assert.deepEqual(readSettings(env({})), { details: [], placesField: null, placesDefault: null })
})

test("settings: a nonsense default is refused rather than guessed", () => {
  assert.throws(
    () => readSettings(env({ BOOKING_PLACES_DEFAULT: "fifteen" })),
    /must be a number or "unlimited"/,
  )
})

// ------------------------------------------------------------------
//  A Google event becomes a session row
// ------------------------------------------------------------------

const event = (overrides = {}) => ({
  id: "evt1",
  summary: "Reformer Foundations",
  location: "Achrafieh, Beirut",
  start: { dateTime: "2026-09-30T14:00:00+03:00" },
  end: { dateTime: "2026-09-30T15:00:00+03:00" },
  description: "Capacity: 10\nInstructor: Camila M.",
  ...overrides,
})

const neroliSettings = { details: ["Instructor"], placesField: "Capacity", placesDefault: null }

test("a Neroli event becomes a bookable session", () => {
  assert.deepEqual(toSession(event(), neroliSettings), {
    google_event_id: "evt1",
    title: "Reformer Foundations",
    starts_at: "2026-09-30T14:00:00+03:00",
    ends_at: "2026-09-30T15:00:00+03:00",
    location: "Achrafieh, Beirut",
    places: 10,
    details: { Instructor: "Camila M." },
    problem: null,
  })
})

test("an unlimited session stores empty places and no problem", () => {
  const row = toSession(event({ description: "" }), { details: [], placesField: null, placesDefault: "unlimited" })
  assert.equal(row.places, null)
  assert.equal(row.problem, null)
})

test("a missing limit blocks booking, with the reason", () => {
  const row = toSession(event({ description: "Instructor: Rachel MT." }), neroliSettings)
  assert.equal(row.places, null)
  assert.equal(row.problem, `No "Capacity" line in the description`)
  assert.deepEqual(row.details, { Instructor: "Rachel MT." })
})

test("an untitled event gets a placeholder title", () => {
  assert.equal(toSession(event({ summary: "   " }), neroliSettings).title, "(untitled)")
})

test("private lines never reach the session row", () => {
  const row = toSession(event({ description: "Capacity: 6\nInstructor: Maya\nDoor code: 4471" }), neroliSettings)
  assert.ok(!JSON.stringify(row).includes("4471"), "the door code must not appear anywhere in the row")
})
