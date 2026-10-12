// server.ts — talking to Supabase: logging in and out, refreshing the login, calling the
// owner_* functions, and remembering the login on this device.

import { type Auth } from "./types.ts"

export function makeServer(url: string, key: string) {
  const base = url.replace(/\/+$/, "")

  async function token(grant: string, body: Record<string, string>) {
    const response = await fetch(`${base}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(response.status === 400 ? "wrong" : "unreachable")
    const j = await response.json()
    return {
      access_token: j.access_token as string,
      refresh_token: j.refresh_token as string,
      expires_at: (j.expires_at ?? Math.floor(Date.now() / 1000) + j.expires_in) as number,
    }
  }

  return {
    logIn: (email: string, password: string) => token("password", { email, password }),
    refresh: (refresh_token: string) => token("refresh_token", { refresh_token }),
    logout: (access: string) => fetch(`${base}/auth/v1/logout`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${access}` } }).catch(() => undefined),

    // The database refuses anyone off the owners list with code 42501; any other refusal
    // means the login has run out.
    async rpc(name: string, args: Record<string, unknown>, access: string) {
      const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: key, Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      })
      const body = await response.json().catch(() => null)
      if (response.status === 401 || response.status === 403) {
        return { status: body?.code === "42501" ? "not_owner" : "expired", body: null }
      }
      if (!response.ok) throw new Error(`Supabase answered ${response.status}`)
      return { status: "ok", body }
    },
  }
}

// A remembered login lives in localStorage until its day count runs out; an unremembered
// one in sessionStorage, which the browser empties when it closes.
export function storageKey(url: string) {
  return `booking-dashboard:${url}`
}

export function readSaved(url: string): Auth | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(url)) ?? window.localStorage.getItem(storageKey(url))
    if (!raw) return null
    const a = JSON.parse(raw) as Auth
    if (a.rememberUntil !== null && a.rememberUntil < Date.now() / 1000) {
      save(url, null)                                         // remembered long enough: ask again
      return null
    }
    return a
  } catch {
    return null
  }
}

export function save(url: string, a: Auth | null) {
  try {
    window.localStorage.removeItem(storageKey(url))
    window.sessionStorage.removeItem(storageKey(url))
    if (a) (a.rememberUntil === null ? window.sessionStorage : window.localStorage).setItem(storageKey(url), JSON.stringify(a))
  } catch {
    // private browsing: the owner just logs in again next time
  }
}
