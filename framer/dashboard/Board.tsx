// Board.tsx — the layout once logged in. On a desktop: a tinted sidebar fixed to the full
// height, then one surface with the list and the details side by side, each scrolling on
// its own. On a phone: one screen at a time, the sections and Refresh in a bar at the
// bottom. Also Refresh (which syncs Google Calendar first) and the ✓ toast.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { addDays, calendarDay, dayLabel, timeOf } from "../shared/month.ts"
import { AttentionDetail, AttentionList, SyncBanner } from "./Attention.tsx"
import { ClassDetail } from "./ClassDetail.tsx"
import { ClassesList, NextClassCard } from "./ClassesList.tsx"
import { ago, safeLanguage } from "./helpers.ts"
import { applyFilters, filterOptions, findClasses, needsAttention, nextClass, ownerClasses, type OwnerSession, wasMoved } from "./logic.ts"
import { Menu } from "./parts.tsx"
import { type Look } from "./styles.ts"
import { BOARD_DAYS, type Call, type Data, type Notify, type Props, type Route, type ToastLink, type When } from "./types.ts"

export function Board({ inEditor, data, loadedAt, props, look, call, reload, logOut, route, go }: {
  inEditor: boolean; data: Data; loadedAt: number; props: Props; look: Look; call: Call; reload: () => Promise<Data | null>; logOut: () => void
  route: Route; go: (to: Route) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const [slow, setSlow] = useState(false)                  // the sync didn't finish within 20 seconds
  // One confirmation for the whole dashboard ("✓ Sara added · 8/10"), shown where it's
  // always in sight: above the phone's bar, or at the bottom on a desktop. 5 seconds, or 8
  // when it offers something to do next ("Tell Sara").
  const [toast, setToast] = useState<{ text: string; link?: ToastLink } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)
  const notify: Notify = (text, link) => {
    setToast({ text, link })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), link ? 8000 : 5000)
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])
  useEffect(() => setSlow(false), [data.lastSync])         // …until a later load brings it in
  const [query, setQuery] = useState("")                  // the search box
  const [showLater, setShowLater] = useState(false)       // "Later this month" opened
  const [addFor, setAddFor] = useState<string | null>(null) // a class opened from "+ Walk-in", with Add ready
  useEffect(() => { if (route.id !== addFor) setAddFor(null) }, [route.id])
  const [chosen, setChosen] = useState<Record<string, string>>({})   // the filters, e.g. { location: "Achrafieh" }
  const [showFilters, setShowFilters] = useState(false)  // the phone's filters, folded behind "Filter"
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
  // The badge counts classes; a late sync has its own banner above every section.
  const classItems = attention.filter((a) => a.kind !== "sync").length
  const attentionLabel = `Needs attention, ${classItems} ${classItems === 1 ? "class" : "classes"}`
  const when: When = (iso) => `${dayLabel(calendarDay(new Date(iso), tz), language)} · ${timeOf(new Date(iso), tz)}`

  // Refresh: sync Google Calendar first, then load. The sync takes a few seconds, so look
  // again every 2 seconds until its time changes (up to 20 seconds). If the sync can't be
  // started, it still loads what the database has.
  async function refresh() {
    setRefreshing(true)
    setSlow(false)
    const before = data.lastSync
    let started = true
    try { await call("owner_sync", {}) } catch { started = false }
    let fresh = await reload()
    for (let i = 0; started && fresh && fresh.lastSync === before && i < 10; i++) {
      await new Promise((done) => window.setTimeout(done, 2000))
      fresh = await reload()
    }
    if (started && fresh && fresh.lastSync === before) setSlow(true)
    setRefreshing(false)
  }

  // This week's classes, the rest of the month, and what the search finds: each grouped by day
  const byDay = (list: OwnerSession[]) => {
    const groups: [string, OwnerSession[]][] = []
    for (const s of list) {
      const day = calendarDay(new Date(s.starts_at), tz)
      const group = groups.find(([d]) => d === day)
      if (group) group[1].push(s)
      else groups.push([day, [s]])
    }
    return groups
  }
  const lastDay = addDays(today, BOARD_DAYS - 1)
  const allUpcoming = ownerClasses(data.sessions, now)
  const filters = filterOptions(allUpcoming)
  const upcoming = applyFilters(allUpcoming, chosen)
  const week = byDay(upcoming.filter((s) => calendarDay(new Date(s.starts_at), tz) <= lastDay))
  const later = byDay(upcoming.filter((s) => calendarDay(new Date(s.starts_at), tz) > lastDay))
  const found = query.trim() ? findClasses(upcoming, query, props.countryCode ?? "") : null
  const dayName = (day: string) =>
    day === today ? `Today · ${dayLabel(day, language)}` : day === addDays(today, 1) ? `Tomorrow · ${dayLabel(day, language)}` : dayLabel(day, language)

  // What's open. On a desktop the first class is shown when none is picked.
  const byId = new Map(data.sessions.map((s) => [s.id, s]))
  const firstClass = week[0]?.[1][0]
  const openClass = route.section === "classes"
    ? (route.id ? byId.get(route.id) : look.isDesktop ? firstClass : undefined)
    : undefined
  // On a desktop, Needs attention opens its first item, as Classes opens its first class.
  const firstItem = attention.find((a) => a.kind !== "sync")
  const attentionId = route.id ?? (look.isDesktop && firstItem ? firstItem.session.id : null)
  // Once everyone is ticked as told, the class leaves the list, but stays open until the
  // owner picks something else, so the last tick doesn't make the screen disappear.
  const openSession = route.section === "attention" && attentionId ? byId.get(attentionId) : undefined
  const openItem = route.section === "attention" && attentionId
    ? attention.find((a) => a.kind !== "sync" && a.session.id === attentionId)
      ?? (openSession?.cancelled_at ? { kind: "cancelled" as const, session: openSession }
        : openSession && wasMoved(openSession) ? { kind: "moved" as const, session: openSession } : undefined)
    : undefined

  const pickClass = (id: string) => go({ section: "classes", id })

  // The phone's "Next class" card: today's class under way or next, unless searching or filtering
  const next = !look.isDesktop && !query.trim() && !Object.values(chosen).some(Boolean)
    ? nextClass(data.sessions, now, today, (iso) => calendarDay(new Date(iso), tz))
    : null
  const nextCard = next ? (
    <NextClassCard session={next} look={look} tz={tz} now={now}
      onAdd={() => { setAddFor(next.id); pickClass(next.id) }} onOpen={() => pickClass(next.id)} />
  ) : undefined
  const list = route.section === "classes" ? (
    <ClassesList look={look} query={query} setQuery={setQuery} filters={filters} chosen={chosen} setChosen={setChosen}
      showFilters={showFilters} setShowFilters={setShowFilters} showLater={showLater} setShowLater={setShowLater}
      found={found} week={week} later={later} byDay={byDay} dayName={dayName} tz={tz} selected={openClass?.id} pick={pickClass} nextCard={nextCard} />
  ) :<AttentionList attention={attention} look={look} when={when} selected={attentionId} pick={(id) => go({ section: "attention", id })} />

  const detail = openClass
    ? <ClassDetail key={openClass.id} session={openClass} look={look} when={when} call={call} reload={reload} countryCode={props.countryCode} notify={notify}
      sessions={data.sessions} studio={props.studioName} startAdding={addFor === openClass.id}
      openAttention={(id) => go({ section: "attention", id })} />
    : openItem && openItem.kind !== "sync"
      ? <AttentionDetail key={openItem.session.id} item={openItem} look={look} when={when} call={call} reload={reload}
          sessions={data.sessions} studio={props.studioName} countryCode={props.countryCode} notify={notify} />
      : <p style={{ ...look.muted, marginTop: 8 }}>{route.section === "classes" ? "Pick a class to see who's coming." : "Pick an item to see the details."}</p>

  const sections = (
    <>
      <button className="bd-tab" type="button" onClick={() => go({ section: "classes", id: null })}
        aria-current={route.section === "classes" ? "page" : undefined} style={look.tab(route.section === "classes")}>Classes</button>
      <button className="bd-tab" type="button" onClick={() => go({ section: "attention", id: null })}
        aria-current={route.section === "attention" ? "page" : undefined}
        aria-label={attentionLabel}
        style={look.tab(route.section === "attention")}>
        Needs attention{classItems > 0 && <span style={look.badge(urgent)} aria-hidden="true">{classItems}</span>}
      </button>
    </>
  )
  const syncItem = attention.find((a) => a.kind === "sync")
  const banner = syncItem ? <SyncBanner item={syncItem} look={look} when={when} /> : null
  const refreshButton = (
    <button className="bd-refresh" type="button" onClick={() => void refresh()} disabled={refreshing} title="Sync Google Calendar and reload" style={look.refresh}>
      {refreshing ? <><span className="bd-spinner" aria-hidden="true" />Syncing…</> : "Refresh"}
    </button>
  )
  const updated = (
    <div role="status" style={look.updated}>
      {slow ? "Still syncing — try again in a minute" : `Updated ${ago(loadedAt)}`}
    </div>
  )
  const logOutButton = <button className="bd-logout" type="button" onClick={logOut} style={look.logout}>Log out</button>

  // Screen readers hear the confirmation from a region that's always there; everyone else
  // sees it. Live, it's drawn into the page body, so nothing around it can hide it.
  const toastView = (
    <>
      <div role="status" aria-live="polite" style={look.srOnly}>{toast ? toast.text : ""}</div>
      {toast && (
        <div style={look.toastWrap(!inEditor)}>
          <div className="bd-fade" style={look.toast}>
            <span aria-hidden="true">✓ {toast.text}</span>
            {toast.link && (
              <a className="bd-toast-link" href={toast.link.href} target="_blank" rel="noopener noreferrer"
                onClick={() => setToast(null)} style={look.toastLink}>{toast.link.label}</a>
            )}
          </div>
        </div>
      )}
    </>
  )
  const toastLayer = inEditor ? toastView : createPortal(<div className="bd" style={{ ...props.textFont }}>{toastView}</div>, document.body)

  // ── Desktop: a tinted sidebar fixed to the full height, then the list and the details
  if (look.isDesktop) {
    return (
      <div className="bd-fade" style={look.app}>
        {toastLayer}
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

  // ── Phone: one screen at a time; an open class or item gets its own screen. The
  // sections and Refresh sit in a bar at the bottom, where the thumb reaches; Log out is
  // in a menu at the top, where it's hard to hit by accident.
  const bottomBar = (
    <nav aria-label="Sections" style={look.bottomBar(!inEditor)}>
      <button className="bd-tab" type="button" onClick={() => go({ section: "classes", id: null })}
        aria-current={route.section === "classes" ? "page" : undefined} style={look.barButton(route.section === "classes")}>
        Classes
      </button>
      <button className="bd-tab" type="button" onClick={() => go({ section: "attention", id: null })}
        aria-current={route.section === "attention" ? "page" : undefined}
        aria-label={attentionLabel}
        style={look.barButton(route.section === "attention")}>
        Attention{classItems > 0 && <span style={look.badge(urgent)} aria-hidden="true">{classItems}</span>}
      </button>
      <button className="bd-tab" type="button" onClick={() => void refresh()} disabled={refreshing}
        aria-label={refreshing ? "Syncing" : "Refresh"} title="Sync Google Calendar and reload" style={look.barButton(false)}>
        {refreshing ? <span className="bd-spinner" aria-hidden="true" /> : "Refresh"}
      </button>
    </nav>
  )
  const header = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={look.title}>{props.studioName || "Bookings"}</h1>
        {updated}
      </div>
      <Menu look={look}>{logOutButton}</Menu>
    </div>
  )
  return (
    <div className="bd-fade" style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: inEditor ? 0 : 96 }}>
      {route.id && (openClass || openItem) ? (
        <>
          <button className="bd-link" type="button" onClick={() => go({ section: route.section, id: null })}
            style={{ ...look.link, alignSelf: "flex-start", textDecoration: "none", minHeight: 44 }}>‹ Back</button>
          {banner}
          <div style={{ ...look.card, padding: 20 }}>{detail}</div>
        </>
      ) : (
        <>{header}{banner}{list}</>
      )}
      {/* Live: drawn into the page body, so nothing Framer wraps around it stops it from
          staying on screen. It carries the dashboard's class and font with it. */}
      {inEditor ? bottomBar : createPortal(<div className="bd" style={{ ...props.textFont }}>{bottomBar}</div>, document.body)}
      {toastLayer}
    </div>
  )
}
