# Halcyon CRM

A telecaller screen for the Halcyon leads sheet, with Meta Conversions API
attached. Google Apps Script + the sheet you already have — no server, no
database, nothing to pay for.

**[SETUP.md](SETUP.md) — how to put it live (~15 minutes, all in the browser).**

---

## What it is for

The sheet already captures leads and pings Telegram. What it has no screen for is
the call itself: who to ring next, what was said last time, and when to try again.
That is this.

It opens the same spreadsheet by id, as a *separate* standalone script. The
existing container-bound script — intake, Telegram, its own `onEdit` — is not
modified and keeps running exactly as it does now.

## The two screens

**Dashboard** — how the clinic is doing, over 7, 30 or 90 days: new today and
how many are still uncalled, what is due now, what is overdue, how many booked
or converted and the rate; where the leads came from by source; how many Meta
events actually went out; and the pipeline, every stage with a bar.

**Leads** — the table you live in: name with how long ago it arrived, one-tap
call and WhatsApp, source, owner, the stage as a dropdown you can change
straight from the row, and the next follow-up coloured by how late it is.
Search, filter by source and owner, sort, and the quick counts — To call, New,
Today, Working, All. It becomes cards on a phone.

## What a caller sees

- **To call** — everything whose follow-up time has passed, oldest first. This is
  the answer to "who do I ring now", and it is the screen the app opens on.
- **New**, **Today**, **Working**, **All** — plus search by name or phone, and a
  source filter.
- Tap a lead for the cockpit: contact, which landing page the lead came from,
  whether the ad click was matched, and the full history.
  - **Call** and **WhatsApp** as one tap each
  - **Log a call** — outcome + what was said; the stage moves itself, forward only,
    so a missed call never drags a Qualified lead back down the funnel
  - **Add a note** — appended to the history, and mirrored into *Remarks* so the
    sheet still reads the way it always did
  - **Follow-up** — in 2 hours / tomorrow / 3 days / next week / pick a time
  - **Take this lead** — sets Owner
  - **Stage** — the nine stages you already use, and changing one fires the Meta
    event
- **On a desk the cockpit docks to the right** and the queue stays on screen
  beside it. The open lead is marked in the list, the header shows *3 / 14*, and
  **↑ ↓** — or **j** and **k** — step to the next lead without going back to the
  list. That is the shape of the job: work down a queue, one call at a time.
- On a phone it is a full-screen sheet instead, same controls.

Roles come from the **Users** sheet as they already do. `admin` sees everything;
anyone else sees only the sources listed against their name.

## Meta events

Stage → custom event, the same names the current script sends:

| Stage | Event |
|---|---|
| Attempted | `HAttempted` |
| Contacted | `HContacted` |
| Qualified | `HQualified` |
| Booked | `HBooked` |
| Converted | `HConverted` (with `value` + `currency` from Config) |
| Not qualified | `HNotQualified` |
| Junk | `HJunk` |
| Lost | `HLost` |

Each send replays what the website captured on that row — `fbc`, `fbp`, hashed
phone, user agent, IP, the real landing-page URL — so Meta can match it back to the
click. Phone and name are SHA-256 hashed before they leave the script; the raw
values never go to Graph.

The **Events sent** column is the ledger and it is shared with the old script:
before sending, this one checks whether the event is already in there and skips it
if so. An event can therefore fire once per lead and no more, whichever script got
there first. Failures land in **Last result** and in the lead's Activity tab with
Graph's own error text, so a bad token is visible instead of silent.

Set `SEND_EVENTS` to `no` in the sheet's Config tab to work the screens without
sending anything to Meta; set `TEST_EVENT_CODE` to see them land in Events Manager's
test tool instead of live.

## What it writes

Three columns appended to **Leads** — `Next action at`, `Next action note`,
`Last activity at` — and a new **Activity** tab, append-only, one row per call,
note, stage change, owner change and Meta send. Ownership goes in **Assigned**,
which the intake script already declares and never fills. Existing columns are
never moved or renamed, so that script's column map stays valid, and calls and
Meta sends are appended to the **Log** tab it already keeps, in its own
four-column shape.

## Follow-up reminders

Follow-ups are a queue first: the **To call** tab is the reminder, and it needs
nothing running in the background. Optionally run `installDailyDigest` once and each
caller gets an email at 9am IST listing their due follow-ups and untouched leads.

## Files

| | |
|---|---|
| `src/Code.gs` | everything server-side: sessions, the sheet reads, notes, follow-ups, stages, the CAPI sender, the digest |
| `src/App.html` | the whole UI — one file, no build step, no framework, no CDN |
| `src/appsscript.json` | manifest: scopes and web-app access |
| `tools/selftest.js` | 69 checks against a fake spreadsheet — `node tools/selftest.js` |
| `tools/preview.html` | the screens with a fake server, for working on the UI without deploying |
| `SETUP.md` | the install |

## Checking a change before you paste it in

```
node tools/selftest.js
```

It runs `src/Code.gs` against an in-memory spreadsheet with the real header row,
so the things that would be expensive to get wrong are checked on a laptop instead
of in production: that `setup` never reorders existing columns, that a caller only
sees their own sources, that the phone reaching Meta is hashed and in `91…` form,
that the ledger stops an event firing twice, that a missed call cannot drag a
Qualified lead backwards, and that no token is committed. 69 checks, no
dependencies, about a second.

## Working on the screens

```
python3 -m http.server 8080      # from the repo root
```

then open <http://localhost:8080/tools/preview.html>. It loads the real
`src/App.html` against a fake server holding fourteen invented leads — some due,
some overdue, one booked — so layout, the docked panel and the action modals can
be worked on in seconds instead of redeploying to Apps Script each time. Any PIN
signs in. Nothing in `tools/` ships: `Code.gs` is the backend, and `selftest.js`
is what actually tests it.

## Secrets

None in this repo, and none in the sheet. **This repo is public**, so the Meta
token (`META_TOKEN`) and the spreadsheet id (`SHEET_ID`) both live in Script
Properties and the code refuses to run without them. Everything else — dataset,
API version, conversion value, WhatsApp number — comes from the sheet's **Config**
tab, so the two scripts cannot drift apart.

Nothing here is a credential on its own: the web app checks a PIN from your Users
sheet, and reaching the data still needs Google permission on the spreadsheet.

The token currently hardcoded in the old script has been in a shared file; rotate
it before using this. Same for the Telegram bot token, even though nothing here
uses Telegram.

## Limits worth knowing

Apps Script is free but not unlimited: 6 minutes per execution, 20,000 UrlFetch
calls and 90 minutes of runtime a day on a consumer account. At a few hundred leads
and a handful of callers this is not close. The lead list is read in one range call
per screen refresh, which is what keeps it fast; a sheet in the tens of thousands of
rows would want pagination.

Two people editing the same lead in the same few seconds: last write wins. With two
or three callers and an Owner column it has not been worth more than that.
