// sessions.ts — turning a Google Calendar event into a session row,
// using the client's settings.
//
// No network and no Deno APIs here, so the tests can load it directly.
// Descriptions are read one "Label: value" per line; only the labels in the
// client's settings are ever read, so private notes stay in Google Calendar.

import type { GoogleEvent } from "./google.ts"

export interface BookingSettings {
  details: string[]                           // lines shown to visitors
  placesField: string | null                  // the line holding the number of places
  placesDefault: number | "unlimited" | null  // when that line is missing; null = flag it
}

export interface SessionRow {
  google_event_id: string
  title: string
  starts_at: string
  ends_at: string
  location: string | null
  places: number | null            // null = unlimited (when there's no problem)
  details: Record<string, string>
  problem: string | null           // set = can't be booked; the reason
}

// `get` looks a setting up by name. The sync passes Deno.env.get; tests pass their own.
export function readSettings(get: (name: string) => string | undefined): BookingSettings {
  const details = (get("BOOKING_DETAILS") ?? "")
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean)

  const placesField = get("BOOKING_PLACES_FIELD")?.trim() || null

  const raw = (get("BOOKING_PLACES_DEFAULT") ?? "").trim().toLowerCase()
  let placesDefault: number | "unlimited" | null = null
  if (raw === "unlimited") placesDefault = "unlimited"
  else if (/^\d+$/.test(raw)) placesDefault = Number(raw)
  else if (raw !== "") {
    throw new Error(`BOOKING_PLACES_DEFAULT must be a number or "unlimited", not "${raw}"`)
  }

  return { details, placesField, placesDefault }
}

export function toSession(e: GoogleEvent, s: BookingSettings): SessionRow {
  const text = descriptionText(e.description)

  const details: Record<string, string> = {}
  for (const label of s.details) {
    const value = readField(text, label)
    if (value !== null) details[label] = value
  }

  const { places, problem } = resolvePlaces(text, s)

  return {
    google_event_id: e.id,
    title: e.summary?.trim() || "(untitled)",
    starts_at: e.start!.dateTime!,
    ends_at: e.end!.dateTime!,
    location: e.location ?? null,
    places: places === "unlimited" ? null : places,   // in the database, null = unlimited
    details,
    problem,
  }
}

// Turn Google's HTML description into plain text, keeping line breaks.
export function descriptionText(description?: string): string {
  if (!description) return ""
  return description
    .replace(/<br\s*\/?>/gi, "\n")           // <br> → a real line break
    .replace(/<\/(p|div|li)>/gi, "\n")       // end of a paragraph → a line break
    .replace(/<[^>]+>/g, "")                 // drop any other tag (<b>, <span>…)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
}

// Find a line starting with `label` and return what follows it.
// "Capacity: 6", "Capacity 6", "capacity=6", "Places : 8" all work.
// The label must start the line and end there, so "Guide" never matches "Guidelines:".
export function readField(text: string, label: string): string | null {
  const pattern = new RegExp(
    `^[ \\t]*${escapeRegex(label)}(?=[\\s:=]|$)[ \\t]*[:=]?[ \\t]*(.*)$`,
    "imu",
  )
  const value = text.match(pattern)?.[1].trim()
  return value ? value : null
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// The number written in the event, else the client's default, else flag it.
export function resolvePlaces(text: string, s: BookingSettings) {
  if (s.placesField) {
    const value = readField(text, s.placesField)
    if (value !== null) {
      const number = value.match(/^\d+/)
      return number
        ? { places: Number(number[0]), problem: null }
        : { places: null, problem: `"${s.placesField}" says "${value}", which isn't a number` }
    }
  }
  if (s.placesDefault !== null) return { places: s.placesDefault, problem: null }
  return {
    places: null,
    problem: s.placesField
      ? `No "${s.placesField}" line in the description`
      : "No number of places set for this calendar",
  }
}
