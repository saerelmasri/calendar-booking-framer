// Tests for what the owner's dashboard works out from owner_sessions().
//
// Run with:  npm test

import { test } from "node:test"
import assert from "node:assert/strict"
import { fullness, internationalPhone, needsAttention, ownerClasses, wasMoved } from "../framer/dashboard.ts"
import { timeOf } from "../framer/month.ts"

const NOW = new Date("2026-10-03T09:00:00Z")
const JUST_SYNCED = "2026-10-03T08:00:00Z"
const person = (name, told_at = null) => ({ id: name, name, phone: "+96170000000", created_at: JUST_SYNCED, told_at })

// A class as owner_sessions() returns it. By default: tomorrow, 10 places, nothing wrong.
const cls = (title, extra = {}) => ({
  id: title,
  title,
  starts_at: "2026-10-04T11:00:00+00:00",
  ends_at: "2026-10-04T12:00:00+00:00",
  location: null,
  details: {},
  places: 10,
  problem: null,
  cancelled_at: null,
  moved_from: null,
  bookings: [],
  ...extra,
})

const kinds = (sessions, lastSync = JUST_SYNCED) =>
  needsAttention(sessions, lastSync, NOW).map((a) => (a.kind === "sync" ? "sync" : `${a.kind}: ${a.session.title}`))

// ------------------------------------------------------------------
//  Needs attention
// ------------------------------------------------------------------

test("nothing wrong: nothing needs attention", () => {
  assert.deepEqual(kinds([cls("Reformer", { bookings: [person("Sara")] })]), [])
})

test("a class hidden by a setup problem needs attention, booked or not", () => {
  assert.deepEqual(kinds([cls("Barre", { places: null, problem: 'No "Capacity" line in the description' })]),
    ["problem: Barre"])
})

test("a cancelled class needs attention only when people were booked", () => {
  assert.deepEqual(kinds([
    cls("Yin", { cancelled_at: JUST_SYNCED, bookings: [person("Sara")] }),
    cls("Empty", { cancelled_at: JUST_SYNCED }),
  ]), ["cancelled: Yin"])
})

test("a moved class needs attention only when people were booked", () => {
  assert.deepEqual(kinds([
    cls("Moved", { moved_from: "2026-10-03T15:00:00+00:00", bookings: [person("Sara")] }),
    cls("Moved, empty", { moved_from: "2026-10-03T15:00:00+00:00" }),
  ]), ["moved: Moved"])
})

test("a class moved back to its first time isn't moved", () => {
  const back = cls("Back", { moved_from: "2026-10-04T11:00:00Z", bookings: [person("Sara")] })
  assert.equal(wasMoved(back), false)
  assert.deepEqual(kinds([back]), [])
})

test("classes that are over drop off on their own", () => {
  assert.deepEqual(kinds([cls("Last week", {
    starts_at: "2026-09-26T11:00:00+00:00", cancelled_at: JUST_SYNCED, bookings: [person("Sara")],
  })]), [])
})

test("the calendar not synced for over 2.5 hours, or never, needs attention", () => {
  assert.deepEqual(kinds([], "2026-10-03T06:29:00Z"), ["sync"])   // 2.5 hours and a minute ago
  assert.deepEqual(kinds([], "2026-10-03T06:31:00Z"), [])
  assert.deepEqual(kinds([], null), ["sync"])
})

// ------------------------------------------------------------------
//  The class list
// ------------------------------------------------------------------

test("the list: not cancelled, not over, in time order; a class under way stays", () => {
  const list = ownerClasses([
    cls("Later", { starts_at: "2026-10-05T11:00:00+00:00", ends_at: "2026-10-05T12:00:00+00:00" }),
    cls("Under way", { starts_at: "2026-10-03T08:30:00+00:00", ends_at: "2026-10-03T09:30:00+00:00" }),
    cls("Over", { starts_at: "2026-10-03T07:00:00+00:00", ends_at: "2026-10-03T08:00:00+00:00" }),
    cls("Cancelled", { cancelled_at: JUST_SYNCED }),
  ], NOW)
  assert.deepEqual(list.map((s) => s.title), ["Under way", "Later"])
})

test("how full: booked out of places, or just booked when there's no limit", () => {
  assert.deepEqual(fullness(cls("A", { bookings: [person("Sara")] })), { label: "1/10", full: false })
  assert.deepEqual(fullness(cls("B", { places: 1, bookings: [person("Sara")] })), { label: "1/1", full: true })
  assert.deepEqual(fullness(cls("C", { places: null, bookings: [person("Sara")] })), { label: "1 booked", full: false })
})

test("a time on the calendar's clock", () => {
  assert.equal(timeOf(new Date("2026-10-03T13:30:00Z"), "Asia/Beirut"), "4:30 PM")
})

test("everyone told: a cancelled or moved class no longer needs attention", () => {
  assert.deepEqual(kinds([
    cls("Yin", { cancelled_at: JUST_SYNCED, bookings: [person("Sara", JUST_SYNCED), person("Maya", JUST_SYNCED)] }),
    cls("Moved", { moved_from: "2026-10-03T15:00:00+00:00", bookings: [person("Rana", JUST_SYNCED)] }),
  ]), [])
})

test("one person not told yet: it still needs attention", () => {
  assert.deepEqual(kinds([
    cls("Yin", { cancelled_at: JUST_SYNCED, bookings: [person("Sara", JUST_SYNCED), person("Maya")] }),
  ]), ["cancelled: Yin"])
})

test("local numbers get the country code; international ones are kept", () => {
  assert.equal(internationalPhone("70 123 456", "961"), "+96170123456")
  assert.equal(internationalPhone("03 123 456", "961"), "+9613123456")
  assert.equal(internationalPhone("+961 70 123 456", "961"), "+961 70 123 456")
  assert.equal(internationalPhone("00961 70 123 456", "961"), "+961 70 123 456")
  assert.equal(internationalPhone("70 123 456", ""), "70 123 456")
})
