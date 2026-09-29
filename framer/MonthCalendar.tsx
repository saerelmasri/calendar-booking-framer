// MonthCalendar.tsx — the public calendar on a client's Framer site.
//
// Reads the classes from Supabase with the public key. View "Month" shows the current
// month as a grid; view "List" (set on the phone breakpoint) shows the upcoming classes.
// The date and colour logic lives in month.ts, which has the tests. Nothing here is
// specific to one client: everything comes from the settings panel.

import { useEffect, useState, type CSSProperties } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import {
  buildMonth,
  dayLabel,
  fetchRange,
  monthTitle,
  shadeFor,
  upcoming,
  weekdayNames,
  type CalendarSession,
  type Day,
  type PlacedSession,
} from "./month.tsx"   // month.ts in the repo; Framer's code files end in .tsx

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

interface Props {
  supabaseUrl: string
  publicKey: string
  view: "month" | "list"
  days: Partial<Record<(typeof DAY_KEYS)[number], boolean>>
  language: string
  mainColour: string
  textColour: string
  mutedColour: string
  lineColour: string
  titleFont: CSSProperties
  textFont: CSSProperties
  listTitle: string
  emptyMonthText: string
  emptyListText: string
  unavailableText: string
  errorText: string
  style?: CSSProperties
}

type Data = { timeZone: string; sessions: CalendarSession[] }
type State = { status: "loading" } | { status: "setup" } | { status: "error" } | ({ status: "ready" } & Data)

/**
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight auto
 */
export default function MonthCalendar(props: Props) {
  const { supabaseUrl, publicKey, view } = props
  const inEditor = useIsStaticRenderer()      // Framer's canvas: made-up classes, no network
  const [state, setState] = useState<State>({ status: "loading" })

  useEffect(() => {
    if (inEditor) return
    if (!supabaseUrl || !publicKey) {
      setState({ status: "setup" })
      return
    }
    let stale = false
    setState({ status: "loading" })
    load(supabaseUrl, publicKey)
      .then((data) => { if (!stale) setState({ status: "ready", ...data }) })
      .catch(() => { if (!stale) setState({ status: "error" }) })
    return () => { stale = true }
  }, [inEditor, supabaseUrl, publicKey])

  const language = safeLanguage(props.language)
  const data = inEditor ? sample() : state.status === "ready" ? state : null

  let body
  if (state.status === "setup" && !inEditor) body = <Note props={props}>Add the Supabase URL and public key in this component's settings.</Note>
  else if (state.status === "error" && !inEditor) body = <Note props={props}>{props.errorText}</Note>
  else if (!data) body = <Placeholder props={props} />
  else if (view === "list") body = <List data={data} props={props} language={language} />
  else body = <MonthGrid data={data} props={props} language={language} />

  const root: CSSProperties = {
    ...props.style,
    position: "relative",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    color: props.textColour,
    ...props.textFont,
  }
  return <div style={root}>{body}</div>
}

// ------------------------------------------------------------------
//  Loading
// ------------------------------------------------------------------

const COLUMNS = "id,title,starts_at,ends_at,location,details,bookable"

