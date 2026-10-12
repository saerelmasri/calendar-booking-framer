// icons.tsx — the dashboard's three icons, drawn in the colour they're given.



// Small icons, drawn inline: no icon library.
// A speech bubble: the WhatsApp button (not WhatsApp's own logo, which is their trademark).
export function ChatIcon({ colour }: { colour: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: "none" }}>
      <path d="M9 2.5c3.9 0 7 2.6 7 5.9s-3.1 5.9-7 5.9c-.8 0-1.6-.1-2.3-.3L3 15.5l1-3.1C2.8 11.3 2 9.9 2 8.4 2 5.1 5.1 2.5 9 2.5Z"
        fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function WarningIcon({ colour }: { colour: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
      <path d="M8 1.5 15 14H1L8 1.5Z" fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 6v3.5M8 11.5v.5" stroke={colour} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ClockIcon({ colour }: { colour: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}>
      <circle cx="8" cy="8" r="6.5" fill="none" stroke={colour} strokeWidth="1.5" />
      <path d="M8 4.5V8l2.5 1.5" fill="none" stroke={colour} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
