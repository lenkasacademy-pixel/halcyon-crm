/*******************************************************************
 * HALCYON CRM — the telecaller screens, added to the script that is
 * already running.
 *
 * This is a second file inside your existing CAPI project, not a separate
 * one. Everything is already set up there — the sheet it is bound to, the
 * Meta token in Script Properties, the Config tab, the Users sheet — so
 * this file adds screens and nothing else.
 *
 * It deliberately reuses what is already working rather than shipping a
 * second copy of it:
 *
 *   apiLogin / session_   the sessions you already have
 *   setStatus_            stage changes, including the SUPPRESS_ flag that
 *                         stops onEdit echoing, and the Meta send
 *   apiRemarks            writing Remarks + Updated by / Updated at
 *   fireEvent_            the CAPI sender and its "Events sent" ledger
 *   cfg / ss / props / log_ / C / STATUSES / LEAD_HEADERS
 *
 * So there is one CAPI sender, one session store, one audit trail, and one
 * place where an event can be marked as sent.
 *
 * Every name defined here starts with crm or CRM_, so nothing in the
 * original file is shadowed. The only edit needed there is one line in
 * doGet — see SETUP.md.
 *******************************************************************/

var CRM_VERSION = 'crm-2.0.0';
var CRM_TZ = 'Asia/Kolkata';

/* Ownership goes in "Assigned", which LEAD_HEADERS already declares and
   nothing writes — an empty column meant for exactly this. */
var CRM_OWNER_COL = 'Assigned';

/* The only columns the CRM adds, appended at the end so every existing
   column keeps its position and C stays valid. */
var CRM_EXTRA_COLUMNS = ['Next action at', 'Next action note', 'Last activity at'];

var CRM_ACTIVITY = 'Activity';
var CRM_ACTIVITY_HEADERS = ['Time', 'Lead ID', 'Type', 'By', 'Detail'];

/* Call outcomes. `key` is the STATUSES key the outcome implies — applied
   only when it moves the lead forward, never backward. */
var CRM_OUTCOMES = [
  { key: 'answered', label: 'Answered',            status: 'contacted' },
  { key: 'noanswer', label: 'No answer',           status: 'attempted' },
  { key: 'busy',     label: 'Busy / cut',          status: 'attempted' },
  { key: 'switched', label: 'Switched off',        status: 'attempted' },
  { key: 'wrong',    label: 'Wrong number',        status: 'junk'      },
  { key: 'callback', label: 'Asked to call later', status: 'contacted' }
];

/* STATUSES carries a hex colour for the sheet; the screens want a named
   tone. Keyed off the status key so the two stay in step. */
var CRM_TONES = {
  new: 'grey', attempted: 'amber', contacted: 'blue', qualified: 'violet',
  booked: 'teal', converted: 'green', notq: 'grey', junk: 'red', lost: 'red'
};

/* ============================== plumbing ============================== */

/** Header name → 1-based column, including the columns the CRM appends.
    C in the original file is built from LEAD_HEADERS and so does not know
    about them. */
function crmCols_() {
  if (crmCols_._c) return crmCols_._c;
  var sh = ss().getSheetByName(SH_LEADS);
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var map = {};
  for (var i = 0; i < head.length; i++) {
    var name = String(head[i] || '').trim();
    if (name && !map[name]) map[name] = i + 1;
  }
  crmCols_._c = map;
  return map;
}

