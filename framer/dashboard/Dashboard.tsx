// Dashboard.tsx — the owner's dashboard, on a hidden page of the client's Framer site.
//
// The owner logs in with email and password (Supabase's sign-in). Everything shown or
// changed goes through the owner_* database functions, which refuse anyone who isn't on
// the owners list. This file is the component itself: the login, loading the bookings,
// where the owner is (each section has its own address, #class=… or #attention, so the
// browser's back button works), and the settings panel. The rest lives next to it:
//
//   Board.tsx        the layout: desktop sidebar + list + details, or phone screens
//   ClassesList.tsx  Classes: search, filters, this week, later this month
//   ClassDetail.tsx  one class: add, its people, remove and replace
//   Attention.tsx    Needs attention: hidden, cancelled and moved classes, told ticks
//   parts.tsx        login, messages, a person's line, the name-and-phone form…
//   styles.ts        every colour, size and hover, from the settings
//   server.ts        talking to Supabase; remembering the login on this device
//   logic.ts         what needs attention, search, filters, phones (has the tests)
//   ../shared/month.ts  dates, times and colours, shared with the public calendar
//
// Framer gets one file: `npm run build:framer` joins them all into
// framer-build/Dashboard.tsx, which is what's saved to Framer.

import { useEffect, useState, type ReactNode } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { Board } from "./Board.tsx"
import { readRoute, writeRoute } from "./helpers.ts"
import { type OwnerSession } from "./logic.ts"
import { Centred, Login, Message, Skeleton } from "./parts.tsx"
import { sample } from "./sample.ts"
import { makeServer, readSaved, save } from "./server.ts"
import { css, styles } from "./styles.ts"
import { type Auth, type Data, LOOK_AHEAD, type Props, type Route, type Screen } from "./types.ts"

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

  // Loads the bookings again, and hands them back (null when it failed), so Refresh can
  // tell when a sync has landed.
  async function reload(current = auth): Promise<Data | null> {
    try {
      const now = new Date()
      const result = await call<{ time_zone: string; last_sync: string | null; sessions: OwnerSession[] }>(
        "owner_sessions",
        { p_from: new Date(now.getTime() - 86400000).toISOString(), p_to: new Date(now.getTime() + LOOK_AHEAD * 86400000).toISOString() },
        current,
      )
      const loaded = { timeZone: result.time_zone, lastSync: result.last_sync, sessions: result.sessions }
      setData(loaded)
      setLoadedAt(Date.now())
      setScreen("ready")
      return loaded
    } catch (e) {
      if ((e as Error).message === "not an owner" || (e as Error).message === "expired") return null
      setScreen("error")
      return null
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
    body = <Board inEditor={inEditor} data={shown!} loadedAt={inEditor ? Date.now() : loadedAt} props={props} look={look} call={call} reload={() => reload()} logOut={logOut} route={route} go={go} />
  } else if (screen === "login") {
    body = <Centred look={look}><Login props={props} look={look} logIn={logIn} /></Centred>
  } else if (screen === "loading") {
    body = <Skeleton look={look} />
  } else if (screen === "not_owner") {
    body = <Centred look={look}><Message props={props} look={look} text="This account can't see the bookings for this site." action="Log out" onAction={logOut} /></Centred>
  } else if (screen === "error") {
    body = <Centred look={look}><Message props={props} look={look} text="The bookings can't be loaded right now." action="Try again" onAction={() => setScreen("loading")} /></Centred>
  } else {
    body = <Skeleton look={look} />                           // a moment while checking for a saved login
  }

  return (
    <div className="bd" style={look.root}>
      <style>{css(props)}</style>
      {body}
    </div>
  )
}

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
  countryCode: {
    type: ControlType.String, title: "Country code", defaultValue: "", placeholder: "961",
    description: "Added to phone numbers saved without one, so WhatsApp can open them.",
  },
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
