// Dashboard.tsx — the owner's dashboard, on a hidden page of the client's Framer site.
//
// The owner logs in with email and password (Supabase's sign-in). Everything shown or
// changed goes through the owner_* database functions, which refuse anyone who isn't on
// the owners list. What needs attention and how full a class is are worked out in
// dashboard.ts; dates and times in month.ts. Both have the tests.
//
// Three sections: Classes (this week), one class's details, and Needs attention. On a
// desktop (Layout "Desktop") the dashboard fills the window: a tinted sidebar fixed to the
// full height, then one surface with the list and the details side by side, each
// scrolling on its own. On a phone (Layout "Phone", set on the phone breakpoint) they're
// separate screens. Each has its own address (#class=…, #attention), so the browser's back
// button moves between them.
//
// Framer code files can't import each other, so in Framer this file, dashboard.ts and
// month.ts are one code file: the two files pasted in place of the imports below.

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { addDays, calendarDay, dayLabel, readableText, timeOf, whatsappLink } from "./month.ts"
import { fullness, needsAttention, ownerClasses, wasMoved, type Attention, type Booking, type OwnerSession } from "./dashboard.ts"

interface Props {
  supabaseUrl: string
  publicKey: string
  studioName: string
  rememberDays: number
  layout: "desktop" | "phone"
  language: string
  mainColour: string
  textColour: string
  mutedColour: string
  lineColour: string
  cardColour: string
  buttonColour: string
  buttonTextColour: string
  dangerColour: string
  warningColour: string
  titleFont: CSSProperties
  textFont: CSSProperties
  style?: CSSProperties
}

// expires_at: when Supabase's token runs out (it's refreshed); rememberUntil: when this
// device stops being remembered (null = only until the browser closes). Both in seconds.
type Auth = { access_token: string; refresh_token: string; expires_at: number; rememberUntil: number | null }
type Data = { timeZone: string; lastSync: string | null; sessions: OwnerSession[] }
type Screen = "checking" | "login" | "loading" | "ready" | "not_owner" | "error"

// Where the owner is: a section, and the class open in it (if any).
type Route = { section: "classes" | "attention"; id: string | null }

const BOARD_DAYS = 7          // the class list: today and the next 6 days
const LOOK_AHEAD = 32        // needs attention: the whole month the sync keeps

/**
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight auto
 */
export default function Dashboard(props: Props) {
  const inEditor = useIsStaticRenderer()                 // Framer's canvas: made-up data
  const [screen, setScreen] = useState<Screen>("checking")
  const [auth, setAuth] = useState<Auth | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)            // when the bookings were last loaded
  const [route, setRoute] = useState<Route>({ section: "classes", id: null })
  const server = makeServer(props.supabaseUrl, props.publicKey)

  // On opening: pick up a remembered login, if there is one.
  useEffect(() => {
    if (inEditor) return
    const saved = readSaved(props.supabaseUrl)
    if (saved) { setAuth(saved); setScreen("loading") } else setScreen("login")
  }, [inEditor, props.supabaseUrl])

  // The address decides the section, so the back button works.
  useEffect(() => {
    if (inEditor) return
    const follow = () => setRoute(readRoute(window.location.hash))
    follow()
    window.addEventListener("hashchange", follow)
    return () => window.removeEventListener("hashchange", follow)
  }, [inEditor])

  function go(to: Route) {
    if (inEditor) { setRoute(to); return }
    window.location.hash = writeRoute(to)
  }

  // Logged in: load the dashboard.
  useEffect(() => {
    if (screen === "loading" && auth) void reload(auth)
  }, [screen, auth])

  // Coming back to the page (switching tabs, unlocking the phone): reload if older than a
  // minute. While it stays open, every 5 minutes. A booking made on the website shows up
  // without anyone pressing Refresh.
  useEffect(() => {
    if (inEditor || screen !== "ready") return
    const stale = () => document.visibilityState === "visible" && Date.now() - loadedAt > 60_000
    const onReturn = () => { if (stale()) void reload() }
    document.addEventListener("visibilitychange", onReturn)
    window.addEventListener("focus", onReturn)
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void reload() }, 5 * 60_000)
    return () => {
      document.removeEventListener("visibilitychange", onReturn)
      window.removeEventListener("focus", onReturn)
      window.clearInterval(timer)
    }
  }, [inEditor, screen, loadedAt])

  // Every call goes through here: refresh the login if it's about to expire, and turn the
  // database's answers into what the screen should do.
  async function call<T>(name: string, args: Record<string, unknown>, current = auth): Promise<T> {
    if (!current) throw new Error("not logged in")
    let a = current
    if (a.expires_at - 60 < Date.now() / 1000) {
      const fresh = await server.refresh(a.refresh_token).catch(() => { logOut(); throw new Error("expired") })
      a = { ...fresh, rememberUntil: a.rememberUntil }
      keep(a)
    }
    const answer = await server.rpc(name, args, a.access_token)
    if (answer.status === "not_owner") { setScreen("not_owner"); throw new Error("not an owner") }
    if (answer.status === "expired") { logOut(); throw new Error("expired") }
    return answer.body as T
  }

  async function reload(current = auth) {
    try {
      const now = new Date()
      const result = await call<{ time_zone: string; last_sync: string | null; sessions: OwnerSession[] }>(
        "owner_sessions",
        { p_from: new Date(now.getTime() - 86400000).toISOString(), p_to: new Date(now.getTime() + LOOK_AHEAD * 86400000).toISOString() },
        current,
      )
      setData({ timeZone: result.time_zone, lastSync: result.last_sync, sessions: result.sessions })
      setLoadedAt(Date.now())
      setScreen("ready")
    } catch (e) {
      if ((e as Error).message === "not an owner" || (e as Error).message === "expired") return
      setScreen("error")
    }
  }

  function keep(a: Auth) {
    setAuth(a)
    save(props.supabaseUrl, a)
  }

  function logOut() {
    if (auth) void server.logout(auth.access_token)
    save(props.supabaseUrl, null)
    setAuth(null)
    setData(null)
    setScreen("login")
  }

  async function logIn(email: string, password: string, remember: boolean) {
    const days = Math.max(1, props.rememberDays ?? 30)
    const a = await server.logIn(email, password)
    keep({ ...a, rememberUntil: remember ? Math.floor(Date.now() / 1000) + days * 86400 : null })
    setScreen("loading")
  }

  const look = styles(props)
  const shown = inEditor ? sample() : data

  let body: ReactNode
  if (inEditor || (screen === "ready" && shown)) {
    body = <Board data={shown!} loadedAt={inEditor ? Date.now() : loadedAt} props={props} look={look} call={call} reload={() => reload()} logOut={logOut} route={route} go={go} />
  } else if (screen === "login") {
    body = <Centred look={look}><Login props={props} look={look} logIn={logIn} /></Centred>
  } else if (screen === "loading") {
    body = <Skeleton look={look} />
  } else if (screen === "not_owner") {
    body = <Centred look={look}><Message props={props} look={look} text="This account can't see the bookings for this site." action="Log out" onAction={logOut} /></Centred>
  } else if (screen === "error") {
    body = <Centred look={look}><Message props={props} look={look} text="The bookings can't be loaded right now." action="Try again" onAction={() => setScreen("loading")} /></Centred>
  } else {
    body = null                                               // a moment while checking for a saved login
  }

  return (
    <div className="bd" style={look.root}>
      <style>{css(props)}</style>
      {body}
    </div>
  )
}