function crmFmt_(d) {
  if (!d) return '';
  var date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return Utilities.formatDate(date, CRM_TZ, 'dd MMM, HH:mm');
}
function crmIso_(d) {
  if (!d) return '';
  var date = (d instanceof Date) ? d : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

/** The stage list the screens render, built from STATUSES so it cannot drift. */
function crmStages_() {
  var out = [];
  for (var i = 0; i < STATUSES.length; i++) {
    out.push({
      key: STATUSES[i].key, label: STATUSES[i].label,
      event: STATUSES[i].event, tone: CRM_TONES[STATUSES[i].key] || 'grey'
    });
  }
  return out;
}

/** Adds the CRM's columns and the Activity tab. Safe to run repeatedly. */
function crmSetup() {
  var sh = ss().getSheetByName(SH_LEADS);
  var map = crmCols_();
  var want = [CRM_OWNER_COL].concat(CRM_EXTRA_COLUMNS);
  var add = want.filter(function (c) { return !map[c]; });
  if (add.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, add.length).setValues([add])
      .setFontWeight('bold');
    crmCols_._c = null;
  }
  var act = ss().getSheetByName(CRM_ACTIVITY) || ss().insertSheet(CRM_ACTIVITY);
  if (act.getLastRow() === 0) {
    act.getRange(1, 1, 1, CRM_ACTIVITY_HEADERS.length).setValues([CRM_ACTIVITY_HEADERS])
       .setFontWeight('bold');
    act.setFrozenRows(1);
  }
  var due = crmCols_()['Next action at'];
  if (due) sh.getRange(2, due, sh.getMaxRows() - 1, 1).setNumberFormat('dd mmm yyyy, hh:mm');
  log_('crm setup', add.join(', ') || 'nothing to add', 'OK');
  return { ok: true, added: add, version: CRM_VERSION };
}

/** The screens. doGet routes here — see SETUP.md. */
function crmPage() {
  return HtmlService.createTemplateFromFile('App').evaluate()
    .setTitle('Halcyon CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ================================ reading ============================== */

function crmReadAll_() {
  var sh = ss().getSheetByName(SH_LEADS), K = crmCols_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var v = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
  var get = function (row, name) { return K[name] ? row[K[name] - 1] : ''; };
  var out = [];
  for (var i = 0; i < n; i++) {
    var id = String(get(v[i], 'Lead ID') || '');
    if (!id) continue;
    out.push({
      id: id, row: i + 2,
      time: get(v[i], 'Time'),
      name: String(get(v[i], 'Name') || ''),
      phone: String(get(v[i], 'Phone') || ''),
      source: String(get(v[i], 'Source') || ''),
      stage: String(get(v[i], 'Status') || 'New'),
      owner: String(get(v[i], CRM_OWNER_COL) || ''),
      nextAt: get(v[i], 'Next action at'),
      nextNote: String(get(v[i], 'Next action note') || ''),
      remarks: String(get(v[i], 'Remarks') || ''),
      events: String(get(v[i], 'Events sent') || ''),
      pageUrl: String(get(v[i], 'Page URL') || ''),
      fbc: String(get(v[i], 'fbc') || ''),
      lastResult: String(get(v[i], 'Last result') || '')
    });
  }
  return out;
}

/** Which sources a user may see — the same rule apiLeads uses. */
function crmVisible_(u, leads) {
  var mine = (u.role === 'admin' || u.sources === 'all' || !u.sources)
    ? null : u.sources.split(/[,\s]+/).filter(Boolean);
  if (!mine) return leads;
  return leads.filter(function (l) { return mine.indexOf(l.source.toLowerCase()) >= 0; });
}

function crmCard_(l) {
  return {
    id: l.id, name: l.name, phone: l.phone, source: l.source, stage: l.stage,
    owner: l.owner, remarks: l.remarks,
    time: crmFmt_(l.time), timeIso: crmIso_(l.time),
    nextAt: crmFmt_(l.nextAt), nextIso: crmIso_(l.nextAt), nextNote: l.nextNote,
    events: l.events.split('|').filter(Boolean)
  };
}

/** One payload for the whole app. */
function crmBootstrap(token) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  var leads = crmVisible_(u, crmReadAll_());
  var now = Date.now();
  var counts = { total: leads.length, due: 0, overdue: 0, today: 0, untouched: 0 };
  leads.forEach(function (l) {
    if (l.nextAt) {
      var t = new Date(l.nextAt).getTime();
      if (t <= now) counts.due++;
      if (t <= now - 864e5) counts.overdue++;
    }
    if (l.time && now - new Date(l.time).getTime() < 864e5) counts.today++;
    if (String(l.stage).toLowerCase() === 'new') counts.untouched++;
  });
  return {
    ok: true, user: u, version: CRM_VERSION,
    stages: crmStages_(), outcomes: CRM_OUTCOMES,
    whatsapp: String(cfg().WHATSAPP_NUMBER || ''),
    counts: counts,
    sources: leads.map(function (l) { return l.source; })
                  .filter(function (s, i, a) { return s && a.indexOf(s) === i; }).sort(),
    leads: leads.map(crmCard_)
  };
}

function crmFind_(id) {
  var all = crmReadAll_();
  for (var i = 0; i < all.length; i++) if (all[i].id === String(id)) return all[i];
  return null;
}

/** The cockpit: everything for one call on one screen. */
function crmLead(token, id) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  var l = crmFind_(id);
  if (!l) return { ok: false, error: 'Lead not found' };
  if (crmVisible_(u, [l]).length === 0) return { ok: false, error: 'Not your number' };
  return {
    ok: true,
    lead: {
      id: l.id, name: l.name, phone: l.phone, source: l.source, stage: l.stage,
      owner: l.owner, remarks: l.remarks,
      time: crmFmt_(l.time), nextAt: crmFmt_(l.nextAt), nextIso: crmIso_(l.nextAt),
      nextNote: l.nextNote, pageUrl: l.pageUrl,
      attributed: !!l.fbc,
      eventsSent: l.events.split('|').filter(Boolean),
      lastResult: l.lastResult
    },
    activity: crmActivityFor_(l.id)
  };
}

