// ClassDetail.tsx — one class: how full it is, + Add someone, and its people, each with
// WhatsApp and (behind "•••") Replace, Move to another class, and Remove, which asks first.

import { useRef, useState } from "react"
import { whatsappLink } from "../shared/month.ts"
import { moveMessage } from "./Attention.tsx"
import { firstName, REFUSALS } from "./helpers.ts"
import { ClockIcon, WarningIcon } from "./icons.tsx"
import { type Booking, classesToMoveTo, fixHint, fullness, internationalPhone, type OwnerSession, wasMoved } from "./logic.ts"
import { Alert, ClassPicker, NameAndPhone, Person } from "./parts.tsx"
import { type Look } from "./styles.ts"
import { type Call, type Notify, type ToastLink, type When } from "./types.ts"

export function ClassDetail({ session: s, look, when, call, reload, countryCode, notify, sessions, studio, openAttention, startAdding = false }: {
  session: OwnerSession; look: Look; when: When; call: Call; reload: () => Promise<unknown>; countryCode: string
  notify: Notify; sessions: OwnerSession[]; studio: string
  openAttention: (id: string) => void   // the class's item in Needs attention, where people are told
  startAdding?: boolean            // opened from "+ Walk-in": the Add form is ready
}) {
  const peopleHeading = useRef<HTMLHeadingElement>(null)        // where focus goes after an action
  const [adding, setAdding] = useState(startAdding)
  const [replacing, setReplacing] = useState<string | null>(null)       // the booking being replaced
  const [removing, setRemoving] = useState<string | null>(null)         // the booking being removed
  const [moving, setMoving] = useState<string | null>(null)             // the booking being moved to another class
  const [openRow, setOpenRow] = useState<string | null>(null)           // whose Replace and Remove are showing
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ at: string; text: string } | null>(null)  // a refusal, and which form it belongs to
  const { label, full } = fullness(s)
  const count = (n: number) => (s.places === null ? `${n} booked` : `${n}/${s.places}`)
  const classWhen = when(s.starts_at)
  const untold = s.bookings.filter((b) => !b.told_at).length    // for a moved class: people still to tell
  const started = Date.parse(s.starts_at) <= Date.now()
  // What happens to the freed spot, said at the moment of choosing.
  const spotNote = s.problem ? "The class is hidden from the site, so the spot won't be offered."
    : started ? "The class has started, so the spot won't be offered on the website."
    : "Their spot opens on the website straight away."

  // Moving someone: booked on the other class and their place here freed, in one step.
  // They leave this list, so the toast offers to tell them on WhatsApp.
  const moveChoices = (b: Booking) => classesToMoveTo(b, s, sessions, new Date())
  const moveTo = (b: Booking, to: OwnerSession) => {
    const whatsapp = whatsappLink(internationalPhone(b.phone, countryCode ?? ""), moveMessage(b, s, to, when, studio))
    return act(b.id, "owner_move", { p_booking: b.id, p_session: to.id }, `${b.name} moved to ${to.title}, ${when(to.starts_at)}`,
      whatsapp ? { label: `Tell ${firstName(b.name)}`, href: whatsapp } : undefined,
      { full: "That class just filled up. Pick another one." })
  }

  // One action: ask the database. A refusal is explained under the form it came from; a
  // success is confirmed for 5 seconds. Then everything is loaded again, with the buttons
  // already free.
  // link: one thing to do next, in the toast. refusals: wording that fits this action better.
  async function act(at: string, name: string, args: Record<string, unknown>, success: string,
    link?: ToastLink, refusals: Record<string, string> = {}) {
    setBusy(true)
    setNotice(null)
    try {
      const answer = await call<{ status: string }>(name, args)
      const problem = refusals[answer.status] ?? REFUSALS[answer.status]
      setBusy(false)
      if (problem) setNotice({ at, text: problem })
      else {
        setAdding(false); setReplacing(null); setRemoving(null); setMoving(null); setOpenRow(null)
        notify(success, link)
      }
      await reload()
      if (!problem) peopleHeading.current?.focus()
    } catch {
      setNotice({ at, text: "That didn't go through. Please try again." })
      setBusy(false)
    }
  }
  const refusal = (at: string) => (notice?.at === at ? <Alert look={look} text={notice.text} /> : null)

  const facts = [Object.values(s.details).join(" · "), s.location].filter(Boolean)

  return (
    <div className="bd-fade" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ ...look.title, fontSize: "1.8em" }}>{s.title}</h2>
        <div style={{ ...look.muted, marginTop: 4 }}>{classWhen}{facts.length > 0 && ` · ${facts.join(" · ")}`}</div>
        <div style={{ marginTop: 10, display: "inline-block", ...look.chip(full) }}>
          {full ? `Full · ${label}` : label}
        </div>
        {s.problem && (
          <div style={{ ...look.warningPanel, marginTop: 12 }}>
            <WarningIcon colour={look.warningText} />
            <span><strong>Hidden from the site.</strong> {s.problem}. {fixHint(s.problem)}</span>
          </div>
        )}
        {!s.problem && wasMoved(s) && (
          <div style={{ ...look.softPanel, marginTop: 12 }}>
            <ClockIcon colour={look.mutedColour} />
            <span>
              Moved from {when(s.moved_from!)}.{" "}
              {untold > 0 ? (
                <>
                  {untold === 1 ? "1 person" : `${untold} people`} still to tell.{" "}
                  <button className="bd-link" type="button" onClick={() => openAttention(s.id)} style={look.link}>
                    Open in Needs attention
                  </button>
                </>
              ) : s.bookings.length > 0 ? "Everyone's been told." : null}
            </span>
          </div>
        )}
      </div>

      {/* Adding someone comes first: a walk-in shouldn't need a scroll past everyone booked */}
      {(!s.problem || refusal("add")) && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {s.problem ? null : full ? (
            <div style={look.muted}>Full — use Replace to swap someone in.</div>
          ) : adding ? (
            <NameAndPhone look={look} button="Add" busy={busy} onCancel={() => setAdding(false)}
              onSubmit={(name, phone) => void act("add", "owner_add", { p_session: s.id, p_name: name, p_phone: phone }, `${name} added · ${count(s.bookings.length + 1)}`)} />
          ) : (
            <button className="bd-btn" type="button" onClick={() => { setAdding(true); setReplacing(null) }} style={{ ...look.button, alignSelf: "flex-start" }}>+ Add someone</button>
          )}
          {refusal("add")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        <h3 ref={peopleHeading} tabIndex={-1} style={{ ...look.heading, marginBottom: 4, outline: "none" }}>People</h3>
        {s.bookings.length === 0 && <div style={{ ...look.muted, padding: "12px 0" }}>
          {s.problem ? "No one booked yet." : "No one booked yet. Bookings from the website appear here, or use + Add someone."}
        </div>}
        {s.bookings.map((b) => (
          <div key={b.id} style={{ borderTop: `1px solid ${look.line}`, padding: "12px 0" }}>
            <Person booking={b} look={look} countryCode={countryCode} message="" open={openRow === b.id}
              onToggle={() => { setOpenRow(openRow === b.id ? null : b.id); setRemoving(null); setReplacing(null); setAdding(false) }} />
            {openRow === b.id && (
              <div style={look.actions} onKeyDown={(e) => { if (e.key === "Escape") setOpenRow(null) }}>
                <button className="bd-action" type="button" disabled={busy} aria-pressed={replacing === b.id}
                  onClick={() => { setReplacing(replacing === b.id ? null : b.id); setRemoving(null); setMoving(null) }}
                  style={look.action}>Replace</button>
                {moveChoices(b).length > 0 && (
                  <button className="bd-action" type="button" disabled={busy} aria-pressed={moving === b.id}
                    onClick={() => { setMoving(moving === b.id ? null : b.id); setRemoving(null); setReplacing(null) }}
                    style={look.action}>Move</button>
                )}
                <button className="bd-action" type="button" disabled={busy}
                  onClick={() => { setRemoving(b.id); setReplacing(null); setMoving(null) }}
                  style={look.action}>Remove</button>
              </div>
            )}

            {removing === b.id && (
              <div role="alertdialog" aria-label={`Remove ${b.name}?`} style={look.confirm}
                onKeyDown={(e) => { if (e.key === "Escape") setRemoving(null) }}>
                <strong>Remove {b.name} from {s.title}, {classWhen}?</strong>
                <span style={look.muted}>{spotNote}</span>
                <div style={look.actions}>
                  <button className="bd-btn" type="button" disabled={busy}
                    onClick={() => void act(b.id, "owner_cancel", { p_booking: b.id },
                      `${b.name} removed · ${s.problem || started ? "the spot isn't offered on the website" : "the spot is open on the website"}`)}
                    style={look.dangerButton}>
                      {busy ? <><span className="bd-spinner" aria-hidden="true" />Removing…</> : `Remove ${firstName(b.name)}`}
                    </button>
                  <button className="bd-action" type="button" autoFocus onClick={() => setRemoving(null)}
                    style={look.action}>Keep booking</button>
                </div>
                {!s.problem && (
                  <button className="bd-link" type="button" onClick={() => { setRemoving(null); setReplacing(b.id) }}
                    style={{ ...look.link, alignSelf: "flex-start" }}>Someone else is taking the spot? Replace instead</button>
                )}
              </div>
            )}

            {moving === b.id && (
              <ClassPicker look={look} when={when} choices={moveChoices(b)} busy={busy} onCancel={() => setMoving(null)}
                title={`Move ${firstName(b.name)} to:`} button={`Move ${firstName(b.name)}`}
                onPick={(to) => void moveTo(b, to)} />
            )}
            {replacing === b.id && (
              <NameAndPhone look={look} button={`Replace ${firstName(b.name)}`} busy={busy} onCancel={() => setReplacing(null)}
                onSubmit={(name, phone) => void act(b.id, "owner_replace", { p_booking: b.id, p_name: name, p_phone: phone }, `${b.name} replaced by ${name}`)} />
            )}
            {refusal(b.id)}
          </div>
        ))}
      </div>

    </div>
  )
}