// Two requests: the calendar's timezone first, because it decides which days to ask for.
async function load(url: string, key: string): Promise<Data> {
  async function get(path: string) {
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/${path}`, { headers: { apikey: key } })
    if (!response.ok) throw new Error(`Supabase answered ${response.status}`)
    return response.json()
  }
  const [info] = await get("sync_status?select=time_zone")
  if (!info?.time_zone) throw new Error("The calendar hasn't been synced yet")
  const { from, to } = fetchRange(new Date(), info.time_zone)
  const sessions = await get(`sessions?select=${COLUMNS}&starts_at=gte.${from}&starts_at=lt.${to}&order=starts_at`)
  return { timeZone: info.time_zone, sessions }
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

// Made-up classes for Framer's canvas, so the calendar can be designed without data.
function sample(): Data {
  const week: [string, number][] = [
    ["Morning Flow", 9], ["Strength", 18], ["Morning Flow", 9],
    ["Strength", 18], ["Evening Stretch", 19], ["Weekend Workshop", 10],
  ]
  const today = new Date()
  const sessions: CalendarSession[] = []
  for (let i = 0; i < 60; i++) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1 + i))
    const weekday = (day.getUTCDay() + 6) % 7
    if (weekday === 6) continue                                   // none on Sundays
    const [title, hour] = week[weekday]
    day.setUTCHours(hour)
    const start = day.toISOString()
    sessions.push({ id: start, title, starts_at: start, ends_at: start, location: null, details: { Host: "Alex" }, bookable: true })
  }
  return { timeZone: "UTC", sessions }
}

// ------------------------------------------------------------------
//  Month view
// ------------------------------------------------------------------

function MonthGrid({ data, props, language }: { data: Data; props: Props; language: string }) {
  const days = DAY_KEYS.flatMap((key, i) => ((props.days?.[key] ?? i < 6) ? [i] : []))   // default Monday–Saturday
  const month = buildMonth(data.sessions, { now: new Date(), timeZone: data.timeZone, days })
  const names = weekdayNames(language)
  const line = `1px solid ${props.lineColour}`
  const hasClasses = month.weeks.some((week) => week.some((d) => d.sessions.length > 0))

  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${month.weekdays.length}, minmax(0, 1fr))`,
    borderTop: line,
    borderLeft: line,
  }
  const header: CSSProperties = {
    padding: "8px",
    borderRight: line,
    borderBottom: line,
    color: props.mutedColour,
    fontSize: "0.8em",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  }

  return (
    <>
      <Title props={props}>{monthTitle(month.year, month.month, language)}</Title>
      {hasClasses ? (
        <div style={grid}>
          {month.weekdays.map((w) => <div key={`weekday-${w}`} style={header}>{names[w]}</div>)}
          {month.weeks.flat().map((d) => <DayCell key={d.key} day={d} props={props} />)}
        </div>
      ) : (
        <Note props={props}>{props.emptyMonthText}</Note>
      )}
    </>
  )
}