function crmActivityFor_(leadId) {
  var sh = ss().getSheetByName(CRM_ACTIVITY);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, CRM_ACTIVITY_HEADERS.length).getValues();
  var out = [];
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][1]) !== String(leadId)) continue;
    out.push({ time: crmFmt_(v[i][0]), type: String(v[i][2] || ''),
               by: String(v[i][3] || ''), detail: String(v[i][4] || '') });
    if (out.length >= 60) break;
  }
  return out;
}

function crmAddActivity_(leadId, type, by, detail) {
  var sh = ss().getSheetByName(CRM_ACTIVITY);
  if (!sh) return;
  sh.appendRow([new Date(), leadId, type, by, String(detail || '').slice(0, 1000)]);
  var K = crmCols_();
  if (K['Last activity at']) {
    var row = findRowById_(leadId);
    if (row) ss().getSheetByName(SH_LEADS).getRange(row, K['Last activity at']).setValue(new Date());
  }
}

/* ================================ writing ============================== */

function crmNote(token, leadId, text) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  text = String(text || '').trim();
  if (!text) return { ok: false, error: 'Nothing to save' };
  var r = apiRemarks(token, leadId, text);          // Remarks + Updated by / at
  if (!r.ok) return r;
  crmAddActivity_(leadId, 'note', u.name, text);
  return { ok: true, activity: crmActivityFor_(leadId) };
}

function crmSetStage(token, leadId, label, quiet) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  var r = apiStatus(token, leadId, label);          // status + SUPPRESS_ + Meta send
  if (!r.ok) return r;
  if (!quiet) crmAddActivity_(leadId, 'stage', u.name, r.status);
  var meta = r.meta || {};
  if (meta.ok || meta.error) {
    crmAddActivity_(leadId, 'meta', 'system',
      statusByLabel(r.status).event + ' → ' + (meta.ok ? 'sent' : 'failed: ' + meta.error));
  }
  return { ok: true, stage: r.status, meta: meta, activity: crmActivityFor_(leadId) };
}

function crmLogCall(token, leadId, outcomeKey, text) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  var l = crmFind_(leadId);
  if (!l) return { ok: false, error: 'Lead not found' };
  var outcome = null;
  for (var i = 0; i < CRM_OUTCOMES.length; i++)
    if (CRM_OUTCOMES[i].key === outcomeKey) outcome = CRM_OUTCOMES[i];
  if (!outcome) return { ok: false, error: 'Unknown outcome' };

  crmAddActivity_(leadId, 'call', u.name, outcome.label + (text ? ' — ' + text : ''));
  log_('crm call', leadId + ' ' + outcome.label, u.name);

  /* Forward only: a missed call must not drag a Qualified lead back down the
     funnel. A wrong number is the exception — that is a fact, not progress. */
  var order = STATUSES.map(function (s) { return s.key; });
  var cur = statusByLabel(l.stage);
  var want = statusByKey(outcome.status);
  var stage = l.stage;
  if (want && (want.key === 'junk' || !cur || order.indexOf(want.key) > order.indexOf(cur.key))) {
    var r = crmSetStage(token, leadId, want.label, true);
    if (r.ok) stage = r.stage;
  }
  return { ok: true, stage: stage, activity: crmActivityFor_(leadId) };
}

