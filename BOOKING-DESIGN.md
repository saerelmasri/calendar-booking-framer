# Calendar booking system — design

**Last updated:** 28 September 2026
**Status:** agreed shape. The calendar mirror and its hourly timer are built and tested on a
real calendar; the public calendar is being built; booking and the dashboard are not built yet.

---

## What this is

A booking system for Framer websites. A visitor sees the month's sessions and books one
instantly. The business manages its timetable in Google Calendar and sees its bookings on a
dashboard.

**It fits anything booked as scheduled sessions with a number of places:** classes,
workshops, group training, tours, courses — and appointments too, where each slot is one
place.

**It does not fit "pick any free time in my working hours"** (the Calendly style), where free
slots are calculated from opening hours rather than created as events. That's a different
model and this system shouldn't pretend to be it.

Built first for Neroli, a Pilates studio. Designed from the start so that a new client needs
**new settings, never new code**.

## The problem it actually solves

Businesses like this take bookings on WhatsApp today. The problem isn't effort — it's
**waiting**. You send a message and sit there not knowing whether you got a spot, until
someone finds the phone and replies.

**The website's entire advantage is answering immediately.** "You're in — 3 spots left,"
in under a second.

This sets the hardest constraint in the whole design: **booking must be two fields and one
tap.** Name, phone, done. No account, no email confirmation, no verification step. Every
step added gives the advantage back to WhatsApp.

---

## The three parts

### Google Calendar — the timetable

The owner's only tool for managing sessions. They already need a calendar; this is it.

Each session is a calendar event:

| What | Where it comes from |
|---|---|
| Date and time | the event's start time |
| Duration | start to end — no extra field needed |
| Session name | the event title, e.g. *Reformer Foundations* |
| Location | Google Calendar's own location field |
| Timezone | the calendar's own timezone setting |
| Number of places | a line in the description — *which* line is a per-client setting |
| Other details | lines in the description — *which* lines is a per-client setting |

See *Reading event descriptions* below for how the description is read.

**Why Google Calendar rather than a form we build:** recurrence. A timetable repeats
weekly, and recurring events are one of the genuinely hard problems in software —
exceptions, "just this one", "this and all future", a teacher away for a week. Google has
solved it. Building it ourselves would cost more than the rest of the system combined.

It also works on the owner's phone, costs nothing, and is theirs to keep.

**What it can't do:** know how many people fit. A calendar event has no concept of places,
so the number is written as a line in the description.

### Supabase — the part that must be trusted

Holds two things Google Calendar cannot:

**The bookings.** Names and phone numbers. Nobody but the business can read them.

**The capacity check.** When someone books, the database locks that session, counts the
existing bookings, and refuses if it's full. The lock is what stops two people taking the
last spot at the same moment — the second person waits a few milliseconds, then counts
again and sees the truth.

This has to live in the database rather than the website because a Framer site runs
entirely in the visitor's browser, where any check can be skipped with the developer
tools. The public has no permission to write a booking directly. The only route is to ask
the database to do it, and the database always checks.

Supabase also reads the calendar. An Edge Function signs in to Google as a *service
account* — a Google identity belonging to the program rather than a person — that has been
given read-only access to that one calendar and nothing else. The owner can cut it off at
any time by removing it from the calendar's sharing, like removing a colleague.

**The component never talks to Google directly.** The Google key must stay secret inside
Supabase, and bookings only exist in Supabase. Google → Supabase is the sync's job;
Supabase → the website is the component's.

### Framer — what people see

**The public calendar.** The current month, like a wall calendar, so a visitor sees every
session this month at a glance. There is no arrow: next month's sessions appear on the 1st.
The cost is that in the last days of a month, the grid doesn't show the next month's sessions
yet. On a phone this doesn't arise: phones get a list of the upcoming sessions, 30 days ahead.

**Past sessions stay visible**, greyed out and without a Book button. The month looks
complete, and a visitor on Wednesday learns that Mat Flow runs on Mondays. From its start
time onwards a session can't be booked — and the database refuses it anyway, so hiding the
button is presentation, not protection.

Booking is two fields and an instant answer.

A **full session still appears in full** — time, name, details, location — but has no Book
button. It reads *Full* instead. Hiding full sessions would be worse: someone browsing
Tuesday evening should know a 7 PM reformer class exists even when this week is taken,
because that is how they discover it for next week.

