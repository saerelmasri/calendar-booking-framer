// Tests for what the owner's dashboard works out from owner_sessions().
//
// Run with:  npm test

import { test } from "node:test"
import assert from "node:assert/strict"
import { applyFilters, classesToMoveTo, filterOptions, findClasses, fixHint, fullness, internationalPhone, nextClass, readablePhone, rebookedOn, startsIn, needsAttention, ownerClasses, wasMoved } from "../framer/dashboard/logic.ts"
import { timeOf } from "../framer/shared/month.ts"

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
  fields: {},
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

test("search: a person's name, ignoring capitals and accents, says who matched", () => {
  const joelle = { ...person("Joëlle Haddad"), phone: "+961 70 123 456" }
  const classes = [cls("Mat Flow", { bookings: [joelle, person("Rana Saad")] }), cls("Barre", { bookings: [person("Rana Saad")] })]
  const found = findClasses(classes, "  JOELLE ")
  assert.equal(found.length, 1)
  assert.equal(found[0].session.title, "Mat Flow")
  assert.deepEqual(found[0].people.map((b) => b.name), ["Joëlle Haddad"])
})

test("search: a class name finds the class, with no one named", () => {
  const found = findClasses([cls("Reformer Foundations"), cls("Mat Flow")], "reformer")
  assert.deepEqual(found.map((f) => f.session.title), ["Reformer Foundations"])
  assert.deepEqual(found[0].people, [])
})

test("search: part of a phone number, 3 digits or more", () => {
  const sara = { ...person("Sara"), phone: "+961 70 123 456" }
  const classes = [cls("Mat Flow", { bookings: [sara] })]
  assert.equal(findClasses(classes, "123 456").length, 1)
  assert.equal(findClasses(classes, "12").length, 0)
  assert.equal(findClasses(classes, "   ").length, 0)
})

test("filters: any description line, offered only when it'd narrow something; no class-name filter", () => {
  const classes = [
    cls("Mat Flow", { location: "Achrafieh", fields: { Instructor: "Camila M.", Level: "Beginner", Room: "A" } }),
    cls("Barre", { location: "Achrafieh", fields: { instructor: "Rita K.", Level: "Beginner", Room: "B" } }),
  ]
  const filters = filterOptions(classes)
  // one location, one level: no filter for them; "instructor" and "Instructor" are one filter
  assert.deepEqual(filters.map((f) => f.label), ["Instructor", "Room"])
  assert.deepEqual(filters[0].values, ["Camila M.", "Rita K."])
})

test("filters: they combine, and All (empty) means no filter", () => {
  const classes = [
    cls("Mat Flow", { location: "Achrafieh", fields: { Instructor: "Camila M." } }),
    cls("Barre", { location: "Achrafieh", fields: { Instructor: "Rita K." } }),
    cls("Reformer", { location: "Jounieh", fields: { Instructor: "Camila M." } }),
  ]
  const titles = (chosen) => applyFilters(classes, chosen).map((s) => s.title)
  assert.deepEqual(titles({ "field:instructor": "Camila M." }), ["Mat Flow", "Reformer"])
  assert.deepEqual(titles({ "field:instructor": "Camila M.", location: "Jounieh" }), ["Reformer"])
  assert.deepEqual(titles({ location: "" }), ["Mat Flow", "Barre", "Reformer"])
})

test("search: a value written in the description finds its classes", () => {
  const classes = [cls("Mat Flow", { fields: { Instructor: "Camila M." } }), cls("Barre", { fields: { Instructor: "Rita K." } })]
  assert.deepEqual(findClasses(classes, "camila").map((f) => f.session.title), ["Mat Flow"])
})

test("phones shown in readable groups with the client's country code; others as typed", () => {
  assert.equal(readablePhone("+96170123456", "961"), "+961 70 123 456")
  assert.equal(readablePhone("03 123 456", "961"), "+961 3 123 456")
  assert.equal(readablePhone("0096176543210", "961"), "+961 76 543 210")
  assert.equal(readablePhone("+44 7700 900123", "961"), "+44 7700 900123")
  assert.equal(readablePhone(" 70123456 ", ""), "70123456")
})

test("search: a phone number however it's typed — spaces, +961, or a leading 0", () => {
  const local = { ...person("Sara"), phone: "70123456" }               // stored as typed, no country code
  const intl = { ...person("Rana"), phone: "+96103123456" }
  const classes = [cls("Mat Flow", { bookings: [local] }), cls("Barre", { bookings: [intl] })]
  const who = (q) => findClasses(classes, q, "961").flatMap((f) => f.people.map((b) => b.name))
  assert.deepEqual(who("70123"), ["Sara"])
  assert.deepEqual(who("+961 70 123"), ["Sara"])
  assert.deepEqual(who("96170123"), ["Sara"])
  assert.deepEqual(who("070 123"), ["Sara"])
  assert.deepEqual(who("03 123 456"), ["Rana"])
  assert.deepEqual(who("+961 3 123"), ["Rana"])
})

