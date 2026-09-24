// calendar-sync — copies a client's Google Calendar into the sessions table.
//
// Called with the SYNC_TOKEN setting in an "x-sync-token" header. For now it's run by hand;
// the 10-minute timer and Google's webhook will call it the same way.
//
// Settings (in the client's Supabase project):
//   GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID,
//   BOOKING_DETAILS, BOOKING_PLACES_FIELD, BOOKING_PLACES_DEFAULT  — see BOOKING-DESIGN.md
//   SYNC_TOKEN — a long random value; only callers who know it can run a sync
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { getAccessToken, getEvent, isTimedEvent, listEvents, type ServiceAccountKey } from "./google.ts"
import { readSettings, toSession, type SessionRow } from "./sessions.ts"

const DAY = 24 * 60 * 60 * 1000

Deno.serve(async (req) => {
  if (!authorised(req)) return new Response("Forbidden", { status: 403 })

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  // Only one sync at a time. If another is running, this one steps aside.
  const { data: started, error } = await db.rpc("begin_sync")
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  if (!started) return Response.json({ ok: true, skipped: "another sync is already running" })

  try {
    return Response.json({ ok: true, ...(await sync(db)) })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Record the failure for the dashboard. Sessions are left exactly as they were.
    await db.rpc("fail_sync", { p_error: message })
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
})

async function sync(db: SupabaseClient) {
  const settings = readSettings((name) => Deno.env.get(name))
  const key = JSON.parse(setting("GOOGLE_SERVICE_ACCOUNT_KEY")) as ServiceAccountKey
  const calendarId = setting("GOOGLE_CALENDAR_ID")

  // ① About a week back and two weeks ahead: this week and next, whatever day it is.
  const from = new Date(Date.now() - 8 * DAY)
  const to = new Date(Date.now() + 15 * DAY)

  // ② Every page from Google. Any failure throws before anything is written.
  const token = await getAccessToken(key)
  const { timeZone, items } = await listEvents(token, calendarId, from, to)

  // ③ Sessions only (no all-day events), read with this client's settings.
  const sessions = new Map<string, SessionRow>()
  for (const e of items.filter(isTimedEvent)) sessions.set(e.id, toSession(e, settings))

  // ⑤ Sessions we hold as running in this window that Google didn't return.
  const { data: held, error } = await db
    .from("sessions")
    .select("google_event_id")
    .is("cancelled_at", null)
    .gt("ends_at", from.toISOString())     // the same window rule Google uses:
    .lt("starts_at", to.toISOString())     // ends after `from`, starts before `to`
  if (error) throw new Error(`Couldn't read sessions: ${error.message}`)

  const cancelled: string[] = []
  for (const { google_event_id: id } of held ?? []) {
    if (sessions.has(id)) continue
    // Check with Google before calling it cancelled: it may have moved beyond the window.
    const event = await getEvent(token, calendarId, id)
    if (event && isTimedEvent(event)) sessions.set(id, toSession(event, settings))
    else cancelled.push(id)
  }

  // ④ + ⑥ All changes in one go. apply_sync also records success and releases the lock.
  const { data: counts, error: applyError } = await db.rpc("apply_sync", {
    p_sessions: [...sessions.values()],
    p_cancelled: cancelled,
    p_time_zone: timeZone,
  })
  if (applyError) throw new Error(`Couldn't save the sync: ${applyError.message}`)
  return { timeZone, ...counts }
}

// A required setting, or a clear error naming the missing one.
function setting(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`The ${name} setting is missing`)
  return value
}

function authorised(req: Request): boolean {
  const expected = Deno.env.get("SYNC_TOKEN")
  if (!expected) return false            // no token set → nobody can run a sync
  return sameText(req.headers.get("x-sync-token") ?? "", expected)
}

// Compares two strings without revealing, through timing, how much of them matched.
function sameText(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}
