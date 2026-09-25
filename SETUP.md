# Setting it up

Ten minutes, all in the browser. The CRM goes **inside the CAPI script you are
already running** — the one bound to the leads sheet. Everything it needs is
already there: the sheet, the Meta token, the Config tab, the Users sheet.

Nothing here replaces or edits your existing code. You add two files and change
one line.

---

## 1. Add the two files

Open the leads spreadsheet → **Extensions ▸ Apps Script**. You should see the
existing project with your CAPI code and a `Dashboard` HTML file.

1. **+** next to *Files* → **Script** → name it `Crm` → delete the stub and paste
   in all of [`src/Crm.gs`](src/Crm.gs).
2. **+** next to *Files* → **HTML** → name it exactly `App` → delete the stub and
   paste in all of [`src/App.html`](src/App.html).
3. Save (⌘S).

Every name in `Crm.gs` starts with `crm` or `CRM_`, so nothing in your original
file is shadowed. It *calls* your existing functions rather than duplicating
them — `apiLogin` and `session_` for sessions, `setStatus_` for stage changes,
`apiRemarks` for notes, `fireEvent_` for the Meta send, plus `cfg`, `ss`, `log_`,
`C` and `STATUSES`. One CAPI sender, one session store, one audit trail.

---

## 2. Change one line in your existing file

Find `doGet` in your original script. Near the end it does this:

```js
  if (p.health) return json_(healthData_());

  var t = HtmlService.createTemplateFromFile('Dashboard');
```

Add one line immediately **above** that `var t`:

```js
  if (p.app === 'crm') return crmPage();

  var t = HtmlService.createTemplateFromFile('Dashboard');
```

That is the only edit to your code. Your old dashboard stays exactly where it
was; the CRM answers on the same deployment at `?app=crm`.

---

## 3. Add the columns

In the editor, pick `crmSetup` from the function dropdown and press **Run**.

Google may ask for permission again, because the project can now send mail for
the optional digest. Choose the account that owns the sheet → *Advanced* → *Go
to … (unsafe)* → **Allow**. "Unsafe" is what Google shows for any script it has
not reviewed; it means unverified, not unsafe.

It appends **three** columns to the end of the Leads header row, so every
existing column keeps its position and your `C` map stays valid:

- **Next action at** — when to call back
- **Next action note** — why
- **Last activity at** — for sorting

Ownership goes in **Assigned**, the column `LEAD_HEADERS` already declares and
nothing writes to, so there is no second column meaning the same thing.

It also creates an **Activity** tab: every call, note, stage change and Meta
send, append-only, one row each.

Check the execution log says `added: [...]` with no error.

---

## 4. The login

The CRM signs in through your existing `apiLogin`, which compares what is typed
against **column B** of the Users sheet. It was never restricted to digits — any
text works — so a single shared password is just a matter of what is in that
cell.

**For one shared login:** put the password in **B2** (the `admin` row, sources
`all`) and clear B3 onwards. `apiLogin` skips empty values explicitly, so those
rows can no longer sign in.

Do not delete the rows. The same sheet decides **who gets the Telegram alert**
for a new lead — `chatIdsForSource_` matches a row's *Sources* against the
lead's source and messages that row's chat ID. Clearing the password leaves
that routing exactly as it is; deleting the row silently stops the alerts.

> The same login also opens your older dashboard. Whichever passwords you clear,
> those people lose that too.

**On what to choose.** This is a public URL holding patients' names, phone
numbers and what they said is wrong with them. A brand name plus a number is
guessed in seconds. Three unrelated words — `halcyon-tuesday-lamp` — is just as
easy to read out over the phone and cannot be walked into. Change it whenever
someone leaves: one cell, no deploy.

For the optional morning mail, add an **Email** column **after** Active. The
rest of the script reads only the first six columns, so a seventh is invisible
to it.

---

## 5. Redeploy

**Deploy ▸ Manage deployments ▸** ✏️ **→ Version: New version → Deploy.**

The URL does not change. Then:

- your existing dashboard: `https://script.google.com/macros/s/…/exec`
- **the CRM: `https://script.google.com/macros/s/…/exec?app=crm`**

Send the callers the `?app=crm` link. On each phone: open it in Chrome → ⋮ →
**Add to Home screen**, and it behaves like an app.

Editing a file without deploying a new version changes nothing for the callers —
the deployment serves the version you last published.

---

## 6. Morning reminders (optional)

Editor → run `crmInstallDigest` once. At 9am IST each active user with an Email
gets their follow-ups due in the next 24 hours plus anything still New.

To stop it: Triggers (⏰ in the left rail) → delete the `crmDailyDigest` trigger.

---

## The token

You do not need to set one. The CRM calls your `fireEvent_`, which reads
`ACCESS_TOKEN` from `cfg()` — the `META_TOKEN` script property you already have.

Separately, and still worth doing: that token has been in a shared file and
pasted into a chat, so treat it as public. Generate a new one in Business
Manager and replace the `META_TOKEN` property. Both the intake and the CRM pick
it up with no other change.

---

## If something is wrong

**`crmPage is not defined`** — `Crm.gs` was not saved, or the `doGet` edit went
into a different project. Both files must be in the same Apps Script project.

**The CRM URL shows the old dashboard** — the `?app=crm` line is below the
`var t = HtmlService…` line instead of above it, or a new version has not been
deployed.

**"Run crmSetup first"** — the three columns are missing; step 3.

**A stage saves but the Meta pill says it failed** — open the lead's Activity
tab; the `meta` line carries Graph's own error text, and the same message is in
the *Last result* column. Usually an expired token.

**An event only fires once, ever** — by design, and it is your ledger doing it.
`fireEvent_` checks `Events sent` before sending, so if `HConverted` is already
there, moving the lead out of Converted and back will not send it again.

**Someone sees no leads** — their *Sources* value does not match the Source
column's spelling, or *Active* is not `yes`. The same rule your dashboard uses.