function crmFollowUp(token, leadId, whenIso, text) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  var row = findRowById_(leadId);
  if (!row) return { ok: false, error: 'Lead not found' };
  var K = crmCols_(), sh = ss().getSheetByName(SH_LEADS);
  if (!K['Next action at']) return { ok: false, error: 'Run crmSetup first' };

  if (!whenIso) {
    sh.getRange(row, K['Next action at']).setValue('');
    sh.getRange(row, K['Next action note']).setValue('');
    crmAddActivity_(leadId, 'followup', u.name, 'Follow-up cleared');
    return { ok: true, nextAt: '', nextNote: '' };
  }
  var when = new Date(whenIso);
  if (isNaN(when.getTime())) return { ok: false, error: 'Bad date' };
  sh.getRange(row, K['Next action at']).setValue(when);
  sh.getRange(row, K['Next action note']).setValue(String(text || '').slice(0, 300));
  if (K[CRM_OWNER_COL] && !String(sh.getRange(row, K[CRM_OWNER_COL]).getValue() || ''))
    sh.getRange(row, K[CRM_OWNER_COL]).setValue(u.name);
  crmAddActivity_(leadId, 'followup', u.name,
    'Call back ' + crmFmt_(when) + (text ? ' — ' + text : ''));
  return { ok: true, nextAt: crmFmt_(when), nextIso: when.toISOString(), nextNote: String(text || '') };
}

function crmAssign(token, leadId, who) {
  var u = session_(token);
  if (!u) return { ok: false, expired: true };
  var row = findRowById_(leadId);
  if (!row) return { ok: false, error: 'Lead not found' };
  var K = crmCols_();
  if (!K[CRM_OWNER_COL]) return { ok: false, error: 'No "' + CRM_OWNER_COL + '" column' };
  ss().getSheetByName(SH_LEADS).getRange(row, K[CRM_OWNER_COL]).setValue(String(who || u.name));
  crmAddActivity_(leadId, 'owner', u.name, 'Owner: ' + (who || u.name));
  return { ok: true, owner: String(who || u.name) };
}

/* ========================== daily reminder mail ======================== */
/*
 * Optional. Run crmInstallDigest() once and each morning every active user
 * with an Email in the Users sheet gets their own due list. The Users sheet
 * is read by USER_HEADERS.length elsewhere, so an Email column added after
 * Active is invisible to the rest of the script.
 */

function crmInstallDigest() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'crmDailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('crmDailyDigest').timeBased().atHour(9).everyDays(1)
    .inTimezone(CRM_TZ).create();
  return { ok: true, note: 'Digest goes out at 9am ' + CRM_TZ };
}

function crmDailyDigest() {
  var sh = ss().getSheetByName(SH_USERS);
  if (!sh || sh.getLastRow() < 2) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var emailCol = head.indexOf('Email');
  if (emailCol < 0) return;
  var users = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var leads = crmReadAll_(), now = Date.now();

  users.forEach(function (row) {
    var email = String(row[emailCol] || '').trim();
    if (!email || String(row[5]).toLowerCase() !== 'yes') return;
    var u = { role: String(row[2] || 'caller').toLowerCase(),
              sources: String(row[3] || '').toLowerCase() };
    var mine = crmVisible_(u, leads).filter(function (l) {
      return (l.nextAt && new Date(l.nextAt).getTime() <= now + 864e5) ||
             String(l.stage).toLowerCase() === 'new';
    });
    if (!mine.length) return;
    var lines = mine.slice(0, 40).map(function (l) {
      return '• ' + (l.name || 'No name') + ' — ' + l.phone + '  [' + l.stage + ']' +
             (l.nextAt ? '  due ' + crmFmt_(l.nextAt) : '') +
             (l.nextNote ? ' — ' + l.nextNote : '');
    });
    MailApp.sendEmail({
      to: email,
      subject: 'Halcyon: ' + mine.length + ' lead' + (mine.length > 1 ? 's' : '') + ' to call today',
      body: 'Due or waiting:\n\n' + lines.join('\n') +
            '\n\nOpen the CRM: ' + ScriptApp.getService().getUrl() + '?app=crm'
    });
  });
}
