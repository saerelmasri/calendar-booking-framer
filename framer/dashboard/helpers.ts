// helpers.ts — small helpers the screens share: the address of each section, "3 min
// ago", first names, the language, and what to say when the database refuses something.

import { type Route } from "./types.ts"

export function readRoute(hash: string): Route {
  const [key, id] = hash.replace(/^#/, "").split("=")
  if (key === "attention") return { section: "attention", id: id ? decodeURIComponent(id) : null }
  if (key === "class" && id) return { section: "classes", id: decodeURIComponent(id) }
  return { section: "classes", id: null }
}

export function writeRoute(route: Route): string {
  if (route.section === "attention") return route.id ? `attention=${encodeURIComponent(route.id)}` : "attention"
  return route.id ? `class=${encodeURIComponent(route.id)}` : ""
}

// How long ago the bookings were loaded: "just now", "3 min ago", "1 h ago".
export function ago(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`
}

// "Sara Haddad" → "Sara", for buttons that name who they act on.
export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

// A language the browser doesn't know (a typo in the settings) falls back to English.
export function safeLanguage(language: string): string {
  try {
    new Intl.DateTimeFormat(language)
    return language
  } catch {
    return "en"
  }
}

// What to tell the owner when the database refuses an action.
export const REFUSALS: Record<string, string> = {
  full: "This class is full. Use Replace to swap someone in.",
  already_booked: "That phone number is already booked on this class.",
  invalid_name: "Please enter a name.",
  invalid_phone: "Please enter a valid phone number.",
  unavailable: "This class can't take bookings (it's cancelled or hidden from the site).",
  not_found: "That booking no longer exists. The list has been refreshed.",
}
