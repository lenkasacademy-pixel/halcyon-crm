# Halcyon CRM

Telecaller screens added to the Meta CAPI script already running on the Halcyon
leads sheet. Two files and a one-line change — no second project, no second
token, no second copy of anything.

**[SETUP.md](SETUP.md) — how to put it live (~10 minutes, all in the browser).**

---

## What it is

The existing script captures leads, fires the Meta events and pings Telegram.
What it has no screen for is the call itself: who to ring next, what was said
last time, when to try again. That is this.

It lives *inside* that project as `Crm.gs` and calls its functions rather than
duplicating them:

| it needs | it uses yours |
|---|---|
| sessions | `apiLogin`, `session_` |
| stage changes | `setStatus_` — including the `SUPPRESS_` flag that stops `onEdit` echoing |
| notes | `apiRemarks` |
| the Meta send | `fireEvent_` and its `Events sent` ledger |
| config, sheet, log | `cfg`, `ss`, `props`, `log_`, `C`, `STATUSES`, `LEAD_HEADERS` |

So there is one CAPI sender, one session store, one audit trail, and one place
where an event can be marked as sent. Every name it defines starts with `crm` or
`CRM_`, and a test fails if that ever stops being true.

Your existing dashboard keeps its URL. The CRM answers on the same deployment at
`?app=crm`.

## The two screens

**Dashboard** — how the clinic is doing, over 7, 30 or 90 days: new today and how
many are still uncalled, what is due now, what is overdue, how many booked or
converted and the rate; where the leads came from by source; how many Meta events
actually went out; and the pipeline, every stage with a bar.

**Leads** — the table a caller lives in: name with how long ago it arrived,
one-tap call and WhatsApp, source, owner, the stage as a dropdown changeable from
the row, and the next follow-up coloured by how late it is. Search, filter by
source and owner, sort, and the quick counts — To call, New, Today, Working, All.
It becomes cards on a phone.

## What a caller sees

- **To call** — everything whose follow-up time has passed, oldest first. The
  answer to "who do I ring now".
- Tap a lead for the cockpit: contact, which landing page it came from, whether
  the ad click was matched, and the full history.
  - **Call** and **WhatsApp** as one tap each
  - **Log a call** — outcome plus what was said; the stage moves itself, forward
    only, so a missed call never drags a Qualified lead back down the funnel
  - **Add a note**, **Follow-up** (in 2 hours / tomorrow / 3 days / next week /
    pick a time), **Take this lead**
  - **Stage** — the nine you already use; changing one fires the Meta event
- **On a desk the cockpit docks to the right** and the queue stays on screen
  beside it. The open lead is marked, the header shows *3 / 14*, and **↑ ↓** — or
  **j** and **k** — step to the next lead without going back to the list.
- On a phone it is a full-screen sheet instead, same controls.

Roles come from the Users sheet exactly as they already do: `admin` sees
everything, anyone else only the sources listed against their name.

## Meta events

Unchanged — the CRM does not send anything itself. A stage change calls
`setStatus_`, which calls your `fireEvent_`, which checks the `Events sent`
ledger before sending. An event fires once per lead and no more, whether the
intake, the sheet or the CRM got there first. Failures land in *Last result* and
in the lead's Activity tab with Graph's own error text.

`SEND_EVENTS: no` in the Config tab still works as a dry run.

## What it writes

Three columns appended to **Leads** — `Next action at`, `Next action note`,
`Last activity at` — and a new **Activity** tab, append-only, one row per call,
note, stage change, owner change and Meta send. Ownership goes in **Assigned**,
which `LEAD_HEADERS` already declares and nothing writes to. Calls, logins and
Meta sends also land in the **Log** tab the script already keeps, in its own
four-column shape.

Existing columns are never moved or renamed, so `C` stays valid.

## Follow-up reminders

Follow-ups are a queue first: the **To call** tab is the reminder and needs
nothing running in the background. Optionally run `crmInstallDigest` once and
each caller gets an email at 9am IST listing their due follow-ups and untouched
leads.

## Files

| | |
|---|---|
| `src/Crm.gs` | the second file for your Apps Script project |
| `src/App.html` | the whole UI — one file, no build step, no framework, no CDN |
| `tools/selftest.js` | 69 checks, see below |
| `tools/preview.html` | the screens with a fake server, for working on the UI without deploying |
| `SETUP.md` | the install |

## Checking a change before you paste it in

```
node tools/selftest.js
```

Because `Crm.gs` calls the original script rather than reimplementing it, the
test stands that script up first — a faithful stand-in for `apiLogin`,
`session_`, `setStatus_`, `apiRemarks`, `fireEvent_`, `log_`, `cfg`, `ss`, `C`
and `STATUSES`, with the real pipe-delimited ledger, the `SUPPRESS_` flag and the
Log tab's shape — then loads `Crm.gs` on top and checks the seams.

It is the seams that would break quietly: that `Assigned` is reused rather than
duplicated, that the ledger stops an event firing twice, that a stage change goes
through `setStatus_` so `SUPPRESS_` is set and cleared, that `HEnquiry` reaches
the dashboard even though it is not a stage, and that no top-level name shadows
one in your file. 69 checks, no dependencies, about a second.

## Working on the screens

```
python3 -m http.server 8080      # from the repo root
```

then open <http://localhost:8080/tools/preview.html>. It loads the real
`src/App.html` against a fake server holding fourteen invented leads — some due,
some overdue, one booked — so layout, the docked panel and the action modals can
be worked on in seconds instead of redeploying each time. Any PIN signs in.
Nothing in `tools/` ships.

## Secrets

None, and none needed. The CRM calls your `fireEvent_`, which reads the token
from `cfg()` — the `META_TOKEN` script property the project already has. There is
no second token and no spreadsheet id in the code, because the script is bound to
the sheet.

Nothing here is a credential: the screens check a PIN from your Users sheet
through your own `apiLogin`, and reaching the data still needs Google permission
on the spreadsheet.

The token currently in use has been in a shared file and pasted into a chat.
Rotate it in Business Manager and replace the `META_TOKEN` property — both the
intake and the CRM pick the new one up with no other change.

## Limits worth knowing

Apps Script is free but not unlimited: 6 minutes per execution, and on a consumer
account 20,000 UrlFetch calls and 90 minutes of runtime a day. At a few hundred
leads and a handful of callers this is nowhere near. The lead list is read in one
range call per refresh, which is what keeps it quick; a sheet in the tens of
thousands of rows would want pagination.

Two people editing the same lead within a few seconds: last write wins. With two
or three callers and an owner column it has not been worth more than that.