function readRoute(hash: string): Route {
  const [key, id] = hash.replace(/^#/, "").split("=")
  if (key === "attention") return { section: "attention", id: id ? decodeURIComponent(id) : null }
  if (key === "class" && id) return { section: "classes", id: decodeURIComponent(id) }
  return { section: "classes", id: null }
}

function writeRoute(route: Route): string {
  if (route.section === "attention") return route.id ? `attention=${encodeURIComponent(route.id)}` : "attention"
  return route.id ? `class=${encodeURIComponent(route.id)}` : ""
}

// ------------------------------------------------------------------
//  Talking to Supabase
// ------------------------------------------------------------------

function makeServer(url: string, key: string) {
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
function storageKey(url: string) {
  return `booking-dashboard:${url}`
}

function readSaved(url: string): Auth | null {
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

function save(url: string, a: Auth | null) {
  try {
    window.localStorage.removeItem(storageKey(url))
    window.sessionStorage.removeItem(storageKey(url))
    if (a) (a.rememberUntil === null ? window.sessionStorage : window.localStorage).setItem(storageKey(url), JSON.stringify(a))
  } catch {
    // private browsing: the owner just logs in again next time
  }
}

// ------------------------------------------------------------------
//  Log in, loading, messages
// ------------------------------------------------------------------

function Centred({ look, children }: { look: Look; children: ReactNode }) {
  return <div style={look.centred}>{children}</div>
}

function Login({ props, look, logIn }: { props: Props; look: Look; logIn: (email: string, password: string, remember: boolean) => Promise<void> }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const days = Math.max(1, props.rememberDays ?? 30)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await logIn(email.trim(), password, remember)
    } catch (err) {
      setError((err as Error).message === "wrong" ? "Wrong email or password." : "Couldn't reach the server. Please try again.")
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="bd-fade" style={look.loginCard}>
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <h1 style={{ ...look.title, fontSize: "2.2em" }}>{props.studioName || "Bookings"}</h1>
        <div style={look.muted}>Bookings</div>
      </div>
      <label>
        Email
        <input className="bd-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required disabled={busy} style={look.input} />
      </label>
      <label>
        Password
        <input className="bd-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required disabled={busy} style={look.input} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={busy} style={{ accentColor: props.mainColour, width: 16, height: 16 }} />
        Remember this device for {days} {days === 1 ? "day" : "days"}
      </label>
      {error && <div role="alert" style={look.alert}>{error}</div>}
      <button className="bd-btn" type="submit" disabled={busy} style={{ ...look.button, width: "100%", padding: "12px 16px" }}>
        {busy ? <><span className="bd-spinner" aria-hidden="true" />Logging in…</> : "Log in"}
      </button>
    </form>
  )
}

function Message({ props, look, text, action, onAction }: { props: Props; look: Look; text: string; action: string; onAction: () => void }) {
  return (
    <div className="bd-fade" style={{ ...look.loginCard, alignItems: "center", textAlign: "center" }}>
      <h1 style={{ ...look.title, fontSize: "2.2em" }}>{props.studioName || "Bookings"}</h1>
      <div>{text}</div>
      <button className="bd-btn" type="button" onClick={onAction} style={look.button}>{action}</button>
    </div>
  )
}

// While the bookings load: the dashboard's shape, softly shimmering.
function Skeleton({ look }: { look: Look }) {
  const bar = (width: number | string, height: number, extra: CSSProperties = {}) => (
    <div className="bd-skeleton" style={{ width, height, ...extra }} />
  )
  const rows = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>{bar("100%", 52)}</div>)
  if (!look.isDesktop) {
    return (
      <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bar(140, 34)}
        {bar("60%", 36)}
        {rows(5)}
      </div>
    )
  }
  return (
    <div aria-busy="true" aria-label="Loading" style={look.app}>
      <div style={look.sidebar}>
        {bar(120, 34, { marginBottom: 24 })}
        {bar("100%", 40)}
        {bar("100%", 40)}
      </div>
      <div style={look.surface}>
        <div style={{ ...look.listColumn, display: "flex", flexDirection: "column", gap: 10 }}>
          {bar(110, 14)}
          {rows(3)}
          {bar(110, 14, { marginTop: 12 })}
          {rows(2)}
        </div>
        <div style={{ ...look.detailColumn, display: "flex", flexDirection: "column", gap: 12 }}>
          {bar("50%", 34)}
          {bar("70%", 16)}
          {rows(4)}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
//  The board: Classes, a class's details, and Needs attention
// ------------------------------------------------------------------

type Call = <T>(name: string, args: Record<string, unknown>) => Promise<T>
type When = (iso: string) => string

function Board({ data, loadedAt, props, look, call, reload, logOut, route, go }: {
  data: Data; loadedAt: number; props: Props; look: Look; call: Call; reload: () => Promise<void>; logOut: () => void
  route: Route; go: (to: Route) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  // Re-draw every 30 seconds so "Updated 3 min ago" stays true.
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const now = new Date()
  const tz = data.timeZone
  const language = safeLanguage(props.language)
  const today = calendarDay(now, tz)
  const attention = needsAttention(data.sessions, data.lastSync, now)
  const urgent = attention.some((a) => a.kind !== "moved")     // anything that needs action, not just telling
  const when: When = (iso) => `${dayLabel(calendarDay(new Date(iso), tz), language)} · ${timeOf(new Date(iso), tz)}`

  async function refresh() {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  // This week's classes, grouped by day
  const lastDay = addDays(today, BOARD_DAYS - 1)
  const week: [string, OwnerSession[]][] = []
  for (const s of ownerClasses(data.sessions, now)) {
    const day = calendarDay(new Date(s.starts_at), tz)
    if (day > lastDay) continue
    const group = week.find(([d]) => d === day)
    if (group) group[1].push(s)
    else week.push([day, [s]])
  }
  const dayName = (day: string) =>
    day === today ? `Today · ${dayLabel(day, language)}` : day === addDays(today, 1) ? `Tomorrow · ${dayLabel(day, language)}` : dayLabel(day, language)

  // What's open. On a desktop the first class is shown when none is picked.
  const byId = new Map(data.sessions.map((s) => [s.id, s]))
  const firstClass = week[0]?.[1][0]
  const openClass = route.section === "classes"
    ? (route.id ? byId.get(route.id) : look.isDesktop ? firstClass : undefined)
    : undefined
  const openItem = route.section === "attention" && route.id
    ? attention.find((a) => a.kind !== "sync" && a.session.id === route.id)
    : undefined

  const list = route.section === "classes"
    ? <WeekList week={week} dayName={dayName} look={look} tz={tz} selected={openClass?.id} pick={(id) => go({ section: "classes", id })} />
    : <AttentionList attention={attention} look={look} when={when} selected={route.id} pick={(id) => go({ section: "attention", id })} />

  const detail = openClass
    ? <ClassDetail key={openClass.id} session={openClass} look={look} when={when} call={call} reload={reload} />
    : openItem && openItem.kind !== "sync"
      ? <AttentionDetail key={openItem.session.id} item={openItem} look={look} when={when} />
      : <p style={{ ...look.muted, marginTop: 8 }}>{route.section === "classes" ? "Pick a class to see who's coming." : "Pick an item to see the details."}</p>

  const sections = (
    <>
      <button className="bd-tab" type="button" onClick={() => go({ section: "classes", id: null })}
        aria-current={route.section === "classes" ? "page" : undefined} style={look.tab(route.section === "classes")}>Classes</button>
      <button className="bd-tab" type="button" onClick={() => go({ section: "attention", id: null })}
        aria-current={route.section === "attention" ? "page" : undefined}
        aria-label={`Needs attention, ${attention.length} ${attention.length === 1 ? "item" : "items"}`}
        style={look.tab(route.section === "attention")}>
        Needs attention{attention.length > 0 && <span style={look.badge(urgent)} aria-hidden="true">{attention.length}</span>}
      </button>
    </>
  )
  const syncItem = attention.find((a) => a.kind === "sync")
  const banner = syncItem ? <SyncBanner item={syncItem} look={look} when={when} /> : null
  const refreshButton = (
    <button className="bd-refresh" type="button" onClick={() => void refresh()} disabled={refreshing} style={look.refresh}>
      {refreshing ? <><span className="bd-spinner" aria-hidden="true" />Refreshing…</> : "Refresh"}
    </button>
  )
  const updated = <div style={look.updated}>Updated {ago(loadedAt)}</div>
  const logOutButton = <button className="bd-logout" type="button" onClick={logOut} style={look.logout}>Log out</button>

  // ── Desktop: a tinted sidebar fixed to the full height, then the list and the details
  if (look.isDesktop) {
    return (
      <div className="bd-fade" style={look.app}>
        <nav style={look.sidebar}>
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ ...look.title, fontSize: "1.9em" }}>{props.studioName || "Bookings"}</h1>
            <div style={look.muted}>Bookings</div>
          </div>
          {sections}
          <div style={{ flex: 1 }} />
          {refreshButton}
          {updated}
          {logOutButton}
        </nav>
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
          {banner}
          <div style={{ ...look.surface, flex: 1, height: "auto" }}>
            <div style={look.listColumn}>{list}</div>
            <div style={look.detailColumn}>{detail}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Phone: one screen at a time; an open class or item gets its own screen
  if (route.id && (openClass || openItem)) {
    return (
      <div className="bd-fade" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button className="bd-link" type="button" onClick={() => go({ section: route.section, id: null })} style={{ ...look.link, alignSelf: "flex-start", textDecoration: "none" }}>‹ Back</button>
        {banner}
        <div style={{ ...look.card, padding: 20 }}>{detail}</div>
      </div>
    )
  }
  return (
    <div className="bd-fade" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h1 style={{ ...look.title, flex: 1 }}>{props.studioName || "Bookings"}</h1>
        {refreshButton}
        {logOutButton}
      </div>
      {updated}
      {banner}
      <div style={{ display: "flex", gap: 8 }}>{sections}</div>
      {list}
    </div>
  )
}

// ------------------------------------------------------------------
//  Classes: one compact row per class
// ------------------------------------------------------------------

function WeekList({ week, dayName, look, tz, selected, pick }: {
  week: [string, OwnerSession[]][]; dayName: (day: string) => string; look: Look; tz: string; selected?: string; pick: (id: string) => void
}) {
  if (week.length === 0) return <p style={look.muted}>No classes in the next 7 days.</p>
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {week.map(([day, classes]) => (
        <div key={day} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={look.heading}>{dayName(day)}</h3>
          {classes.map((s) => {
            const { label, full } = fullness(s)
            return (
              <button className="bd-row" key={s.id} type="button" onClick={() => pick(s.id)} aria-current={s.id === selected ? "true" : undefined} style={look.item(s.id === selected)}>
                <span style={{ minWidth: 70, fontWeight: 600 }}>{timeOf(new Date(s.starts_at), tz)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {s.title}
                  {s.problem && <span style={look.warningNote}><WarningIcon colour={look.warningText} /> Hidden from the site</span>}
                  {!s.problem && wasMoved(s) && (
                    <span style={{ ...look.note, display: "flex", alignItems: "center", gap: 6 }}>
                      <ClockIcon colour={look.mutedColour} /> Moved from {timeOf(new Date(s.moved_from!), tz)}
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: 600, color: full ? look.accent : undefined, whiteSpace: "nowrap" }}>{full ? `Full · ${label}` : label}</span>
                <span aria-hidden="true" style={look.muted}>›</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------
//  One class: its people and the owner's actions
// ------------------------------------------------------------------

function ClassDetail({ session: s, look, when, call, reload }: {
  session: OwnerSession; look: Look; when: When; call: Call; reload: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [replacing, setReplacing] = useState<string | null>(null)       // the booking being replaced
  const [removing, setRemoving] = useState<string | null>(null)         // the booking being removed
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)                           // the confirmation
  const [notice, setNotice] = useState<{ at: string; text: string } | null>(null)  // a refusal, and which form it belongs to
  const { label, full } = fullness(s)
  const count = (n: number) => (s.places === null ? `${n} booked` : `${n}/${s.places}`)
  const classWhen = when(s.starts_at)
  const started = Date.parse(s.starts_at) <= Date.now()
  // What happens to the freed spot, said at the moment of choosing.
  const spotNote = s.problem ? "The class is hidden from the site, so the spot won't be offered."
    : started ? "The class has started, so the spot won't be offered on the website."
    : "Their spot opens on the website straight away."

  // One action: ask the database. A refusal is explained under the form it came from; a
  // success is confirmed for 5 seconds. Then everything is loaded again, with the buttons
  // already free.
  async function act(at: string, name: string, args: Record<string, unknown>, success: string) {
    setBusy(true)
    setNotice(null)
    setDone(null)
    try {
      const answer = await call<{ status: string }>(name, args)
      const problem = REFUSALS[answer.status]
      if (problem) setNotice({ at, text: problem })
      else {
        setAdding(false); setReplacing(null); setRemoving(null)
        setDone(success)
        window.setTimeout(() => setDone(null), 5000)
      }
      setBusy(false)
      await reload()
    } catch {
      setNotice({ at, text: "That didn't go through. Please try again." })
      setBusy(false)
    }
  }
  const refusal = (at: string) => (notice?.at === at ? <div role="alert" style={{ ...look.alert, marginTop: 8 }}>{notice.text}</div> : null)

  const facts = [Object.values(s.details).join(" · "), s.location].filter(Boolean)

  return (
    <div className="bd-fade" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div role="status" aria-live="polite" style={done ? look.done : { display: "none" }}>{done && <>✓ {done}</>}</div>
      <div>
        <h2 style={{ ...look.title, fontSize: "1.8em" }}>{s.title}</h2>
        <div style={{ ...look.muted, marginTop: 4 }}>{classWhen}{facts.length > 0 && ` · ${facts.join(" · ")}`}</div>
        <div style={{ marginTop: 10, display: "inline-block", ...look.chip(full) }}>
          {full ? `Full · ${label}` : s.places === null ? label : `${label} booked`}
        </div>
        {s.problem && (
          <div style={{ ...look.warningPanel, marginTop: 12 }}>
            <WarningIcon colour={look.warningText} />
            <span><strong>Hidden from the site.</strong> {s.problem} Fix it in Google Calendar.</span>
          </div>
        )}
        {!s.problem && wasMoved(s) && (
          <div style={{ ...look.softPanel, marginTop: 12 }}>
            <ClockIcon colour={look.mutedColour} />
            <span>Moved from {when(s.moved_from!)}. Let the people below know.</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <h3 style={{ ...look.heading, marginBottom: 4 }}>People · {s.bookings.length}</h3>
        {s.bookings.length === 0 && <div style={{ ...look.muted, padding: "12px 0" }}>No one booked yet.</div>}
        {s.bookings.map((b) => (
          <div key={b.id} style={{ borderTop: `1px solid ${look.line}`, padding: "12px 0" }}>
            <Person booking={b} look={look} />
            <div style={look.actions}>
              <button className="bd-action" type="button" disabled={busy}
                onClick={() => { setReplacing(replacing === b.id ? null : b.id); setRemoving(null); setAdding(false) }}
                style={look.action}>Replace</button>
              <button className="bd-action bd-danger-action" type="button" disabled={busy}
                onClick={() => { setRemoving(b.id); setReplacing(null); setAdding(false) }}
                style={look.dangerAction}>Remove</button>
            </div>

            {removing === b.id && (
              <div role="alertdialog" aria-label={`Remove ${b.name}?`} style={look.confirm}
                onKeyDown={(e) => { if (e.key === "Escape") setRemoving(null) }}>
                <strong>Remove {b.name} from {s.title}, {classWhen}?</strong>
                <span style={look.muted}>{spotNote}</span>
                <div style={look.actions}>
                  <button className="bd-btn" type="button" disabled={busy}
                    onClick={() => void act(b.id, "owner_cancel", { p_booking: b.id },
                      `${b.name} removed · ${s.problem || started ? "the spot isn't offered on the website" : "the spot is open on the website"}`)}
                    style={look.dangerButton}>Remove {firstName(b.name)}</button>
                  <button className="bd-action" type="button" autoFocus onClick={() => setRemoving(null)}
                    style={look.action}>Keep booking</button>
                </div>
                {!s.problem && (
                  <button className="bd-link" type="button" onClick={() => { setRemoving(null); setReplacing(b.id) }}
                    style={{ ...look.link, alignSelf: "flex-start" }}>Someone else is taking the spot? Replace instead</button>
                )}
              </div>
            )}

            {replacing === b.id && (
              <NameAndPhone look={look} button={`Replace ${firstName(b.name)}`} busy={busy}
                onSubmit={(name, phone) => void act(b.id, "owner_replace", { p_booking: b.id, p_name: name, p_phone: phone }, `${b.name} replaced by ${name}`)} />
            )}
            {refusal(b.id)}
          </div>
        ))}
      </div>

      {s.problem ? null : full ? (
        <div style={look.muted}>Full — use Replace to swap someone in.</div>
      ) : adding ? (
        <NameAndPhone look={look} button="Add" busy={busy}
          onSubmit={(name, phone) => void act("add", "owner_add", { p_session: s.id, p_name: name, p_phone: phone }, `${name} added · ${count(s.bookings.length + 1)}`)} />
      ) : (
        <button className="bd-btn" type="button" onClick={() => { setAdding(true); setReplacing(null) }} style={{ ...look.button, alignSelf: "flex-start" }}>+ Add someone</button>
      )}
      {refusal("add")}
    </div>
  )
}

// ------------------------------------------------------------------
//  Needs attention: grouped by kind, one line each
// ------------------------------------------------------------------

const KINDS: { kind: Attention["kind"]; title: string }[] = [
  { kind: "problem", title: "Hidden from the site" },
  { kind: "cancelled", title: "Cancelled — people to tell" },
  { kind: "moved", title: "Moved — people to tell" },
]

function AttentionList({ attention, look, when, selected, pick }: {
  attention: Attention[]; look: Look; when: When; selected: string | null; pick: (id: string) => void
}) {
  // A late sync shows as the banner above every section, so it isn't repeated here.
  const classes = attention.filter((a) => a.kind !== "sync")
  if (classes.length === 0) return <p style={look.muted}>{attention.length ? "Nothing else needs your attention." : "Nothing needs your attention."}</p>
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {KINDS.map(({ kind, title }) => {
        const items = attention.filter((a) => a.kind === kind)
        if (items.length === 0) return null
        return (
          <div key={kind} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 style={look.heading}>{title} · {items.length}</h3>
            {items.map((a) => {
              if (a.kind === "sync") return null
              const s = a.session
              return (
                <button className="bd-row" key={s.id} type="button" onClick={() => pick(s.id)} aria-current={s.id === selected ? "true" : undefined} style={look.item(s.id === selected)}>
                  {a.kind === "moved" ? <ClockIcon colour={look.mutedColour} /> : <WarningIcon colour={look.warningText} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{s.title}</span>
                    <span style={look.note}>{when(s.starts_at)}</span>
                  </span>
                  {a.kind !== "problem" && <span style={{ whiteSpace: "nowrap" }}>{s.bookings.length} to tell</span>}
                  <span aria-hidden="true" style={look.muted}>›</span>
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function AttentionDetail({ item, look, when }: { item: Exclude<Attention, { kind: "sync" }>; look: Look; when: When }) {
  const s = item.session
  const text =
    item.kind === "problem" ? `Hidden from the site: ${s.problem} Fix it in Google Calendar and it will reappear at the next sync.`
    : item.kind === "cancelled" ? "Cancelled in Google Calendar. Let these people know:"
    : `Moved from ${when(s.moved_from!)} to ${when(s.starts_at)}. Let these people know:`
  return (
    <div className="bd-fade" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ ...look.title, fontSize: "1.8em" }}>{s.title}</h2>
        <div style={{ ...look.muted, marginTop: 4 }}>{when(s.starts_at)}</div>
      </div>
      <div style={item.kind === "moved" ? look.softPanel : look.warningPanel}>
        {item.kind === "moved" ? <ClockIcon colour={look.mutedColour} /> : <WarningIcon colour={look.warningText} />}
        <span>{text}</span>
      </div>
      {item.kind !== "problem" && (
        <div>
          {s.bookings.map((b) => (
            <div key={b.id} style={{ borderTop: `1px solid ${look.line}`, padding: "12px 0" }}>
              <Person booking={b} look={look} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A late or missing calendar sync, above every section: it affects the whole site.
function SyncBanner({ item, look, when }: { item: Attention; look: Look; when: When }) {
  if (item.kind !== "sync") return null
  return (
    <div role="status" style={look.warningBanner}>
      <WarningIcon colour={look.warningText} />
      <span>
        <strong>{item.lastSync ? `The calendar hasn't synced since ${when(item.lastSync)}.` : "The calendar has never synced."}</strong>{" "}
        Changes made in Google Calendar may not be on the site. If this lasts more than a few hours, contact your website team.
      </span>
    </div>
  )
}

// Small icons, drawn inline: no icon library.
function WarningIcon({ colour }: { colour: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
      <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6v3.5M8 11.5v.5" stroke={colour} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ClockIcon({ colour }: { colour: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke={colour} strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 1.5" fill="none" stroke={colour} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// What to tell the owner when the database refuses an action.
const REFUSALS: Record<string, string> = {
  full: "This class is full. Use Replace to swap someone in.",
  already_booked: "That phone number is already booked on this class.",
  invalid_name: "Please enter a name.",
  invalid_phone: "Please enter a valid phone number.",
  unavailable: "This class can't take bookings (it's cancelled or hidden from the site).",
  not_found: "That booking no longer exists. The list has been refreshed.",
}

function Person({ booking: b, look }: { booking: Booking; look: Look }) {
  const whatsapp = whatsappLink(b.phone, "")
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 600, flex: "1 1 140px" }}>
        {b.name}
        <span style={{ ...look.muted, display: "block", fontWeight: 400 }}>{b.phone}</span>
      </span>
      {whatsapp && <a className="bd-pill" href={whatsapp} target="_blank" rel="noopener noreferrer" style={look.pill}>WhatsApp</a>}
    </div>
  )
}

// How long ago the bookings were loaded: "just now", "3 min ago", "1 h ago".
function ago(time: number) {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`
}

// "Sara Haddad" → "Sara", for buttons that name who they act on.
function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name
}

function NameAndPhone({ look, button, busy, onSubmit }: { look: Look; button: string; busy: boolean; onSubmit: (name: string, phone: string) => void }) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(name.trim(), phone) }}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}
    >
      <input className="bd-input" aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} style={{ ...look.input, marginTop: 0, flex: "1 1 140px" }} />
      <input className="bd-input" aria-label="Phone" placeholder="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ ...look.input, marginTop: 0, flex: "1 1 140px" }} />
      <button className="bd-btn" type="submit" disabled={busy} style={look.button}>
        {busy ? <><span className="bd-spinner" aria-hidden="true" />{button}…</> : button}
      </button>
    </form>
  )
}

// ------------------------------------------------------------------
//  Look
// ------------------------------------------------------------------

type Look = ReturnType<typeof styles>

// Hover, focus and motion: things inline styles can't do. Scoped to the dashboard by the
// "bd" class names.
function css(p: Props) {
  const mix = (colour: string, percent: number, other = "transparent") => `color-mix(in srgb, ${colour} ${percent}%, ${other})`
  return `
.bd button, .bd a, .bd input { transition: background-color .15s ease, border-color .15s ease, color .15s ease, filter .15s ease; }
.bd button:disabled { cursor: default; opacity: .6; }
.bd button:focus-visible, .bd a:focus-visible, .bd input:focus-visible { outline: 2px solid ${p.mainColour}; outline-offset: 2px; }
.bd .bd-row:hover { background: ${mix(p.mainColour, 9, p.cardColour)} !important; }
.bd .bd-tab:hover { background: ${mix(p.mainColour, 14)} !important; }
.bd .bd-btn:hover:not(:disabled) { filter: brightness(1.25); }
.bd .bd-link:hover:not(:disabled) { color: ${p.mainColour} !important; }
.bd .bd-link.bd-danger:hover:not(:disabled) { color: ${p.dangerColour} !important; }
.bd .bd-pill:hover { border-color: ${p.mainColour} !important; background: ${mix(p.mainColour, 12)} !important; }
.bd .bd-refresh:hover:not(:disabled) { background: ${mix(p.mainColour, 18)} !important; }
.bd .bd-logout:hover { background: ${mix(p.dangerColour, 12)} !important; }
.bd .bd-action:hover:not(:disabled) { background: ${mix(p.mainColour, 10)} !important; }
.bd .bd-danger-action:hover:not(:disabled) { background: ${mix(p.dangerColour, 10)} !important; }
.bd .bd-input:focus { border-color: ${p.mainColour} !important; outline: none; }
@keyframes bd-shimmer { from { background-position: -600px 0 } to { background-position: 600px 0 } }
@keyframes bd-spin { to { transform: rotate(360deg) } }
@keyframes bd-fade { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
.bd .bd-fade { animation: bd-fade .3s ease-out; }
.bd .bd-skeleton {
  border-radius: 8px;
  background: linear-gradient(90deg, ${mix(p.mainColour, 8)} 0%, ${mix(p.mainColour, 18)} 50%, ${mix(p.mainColour, 8)} 100%);
  background-size: 1200px 100%;
  animation: bd-shimmer 1.4s linear infinite;
}
.bd .bd-spinner {
  display: inline-block; width: 14px; height: 14px; margin-right: 8px; vertical-align: -2px;
  border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
  animation: bd-spin .7s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .bd .bd-skeleton, .bd .bd-spinner, .bd .bd-fade { animation: none; } }
`
}

function styles(props: Props) {
  const line = props.lineColour
  const isDesktop = props.layout !== "phone"
  const base = { fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }
  const tint = (percent: number, other = "transparent") => `color-mix(in srgb, ${props.mainColour} ${percent}%, ${other})`
  const danger = (percent: number) => `color-mix(in srgb, ${props.dangerColour} ${percent}%, transparent)`
  const warning = (percent: number) => `color-mix(in srgb, ${props.warningColour} ${percent}%, transparent)`
  // Colours used for text are darkened, if needed, until they're readable (4.5:1) on the cards.
  // Fills keep the true colour.
  const accentText = readableText(props.mainColour, props.cardColour)
  const warningText = readableText(props.warningColour, props.cardColour)
  const panel = { display: "flex", alignItems: "flex-start", gap: 10, borderRadius: 10, padding: "12px 14px", color: props.textColour }
  return {
    isDesktop,
    accentText,
    warningText,
    mutedColour: props.mutedColour,
    // Needs action (hidden from the site, cancelled, sync): the warning colour
    warningNote: { display: "flex", alignItems: "center", gap: 6, fontSize: "0.85em", fontWeight: 600, color: warningText } as CSSProperties,
    warningPanel: { ...panel, background: warning(12), borderLeft: `3px solid ${props.warningColour}` } as CSSProperties,
    warningBanner: {
      ...panel, borderRadius: 0, padding: "12px 20px", background: warning(14),
      borderBottom: `1px solid ${warning(40)}`, ...(isDesktop ? {} : { borderRadius: 10, borderBottom: "none", borderLeft: `3px solid ${props.warningColour}` }),
    } as CSSProperties,
    // Worth knowing, not urgent (moved): the main colour, softly
    softPanel: { ...panel, background: tint(12) } as CSSProperties,
    // The confirmation after an action
    done: { ...panel, background: tint(14), borderLeft: `3px solid ${accentText}`, fontWeight: 600 } as CSSProperties,
    updated: { color: props.mutedColour, fontSize: "0.8em", textAlign: isDesktop ? "center" : "left", margin: isDesktop ? "0 0 6px" : 0 } as CSSProperties,
    actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 } as CSSProperties,
    // Per-person actions: real buttons with a 44px tap target
    action: {
      ...base, minHeight: 44, padding: "0 16px", borderRadius: 8, cursor: "pointer",
      border: `1px solid ${line}`, background: "transparent", color: props.textColour,
    } as CSSProperties,
    dangerAction: {
      ...base, minHeight: 44, padding: "0 16px", borderRadius: 8, cursor: "pointer",
      border: `1px solid ${danger(40)}`, background: "transparent", color: props.dangerColour,
    } as CSSProperties,
    dangerButton: {
      ...base, minHeight: 44, padding: "0 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600,
      border: "none", background: props.dangerColour, color: "#FFFFFF",
    } as CSSProperties,
    // The confirmation inside a person's row
    confirm: {
      display: "flex", flexDirection: "column", gap: 6, marginTop: 10, padding: 14, borderRadius: 10,
      background: danger(6), borderLeft: `3px solid ${props.dangerColour}`,
    } as CSSProperties,
    accent: accentText,
    line,
    root: {
      ...props.style,
      ...props.textFont,
      position: "relative",
      width: "100%",
      boxSizing: "border-box",
      color: props.textColour,
      ...(isDesktop ? { height: "100vh", minHeight: 560 } : { display: "flex", flexDirection: "column", gap: 16 }),
    } as CSSProperties,
    centred: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: isDesktop ? "100%" : "70vh", padding: 16, boxSizing: "border-box" } as CSSProperties,
    loginCard: {
      display: "flex", flexDirection: "column", gap: 14, width: "100%", maxWidth: 400, boxSizing: "border-box",
      padding: 32, borderRadius: 16, background: props.cardColour, border: `1px solid ${line}`,
      boxShadow: "0 12px 40px rgba(0, 0, 0, 0.06)",
    } as CSSProperties,

    // Desktop: a sidebar fixed to the full height; one surface with the list and the details
    app: { display: "grid", gridTemplateColumns: "240px 1fr", height: "100%" } as CSSProperties,
    sidebar: {
      display: "flex", flexDirection: "column", gap: 6, padding: "32px 20px", boxSizing: "border-box",
      background: tint(12, props.cardColour), borderRight: `1px solid ${line}`, height: "100%", overflowY: "auto",
    } as CSSProperties,
    surface: { display: "grid", gridTemplateColumns: "minmax(320px, 400px) 1fr", background: props.cardColour, minHeight: 0, height: "100%" } as CSSProperties,
    listColumn: { overflowY: "auto", minHeight: 0, padding: "32px 20px", borderRight: `1px solid ${line}`, boxSizing: "border-box" } as CSSProperties,
    detailColumn: { overflowY: "auto", minHeight: 0, padding: "32px 40px", boxSizing: "border-box" } as CSSProperties,

    title: { margin: 0, color: props.textColour, ...props.titleFont } as CSSProperties,
    heading: { margin: 0, fontSize: "0.78em", letterSpacing: "0.07em", textTransform: "uppercase", color: props.mutedColour, fontWeight: 600 } as CSSProperties,
    muted: { color: props.mutedColour, margin: 0 } as CSSProperties,
    note: { color: props.mutedColour, display: "block", fontSize: "0.85em", fontWeight: 400 } as CSSProperties,
    alert: { color: props.textColour, background: tint(14), borderRadius: 10, padding: "12px 14px" } as CSSProperties,
    card: { background: props.cardColour, border: `1px solid ${line}`, borderRadius: 12, padding: 16, boxSizing: "border-box" } as CSSProperties,
    chip: (full: boolean): CSSProperties => ({
      padding: "4px 10px", borderRadius: 999, fontWeight: 600, fontSize: "0.9em",
      background: full ? accentText : tint(14), color: full ? "#FFFFFF" : props.textColour,
    }),
    // The count on Needs attention: the warning colour when something needs action
    badge: (urgent: boolean): CSSProperties => ({
      marginLeft: "auto", minWidth: 22, textAlign: "center", padding: "1px 7px", borderRadius: 999, fontSize: "0.8em",
      fontWeight: 600, background: urgent ? warningText : accentText, color: "#FFFFFF", boxSizing: "border-box",
    }),

    // A section switch: a row in the sidebar on desktop, a tab on the phone
    tab: (on: boolean): CSSProperties => ({
      ...base, display: "flex", alignItems: "center", gap: 8, textAlign: "left", cursor: "pointer",
      padding: isDesktop ? "10px 12px" : "8px 14px", borderRadius: isDesktop ? 8 : 999,
      border: isDesktop ? "none" : `1px solid ${on ? props.mainColour : line}`,
      background: on ? (isDesktop ? props.cardColour : tint(16)) : "transparent",
      boxShadow: on && isDesktop ? "0 1px 3px rgba(0, 0, 0, 0.06)" : "none",
      color: props.textColour, fontWeight: on ? 600 : 400,
    }),
    // A row in a list: a class, or an item that needs attention
    item: (on: boolean): CSSProperties => ({
      ...base, display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box",
      padding: "12px 14px", borderRadius: 10, cursor: "pointer", textAlign: "left", color: props.textColour,
      background: on ? tint(14, props.cardColour) : props.cardColour,
      border: `1px solid ${on ? props.mainColour : isDesktop ? "transparent" : line}`,
    }),

    input: {
      ...base, display: "block", width: "100%", boxSizing: "border-box", marginTop: 6, padding: "11px 12px",
      borderRadius: 8, border: `1px solid ${line}`, background: "transparent", color: props.textColour,
    } as CSSProperties,
    button: {
      ...base, fontWeight: 600, padding: "10px 16px", borderRadius: 8, border: "none", cursor: "pointer",
      background: props.buttonColour, color: props.buttonTextColour,
    } as CSSProperties,
    refresh: {
      ...base, fontWeight: 600, padding: "9px 14px", borderRadius: 8, cursor: "pointer",
      border: `1px solid ${accentText}`, background: "transparent", color: accentText,
    } as CSSProperties,
    logout: {
      ...base, fontWeight: 600, padding: "9px 14px", borderRadius: 8, cursor: "pointer",
      border: `1px solid ${props.dangerColour}`, background: "transparent", color: props.dangerColour,
    } as CSSProperties,
    link: {
      ...base, padding: 0, border: "none", background: "none", cursor: "pointer",
      color: props.textColour, textDecoration: "underline", textUnderlineOffset: 3,
    } as CSSProperties,
    pill: {
      fontSize: "0.85em", padding: "6px 12px", borderRadius: 999, textDecoration: "none",
      border: `1px solid ${line}`, color: props.textColour, whiteSpace: "nowrap",
    } as CSSProperties,
  }
}

// A language the browser doesn't know (a typo in the settings) falls back to English.
function safeLanguage(language: string): string {
  try {
    new Intl.DateTimeFormat(language)
    return language
  } catch {
    return "en"
  }
}

// Made-up data for Framer's canvas, so the dashboard can be designed without logging in.
function sample(): Data {
  const at = (days: number, hour: number) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + days)
    d.setUTCHours(hour, 0, 0, 0)
    return d.toISOString()
  }
  const people = (names: string[]) => names.map((name, i) => ({ id: name, name, phone: `+96170000${100 + i}`, created_at: at(-1, 9) }))
  const cls = (id: string, title: string, days: number, hour: number, places: number | null, names: string[], extra: Partial<OwnerSession> = {}): OwnerSession => ({
    id, title, starts_at: at(days, hour), ends_at: at(days, hour + 1), location: "Achrafieh, Beirut", details: { Instructor: "Camila M." },
    places, problem: null, cancelled_at: null, moved_from: null, bookings: people(names), ...extra,
  })
  const many = ["Sara Haddad", "Maya Khoury", "Rana Saad", "Lina Aoun", "Nour Karam", "Joelle Haddad", "Tala Daher"]
  return {
    timeZone: "UTC",
    lastSync: new Date().toISOString(),
    sessions: [
      cls("a", "Reformer Foundations", 0, 22, 10, many),
      cls("b", "Mat Flow", 1, 9, 3, many.slice(0, 3)),
      cls("c", "Candlelit Yin", 1, 19, 8, ["Tala Daher"], { moved_from: at(1, 17) }),
      cls("d", "Barre Basics", 2, 10, null, [], { problem: 'No "Capacity" line in the description.' }),
      cls("e", "Strength", 3, 18, 10, ["Karim Nassar", "Rami Haddad"], { cancelled_at: at(-1, 9) }),
      cls("f", "Reformer Foundations", 4, 11, 10, many.slice(2, 6)),
    ],
  }
}

// ------------------------------------------------------------------
//  Settings panel
// ------------------------------------------------------------------

addPropertyControls(Dashboard, {
  supabaseUrl: { type: ControlType.String, title: "Supabase URL", defaultValue: "", placeholder: "https://….supabase.co" },
  publicKey: { type: ControlType.String, title: "Public key", defaultValue: "", placeholder: "sb_publishable_…" },
  studioName: { type: ControlType.String, title: "Studio name", defaultValue: "Studio", description: "Shown on the login and at the top of the dashboard." },
  rememberDays: {
    type: ControlType.Number,
    title: "Remember for",
    description: "Days a device stays logged in when \"Remember this device\" is ticked.",
    defaultValue: 30, min: 1, max: 365, step: 1, unit: " days", displayStepper: true,
  },
  layout: {
    type: ControlType.Enum,
    title: "Layout",
    description: "Desktop: fills the window, sections side by side. Phone: one screen at a time. Set Phone on the phone breakpoint.",
    options: ["desktop", "phone"],
    optionTitles: ["Desktop", "Phone"],
    defaultValue: "desktop",
    displaySegmentedControl: true,
  },
  language: { type: ControlType.String, title: "Language", defaultValue: "en" },
  mainColour: { type: ControlType.Color, title: "Main colour", defaultValue: "#6B7280" },
  textColour: { type: ControlType.Color, title: "Text", defaultValue: "#1A1A1A" },
  mutedColour: { type: ControlType.Color, title: "Muted text", defaultValue: "#6B6B6B" },
  lineColour: { type: ControlType.Color, title: "Lines", defaultValue: "#E6E6E6" },
  cardColour: { type: ControlType.Color, title: "Cards", defaultValue: "#FFFFFF" },
  buttonColour: { type: ControlType.Color, title: "Button", defaultValue: "#1A1A1A" },
  buttonTextColour: { type: ControlType.Color, title: "Button text", defaultValue: "#FFFFFF" },
  warningColour: {
    type: ControlType.Color, title: "Warning", defaultValue: "#B45309",
    description: "Things that need action: classes hidden from the site, cancelled classes, sync problems.",
  },
  dangerColour: { type: ControlType.Color, title: "Danger", defaultValue: "#C0392B", description: "Removing a booking and logging out." },
  titleFont: {
    type: ControlType.Font,
    title: "Title font",
    controls: "extended",
    defaultFontType: "serif",
    defaultValue: { fontSize: "32px", lineHeight: "1.2em" },
  },
  textFont: {
    type: ControlType.Font,
    title: "Text font",
    controls: "extended",
    defaultFontType: "sans-serif",
    defaultValue: { fontSize: "15px", lineHeight: "1.4em", variant: "Regular" },
  },
})