A full session offers one way forward: a link that opens WhatsApp with the business's number
and a message already written — *"Hi, I'd like to join the waiting list for Tuesday 7 PM
Reformer Foundations."*

This is **not a waiting list feature.** Nothing is stored, there is no queue, nobody is
promoted automatically. It is a link to a conversation, catching someone at the moment they
are most motivated — right after finding out they can't have what they came for. People do
cancel, and without this the business never learns who wanted in.

**One component serves every client.** It doesn't know what any detail is called; it shows
whatever details came through — *Instructor: Camila M.* for Neroli, *Guide: Karim ·
Language: French* for a tour company. The site's own words ("Book", "Full", "Réserver") are
set in the component's settings on each client's site.

**The owner's dashboard.** Shows who is booked into what, which sessions need attention,
and the phone numbers of anyone affected by a change.

It manages **bookings** — see *Managing bookings* below — but never creates or edits
**sessions**. That is Google Calendar's job, and leaving it there removes roughly half the
work originally scoped.

---

## Reading event descriptions

Different businesses write different things in their events. A Pilates studio writes
`Capacity: 10` and `Instructor: Camila M.`; a tour company writes `Spots: 15`,
`Guide: Karim` and `Language: French`; a barber writes nothing at all.

So **the code contains no field names.** Each client's settings say which lines to read.

### The rules for the owner

- **One detail per line**, written `Label: value`
- The label starts the line. Capitals don't matter, the colon is optional, and any spacing
  works — `Capacity: 6`, `capacity 6` and the French `Places : 6` all read the same
- Any language works, including accents and Arabic

A detail written inside a sentence — *"Max 10 people, taught by Camila"* — is **not** read.
The session still appears, but without the detail. This is explained on the owner's
onboarding call, and the dashboard flags it the first time it happens.

### Private notes stay private

Only the lines a client has listed are ever read. Everything else in a description — `Door
code: 4471`, `Paid: cash`, `Driver: +961 71 000 000` — never leaves Google Calendar. It
isn't published on the website and it isn't stored in the database.

Reading every `Label: value` line would have needed no settings, and was rejected for
exactly this reason: owners write private notes in their calendar.

### Number of places

Worked out in this order:

1. **The number written in the event**, if the client has a places line and it's there
2. otherwise **the client's default** — a number, or *unlimited*
3. otherwise **flag it**

A value that isn't a number — `Capacity: TBD` — is flagged, **not** replaced by the default.
The owner wrote something deliberate that can't be read, and guessing could overbook.

`Capacity: 10 people` reads as 10.

### When it fails, it fails loudly

A missing or unreadable number of places will happen in the first week. What matters is
that it's visible.

The dangerous version: the session quietly doesn't appear. The owner looks at their
calendar, looks at the website, can't reconcile them, stops trusting the system, goes back
to WhatsApp.

Instead:

- the session **still appears** on the website, marked as not bookable
- the dashboard shows the reason as a plain sentence the owner understands, e.g.
  *No "Capacity" line in the description*

Parsing is perfectly survivable as long as failure is visible. It is only dangerous when it
is silent.

### Five clients, the same code

| | Details shown | Places come from | If no number is written |
|---|---|---|---|
| Pilates studio | Instructor | Capacity | flag, not bookable |
| Barber | — | — | 1 |
| Walking tours | Guide, Language, Meeting point | Spots | 15 |
| Cooking school | Chef, Niveau | Places | flag, not bookable |
| Open day | — | — | unlimited |

This was tested on 24 September: the same code, reading the same calendar, behaved as
Neroli and then as a barber, with only the settings changed.

---

## Which events count

**Everything in the calendar is treated as a bookable session.** Owners also put things in
calendars that aren't sessions — a dentist appointment, a staff meeting — and with a default
like a barber's `1`, "Dentist" would become a bookable slot. Two protections:

- **A calendar used only for bookable sessions.** The rule for the owner: *everything in
  this calendar can be booked; everything else goes in your normal calendar.* This is the
  main protection, and it costs nothing.
- **All-day events are skipped automatically.** In practice they are closures and holidays,
  not sessions. If a client ever sells full-day events — a retreat, say — this becomes a
  setting.

---

## The public calendar

The month as visitors see it, on the client's Framer site. **Display only in this step** —
booking is designed separately, once the booking channel is chosen.

