// Attention.tsx — Needs attention: classes hidden by a setup problem, and cancelled or
// moved classes with people to tell. Ready-written WhatsApp messages, Told ticks, booking
// people from a cancelled class on another one, and moving people who can't make a new
// time. Also the late-sync banner.

import { useRef, useState } from "react"
import { whatsappLink } from "../shared/month.ts"
import { firstName, REFUSALS } from "./helpers.ts"
import { ClockIcon, WarningIcon } from "./icons.tsx"
import { type Attention, type Booking, classesToMoveTo, fixHint, internationalPhone, type OwnerSession, rebookedOn } from "./logic.ts"
import { Alert, ClassPicker, Person } from "./parts.tsx"
import { type Look } from "./styles.ts"
import { type Call, type Notify, type ToastLink, type When } from "./types.ts"

export const KINDS: { kind: Attention["kind"]; title: string }[] = [
  { kind: "problem", title: "Hidden from the site" },
  { kind: "cancelled", title: "Cancelled — people to tell" },
  { kind: "moved", title: "Moved — people to tell" },
]

export function AttentionList({ attention, look, when, selected, pick }: {
  attention: Attention[]; look: Look; when: When; selected: string | null; pick: (id: string) => void
}) {
  // A late sync shows as the banner above every section, so it isn't repeated here.
  const classes = attention.filter((a) => a.kind !== "sync")
  if (classes.length === 0) return <p style={look.muted}>{attention.length ? "Nothing else needs your attention." : "All clear. Cancelled, moved, or hidden classes will show up here."}</p>
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
                  {a.kind !== "problem" && <span style={{ whiteSpace: "nowrap" }}>{s.bookings.filter((b) => !b.told_at).length} to tell</span>}
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

export function AttentionDetail({ item, look, when, call, reload, sessions, studio, countryCode, notify }: {
  item: Exclude<Attention, { kind: "sync" }>; look: Look; when: When; call: Call; reload: () => Promise<unknown>
  sessions: OwnerSession[]; studio: string; countryCode: string; notify: Notify
}) {
  const toldHeading = useRef<HTMLHeadingElement>(null)          // where focus goes after an action
  const s = item.session
  const [busy, setBusy] = useState<string | null>(null)                 // the booking being saved
  const [moving, setMoving] = useState<string | null>(null)             // the booking being put on another class
  const [notice, setNotice] = useState<{ at: string; text: string } | null>(null)
  const told = s.bookings.filter((b) => b.told_at).length
  const text =
    item.kind === "problem" ? `Hidden from the site: ${s.problem}. ${fixHint(s.problem!)} It reappears at the next sync.`
    : item.kind === "cancelled" ? "Cancelled in Google Calendar. Let these people know, then tick them off:"
    : `Moved from ${when(s.moved_from!)} to ${when(s.starts_at)}. Let these people know, then tick them off:`

  async function save(b: Booking, work: () => Promise<string | null>, success: string, link?: ToastLink) {
    setBusy(b.id)
    setNotice(null)
    try {
      const problem = await work()
      setBusy(null)
      if (problem) setNotice({ at: b.id, text: problem })
      else {
        setMoving(null)
        notify(success, link)
      }
      await reload()
      if (!problem) toldHeading.current?.focus()
    } catch {
      setNotice({ at: b.id, text: "That didn't go through. Please try again." })
      setBusy(null)
    }
  }

  const markTold = (b: Booking, value: boolean) => save(b, async () => {
    const answer = await call<{ status: string }>("owner_mark_told", { p_booking: b.id, p_told: value })
    return REFUSALS[answer.status] ?? null
  }, value ? `${b.name} ticked as told` : `${b.name} unticked`)

  // Book them on the other class. Told stays unticked: they still need telling, and their
  // WhatsApp message now says where they've been booked.
  const bookElsewhere = (b: Booking, other: OwnerSession) => save(b, async () => {
    const answer = await call<{ status: string }>("owner_add", { p_session: other.id, p_name: b.name, p_phone: b.phone })
    return REFUSALS[answer.status] ?? null
  }, `${b.name} booked on ${other.title}, ${when(other.starts_at)} · now tell ${firstName(b.name)}`)

  // Can't make the new time: move them to another class in one step (booked there, their
  // place here freed). They leave this list, so the toast offers to tell them.
  const moveTo = (b: Booking, to: OwnerSession) => {
    const whatsapp = whatsappLink(internationalPhone(b.phone, countryCode ?? ""), moveMessage(b, s, to, when, studio))
    return save(b, async () => {
      const answer = await call<{ status: string }>("owner_move", { p_booking: b.id, p_session: to.id })
      return answer.status === "full" ? "That class just filled up. Pick another one." : REFUSALS[answer.status] ?? null
    }, `${b.name} moved to ${to.title}, ${when(to.starts_at)}`, whatsapp ? { label: `Tell ${firstName(b.name)}`, href: whatsapp } : undefined)
  }

  // Everyone at once. A WhatsApp link opens one chat, so "everyone" is a message to copy
  // (for a broadcast list or a group) and one button to tick all who are left.
  const [copied, setCopied] = useState(false)
  const untold = s.bookings.filter((b) => !b.told_at)
  async function copyForEveryone() {
    try {
      await navigator.clipboard.writeText(changeMessage(item, null, when, studio, null))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    } catch {
      notify("Couldn't copy here. Open one person's WhatsApp and copy the message from there.")
    }
  }
  async function markAll() {
    setBusy("all")
    setNotice(null)
    const results = await Promise.allSettled(untold.map((b) => call("owner_mark_told", { p_booking: b.id, p_told: true })))
    const failed = results.filter((r) => r.status === "rejected").length
    setBusy(null)
    notify(failed ? `${untold.length - failed} ticked as told; ${failed} didn't go through. Please try again.` : "Everyone ticked as told")
    await reload()
    toldHeading.current?.focus()
  }

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
        <div style={{ display: "flex", flexDirection: "column" }}>
          <h3 ref={toldHeading} tabIndex={-1} style={{ ...look.heading, marginBottom: 4, outline: "none" }}>
            {told === s.bookings.length ? `Everyone's been told · ${told}` : `Told ${told} of ${s.bookings.length}`}
          </h3>
          {s.bookings.length > 1 && (
            <div style={{ ...look.actions, marginTop: 4, marginBottom: 12 }}>
              <button className="bd-action" type="button" onClick={() => void copyForEveryone()} style={look.action}>
                {copied ? "Copied ✓" : "Copy message for everyone"}
              </button>
              {untold.length > 1 && (
                <button className="bd-action" type="button" disabled={busy !== null} onClick={() => void markAll()} style={look.action}>
                  {busy === "all" ? <><span className="bd-spinner" aria-hidden="true" />Marking…</> : `Mark all ${untold.length} as told`}
                </button>
              )}
            </div>
          )}
          {s.bookings.map((b) => {
            const moved = item.kind === "cancelled" ? rebookedOn(b, s, sessions, new Date()) : null
            const choices = moved ? [] : classesToMoveTo(b, s, sessions, new Date())
            const first = firstName(b.name)
            return (
              <div key={b.id} style={{ borderTop: `1px solid ${look.line}`, padding: "12px 0" }}>
                <Person booking={b} look={look} countryCode={countryCode} message={changeMessage(item, b, when, studio, moved)} />
                {moved && <div style={look.note}>Booked on {moved.title} · {when(moved.starts_at)}</div>}
                <div style={look.actions}>
                  <button className="bd-action" type="button" disabled={busy !== null} aria-pressed={!!b.told_at}
                    onClick={() => void markTold(b, !b.told_at)} style={look.action}>
                    {b.told_at ? <>Told<span aria-hidden="true"> ✓</span></> : "Mark as told"}
                  </button>
                  {choices.length > 0 && moving !== b.id && (
                    <button className="bd-link" type="button" disabled={busy !== null}
                      onClick={() => setMoving(b.id)} style={look.link}>
                      {item.kind === "cancelled" ? "Book on another class…" : "Can't make it? Move to another class…"}
                    </button>
                  )}
                </div>
                {moving === b.id && (
                  <ClassPicker look={look} when={when} choices={choices} busy={busy === b.id} onCancel={() => setMoving(null)}
                    {...(item.kind === "cancelled"
                      ? { title: `Book ${first} on:`, button: `Book ${first}`, onPick: (to: OwnerSession) => void bookElsewhere(b, to) }
                      : { title: `Move ${first} to:`, button: `Move ${first}`, onPick: (to: OwnerSession) => void moveTo(b, to) })} />
                )}
                {notice?.at === b.id && <Alert look={look} text={notice.text} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// The WhatsApp message for someone on a cancelled or moved class, ready to send.
// The WhatsApp message after moving someone to another class.
export function moveMessage(b: Booking, from: OwnerSession, to: OwnerSession, when: When, studio: string) {
  const at = (iso: string) => when(iso).replace(" · ", " at ")
  return `Hi ${firstName(b.name)}, it's ${studio}. No problem, we've moved you from ${from.title} to ${to.title}, ${at(to.starts_at)}. See you there!`
}

// b: the person, or null for the copy that goes to everyone ("Hi, it's Neroli.").
// moved: the class they were booked on instead, if any.
export function changeMessage(item: Exclude<Attention, { kind: "sync" }>, b: Booking | null, when: When, studio: string, moved: OwnerSession | null) {
  const at = (iso: string) => when(iso).replace(" · ", " at ")
  const s = item.session
  const hello = b ? `Hi ${firstName(b.name)}, it's ${studio}.` : `Hi, it's ${studio}.`
  return item.kind === "cancelled"
    ? `${hello} Sorry, ${s.title} on ${at(s.starts_at)} is cancelled. ` + (moved
      ? `We've booked you on ${moved.title}, ${at(moved.starts_at)} instead. Reply here if that doesn't work for you.`
      : "Reply here and we'll find you another class.")
    : `${hello} ${s.title} has moved from ${at(s.moved_from!)} to ${at(s.starts_at)}. Does the new time still work for you?`
}

// A late or missing calendar sync, above every section: it affects the whole site.
export function SyncBanner({ item, look, when }: { item: Attention; look: Look; when: When }) {
  if (item.kind !== "sync") return null
  return (
    <div role="status" style={look.warningBanner}>
      <WarningIcon colour={look.warningText} />
      <span>
        <strong>{item.lastSync ? `The calendar hasn't synced since ${when(item.lastSync)}.` : "The calendar has never synced."}</strong>{" "}
        Bookings on the website still work; changes made in Google Calendar won't show until it syncs. If this lasts more than a few hours, contact your website team.
      </span>
    </div>
  )
}
