// sample.ts — made-up classes for Framer's canvas, so the dashboard can be designed
// without logging in.

import { type OwnerSession } from "./logic.ts"
import { type Data } from "./types.ts"

// Made-up data for Framer's canvas, so the dashboard can be designed without logging in.
export function sample(): Data {
  const at = (days: number, hour: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + days)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  const people = (names: string[]) => names.map((name, i) => ({ id: name, name, phone: `+96170000${100 + i}`, created_at: at(-1, 9), told_at: null }))
  const cls = (id: string, title: string, days: number, hour: number, places: number | null, names: string[], extra: Partial<OwnerSession> = {}): OwnerSession => ({
    id, title, starts_at: at(days, hour), ends_at: at(days, hour + 1), location: "Achrafieh, Beirut", details: { Instructor: "Camila M." }, fields: { Instructor: "Camila M.", Level: "All levels" },
    places, problem: null, cancelled_at: null, moved_from: null, bookings: people(names), ...extra,
  })
  const many = ["Sara Haddad", "Maya Khoury", "Rana Saad", "Lina Aoun", "Nour Karam", "Joelle Haddad", "Tala Daher"]
  return {
    timeZone: "UTC",
    lastSync: new Date().toISOString(),
    sessions: [
      cls("a", "Reformer Foundations", 0, 22, 10, many),
      cls("b", "Mat Flow", 1, 9, 3, many.slice(0, 3), { fields: { Instructor: "Rita K.", Level: "Beginner" } }),
      cls("c", "Candlelit Yin", 1, 19, 8, ["Tala Daher"], { moved_from: at(1, 17) }),
      cls("d", "Barre Basics", 2, 10, null, [], { problem: 'No "Capacity" line in the description.' }),
      cls("e", "Strength", 3, 18, 10, ["Karim Nassar", "Rami Haddad"], { cancelled_at: at(-1, 9) }),
      cls("f", "Reformer Foundations", 4, 11, 10, many.slice(2, 6)),
    ],
  }
}