### What the website can read

The website reads with Supabase's public key, which anyone can see in the site's code, so
rules in the database are the protection. They let it read only what a visitor should see,
and write nothing:

- name, start and end, location, and details (e.g. `Instructor`)
- whether the session is **bookable**. The owner's `problem` notes, such as *No "Capacity"
  line*, stay private
- the calendar's timezone
- cancelled sessions are left out entirely

### Layout — the month, like a wall calendar

- **The current month:** its title (*September 2026*), a column per weekday, a row per week.
  Days before the 1st and after the last are left blank
- Each day lists its classes **in time order**: time · class name · details, on a shade of
  the site's colour
- Times on the **12-hour clock**: *9:00 AM*, *4:30 PM*
- **No arrows.** Next month's classes appear on the 1st, so in the last days of a month the
  desktop grid doesn't show them yet. The phone list isn't affected: it always runs 30 days
  ahead
- **Past days and past classes greyed out** — a class from the moment it starts, which is
  also when it stops being bookable. Today gently highlighted
- **Phone:** a month grid leaves about 50px per day, too narrow for class names, so phones
  show a short list instead: the **upcoming classes, from now to 30 days ahead**, whatever
  month they're in. One row per class (*Tue, Sep 29 · 2:30 PM · Popup Class · MJ*), with no
  past classes and no empty days. Classes that can't be booked stay in the list, marked
- Clicking a class does nothing yet

Considered and rejected:

- *A week at a time, with an arrow to next week* — the first design, a grid with hour rows
  down the side and the phone swiping it sideways
- *The next 4 weeks, rolling from this Monday* — never runs out at the end of a month, but
  isn't a calendar month

### Which days show

A setting per client site: **which days to show**, default Monday to Saturday. A studio open
on Sundays switches Sunday on.

**A hidden day still gets its column if it has a class that month.** A one-off Sunday
workshop at a studio normally closed on Sundays must not be invisible, and so unbookable.

### Colour

One setting: the site's **main colour**. Each class name automatically gets a **shade** of it,
lighter or deeper, and keeps that shade from month to month. Shades stay light enough that
dark text on them is always readable. With many classes some share a shade, which is fine
because every class shows its name. For the same reason there is no legend.

Considered and rejected:

- *Google Calendar's own event colours* — gives the owner control, but Google's colours clash
  with the site, and translating them into the site's palette added complexity
- *A different generated colour per class name* — unlimited colours, but people can't tell
  more than 8–10 apart
- *Colouring by a `Level:` line* — readable with many classes, but another convention for the
  owner to learn

### Dates and times — the one piece of tricky logic

The month, "today" and every time shown are worked out **in the calendar's timezone**, never
the visitor's: at 1:30 AM on 1 October in Beirut it is October, though UTC is still in
September. Lebanon changes its clocks **at midnight**, so on one Sunday a year midnight
doesn't exist, and on another the hour before midnight happens twice. The logic reads times
from the browser's own timezone database and counts days on dates alone, so neither can put
a class on the wrong day. It lives in `framer/month.ts`, tested by `npm test`.

### States

- **Loading** — a soft placeholder grid
- **Empty month** — "No classes scheduled this month"
- **Can't load** — a short message; the rest of the page is unaffected

### Settings on the component, per client site

The component is `framer/MonthCalendar.tsx`; its settings panel in Framer holds everything
that differs between clients:

- **Supabase URL** and **public key** — both safe to publish
- **View** — *Month* or *List*. Framer lets each breakpoint have its own settings, so the
  phone breakpoint is set to *List*. No code measures the screen, and nothing jumps from grid
  to list as the page loads
- **Days** to show — default Monday to Saturday
- **Language** — gives the month and day names (*September*, *septembre*); `en-GB` gives
  British dates (*Tue 29 Sept*)
