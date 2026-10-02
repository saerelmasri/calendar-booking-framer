// MonthCalendar.tsx — the public calendar on a client's Framer site.
//
// Reads the classes and their places left from Supabase with the public key. View
// "Month" shows the current month as a grid; view "List" (set on the phone breakpoint)
// shows the upcoming classes. Tapping a class opens a panel to book it with a name and a
// phone number. The date, places and colour logic lives in month.ts, which has the
// tests. Nothing here is specific to one client: everything comes from the settings panel.
//
// Framer code files can't import each other, so in Framer this file and month.ts are
// one code file: month.ts pasted in place of the import below.

import { useEffect, useState, type CSSProperties, type FormEvent } from "react"
import { createPortal } from "react-dom"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import {
  buildMonth,
  dayLabel,
  fetchRange,
  fillIn,
  monthTitle,
  placesNote,
  shadeFor,
  upcoming,
  weekdayNames,
  whatsappLink,
  type CalendarSession,
  type Day,
  type PlacedSession,
} from "./month.ts"

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

// Everything the booking panel says, so a client can change the wording or the language.
const WORDS = {
  book: "Book",
  name: "Name",
  phone: "Phone",
  placesLeft: "{n} places left",
  lastPlace: "1 place left",
  full: "Full",
  booked: "You're in, {name}! See you {day} at {time}.",
  justFilled: "Sorry, this class just filled up.",
  alreadyBooked: "You're already booked for this class.",
  closed: "This class can't be booked any more.",
  invalidName: "Please enter your name.",
  invalidPhone: "Please enter a valid phone number.",
  failed: "Couldn't book right now. Please try again.",
  waitingList: "Join the waiting list on WhatsApp",
  waitingMessage: "Hi, I'd like to join the waiting list for {class} on {day} at {time}.",
  done: "Done",
  bookOnWhatsapp: "Book through WhatsApp",
  bookingMessage: "Hi, I'd like to book {class} on {day} at {time}.",
}
type Words = typeof WORDS

interface Props {
  supabaseUrl: string
  publicKey: string
  view: "month" | "list"
  days: Partial<Record<(typeof DAY_KEYS)[number], boolean>>
  language: string
  placesFrom: number
  whatsapp: string
  method: "website" | "whatsapp"
  mainColour: string
  textColour: string
  mutedColour: string
  lineColour: string
  panelColour: string
  buttonColour: string
  buttonTextColour: string
  titleFont: CSSProperties
  textFont: CSSProperties
  listTitle: string
  emptyMonthText: string
  emptyListText: string
  errorText: string
  words: Partial<Words>
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
  const [booking, setBooking] = useState<PlacedSession | null>(null)   // the class being booked

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