test("rebooked: the same number on another class still to come; not a cancelled or past one", () => {
  const now = new Date("2026-10-04T08:00:00Z")
  const sara = { ...person("Sara"), phone: "+961 70 123 456" }
  const at = (iso) => ({ starts_at: iso, ends_at: iso })
  const cancelled = cls("Mat Flow", { ...at("2026-10-05T09:00:00Z"), cancelled_at: "2026-10-03T00:00:00Z", bookings: [sara] })
  const later = cls("Barre", { ...at("2026-10-08T09:00:00Z"), bookings: [{ ...sara, id: "s2", phone: "+96170123456" }] })
  const sooner = cls("Reformer", { ...at("2026-10-06T09:00:00Z"), bookings: [{ ...sara, id: "s3" }] })
  const gone = cls("Yin", { ...at("2026-10-05T18:00:00Z"), cancelled_at: "2026-10-03T00:00:00Z", bookings: [{ ...sara, id: "s4" }] })
  const past = cls("Strength", { ...at("2026-10-03T09:00:00Z"), bookings: [{ ...sara, id: "s5" }] })
  assert.equal(rebookedOn(sara, cancelled, [cancelled, later, sooner, gone, past], now)?.title, "Reformer")
  assert.equal(rebookedOn(sara, cancelled, [cancelled, gone, past], now), null)
})

test("a setup problem comes with its fix, in the client's own label", () => {
  assert.equal(fixHint('No "Places" line in the description'), 'Add a line like "Places: 10" to the event\'s description in Google Calendar.')
  assert.equal(fixHint('"Capacity" says "ten", which isn\'t a number'), 'Write a number on the "Capacity" line, like "Capacity: 10", in Google Calendar.')
  assert.equal(fixHint("No number of places set for this calendar"), "Ask your website team to set a number of places for this calendar.")
  assert.equal(fixHint("Something else"), "Fix it in Google Calendar.")
})

test("next class: today's first class under way, else the next; not over, cancelled, hidden or tomorrow", () => {
  const now = new Date("2026-10-04T10:30:00Z")
  const at = (start, end) => ({ starts_at: start, ends_at: end })
  const dayOf = (iso) => iso.slice(0, 10)
  const over = cls("Early", at("2026-10-04T08:00:00Z", "2026-10-04T09:00:00Z"))
  const going = cls("Going", at("2026-10-04T10:00:00Z", "2026-10-04T11:00:00Z"))
  const later = cls("Later", at("2026-10-04T18:00:00Z", "2026-10-04T19:00:00Z"))
  const gone = cls("Gone", { ...at("2026-10-04T12:00:00Z", "2026-10-04T13:00:00Z"), cancelled_at: "2026-10-03T00:00:00Z" })
  const hidden = cls("Hidden", { ...at("2026-10-04T12:00:00Z", "2026-10-04T13:00:00Z"), problem: "No places" })
  const tomorrow = cls("Tomorrow", at("2026-10-05T09:00:00Z", "2026-10-05T10:00:00Z"))
  assert.equal(nextClass([later, over, going, gone, hidden, tomorrow], now, "2026-10-04", dayOf)?.title, "Going")
  assert.equal(nextClass([later, over, gone, hidden, tomorrow], now, "2026-10-04", dayOf)?.title, "Later")
  assert.equal(nextClass([over, gone, hidden, tomorrow], now, "2026-10-04", dayOf), null)
})

test("starts in: minutes under an hour, then hours; null once started", () => {
  const now = new Date("2026-10-04T10:00:00Z")
  assert.equal(startsIn("2026-10-04T10:25:00Z", now), "in 25 min")
  assert.equal(startsIn("2026-10-04T12:00:00Z", now), "in 2 h")
  assert.equal(startsIn("2026-10-04T10:00:00Z", now), null)
})

test("classes to move to: coming up, on the site, with room, not this one or one they're on", () => {
  const now = new Date("2026-10-04T08:00:00Z")
  const sara = { ...person("Sara"), phone: "+961 70 123 456" }
  const at = (iso) => ({ starts_at: iso, ends_at: iso })
  const from = cls("Mat Flow", { ...at("2026-10-05T09:00:00Z"), bookings: [sara] })
  const open = cls("Barre", at("2026-10-06T09:00:00Z"))
  const full = cls("Yin", { ...at("2026-10-06T18:00:00Z"), places: 1, bookings: [person("Rana")] })
  const theirs = cls("Reformer", { ...at("2026-10-07T09:00:00Z"), bookings: [{ ...sara, id: "s2", phone: "+96170123456" }] })
  const past = cls("Strength", at("2026-10-03T09:00:00Z"))
  const hidden = cls("Barre 2", { ...at("2026-10-08T09:00:00Z"), problem: "No places" })
  const gone = cls("Pilates", { ...at("2026-10-08T10:00:00Z"), cancelled_at: "2026-10-03T00:00:00Z" })
  const unlimited = cls("Open", { ...at("2026-10-09T09:00:00Z"), places: null })
  const titles = classesToMoveTo(sara, from, [from, open, full, theirs, past, hidden, gone, unlimited], now).map((s) => s.title)
  assert.deepEqual(titles, ["Barre", "Open"])
})
