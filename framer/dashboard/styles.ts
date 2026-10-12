// styles.ts — every colour, size and hover state, worked out from the settings. Text
// colours are darkened where needed to stay readable (4.5:1) on the cards.

import { type CSSProperties } from "react"
import { readableText } from "../shared/month.ts"
import { type Props } from "./types.ts"

export type Look = ReturnType<typeof styles>

// Hover, focus and motion: things inline styles can't do. Scoped to the dashboard by the
// "bd" class names.
export function css(p: Props) {
  const mix = (colour: string, percent: number, other = "transparent") => `color-mix(in srgb, ${colour} ${percent}%, ${other})`
  return `
.bd button, .bd a, .bd input { transition: background-color .15s ease, border-color .15s ease, color .15s ease, filter .15s ease; }
.bd button:disabled { cursor: default; opacity: .6; }
.bd button:focus-visible, .bd a:focus-visible, .bd input:focus-visible, .bd select:focus-visible { outline: 2px solid ${p.mainColour}; outline-offset: 2px; }
.bd .bd-row:hover { background: ${mix(p.mainColour, 9, p.cardColour)} !important; }
.bd .bd-tab:hover { background: ${mix(p.mainColour, 14)} !important; }
.bd .bd-btn:hover:not(:disabled) { filter: brightness(1.25); }
.bd .bd-link:hover:not(:disabled) { color: ${p.mainColour} !important; }
.bd .bd-link.bd-danger:hover:not(:disabled) { color: ${p.dangerColour} !important; }
.bd .bd-refresh:hover:not(:disabled) { background: ${mix(p.mainColour, 18)} !important; }
.bd .bd-logout:hover { background: ${mix(p.dangerColour, 12)} !important; }
.bd .bd-action:hover:not(:disabled) { background: ${mix(p.mainColour, 10)} !important; }
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

export function styles(props: Props) {
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
    updated: { color: props.mutedColour, fontSize: "0.8em", textAlign: isDesktop ? "center" : "left", margin: isDesktop ? "0 0 6px" : 0 } as CSSProperties,
    actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 } as CSSProperties,
    // Per-person actions: real buttons with a 44px tap target
    action: {
      ...base, minHeight: 44, padding: "0 16px", borderRadius: 8, cursor: "pointer",
      border: `1px solid ${line}`, background: "transparent", color: props.textColour,
    } as CSSProperties,
    // The phone's Filter button, highlighted while filters are on
    filterButton: (on: boolean): CSSProperties => ({
      ...base, minHeight: 44, padding: "0 16px", borderRadius: 8, cursor: "pointer", flexShrink: 0, fontWeight: 600,
      border: `1px solid ${on ? props.mainColour : line}`, background: on ? tint(16) : "transparent",
      color: on ? accentText : props.textColour,
    }),
    // A square 44px button for an icon: WhatsApp, and "•••" for a person's other actions
    iconButton: {
      ...base, width: 44, height: 44, padding: 0, borderRadius: 8, cursor: "pointer", flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none",
      border: `1px solid ${line}`, background: "transparent", color: props.textColour, boxSizing: "border-box",
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
    // Picking another class: the same shape as the confirmation, but calm, nothing is lost
    picker: {
      display: "flex", flexDirection: "column", gap: 6, marginTop: 10, padding: 14, borderRadius: 10,
      background: tint(8), borderLeft: `3px solid ${props.mainColour}`,
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
    // A refusal or error: one line under the form it belongs to, in the warning colour
    alert: {
      display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8,
      color: warningText, fontSize: "0.9em", fontWeight: 500, lineHeight: 1.4,
    } as CSSProperties,
    card: { background: props.cardColour, border: `1px solid ${line}`, borderRadius: 12, padding: 16, boxSizing: "border-box" } as CSSProperties,
    // The phone's "Next class" card: a card with the main colour down its side
    nextCard: {
      background: props.cardColour, border: `1px solid ${line}`, borderLeft: `4px solid ${props.mainColour}`,
      borderRadius: 12, padding: 16, boxSizing: "border-box",
    } as CSSProperties,
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
    // The confirmation after an action: dark on light, so it stands out from everything
    // (the wrapper centres it, so the fade-in can move it without knocking it sideways)
    toastWrap: (pinned: boolean): CSSProperties => ({
      position: pinned ? "fixed" : "relative", zIndex: 12, left: 0, right: 0,
      bottom: isDesktop ? 24 : "calc(76px + env(safe-area-inset-bottom))",
      display: "flex", justifyContent: "center", padding: "0 16px", pointerEvents: "none",
    }),
    toast: {
      maxWidth: 480, boxSizing: "border-box", padding: "12px 16px", borderRadius: 10, fontWeight: 600,
      background: props.textColour, color: props.cardColour, boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 4, pointerEvents: "auto",
    } as CSSProperties,
    // "Tell Sara" in the toast: the one thing to do next
    toastLink: {
      color: props.cardColour, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3,
      padding: "10px 0", whiteSpace: "nowrap",
    } as CSSProperties,
    // Heard by screen readers, not seen
    srOnly: {
      position: "absolute", width: 1, height: 1, margin: -1, padding: 0, border: 0,
      overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap",
    } as CSSProperties,
    // The phone's bar at the bottom, pinned to the screen (on Framer's canvas: in place)
    bottomBar: (pinned: boolean): CSSProperties => ({
      position: pinned ? "fixed" : "relative", left: 0, right: 0, bottom: 0, zIndex: 10,
      display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4,
      padding: "8px 12px calc(8px + env(safe-area-inset-bottom))",
      background: props.cardColour, borderTop: `1px solid ${line}`,
    }),
    barButton: (on: boolean): CSSProperties => ({
      ...base, minHeight: 48, border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      background: on ? tint(16) : "transparent", color: on ? accentText : props.textColour,
    }),
    menu: {
      position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 11, padding: 8, minWidth: 140,
      background: props.cardColour, border: `1px solid ${line}`, borderRadius: 12,
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)", display: "flex", flexDirection: "column",
    } as CSSProperties,
    link: {
      ...base, padding: 0, border: "none", background: "none", cursor: "pointer",
      color: props.textColour, textDecoration: "underline", textUnderlineOffset: 3,
    } as CSSProperties,
  }
}