  // After an answer from the database, show the new number of places without reloading.
  function updatePlaces(id: string, placesLeft: number | null) {
    setState((s) => s.status !== "ready" ? s : {
      ...s,
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, places_left: placesLeft } : x)),
    })
  }

  const language = safeLanguage(props.language)
  const data = inEditor ? sample() : state.status === "ready" ? state : null

  let body
  if (state.status === "setup" && !inEditor) body = <Note props={props}>Add the Supabase URL and public key in this component's settings.</Note>
  else if (state.status === "error" && !inEditor) body = <Note props={props}>{props.errorText}</Note>
  else if (!data) body = <Placeholder props={props} />
  else if (view === "list") body = <List data={data} props={props} language={language} onPick={setBooking} />
  else body = <MonthGrid data={data} props={props} language={language} onPick={setBooking} />

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
  return (
    <div style={root}>
      {body}
      {booking && (
        <BookingPanel
          session={booking}
          props={props}
          language={language}
          onClose={() => setBooking(null)}
          onPlaces={updatePlaces}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------
//  Talking to Supabase
// ------------------------------------------------------------------

const COLUMNS = "id,title,starts_at,ends_at,location,details"

function api(url: string) {
  return `${url.replace(/\/+$/, "")}/rest/v1`
}

// The calendar's timezone first, because it decides which days to ask for; then the
// classes and their places left, both at once.
async function load(url: string, key: string): Promise<Data> {
  async function get(path: string) {
    const response = await fetch(`${api(url)}/${path}`, { headers: { apikey: key } })
    if (!response.ok) throw new Error(`Supabase answered ${response.status}`)
    return response.json()
  }
  const [info] = await get("sync_status?select=time_zone")
  if (!info?.time_zone) throw new Error("The calendar hasn't been synced yet")
  const { from, to } = fetchRange(new Date(), info.time_zone)
  const [rows, places] = await Promise.all([
    get(`sessions?select=${COLUMNS}&starts_at=gte.${from}&starts_at=lt.${to}&order=starts_at`),
    get(`rpc/places_left?p_from=${from}&p_to=${to}`),
  ])
  const left = new Map<string, number>()
  for (const p of places as { session_id: string; places_left: number }[]) left.set(p.session_id, p.places_left)
  const sessions: CalendarSession[] = (rows as Omit<CalendarSession, "places_left">[])
    .map((s) => ({ ...s, places_left: left.get(s.id) ?? null }))    // not listed = no limit
  return { timeZone: info.time_zone, sessions }
}

// One booking. The database checks everything and answers with a status:
// booked, full, already_booked, started, unavailable, invalid_name or invalid_phone.
async function book(url: string, key: string, session: string, name: string, phone: string) {
  const response = await fetch(`${api(url)}/rpc/book_session`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ p_session: session, p_name: name, p_phone: phone }),
  })
  if (!response.ok) throw new Error(`Supabase answered ${response.status}`)
  return (await response.json()) as { status: string; places_left?: number | null }
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
// Some are nearly full and some full, to show how those look.
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
    const places_left = i % 7 === 3 ? 0 : i % 5 === 1 ? 2 : null
    sessions.push({ id: start, title, starts_at: start, ends_at: start, location: null, details: { Host: "Alex" }, places_left })
  }
  return { timeZone: "UTC", sessions }
}

// ------------------------------------------------------------------
//  Month view
// ------------------------------------------------------------------

type Pick = (session: PlacedSession) => void

function MonthGrid({ data, props, language, onPick }: { data: Data; props: Props; language: string; onPick: Pick }) {
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
          {month.weeks.flat().map((d) => <DayCell key={d.key} day={d} props={props} onPick={onPick} />)}
        </div>
      ) : (
        <Note props={props}>{props.emptyMonthText}</Note>
      )}
    </>
  )
}

function DayCell({ day, props, onPick }: { day: Day; props: Props; onPick: Pick }) {
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
      {day.sessions.map((s) => <ClassCard key={s.id} session={s} props={props} onPick={onPick} />)}
    </div>
  )
}

// ------------------------------------------------------------------
//  List view (phones)
// ------------------------------------------------------------------

