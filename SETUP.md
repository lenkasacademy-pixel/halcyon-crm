# Setting it up

About 15 minutes, all in the browser. Nothing to install, nothing to pay for.

You will need the leads spreadsheet open in one tab and this repo in another.

---

## 1. Create the script project

1. Go to <https://script.google.com> → **New project**.
2. Rename it (top left) to **Halcyon CRM**.
3. Delete whatever is in `Code.gs` and paste in all of [`src/Code.gs`](src/Code.gs).
4. **+** next to *Files* → **HTML** → name it exactly `App` → delete its contents and
   paste in all of [`src/App.html`](src/App.html).
5. ⚙️ **Project Settings** → tick **Show "appsscript.json" manifest file in editor**.
   Go back to the editor, open `appsscript.json`, and paste in
   [`src/appsscript.json`](src/appsscript.json).
6. Save (⌘S).

This is a *standalone* script, not attached to the sheet. The script that already
captures leads and sends the Telegram alerts is not touched and keeps working.

---

## 2. Point it at the sheet and give it the Meta token

Project Settings → **Script Properties** → **Add script property**, twice:

| Property | Value |
|---|---|
| `SHEET_ID` | **required** — the id from the leads sheet's own URL, the long string between `/d/` and `/edit`. It is deliberately not in the code: this repo is public and that id points at live enquiries. |
| `META_TOKEN` | a Meta system-user access token with `ads_management` on the dataset |

**About the token.** The one currently sitting in the old script's source has
been in a shared file and pasted into a chat, so treat it as public: in Business
Manager, delete it and generate a new one. Paste the new token here only. It
never goes into the code, into the sheet, or into this repo.

Everything else — dataset id, API version, conversion value, the WhatsApp number —
is read from the **Config** tab of the sheet, so both scripts always agree. Nothing
to duplicate here.

---

## 3. Add the CRM's columns

In the editor, pick `setup` from the function dropdown and press **Run**.

Google will ask for permission the first time: choose the account that owns the
sheet → *Advanced* → *Go to Halcyon CRM (unsafe)* → **Allow**. The "unsafe" wording
is what Google shows for any script that has not been through its review; it means
unverified, not unsafe.

It adds three columns at the **end** of the Leads header row, so every existing
column keeps its position and the other script's column map still matches:

- **Next action at** — when to call back
- **Next action note** — why
- **Last activity at** — for sorting

Ownership goes in **Assigned**, the column your intake script already declares
and never fills, so there is no second column meaning the same thing.

and creates an **Activity** tab: every call, note, stage change and Meta send,
append-only, one row each.

Check the execution log says `added: [...]` with no error.

---

## 4. Users and PINs

The **Users** sheet is exactly the one your intake script already uses, with the
same six columns in the same order — `Name, PIN, Role, Sources, Telegram chat ID,
Active`. Do not reorder or rename them: both scripts read them by position.

| Name | PIN | Role | Sources | Telegram chat ID | Active |
|---|---|---|---|---|---|
| Pallavi | *your 6 digits* | admin | all | *leave as is* | yes |
| Caller 1 | *your 6 digits* | caller | 7788 | *leave as is* | yes |

- **PIN** — 6 digits, different for each person, and chosen by you. Do not copy an
  example from anywhere: this repo is public, and the PIN is the only thing
  standing between the web app URL and the lead data. Don't use 1234, and don't
  send the PIN in the same message as the link.
- **Role** — `admin` sees every lead; anything else is limited to **Sources**.
- **Sources** — `all`, or the source tags that person handles, comma separated.
  These must match the values in the Leads sheet's *Source* column exactly.
- **Active** — `no` switches someone off without deleting the row.

For the morning reminder mail, add an **Email** column **after** Active. The
intake script reads only the first six columns, so a seventh is invisible to it.

---

## 5. Publish it

**Deploy** → **New deployment** → gear ⚙️ → **Web app**:

- Description: `v1`
- Execute as: **Me**
- Who has access: **Anyone**

→ **Deploy**, then copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`).

"Anyone" means anyone with that URL reaches the *login screen* — it has to be this,
or callers who are not signed into a Google account on their phone cannot open it.
The PIN is the actual gate. Treat the URL as semi-secret: send it to the callers,
don't post it anywhere public.

On each caller's phone: open the URL in Chrome → ⋮ → **Add to Home screen**. It then
behaves like an app, and the sign-in survives until the phone closes the tab.

Sanity check: `…/exec?health=1` returns a small JSON — `metaTokenSet` should be
`true` and `leads` should be your real count.

---

## 6. Morning reminders (optional)

Editor → run `installDailyDigest` once. At 9am IST each active user with an Email
gets a list of their follow-ups due in the next 24 hours plus anything still New.
Gmail's free sending limit is far above what this needs.

To stop it: Triggers (⏰ in the left rail) → delete the `dailyDigest` trigger.

---

## Updating it later

Paste the changed file over the old one, save, then **Deploy → Manage deployments →**
✏️ **→ Version: New version → Deploy**. The URL stays the same. Editing without
deploying a new version changes nothing for the callers.

---

## If something is wrong

**"SHEET_ID is not set"** — step 2. The id is not in the code on purpose, so the
script cannot start without it.

**"Sheet 'Leads' not found"** — `SHEET_ID` is wrong, or the account you deployed as
cannot open that sheet.

**"No Meta token in Script Properties"** — stage changes still save; only the Meta
send is skipped. Add `META_TOKEN` and it works from the next change on. Nothing is
lost, but the events missed in between are not sent retroactively.

**Stage saves but the Meta pill says the send failed** — open the lead's Activity
tab; the `meta` line carries Graph's own error text. Usually an expired token or a
dataset the token has no permission on. The *Last result* column in the sheet has
the same message.

**An event only fires once, ever** — by design. The **Events sent** column is the
ledger; if `HConverted` is in there, moving the lead out of Converted and back will
not send it a second time. That column is shared with the old script, so whichever
one sent it first counts.

**Someone sees no leads** — their *Sources* value doesn't match the Source column's
spelling, or *Active* isn't `yes`.

**"Run setup first"** — the Owner / Next action columns are missing; step 3.
