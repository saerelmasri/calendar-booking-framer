// parts.tsx — the small building blocks: the login screen, messages, the loading
// placeholder, the "•••" menu, a refusal line, a person's line, the name-and-phone form,
// and the picker for moving someone to another class.

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { whatsappLink } from "../shared/month.ts"
import { ChatIcon, WarningIcon } from "./icons.tsx"
import { type Booking, internationalPhone, type OwnerSession, readablePhone } from "./logic.ts"
import { type Look } from "./styles.ts"
import { type Props } from "./types.ts"

export function Centred({ look, children }: { look: Look; children: ReactNode }) {
  return <div style={look.centred}>{children}</div>
}

export function Login({ props, look, logIn }: { props: Props; look: Look; logIn: (email: string, password: string, remember: boolean) => Promise<void> }) {
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
      {error && <Alert look={look} text={error} />}
      <button className="bd-btn" type="submit" disabled={busy} style={{ ...look.button, width: "100%", padding: "12px 16px" }}>
        {busy ? <><span className="bd-spinner" aria-hidden="true" />Logging in…</> : "Log in"}
      </button>
    </form>
  )
}

export function Message({ props, look, text, action, onAction }: { props: Props; look: Look; text: string; action: string; onAction: () => void }) {
  return (
    <div className="bd-fade" style={{ ...look.loginCard, alignItems: "center", textAlign: "center" }}>
      <h1 style={{ ...look.title, fontSize: "2.2em" }}>{props.studioName || "Bookings"}</h1>
      <div>{text}</div>
      <button className="bd-btn" type="button" onClick={onAction} style={look.button}>{action}</button>
    </div>
  )
}

// While the bookings load: the dashboard's shape, softly shimmering.
export function Skeleton({ look }: { look: Look }) {
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

// A small "•••" menu: opens under its button, closes on a tap outside or Escape.
export function Menu({ look, children }: { look: Look; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("click", close)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("click", close)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])
  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button className="bd-action" type="button" aria-label="Menu" aria-haspopup="true" aria-expanded={open}
        onClick={() => setOpen(!open)} style={{ ...look.action, minWidth: 44 }}>•••</button>
      {open && <div style={look.menu}>{children}</div>}
    </div>
  )
}

// A refusal or error, said where it happened: the warning icon and one line of text.
export function Alert({ look, text }: { look: Look; text: string }) {
  return (
    <div role="alert" style={look.alert}>
      <span style={{ display: "inline-flex", marginTop: 2 }}><WarningIcon colour={look.warningText} /></span>
      <span>{text}</span>
    </div>
  )
}

// message: the WhatsApp text, ready written ("" for an empty chat). Numbers saved without
// a country code (as people often type them) get the studio's, so WhatsApp can open them.
export function Person({ booking: b, look, countryCode, message, open, onToggle }: {
  booking: Booking; look: Look; countryCode: string; message: string; open?: boolean; onToggle?: () => void
}) {
  const whatsapp = whatsappLink(internationalPhone(b.phone, countryCode ?? ""), message)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
        {b.name}
        <span style={{ ...look.muted, display: "block", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>{readablePhone(b.phone, countryCode ?? "")}</span>
      </span>
      {whatsapp && (
        <a className="bd-action" href={whatsapp} target="_blank" rel="noopener noreferrer"
          aria-label={`WhatsApp ${b.name}`} title="WhatsApp" style={look.iconButton}><ChatIcon colour={look.accent} /></a>
      )}
      {onToggle && (
        <button className="bd-action" type="button" aria-label={`More for ${b.name}`} aria-expanded={!!open}
          onClick={onToggle} style={look.iconButton}>•••</button>
      )}
    </div>
  )
}

// Name and phone, for Add and Replace. Labels stay visible while typing; Cancel or Escape
// closes it; the name field is ready to type in.
export function NameAndPhone({ look, button, busy, onSubmit, onCancel }: {
  look: Look; button: string; busy: boolean; onSubmit: (name: string, phone: string) => void; onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const field = { ...look.note, display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", minWidth: 0 } as CSSProperties
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(name.trim(), phone) }}
      onKeyDown={(e) => { if (e.key === "Escape") onCancel() }}
      style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 8 }}
    >
      <label style={field}>
        Name
        <input className="bd-input" autoFocus value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={80} autoComplete="off" style={{ ...look.input, marginTop: 0 }} />
      </label>
      <label style={field}>
        Phone
        <input className="bd-input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          required autoComplete="off" style={{ ...look.input, marginTop: 0 }} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="bd-btn" type="submit" disabled={busy} style={look.button}>
          {busy ? <><span className="bd-spinner" aria-hidden="true" />{button}…</> : button}
        </button>
        <button className="bd-action" type="button" onClick={onCancel} disabled={busy} style={look.action}>Cancel</button>
      </div>
    </form>
  )
}

// Pick another class for someone: for booking people from a cancelled class elsewhere, or
// moving them. Lists the classes they could go to, with the places left.
export function ClassPicker({ look, when, choices, title, button, busy, onPick, onCancel }: {
  look: Look; when: (iso: string) => string; choices: OwnerSession[]
  title: string; button: string; busy: boolean; onPick: (to: OwnerSession) => void; onCancel: () => void
}) {
  const [target, setTarget] = useState("")
  const picked = choices.find((o) => o.id === target)
  return (
    <div style={look.picker} onKeyDown={(e) => { if (e.key === "Escape") onCancel() }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <strong>{title}</strong>
        <select className="bd-input" value={target} onChange={(e) => setTarget(e.target.value)} autoFocus
          style={{ ...look.input, marginTop: 0 }}>
          <option value="">Pick a class</option>
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title} · {when(o.starts_at)}{o.places !== null && ` · ${o.places - o.bookings.length} left`}
            </option>
          ))}
        </select>
      </label>
      <div style={look.actions}>
        <button className="bd-btn" type="button" disabled={!picked || busy} onClick={() => picked && onPick(picked)} style={look.button}>
          {busy ? <><span className="bd-spinner" aria-hidden="true" />{button}…</> : button}
        </button>
        <button className="bd-action" type="button" onClick={onCancel} disabled={busy} style={look.action}>Cancel</button>
      </div>
    </div>
  )
}