function List({ data, props, language, onPick }: { data: Data; props: Props; language: string; onPick: Pick }) {
  const classes = upcoming(data.sessions, { now: new Date(), timeZone: data.timeZone })
  return (
    <>
      {props.listTitle && <Title props={props}>{props.listTitle}</Title>}
      {classes.length === 0 ? (
        <Note props={props}>{props.emptyListText}</Note>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {classes.map((s) => <ClassCard key={s.id} session={s} props={props} onPick={onPick} date={dayLabel(s.day, language)} />)}
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------------
//  A class: a card on its shade of the main colour
// ------------------------------------------------------------------

// In the grid it shows the time, name and details; in the list (`date` given) the date
// comes first and the name is bigger. It opens the booking panel when there's something
// to do there: a place to book, or the waiting list of a full class. With WhatsApp
// booking, the system doesn't know who booked, so it shows no places and opens the
// panel whenever there's a number to message.
function ClassCard({ session: s, props, onPick, date }: { session: PlacedSession; props: Props; onPick: Pick; date?: string }) {
  const words = wordsOf(props)
  const byWhatsapp = props.method === "whatsapp"
  const hasNumber = whatsappLink(props.whatsapp ?? "", "") !== null
  const note = byWhatsapp ? null : placesNote(s.places_left, props.placesFrom ?? 3)
  const details = Object.values(s.details).join(" · ")
  const canOpen = !s.past && (byWhatsapp ? hasNumber : note !== "full" || hasNumber)

  const style: CSSProperties = {
    background: shadeFor(s.title, props.mainColour),
    color: props.textColour,
    borderRadius: 8,
    padding: date ? "12px 14px" : "6px 8px",
    fontSize: "0.85em",
    overflowWrap: "anywhere",
    opacity: s.past ? 0.45 : 1,                                 // greyed once it has started
  }
  const content = (
    <>
      {date ? <div style={{ opacity: 0.75 }}>{date} · {s.time}</div> : <div style={{ fontWeight: 600 }}>{s.time}</div>}
      <div style={date ? { fontWeight: 600, fontSize: "1.15em" } : undefined}>{s.title}</div>
      {details && <div style={{ opacity: 0.75 }}>{details}</div>}
      {note !== null && !s.past && (
        <div style={{ fontWeight: 600 }}>
          {note === "full" ? words.full : note === 1 ? words.lastPlace : fillIn(words.placesLeft, { n: String(note) })}
        </div>
      )}
    </>
  )

  if (!canOpen) return <div style={style}>{content}</div>
  return (
    <button type="button" onClick={() => onPick(s)} style={{ ...buttonReset, ...style }}>
      {content}
    </button>
  )
}

// A <button> that looks like the card it wraps.
const buttonReset: CSSProperties = {
  display: "block",
  width: "100%",
  border: "none",
  margin: 0,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: "inherit",
  lineHeight: "inherit",
  letterSpacing: "inherit",
}

// ------------------------------------------------------------------
//  The booking panel
// ------------------------------------------------------------------

type Answer = string | null     // the status from book_session, "failed" if it couldn't be reached

function BookingPanel({ session: s, props, language, onClose, onPlaces }: {
  session: PlacedSession
  props: Props
  language: string
  onClose: () => void
  onPlaces: (id: string, placesLeft: number | null) => void
}) {
  const words = wordsOf(props)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [sending, setSending] = useState(false)
  const [answer, setAnswer] = useState<Answer>(null)

  // Escape closes the panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const day = dayLabel(s.day, language)
  const values = { class: s.title, day, time: s.time, name: name.trim() }
  const waitingList = whatsappLink(props.whatsapp ?? "", fillIn(words.waitingMessage, values))
  const byWhatsapp = props.method === "whatsapp"
  const bookingLink = whatsappLink(props.whatsapp ?? "", fillIn(words.bookingMessage, values))
  const full = !byWhatsapp && (answer === "full" || (answer === null && s.places_left === 0))
  const note = byWhatsapp ? null : placesNote(s.places_left, props.placesFrom ?? 3)

  // Answers that end the booking; the others (a mistake in a field, no connection) keep the form.
  const final: Record<string, string> = {
    booked: fillIn(words.booked, values),
    full: words.justFilled,
    already_booked: words.alreadyBooked,
    started: words.closed,
    unavailable: words.closed,
  }
  const retry: Record<string, string> = {
    invalid_name: words.invalidName,
    invalid_phone: words.invalidPhone,
    failed: words.failed,
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSending(true)
    try {
      const result = await book(props.supabaseUrl, props.publicKey, s.id, name, phone)
      setAnswer(result.status)
      if (result.places_left !== undefined) onPlaces(s.id, result.places_left)
    } catch {
      setAnswer("failed")
    }
    setSending(false)
  }

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(0, 0, 0, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  }
  const panel: CSSProperties = {
    ...props.textFont,
    position: "relative",
    width: "100%",
    maxWidth: 420,
    maxHeight: "100%",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: 24,
    borderRadius: 16,
    background: props.panelColour,
    color: props.textColour,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  }
  const input: CSSProperties = {
    font: "inherit",
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    marginTop: 6,
    borderRadius: 8,
    border: `1px solid ${props.lineColour}`,
    background: "transparent",
    color: props.textColour,
  }
  const button: CSSProperties = {
    font: "inherit",
    fontWeight: 600,
    padding: "12px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    textAlign: "center",
    textDecoration: "none",
    background: props.buttonColour,
    color: props.buttonTextColour,
  }

  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={s.title} style={panel} onClick={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Close" onClick={onClose} style={{ ...buttonReset, position: "absolute", top: 12, right: 12, width: "auto", background: "none", fontSize: 22, color: props.mutedColour }}>
          ×
        </button>

        <div>
          <h3 style={{ margin: 0, paddingRight: 24, color: props.textColour, ...props.titleFont }}>{s.title}</h3>
          <div style={{ color: props.mutedColour, marginTop: 4 }}>{day} · {s.time}</div>
          {[Object.values(s.details).join(" · "), s.location].filter(Boolean).map((line) => (
            <div key={line} style={{ color: props.mutedColour }}>{line}</div>
          ))}
          {note !== null && answer === null && (
            <div style={{ fontWeight: 600, marginTop: 4 }}>
              {note === "full" ? words.full : note === 1 ? words.lastPlace : fillIn(words.placesLeft, { n: String(note) })}
            </div>
          )}
        </div>

        {byWhatsapp ? (
          bookingLink && <a href={bookingLink} target="_blank" rel="noopener noreferrer" style={button}>{words.bookOnWhatsapp}</a>
        ) : answer !== null && answer in final ? (
          <>
            <div role="status" style={{ fontWeight: 600 }}>{final[answer]}</div>
            {full && waitingList && <a href={waitingList} target="_blank" rel="noopener noreferrer" style={button}>{words.waitingList}</a>}
            <button type="button" onClick={onClose} style={{ ...button, background: "transparent", color: props.textColour, border: `1px solid ${props.lineColour}` }}>
              {words.done}
            </button>
          </>
        ) : full ? (
          waitingList && <a href={waitingList} target="_blank" rel="noopener noreferrer" style={button}>{words.waitingList}</a>
        ) : (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              {words.name}
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required autoFocus style={input} />
            </label>
            <label>
              {words.phone}
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" required style={input} />
            </label>
            {answer !== null && answer in retry && <div role="alert" style={{ color: props.mutedColour }}>{retry[answer]}</div>}
            <button type="submit" disabled={sending} style={{ ...button, opacity: sending ? 0.6 : 1 }}>{words.book}</button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ------------------------------------------------------------------
//  Small shared pieces
// ------------------------------------------------------------------

function wordsOf(props: Props): Words {
  return { ...WORDS, ...props.words }
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
      monday: { type: ControlType.Boolean, title: "Monday", defaultValue: true },
      tuesday: { type: ControlType.Boolean, title: "Tuesday", defaultValue: true },
      wednesday: { type: ControlType.Boolean, title: "Wednesday", defaultValue: true },
      thursday: { type: ControlType.Boolean, title: "Thursday", defaultValue: true },
      friday: { type: ControlType.Boolean, title: "Friday", defaultValue: true },
      saturday: { type: ControlType.Boolean, title: "Saturday", defaultValue: true },
      sunday: { type: ControlType.Boolean, title: "Sunday", defaultValue: false },
    },
    hidden: (p) => p.view === "list",
  },
  language: { type: ControlType.String, title: "Language", defaultValue: "en" },
  method: {
    type: ControlType.Enum,
    title: "Booking",
    description: "Website: name and phone, instant answer, places enforced. WhatsApp: opens a chat with a ready message.",
    options: ["website", "whatsapp"],
    optionTitles: ["Website", "WhatsApp"],
    defaultValue: "website",
    displaySegmentedControl: true,
  },
  placesFrom: {
    type: ControlType.Number,
    title: "Places left from",
    description: "Shows \"3 places left\" once 3 or fewer remain. 0 shows only \"Full\".",
    defaultValue: 3,
    min: 0,
    max: 50,
    step: 1,
    displayStepper: true,
    hidden: (p) => p.method === "whatsapp",
  },
  whatsapp: {
    type: ControlType.String,
    title: "WhatsApp",
    description: "The studio's number, with the country code. Website booking: used for the waiting-list link on full classes. WhatsApp booking: required.",
    defaultValue: "",
    placeholder: "+961 70 123 456",
  },
  mainColour: { type: ControlType.Color, title: "Main colour", defaultValue: "#6B7280" },
  textColour: { type: ControlType.Color, title: "Text", defaultValue: "#1A1A1A" },
  mutedColour: { type: ControlType.Color, title: "Muted text", defaultValue: "#6B6B6B" },
  lineColour: { type: ControlType.Color, title: "Lines", defaultValue: "#E6E6E6" },
  panelColour: { type: ControlType.Color, title: "Panel", defaultValue: "#FFFFFF" },
  buttonColour: { type: ControlType.Color, title: "Button", defaultValue: "#1A1A1A" },
  buttonTextColour: { type: ControlType.Color, title: "Button text", defaultValue: "#FFFFFF" },
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
  listTitle: {
    type: ControlType.String,
    title: "List title",
    defaultValue: "Upcoming classes",
    hidden: (p) => p.view !== "list",
  },
  emptyMonthText: {
    type: ControlType.String,
    title: "Empty month",
    defaultValue: "No classes scheduled this month",
    hidden: (p) => p.view === "list",
  },
  emptyListText: {
    type: ControlType.String,
    title: "Empty list",
    defaultValue: "No upcoming classes",
    hidden: (p) => p.view !== "list",
  },
  errorText: { type: ControlType.String, title: "Can't load", defaultValue: "The timetable can't be loaded right now." },
  words: {
    type: ControlType.Object,
    title: "Booking words",
    controls: {
      book: { type: ControlType.String, title: "Book button", defaultValue: WORDS.book },
      name: { type: ControlType.String, title: "Name field", defaultValue: WORDS.name },
      phone: { type: ControlType.String, title: "Phone field", defaultValue: WORDS.phone },
      placesLeft: { type: ControlType.String, title: "Places left", defaultValue: WORDS.placesLeft },
      lastPlace: { type: ControlType.String, title: "Last place", defaultValue: WORDS.lastPlace },
      full: { type: ControlType.String, title: "Full", defaultValue: WORDS.full },
      booked: { type: ControlType.String, title: "Booked", defaultValue: WORDS.booked },
      justFilled: { type: ControlType.String, title: "Just filled up", defaultValue: WORDS.justFilled },
      alreadyBooked: { type: ControlType.String, title: "Already booked", defaultValue: WORDS.alreadyBooked },
      closed: { type: ControlType.String, title: "Can't be booked", defaultValue: WORDS.closed },
      invalidName: { type: ControlType.String, title: "Name missing", defaultValue: WORDS.invalidName },
      invalidPhone: { type: ControlType.String, title: "Phone not valid", defaultValue: WORDS.invalidPhone },
      failed: { type: ControlType.String, title: "Couldn't book", defaultValue: WORDS.failed },
      waitingList: { type: ControlType.String, title: "Waiting list", defaultValue: WORDS.waitingList },
      waitingMessage: { type: ControlType.String, title: "Waiting list message", defaultValue: WORDS.waitingMessage },
      done: { type: ControlType.String, title: "Done", defaultValue: WORDS.done },
      bookOnWhatsapp: { type: ControlType.String, title: "WhatsApp button", defaultValue: WORDS.bookOnWhatsapp },
      bookingMessage: { type: ControlType.String, title: "WhatsApp booking message", defaultValue: WORDS.bookingMessage },
    },
  },
})
