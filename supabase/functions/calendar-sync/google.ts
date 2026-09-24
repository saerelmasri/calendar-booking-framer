// google.ts — talking to Google Calendar: sign in as the service account,
// and read events.

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  private_key_id: string
  token_uri: string
}

export interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

const API = "https://www.googleapis.com/calendar/v3"
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly"

// ---------- signing in: prove who we are, get a one-hour pass ----------

export async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: "RS256", typ: "JWT", kid: key.private_key_id }
  const claims = {
    iss: key.client_email,   // "I am calendar-reader@…"
    scope: SCOPE,            // "I want to read calendars"
    aud: key.token_uri,      // "addressed to Google's token service"
    iat: now,
    exp: now + 3600,         // "valid for one hour"
  }

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  const signature = await sign(unsigned, key.private_key)

  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  })
  if (!res.ok) throw new Error(`Google refused the key (${res.status}): ${await res.text()}`)
  return (await res.json()).access_token
}

async function sign(data: string, pem: string): Promise<string> {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  )
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(data))
  return b64url(new Uint8Array(sig))
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// ---------- reading events ----------

// Every event between two moments, across all pages. Throws on any failure,
// so a partial answer can never be mistaken for "these events were deleted".
// No timeZone is sent on purpose: Google then answers in the calendar's own timezone.
export async function listEvents(token: string, calendarId: string, from: Date, to: Date) {
  const items: GoogleEvent[] = []
  let timeZone = ""
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",    // expand "every Monday" into separate dated sessions
      orderBy: "startTime",
      maxResults: "250",
    })
    if (pageToken) qs.set("pageToken", pageToken)
    const res = await fetch(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Google calendar request failed (${res.status}): ${await res.text()}`)
    const page = await res.json()
    timeZone = page.timeZone
    items.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return { timeZone, items }
}

// One event by its ID. Returns null if it has been deleted. A single deleted week of a
// recurring class comes back marked "cancelled" rather than "not found", so both count.
export async function getEvent(token: string, calendarId: string, eventId: string) {
  const res = await fetch(
    `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (res.status === 404 || res.status === 410) return null
  if (!res.ok) throw new Error(`Google event request failed (${res.status}): ${await res.text()}`)
  const event: GoogleEvent = await res.json()
  return event.status === "cancelled" ? null : event
}

// All-day events (closures, holidays) have a date but no time. They're never sessions.
export function isTimedEvent(e: GoogleEvent): boolean {
  return Boolean(e.start?.dateTime)
}
