// types.ts — the dashboard's shared shapes: its settings (Props), the login, the loaded
// data, where the owner is, and how far ahead it looks.

import { type CSSProperties } from "react"
import { type OwnerSession } from "./logic.ts"

export interface Props {
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
  countryCode: string
  warningColour: string
  titleFont: CSSProperties
  textFont: CSSProperties
  style?: CSSProperties
}

// expires_at: when Supabase's token runs out (it's refreshed); rememberUntil: when this
// device stops being remembered (null = only until the browser closes). Both in seconds.
export type Auth = { access_token: string; refresh_token: string; expires_at: number; rememberUntil: number | null }

export type Data = { timeZone: string; lastSync: string | null; sessions: OwnerSession[] }

export type Screen = "checking" | "login" | "loading" | "ready" | "not_owner" | "error"

// Where the owner is: a section, and the class open in it (if any).
export type Route = { section: "classes" | "attention"; id: string | null }

export const BOARD_DAYS = 7          // the class list: today and the next 6 days

export const LOOK_AHEAD = 32        // needs attention: the whole month the sync keeps

export type Call = <T>(name: string, args: Record<string, unknown>) => Promise<T>

export type When = (iso: string) => string

// Shows the ✓ toast. link: one thing to do next, e.g. "Tell Sara" opening WhatsApp.
export type ToastLink = { label: string; href: string }
export type Notify = (text: string, link?: ToastLink) => void