- **Colours** — main colour (the shades and today's highlight), text, muted text, lines
- **Fonts** — one for the title, one for everything else
- **Words** — list title, empty month, empty list, *Unavailable*, can't load — so it works
  in any language

With the URL or key missing, the component says so instead of failing silently, which helps
when setting up a new client. In Framer's editor it shows made-up classes, so it can be
designed without data; real classes appear in Preview and on the live site.

### On Neroli's site

It replaces the Feed Ticker in the Schedule section. The ticker is hidden, not deleted, so it
can come back.

---

## Settings per client

Everything that differs between clients is a setting in that client's Supabase project.
None of it is in the code, and none of it is in this repository.

| Setting | What it is | Example |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The service account's JSON key, pasted whole. **Secret** — the client or agency adds it, it is never committed or shared | *(the key file)* |
| `GOOGLE_CALENDAR_ID` | Which calendar to read | `…@group.calendar.google.com` |
| `BOOKING_DETAILS` | Lines shown to visitors, comma-separated | `Instructor` |
| `BOOKING_PLACES_FIELD` | The line holding the number of places | `Capacity` |
| `BOOKING_PLACES_DEFAULT` | Used when that line is missing: a number or `unlimited`. **Leave unset to flag instead** | *(unset)* |
| `SYNC_TOKEN` | A long random value. Only callers that send it can run a sync — the timer and Google's webhook will. It only allows "run the sync": it can't read bookings or change the database | *(generated per client, never shared)* |

A mistyped default — `fifteen` — stops the function with a clear error rather than guessing.
And **forgetting the default flags sessions rather than opening them to unlimited
bookings**: a missing setting should never make a session unlimited.

The timezone is deliberately not a setting: it is read from the calendar itself, so it can't
drift out of step with it.

**Two values also go in Supabase Vault**, for the timer: the project's address
(`project_url`) and the same sync token (`sync_token`). The token therefore lives in two
places — the function's settings and the Vault — and **they must match**. To change it,
change both together. If they differ, the timer's requests are refused.

### Setting up a new client

1. A new Supabase project for the client
2. A Google service account with read access to the client's calendar (share the calendar
   with the service account's email, *See all event details*)
3. The settings above in the client's Supabase project, including a newly generated
   `SYNC_TOKEN`
4. The project address and the same `SYNC_TOKEN` in Supabase Vault, run in the SQL Editor:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<the SYNC_TOKEN value>', 'sync_token');
   ```

   The SQL Editor saves queries automatically, so delete that query tab afterwards, or the
   token stays saved in it.
5. Create the tables and the timer: `supabase link --project-ref <ref>` (asks for the
   database password), then `supabase db push`
6. Deploy the functions from this repository
7. Drop the booking component into the client's Framer site and fill in its settings

No code changes.

### Checking it works

Run a sync by hand from the repository folder in Git Bash. The token is read from the
git-ignored `supabase/functions/.env`, so it never has to be copied anywhere:

```bash
curl -s -X POST -H "x-sync-token: $(grep '^SYNC_TOKEN=' supabase/functions/.env | cut -d= -f2-)" \
  https://<project-ref>.supabase.co/functions/v1/calendar-sync
```

The reply summarises what happened: `added`, `refreshed` (seen again and brought up to
date) and `cancelled`.

**The Table Editor shows times in UTC.** In September Beirut is three hours ahead, so a 2pm
class appears as `11:00+00`. That is the same moment written differently. The website and
the dashboard always show the calendar's own timezone.

**The timer:** Supabase's *Integrations → Cron* page lists the `calendar-sync` job and every
run. To test the timer's path without waiting for the hour, run its request once by hand in
the SQL Editor, then look at the reply a few seconds later:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
         || '/functions/v1/calendar-sync',
  headers := jsonb_build_object('x-sync-token',
    (select decrypted_secret from vault.decrypted_secrets where name = 'sync_token')),
  timeout_milliseconds := 60000
);

select status_code, content from net._http_response order by created desc limit 1;
```

`200` with `"ok":true` means the Vault values, the token and the sync all work together.

---

## How the calendar stays in sync

The owner changes something in Google Calendar; the website must reflect it. The mirror
copies everything from **about a month ago to about a month ahead** (32 days each way) into
the `sessions` table, which always covers the whole of this month, whatever day it is, and
the whole of next month before it starts. Because the window is plain "days from now", the
sync needs no timezone maths; only the calendar display does.
Sessions older than the window stay in the database as history; they simply stop being
refreshed.

### Honest framing

Webhooks are best-effort. Google can fail to deliver one, a function can be cold, a
network can drop. "It never fails" is not a promise anyone can keep between two systems
they don't control.

What we can guarantee is **convergence** — however badly things go, the website ends up
matching the calendar, and we can state the worst case. That's a promise we can keep.

### Four mechanisms

**1. The webhook is a doorbell, not a delivery.** Google's notification says *something
changed*, not what. The sync then re-reads the whole window from Google and compares it
with the table. This is why a missed webhook loses nothing — the next sync of any kind
catches everything. *(Not built yet.)*

**2. A scheduled check regardless.** A job runs **every hour, on the hour**, and syncs
whether or not a webhook arrived. If every webhook failed, the site is still never more than
an hour out of date. Webhook for speed, timer for correctness — neither is sufficient alone,
and most integrations only build the first. Until the webhook is built, this timer is the
only trigger, so an hour is today's worst case.

The timer is a database job (`pg_cron`) that sends a web request (`pg_net`) to the sync,
carrying the sync token. The project address and the token are read from Supabase Vault
each time, because they differ per client and can't live in this repository.

**3. Subscription renewal.** Google's webhook subscriptions expire after about a month. If
nothing renews them, notifications stop silently and everything looks fine until someone
notices the site is out of date. A scheduled job renews them early. **This is the most
common way calendar integrations die.**

**4. Repeating is harmless.** Everything is keyed to Google's own event ID, so processing
the same change twice just rewrites the same row with the same values.

### Safety rules built into every sync

- **Nothing changes unless Google answered completely.** A wrong calendar ID, removed
  sharing or a Google outage records an error and leaves every session as it was.
  Otherwise one bad response would look like "every class was deleted".
- **Every page of results, or nothing.** Google returns events in pages; a sync that read
  only the first would treat the rest as deleted.
- **Check before calling something cancelled.** A session missing from the window is looked
  up individually first: it may have moved beyond the window rather than been deleted.
- **Cancelling is reversible.** A cancelled session that reappears, say restored from
  Google's bin, comes back with its bookings.
- **All or nothing.** One sync's changes are written in a single transaction.
- **One sync at a time.** A sync that starts while another is running steps aside. The lock
  frees itself after three minutes if a sync crashes without releasing it.
- **Failures are recorded, as sentences.** Every failure is written to `sync_status` in a
  form the dashboard can show, e.g. *The GOOGLE_CALENDAR_ID setting is missing*.
- **Silence is a failure too.** A sync that never starts — mismatched tokens, a broken
  function, a stopped timer — can't record anything. So the dashboard also warns when
  `last_success_at` is more than about **two and a half hours** old: two missed hourly runs
  plus a margin. One rule catches every silent failure, including ones nobody has thought
  of yet. *(Built with the dashboard.)*

### The rule that protects customers

**A deleted calendar event never destroys a session that has bookings.**

If Google says an event is gone and we obediently delete our copy, the bookings go with
it — and the information needed to tell those people is destroyed by the very act of
syncing.

Instead the session is marked cancelled. It disappears from the public site straight away,
and appears on the dashboard as *"Wed 6 PM Reformer — cancelled, 5 people booked"* with
their numbers.

The mirror copies the calendar. It never destroys something the calendar doesn't know
about.

---

## When a session changes

### Cancelled

Gone from the website immediately. The dashboard shows who was booked, with phone numbers,
ready for the owner to message.

### Moved

The session updates to its new time and **the bookings stay attached** — the session moved,
it wasn't replaced. The dashboard flags that those people need telling.

Cancelling five bookings automatically because a session shifted fifteen minutes would be
worse than the problem it solves.

This works because Google never changes an event's ID when it moves — even one week of a
recurring class moved to a different day keeps an ID containing its *original* date — so
the sync recognises it as the same session.

### Known limitation: "This and following events"

In Google Calendar, editing a recurring class with **"This and following events"** doesn't
edit the existing events. Google ends the old series and creates a new one, with new IDs.
People booked on those future dates stay attached to the old sessions, which get marked
cancelled, and the new sessions start with no bookings. Nothing is lost — the dashboard
shows exactly who needs moving — but it will surprise an owner the first time.

**Onboarding note:** to change a single week, edit just that event.

Guessing which new event matches which old one was rejected: it would sometimes guess
wrong, and attach people to a session they didn't book.

### Telling the customers

Phase one: **manual.** The dashboard shows exactly who to message and their numbers. Free,
immediate, and works from day one.

Phase two: **automatic WhatsApp.** A webhook reads the affected bookings and messages them.
Worth knowing this is a real integration, not a small job — business-initiated WhatsApp
messages need approved templates and cost per conversation. The manual step is replaced
without changing anything underneath it.

---

## Managing bookings

Businesses take bookings in person, on the phone and on WhatsApp, not only through the
website. If the dashboard only knew about online bookings it would show *some* of the
people turning up — and a partial attendee list is worse than none, because the owner would
still have to keep their own.

So the dashboard has three actions. None of them touch the session itself.

| Action | When it's used |
|---|---|
| **Add** | Someone phoned, messaged or walked in. Owner types name and phone. |
| **Cancel** | Someone dropped out and nobody is waiting. |
| **Replace** | Someone dropped out and their spot is going to a specific person. |

Cancel and Replace both confirm before acting, because they remove someone's place and
can't be undone.

### The number of places is a hard limit, including for the owner

**Add is unavailable on a full session.** The business cannot overbook from the dashboard,
the same way a visitor can't from the website. One rule, no exceptions.

### Why Replace exists

With a hard limit, cancelling and then adding leaves a gap:

```
10:04  owner cancels Rana            → 5/6, and that spot is now public
10:04  someone on the site takes it  → 6/6
10:05  owner adds the person who asked for it → "this session is full"
```

That isn't a rare edge case. A full session is exactly the session people are watching, and
the owner would have to explain to someone they promised a place to that it disappeared
while they were typing.

**Replace does both changes as a single operation** — one person out, one person in, at the
same instant. The session never drops to 5/6, so no one else can take the spot in between.
Either both changes happen or neither does.

### Freed spots reappear instantly

Remaining places are counted from the bookings rather than stored as a number. The moment a
booking is removed, the public calendar shows one more space. Nothing to recalculate, and no
way for the displayed count to drift away from reality.

Someone whose booking was cancelled can book the same session again later — removing a
booking removes the record of it entirely.

---

## Deliberately not building

| | Why |
|---|---|
| Payments | No money changes hands on the site at all |
| Customer accounts or logins | Every step lost to WhatsApp |
| Customer self-cancellation | Customer messages the business; owner removes the booking from the dashboard |
| Email | We collect a phone number only |
| Session creation in the dashboard | Google Calendar owns the timetable |
| A locations table | Location is a native Google Calendar field |
| Onboarding screens | Handled by a call with the owner, who teaches their staff |
| "Pick any free time" booking | A different model — availability from working hours — not this system |
| Reading details written in sentences | One detail per line keeps it predictable and easy to teach |

---

## Built so far

**The calendar mirror** — `supabase/functions/calendar-sync`, and the migration
`supabase/migrations/20260924120000_mirror.sql`:

- Tables `sessions` and `sync_status`. Row-level security is on; the public key reads only
  what the public calendar rules below allow
- Database functions `begin_sync`, `apply_sync` and `fail_sync`, callable only by the sync
- The sync function, protected by `SYNC_TOKEN`. Run by hand for now; the timer and the
  webhook will call it the same way
- `npm test` — 30 tests covering the description reader (French spacing, accented and
  non-Latin labels, symbols, `Guide` not matching `Guidelines`, an empty line not swallowing
  the next one, `TBD` flagged, private notes never read), the settings, and turning an event
  into a session row. No network or database needed

**Verified on a real calendar, 24 September 2026:**

- First sync: 6 sessions. A weekly class expanded into separate dated sessions, and the
  timezone (`Asia/Beirut`) was read from the calendar
- A recurring **all-day** event (*Studio Close*, every Sunday) was skipped
- Moved classes kept their row and got their new time, including one week of a recurring
  class moved from Wednesday to Thursday
- A class moved **beyond the window** (7 October → 4 November) was updated, not cancelled
- **Deleting** a one-off class, and deleting one week of a recurring class ("This event"),
  both marked the session cancelled with its row kept
- A deleted class **restored from Google's bin** came back as the same row — so its bookings
  would still be attached
- Calls without the token, or with a wrong one, were refused (`403`)
- No raw description text reaches the output

**The timer** — migration `supabase/migrations/20260924160000_timer.sql`: a `pg_cron` job
that calls the sync every hour, on the hour, reading the address and token from Vault.
Verified on 25 September 2026: the timer's request sent by hand from the SQL Editor returned
`"ok":true`, and a class created in Google Calendar appeared in the table at the top of the
hour with nobody running anything.

**The public calendar rules** — migration `supabase/migrations/20260928200000_public_calendar.sql`:
a `bookable` yes/no column on `sessions` that Postgres keeps up to date itself, and rules
letting the public key read sessions that aren't cancelled (seven columns only) and the
calendar's timezone. Verified on 28 September 2026 with the public key: the classes came back
with only those columns (*Barre Basics* showed `bookable: false`, its problem note hidden);
asking for `problem` and trying to change a title were both refused; the timezone read
`Asia/Beirut`.

**The month logic** — `framer/month.ts`, with 30 tests in `tests/month.test.mjs`: the month
and "today" in the calendar's timezone, both of Lebanon's midnight clock changes, the grid in
whole weeks with blank days outside the month, a hidden day getting its column when it has a
class, the phone's list of upcoming classes (30 days ahead, unbookable ones kept), 12-hour
times, names in the site's language, and the colour shades. The sync now copies 32 days back
and 32 days ahead. Verified on 28 September 2026 with the real data:

- After redeploying, the sync added October's three remaining Reformer classes
- September came out with its four classes on the right days and times; the past ones
  greyed, *Barre Basics* not bookable
- October's Sunday class (4 October) gave October a Sunday column
- The 28 October class is stored an hour later in UTC than the others, because Lebanon is on
  winter time by then, and still reads 2:00 PM

**The calendar component** — `framer/MonthCalendar.tsx`: loads the classes, shows the month
grid or the phone list, the loading / empty / can't-load states, and the settings panel.
Type-checked with TypeScript on 29 September 2026; not yet run inside Framer — that is the
next step, placing it on Neroli's site.

---

## Open items

- **How visitors book: website, WhatsApp, or both.** To be decided when the booking step is
  built — probably as a per-client setting on the calendar component. The places count is
  what decides whether each works:
  - *Website only* — the count is exact, automatically
  - *WhatsApp only* — the system never learns who booked, so **places left must not be
    shown**: the number would be wrong
  - *Both* — WhatsApp bookings **must be entered in the dashboard** (the Add action), or the
    count drifts and the website can overbook the session
  - Whenever WhatsApp is used, the pre-written message names the session, the day, the date
    and the time, so the business never has to write back and ask
- **Which Google account owns each client's calendar**, and how the business grants access
  to it. For testing it is the agency's.
- **Who owns each client's Supabase project** — the agency or the client. Affects billing,
  and who can deploy.

## Decisions already made

- Google Calendar is the source of truth for the timetable
- Supabase owns bookings and enforces the number of places
- Booking collects name and phone only, with no account and an instant answer
- **Nothing client-specific is written in the code** — field names, limits and calendars are
  per-client settings
- Descriptions are read one `Label: value` per line; only listed labels are read
- The number of places: written value, else the client's default, else flagged
- The timezone comes from the calendar itself
- All-day events are skipped
- The public calendar shows the current month, like a wall calendar, with no arrows; next
  month appears on the 1st. Past sessions are greyed out and unbookable
- Deleted and moved sessions both notify the same way
- Bookings survive a move
- The dashboard never creates or edits sessions, but manages bookings: add, cancel, replace
- The number of places is a hard limit, including from the dashboard
- A full session stays visible on the site, without a Book button, offering a WhatsApp link
- The timer runs every hour. Until Google's webhook is built, a calendar change reaches the
  website within an hour; with the webhook, within seconds, and the hourly timer becomes the
  safety net
- Visitors read only what the rules on the tables allow: owner's problem notes stay private,
  cancelled sessions are hidden, nothing can be written. Rules on the tables rather than a
  separate view, because a view reads with its owner's full rights (one lock on writing
  instead of two) and Supabase's Security Advisor flags such views as an error
- On desktop the month is a grid: a column per weekday, a row per week, each day listing its
  classes in time order. On a phone, a list of the upcoming classes, from now to 30 days
  ahead, whatever month they're in; classes that can't be booked stay in the list, marked
- Times are shown on the 12-hour clock (*4:30 PM*)
- Days shown is a per-client setting, default Monday–Saturday; a hidden day still gets its
  column if it has a class that month
- Colour is automatic: shades of the site's main colour, one per class name, no legend
- Month and day names come from a language setting on the component
- The mirror copies 32 days back and 32 days ahead, so the whole month is always there