function DayCell({ day, props }: { day: Day; props: Props }) {
  const line = `1px solid ${props.lineColour}`
  const cell: CSSProperties = {
    minHeight: 110,
    minWidth: 0,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    borderRight: line,
    borderBottom: line,
    background: day.isToday ? `color-mix(in srgb, ${props.mainColour} 10%, transparent)` : undefined,
  }
  if (!day.inMonth) return <div style={cell} />                  // before the 1st or after the last

  return (
    <div style={cell}>
      <div style={{ fontSize: "0.85em", fontWeight: day.isToday ? 700 : 500, color: day.isPast ? props.mutedColour : props.textColour }}>
        {day.date}
      </div>
      {day.sessions.map((s) => (
        <div key={s.id} style={card(s, props, "6px 8px")}>
          <div style={{ fontWeight: 600 }}>{s.time}</div>
          <div>{s.title}</div>
          <Extra session={s} props={props} />
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------
//  List view (phones)
// ------------------------------------------------------------------

function List({ data, props, language }: { data: Data; props: Props; language: string }) {
  const classes = upcoming(data.sessions, { now: new Date(), timeZone: data.timeZone })
  return (
    <>
      {props.listTitle && <Title props={props}>{props.listTitle}</Title>}
      {classes.length === 0 ? (
        <Note props={props}>{props.emptyListText}</Note>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {classes.map((s) => (
            <div key={s.id} style={card(s, props, "12px 14px")}>
              <div style={{ opacity: 0.75 }}>{dayLabel(s.day, language)} · {s.time}</div>
              <div style={{ fontWeight: 600, fontSize: "1.15em" }}>{s.title}</div>
              <Extra session={s} props={props} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------
//  Shared pieces
// ------------------------------------------------------------------

// A class on its shade of the main colour, greyed once it has started.
function card(s: PlacedSession, props: Props, padding: string): CSSProperties {
  return {
    background: shadeFor(s.title, props.mainColour),
    color: props.textColour,
    borderRadius: 8,
    padding,
    fontSize: "0.85em",
    overflowWrap: "anywhere",
    opacity: s.past ? 0.45 : 1,
  }
}

// The details (e.g. the instructor) and, for a class that can't be booked, the word for it.
function Extra({ session: s, props }: { session: PlacedSession; props: Props }) {
  const details = Object.values(s.details).join(" · ")
  return (
    <>
      {details && <div style={{ opacity: 0.75 }}>{details}</div>}
      {!s.bookable && <div style={{ opacity: 0.75, fontStyle: "italic" }}>{props.unavailableText}</div>}
    </>
  )
}

function Title({ props, children }: { props: Props; children: string }) {
  return <h3 style={{ margin: 0, color: props.textColour, ...props.titleFont }}>{children}</h3>
}

function Note({ props, children }: { props: Props; children: string }) {
  return <p style={{ margin: 0, color: props.mutedColour }}>{children}</p>
}

// A soft placeholder while the classes load.
function Placeholder({ props }: { props: Props }) {
  const block: CSSProperties = { background: `color-mix(in srgb, ${props.mainColour} 6%, transparent)`, borderRadius: 8 }
  if (props.view === "list") {
    return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} style={{ ...block, height: 72 }} />)}</div>
  }
  return (
    <>
      <div style={{ ...block, height: 32, width: 220 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 4 }}>
        {Array.from({ length: 30 }, (_, i) => <div key={i} style={{ ...block, height: 110 }} />)}
      </div>
    </>
  )
}

// ------------------------------------------------------------------
//  Settings panel
// ------------------------------------------------------------------

const day = (title: string, on: boolean) => ({ type: ControlType.Boolean, title, defaultValue: on })
const text = (title: string, defaultValue: string, hidden?: (p: Props) => boolean) =>
  ({ type: ControlType.String, title, defaultValue, hidden })

addPropertyControls(MonthCalendar, {
  supabaseUrl: { type: ControlType.String, title: "Supabase URL", defaultValue: "", placeholder: "https://….supabase.co" },
  publicKey: { type: ControlType.String, title: "Public key", defaultValue: "", placeholder: "sb_publishable_…" },
  view: {
    type: ControlType.Enum,
    title: "View",
    options: ["month", "list"],
    optionTitles: ["Month", "List"],
    defaultValue: "month",
    displaySegmentedControl: true,
  },
  days: {
    type: ControlType.Object,
    title: "Days",
    controls: {
      monday: day("Monday", true),
      tuesday: day("Tuesday", true),
      wednesday: day("Wednesday", true),
      thursday: day("Thursday", true),
      friday: day("Friday", true),
      saturday: day("Saturday", true),
      sunday: day("Sunday", false),
    },
    hidden: (p: Props) => p.view === "list",
  },
  language: { type: ControlType.String, title: "Language", defaultValue: "en" },
  mainColour: { type: ControlType.Color, title: "Main colour", defaultValue: "#6B7280" },
  textColour: { type: ControlType.Color, title: "Text", defaultValue: "#1A1A1A" },
  mutedColour: { type: ControlType.Color, title: "Muted text", defaultValue: "#6B6B6B" },
  lineColour: { type: ControlType.Color, title: "Lines", defaultValue: "#E6E6E6" },
  titleFont: {
    type: ControlType.Font,
    title: "Title font",
    controls: "extended",
    defaultFontType: "serif",
    defaultValue: { fontSize: "28px", lineHeight: "1.2em" },
  },
  textFont: {
    type: ControlType.Font,
    title: "Text font",
    controls: "extended",
    defaultFontType: "sans-serif",
    defaultValue: { fontSize: "15px", lineHeight: "1.4em", variant: "Regular" },
  },
  listTitle: text("List title", "Upcoming classes", (p) => p.view !== "list"),
  emptyMonthText: text("Empty month", "No classes scheduled this month", (p) => p.view === "list"),
  emptyListText: text("Empty list", "No upcoming classes", (p) => p.view !== "list"),
  unavailableText: text("Can't be booked", "Unavailable"),
  errorText: text("Can't load", "The timetable can't be loaded right now."),
})
