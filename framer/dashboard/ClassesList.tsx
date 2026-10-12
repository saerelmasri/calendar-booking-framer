// ClassesList.tsx — the Classes section: one compact row per class, grouped by day.

import { type ReactNode } from "react"
import { timeOf } from "../shared/month.ts"
import { ClockIcon, WarningIcon } from "./icons.tsx"
import { type Booking, type Filter, fullness, type OwnerSession, startsIn, wasMoved } from "./logic.ts"
import { type Look } from "./styles.ts"

// people: for search results, who matched in each class, named under its title.
export function WeekList({ groups, empty, people, dayName, look, tz, selected, pick }: {
  groups: [string, OwnerSession[]][]; empty: string; people?: Map<string, Booking[]>
  dayName: (day: string) => string; look: Look; tz: string; selected?: string; pick: (id: string) => void
}) {
  if (groups.length === 0) return <p style={look.muted}>{empty}</p>
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {groups.map(([day, classes]) => (
        <div key={day} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h3 style={look.heading}>{dayName(day)}</h3>
          {classes.map((s) => {
            const { label, full } = fullness(s)
            return (
              <button className="bd-row" key={s.id} type="button" onClick={() => pick(s.id)} aria-current={s.id === selected ? "true" : undefined} style={look.item(s.id === selected)}>
                <span style={{ minWidth: 70, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{timeOf(new Date(s.starts_at), tz)}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {s.title}
                  {people?.get(s.id)?.length ? <span style={look.note}>{people.get(s.id)!.map((b) => b.name).join(", ")}</span> : null}
                  {s.problem &&<span style={look.warningNote}><WarningIcon colour={look.warningText} /> Hidden from the site</span>}
                  {!s.problem && wasMoved(s) && (
                    <span style={{ ...look.note, display: "flex", alignItems: "center", gap: 6 }}>
                      <ClockIcon colour={look.mutedColour} /> Moved from {timeOf(new Date(s.moved_from!), tz)}
                    </span>
                  )}
                </span>
                <span style={{ fontWeight: s.problem ? 400 : 600, color: s.problem ? look.mutedColour : full ? look.accent : undefined, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{full ? `Full · ${label}` : label}</span>
                <span aria-hidden="true" style={look.muted}>›</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// The Classes section: the search, the filters (folded behind "Filter" on a phone), then
// this week by day, or what the search finds, and the rest of the month on request.
// Board keeps the state, so switching to Needs attention and back keeps the search.
export function ClassesList({ look, query, setQuery, filters, chosen, setChosen, showFilters, setShowFilters,
  showLater, setShowLater, found, week, later, byDay, dayName, tz, selected, pick, nextCard }: {
  look: Look; query: string; setQuery: (q: string) => void
  filters: Filter[]; chosen: Record<string, string>; setChosen: (c: Record<string, string>) => void
  showFilters: boolean; setShowFilters: (open: boolean) => void; showLater: boolean; setShowLater: (open: boolean) => void
  found: { session: OwnerSession; people: Booking[] }[] | null
  week: [string, OwnerSession[]][]; later: [string, OwnerSession[]][]; byDay: (list: OwnerSession[]) => [string, OwnerSession[]][]
  dayName: (day: string) => string; tz: string; selected?: string; pick: (id: string) => void
  nextCard?: ReactNode             // the phone's "Next class" card, when there is one
}) {
  const filtering = Object.values(chosen).some(Boolean)
  const laterCount = later.reduce((n, [, classes]) => n + classes.length, 0)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {nextCard}
      {/* On a phone the filters fold behind "Filter", so the first screen shows classes */}
      <div style={{ display: "flex", gap: 8 }}>
        <input className="bd-input" type="search" placeholder="Find a person or class" aria-label="Find a person or class"
          value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...look.input, marginTop: 0, flex: 1, minWidth: 0 }} />
        {!look.isDesktop && filters.length > 0 && (
          <button className="bd-action" type="button" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}
            style={look.filterButton(filtering)}>
            {filtering ? `Filter · ${Object.values(chosen).filter(Boolean).length}` : "Filter"}
          </button>
        )}
      </div>
      {filters.length > 0 && (look.isDesktop || showFilters) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: -8 }}>
          {filters.map((f) => (
            <label key={f.key} style={{ ...look.note, display: "flex", flexDirection: "column", gap: 4, flex: "1 1 120px", minWidth: 0 }}>
              {f.label}
              <select className="bd-input" value={chosen[f.key] ?? ""} style={{ ...look.input, marginTop: 0 }}
                onChange={(e) => setChosen({ ...chosen, [f.key]: e.target.value })}>
                <option value="">All</option>
                {f.values.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ))}
          {filtering && (
            <button className="bd-link" type="button" onClick={() => setChosen({})} style={{ ...look.link, minHeight: 44 }}>Clear filters</button>
          )}
        </div>
      )}
      {found ? (
        <WeekList groups={byDay(found.map((f) => f.session))} people={new Map(found.map((f) => [f.session.id, f.people]))}
          empty={`No class or person matches "${query.trim()}"${filtering ? " with these filters" : ""}.`}
          dayName={dayName} look={look} tz={tz} selected={selected} pick={pick} />
      ) : (
        <>
          <WeekList groups={week} empty={`${filtering ? "No classes match these filters in the next 7 days." : "No classes in the next 7 days. Classes you add in Google Calendar show up here within the hour."}`}
            dayName={dayName} look={look} tz={tz} selected={selected} pick={pick} />
          {later.length > 0 && (
            <button className="bd-link" type="button" aria-expanded={showLater} onClick={() => setShowLater(!showLater)}
              style={{ ...look.link, alignSelf: "flex-start" }}>
              {showLater ? "Hide later this month" : `Later this month · ${laterCount} ${laterCount === 1 ? "class" : "classes"}`}
            </button>
          )}
          {showLater && <WeekList groups={later} empty="" dayName={dayName} look={look} tz={tz} selected={selected} pick={pick} />}
        </>
      )}
    </div>
  )
}

// The phone's "Next class" card: the class the owner is about to teach (or is teaching),
// how full it is, and a walk-in two taps away.
export function NextClassCard({ session: s, look, tz, now, onAdd, onOpen }: {
  session: OwnerSession; look: Look; tz: string; now: Date; onAdd: () => void; onOpen: () => void
}) {
  const { label, full } = fullness(s)
  const soon = startsIn(s.starts_at, now)
  const left = s.places === null ? null : s.places - s.bookings.length
  const status = full ? `Full · ${label}` : left === null ? label : `${label} · ${left} ${left === 1 ? "place" : "places"} left`
  return (
    <section aria-label="Next class" style={look.nextCard}>
      <div style={look.heading}>{soon ? `Next · ${soon}` : `Now · until ${timeOf(new Date(s.ends_at), tz)}`}</div>
      <div style={{ fontWeight: 600, fontSize: "1.1em", marginTop: 6 }}>{s.title} · {timeOf(new Date(s.starts_at), tz)}</div>
      <div style={{ ...look.muted, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{status}</div>
      <div style={{ ...look.actions, marginTop: 12 }}>
        {full
          ? <button className="bd-action" type="button" onClick={onOpen} style={look.action}>Full · Replace someone</button>
          : <button className="bd-btn" type="button" onClick={onAdd} style={{ ...look.button, minHeight: 44 }}>+ Walk-in</button>}
        <button className="bd-action" type="button" onClick={onOpen} style={look.action}>Who's coming ›</button>
      </div>
    </section>
  )
}
