/*******************************************************************
 * HALCYON CRM — telecaller cockpit on the existing leads sheet
 *
 * A standalone Apps Script web app. It opens the leads spreadsheet by id,
 * so the script that already captures leads and sends the Telegram alerts
 * keeps running untouched. This one adds what that script has no screen for:
 *
 *   · one screen per lead — contact, which ad it came from, every note and
 *     call logged against it;
 *   · follow-ups with a time, and a queue of what is due;
 *   · stage changes that fire the Meta custom events, guarded by the same
 *     "Events sent" ledger, so an event can never be sent twice.
 *
 * Nothing here writes a secret into the sheet or into this file. The Meta
 * token lives in Script Properties (File ▸ Project Settings ▸ Script
 * Properties). See SETUP.md.
 *******************************************************************/

var VERSION = 'crm-1.0.0';

/* The leads spreadsheet. Script Property SHEET_ID wins, so a test copy can be
   pointed at without editing code. */
var SHEET_ID_FALLBACK = 'PUT_THIS_IN_SCRIPT_PROPERTIES';

var SH_LEADS = 'Leads', SH_USERS = 'Users', SH_ACTIVITY = 'Activity', SH_CONFIG = 'Config';

/* Columns this CRM needs on top of the ones the intake script writes.
   Missing ones are appended to the header row on first run; existing columns
   are never moved, so the other script's column map stays valid. */
var EXTRA_COLUMNS = ['Owner', 'Next action at', 'Next action note', 'Last activity at'];

var ACTIVITY_HEADERS = ['Time', 'Lead ID', 'Type', 'By', 'Detail'];

/* Stage → Meta custom event. Must match the intake script, or the ledger in
   "Events sent" would not recognise what has already gone. */
var STAGES = [
  { key: 'new',       label: 'New',           event: null,            tone: 'grey'   },
  { key: 'attempted', label: 'Attempted',     event: 'HAttempted',    tone: 'amber'  },
  { key: 'contacted', label: 'Contacted',     event: 'HContacted',    tone: 'blue'   },
  { key: 'qualified', label: 'Qualified',     event: 'HQualified',    tone: 'violet' },
  { key: 'booked',    label: 'Booked',        event: 'HBooked',       tone: 'teal'   },
  { key: 'converted', label: 'Converted',     event: 'HConverted',    tone: 'green'  },
  { key: 'notq',      label: 'Not qualified', event: 'HNotQualified', tone: 'grey'   },
  { key: 'junk',      label: 'Junk',          event: 'HJunk',         tone: 'red'    },
  { key: 'lost',      label: 'Lost',          event: 'HLost',         tone: 'red'    }
];
function stageByLabel_(l) {
  l = String(l || '').trim().toLowerCase();
  for (var i = 0; i < STAGES.length; i++) if (STAGES[i].label.toLowerCase() === l) return STAGES[i];
  return null;
}

/* Call outcomes offered in the log-call box. `stage` is the stage that outcome
   implies — applied only when it moves the lead forward, never backward. */
var CALL_OUTCOMES = [
  { key: 'answered',  label: 'Answered',      stage: 'contacted' },
  { key: 'noanswer',  label: 'No answer',     stage: 'attempted' },
  { key: 'busy',      label: 'Busy / cut',    stage: 'attempted' },
  { key: 'switched',  label: 'Switched off',  stage: 'attempted' },
  { key: 'wrong',     label: 'Wrong number',  stage: 'junk'      },
  { key: 'callback',  label: 'Asked to call later', stage: 'contacted' }
];

var TZ = 'Asia/Kolkata';

/* ============================== plumbing ============================== */

function props_() { return PropertiesService.getScriptProperties(); }
function sheetId_() { return props_().getProperty('SHEET_ID') || SHEET_ID_FALLBACK; }
function book_() {
  if (!book_._b) book_._b = SpreadsheetApp.openById(sheetId_());
  return book_._b;
}
function sheet_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" not found in the spreadsheet.');
  return sh;
}

/** Config values from the leads sheet's own Config tab, so both scripts agree. */
function cfg_() {
  if (cfg_._c) return cfg_._c;
  var o = {
    DATASET_ID: '1568043288155968', API_VERSION: 'v26.0', TEST_EVENT_CODE: '',
    SITE_ORIGIN: 'https://halcyonpainmanagement.com', CONVERSION_VALUE: 3000,
    CURRENCY: 'INR', COUNTRY_CODE: '91', SEND_EVENTS: 'yes', WHATSAPP_NUMBER: '918585072072'
  };
  try {
    var sh = book_().getSheetByName(SH_CONFIG);
    if (sh && sh.getLastRow() > 1) {
      var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
      for (var i = 0; i < v.length; i++) {
        var k = String(v[i][0] || '').trim();
        if (k && v[i][1] !== '' && v[i][1] !== null) o[k] = v[i][1];
      }
    }
  } catch (e) {}
  o.META_TOKEN = props_().getProperty('META_TOKEN') || '';
  cfg_._c = o;
  return o;
}

/** Header name → 1-based column, built from the sheet's own header row. */
function cols_() {
  if (cols_._c) return cols_._c;
  var sh = sheet_(SH_LEADS);
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  var map = {};
  for (var i = 0; i < head.length; i++) {
    var name = String(head[i] || '').trim();
    if (name && !map[name]) map[name] = i + 1;
  }
  cols_._c = map;
  return map;
}

/** Adds the CRM's own columns and the Activity sheet. Safe to run repeatedly. */
function setup() {
  var sh = sheet_(SH_LEADS);
  var map = cols_();
  var add = EXTRA_COLUMNS.filter(function (c) { return !map[c]; });
  if (add.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, add.length).setValues([add])
      .setFontWeight('bold').setBackground('#12232e').setFontColor('#ffffff');
    cols_._c = null;
  }
  var act = book_().getSheetByName(SH_ACTIVITY) || book_().insertSheet(SH_ACTIVITY);
  if (act.getLastRow() === 0) {
    act.getRange(1, 1, 1, ACTIVITY_HEADERS.length).setValues([ACTIVITY_HEADERS])
       .setFontWeight('bold').setBackground('#12232e').setFontColor('#ffffff');
    act.setFrozenRows(1);
    act.getRange('A:A').setNumberFormat('dd mmm yyyy, hh:mm');
  }
  var dueCol = cols_()['Next action at'];
  if (dueCol) sh.getRange(2, dueCol, sh.getMaxRows() - 1, 1).setNumberFormat('dd mmm yyyy, hh:mm');
  return { ok: true, added: add, version: VERSION, sheet: book_().getName() };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.health) {
    return ContentService.createTextOutput(JSON.stringify(health_(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createTemplateFromFile('App').evaluate()
    .setTitle('Halcyon CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(f) { return HtmlService.createHtmlOutputFromFile(f).getContent(); }

function health_() {
  var sh = sheet_(SH_LEADS);
  var c = cfg_();
  return {
    version: VERSION, spreadsheet: book_().getName(), leads: Math.max(0, sh.getLastRow() - 1),
    metaTokenSet: !!c.META_TOKEN, dataset: c.DATASET_ID, sendEvents: c.SEND_EVENTS,
    columnsPresent: EXTRA_COLUMNS.filter(function (x) { return !!cols_()[x]; }),
    activitySheet: !!book_().getSheetByName(SH_ACTIVITY)
  };
}

/* =============================== sessions ============================== */

function login(pin) {
  pin = String(pin || '').trim();
  if (!pin) return { ok: false, error: 'Enter your PIN' };
  var sh = sheet_(SH_USERS);
  if (sh.getLastRow() < 2) return { ok: false, error: 'No users set up yet' };
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][5]).toLowerCase() === 'no') continue;
    if (String(v[i][1]).trim() !== pin) continue;
    var user = {
      name: String(v[i][0] || 'Caller'),
      role: String(v[i][2] || 'caller').toLowerCase(),
      sources: String(v[i][3] || '').toLowerCase()
    };
    var token = Utilities.getUuid();
    props_().setProperty('s_' + token, JSON.stringify({ u: user, exp: Date.now() + 12 * 3600 * 1000 }));
    return { ok: true, token: token, user: user };
  }
  return { ok: false, error: 'PIN not recognised' };
}

function user_(token) {
  var raw = props_().getProperty('s_' + String(token || ''));
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  if (!s.exp || s.exp < Date.now()) { props_().deleteProperty('s_' + token); return null; }
  return s.u;
}
function logout(token) { props_().deleteProperty('s_' + String(token || '')); return { ok: true }; }

/* Which sources a user may see. Admin, or "all", sees everything. */
function scope_(u) {
  if (!u) return [];
  if (u.role === 'admin' || u.sources === 'all' || !u.sources) return null;
  return u.sources.split(/[,\s]+/).filter(Boolean);
}

/* ================================ reading ============================== */

function allLeads_() {
  var sh = sheet_(SH_LEADS), C = cols_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var width = sh.getLastColumn();
  var v = sh.getRange(2, 1, n, width).getValues();
  var get = function (row, name) { return C[name] ? row[C[name] - 1] : ''; };
  var out = [];
  for (var i = 0; i < n; i++) {
    var r = v[i];
    var id = String(get(r, 'Lead ID') || '');
    if (!id) continue;
    out.push({
      id: id,
      row: i + 2,
      time: get(r, 'Time'),
      name: String(get(r, 'Name') || ''),
      phone: String(get(r, 'Phone') || ''),
      source: String(get(r, 'Source') || ''),
      stage: String(get(r, 'Status') || 'New'),
      owner: String(get(r, 'Owner') || ''),
      nextAt: get(r, 'Next action at'),
      nextNote: String(get(r, 'Next action note') || ''),
      lastActivity: get(r, 'Last activity at'),
      remarks: String(get(r, 'Remarks') || ''),
      events: String(get(r, 'Events sent') || ''),
      pageUrl: String(get(r, 'Page URL') || ''),
      referrer: String(get(r, 'Referrer') || ''),
      fbc: String(get(r, 'fbc') || ''),
      lastResult: String(get(r, 'Last result') || '')
    });
  }
  return out;
}

function fmt_(d) {
  if (!d) return '';
  var date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return Utilities.formatDate(date, TZ, 'dd MMM, HH:mm');
}
function iso_(d) {
  if (!d) return '';
  var date = (d instanceof Date) ? d : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

/** One payload for the whole app: the queue, the counts and the list. */
function bootstrap(token) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  var scope = scope_(u);
  var leads = allLeads_().filter(function (l) { return !scope || scope.indexOf(l.source.toLowerCase()) >= 0; });
  var now = Date.now();

  var counts = { total: leads.length, due: 0, overdue: 0, today: 0, untouched: 0 };
  var byStage = {};
  leads.forEach(function (l) {
    byStage[l.stage] = (byStage[l.stage] || 0) + 1;
    if (l.nextAt) {
      var t = new Date(l.nextAt).getTime();
      if (t <= now) counts.due++;
      if (t <= now - 864e5) counts.overdue++;
    }
    if (l.time && (now - new Date(l.time).getTime()) < 864e5) counts.today++;
    if (String(l.stage).toLowerCase() === 'new') counts.untouched++;
  });

  return {
    ok: true, user: u, version: VERSION,
    stages: STAGES, outcomes: CALL_OUTCOMES,
    whatsapp: String(cfg_().WHATSAPP_NUMBER || ''),
    counts: counts, byStage: byStage,
    sources: leads.map(function (l) { return l.source; })
                  .filter(function (s, i, a) { return s && a.indexOf(s) === i; }).sort(),
    leads: leads.map(card_)
  };
}

function card_(l) {
  return {
    id: l.id, name: l.name, phone: l.phone, source: l.source, stage: l.stage,
    owner: l.owner, remarks: l.remarks,
    time: fmt_(l.time), timeIso: iso_(l.time),
    nextAt: fmt_(l.nextAt), nextIso: iso_(l.nextAt), nextNote: l.nextNote,
    lastActivity: fmt_(l.lastActivity)
  };
}

function leadById_(id) {
  var all = allLeads_();
  for (var i = 0; i < all.length; i++) if (all[i].id === String(id)) return all[i];
  return null;
}

/** The cockpit: everything for one call on one screen. */
function lead(token, id) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  var l = leadById_(id);
  if (!l) return { ok: false, error: 'Lead not found' };
  var scope = scope_(u);
  if (scope && scope.indexOf(l.source.toLowerCase()) < 0) return { ok: false, error: 'Not your number' };

  return {
    ok: true,
    lead: {
      id: l.id, name: l.name, phone: l.phone, source: l.source, stage: l.stage,
      owner: l.owner, remarks: l.remarks,
      time: fmt_(l.time), nextAt: fmt_(l.nextAt), nextIso: iso_(l.nextAt), nextNote: l.nextNote,
      pageUrl: l.pageUrl, referrer: l.referrer,
      attributed: !!l.fbc,
      eventsSent: l.events.split('|').filter(Boolean),
      lastResult: l.lastResult
    },
    activity: activityFor_(l.id)
  };
}

function activityFor_(leadId) {
  var sh = book_().getSheetByName(SH_ACTIVITY);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, ACTIVITY_HEADERS.length).getValues();
  var out = [];
  for (var i = v.length - 1; i >= 0; i--) {
    if (String(v[i][1]) !== String(leadId)) continue;
    out.push({ time: fmt_(v[i][0]), type: String(v[i][2] || ''), by: String(v[i][3] || ''), detail: String(v[i][4] || '') });
    if (out.length >= 60) break;
  }
  return out;
}

function addActivity_(leadId, type, by, detail) {
  var sh = book_().getSheetByName(SH_ACTIVITY) || book_().insertSheet(SH_ACTIVITY);
  if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, ACTIVITY_HEADERS.length).setValues([ACTIVITY_HEADERS]);
  sh.appendRow([new Date(), leadId, type, by, String(detail || '').slice(0, 1000)]);
  var C = cols_();
  if (C['Last activity at']) {
    var l = leadById_(leadId);
    if (l) sheet_(SH_LEADS).getRange(l.row, C['Last activity at']).setValue(new Date());
  }
}

/* ================================ writing ============================== */

function note(token, leadId, text) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  text = String(text || '').trim();
  if (!text) return { ok: false, error: 'Nothing to save' };
  var l = leadById_(leadId);
  if (!l) return { ok: false, error: 'Lead not found' };
  addActivity_(leadId, 'note', u.name, text);
  /* The intake script and the sheet both read Remarks, so keep the latest note there too. */
  var C = cols_();
  if (C['Remarks']) sheet_(SH_LEADS).getRange(l.row, C['Remarks']).setValue(text.slice(0, 500));
  return { ok: true, activity: activityFor_(leadId) };
}

function logCall(token, leadId, outcomeKey, text) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  var l = leadById_(leadId);
  if (!l) return { ok: false, error: 'Lead not found' };
  var outcome = null;
  for (var i = 0; i < CALL_OUTCOMES.length; i++) if (CALL_OUTCOMES[i].key === outcomeKey) outcome = CALL_OUTCOMES[i];
  if (!outcome) return { ok: false, error: 'Unknown outcome' };

  addActivity_(leadId, 'call', u.name, outcome.label + (text ? ' — ' + text : ''));

  /* Move the stage only forward: a "no answer" after "Qualified" must not
     drag the lead back down the funnel. */
  var order = STAGES.map(function (s) { return s.key; });
  var cur = stageByLabel_(l.stage);
  var want = null;
  for (var j = 0; j < STAGES.length; j++) if (STAGES[j].key === outcome.stage) want = STAGES[j];
  var res = { ok: true };
  if (want && (!cur || order.indexOf(want.key) > order.indexOf(cur.key)) && want.key !== 'junk') {
    res = setStage(token, leadId, want.label, true);
  } else if (want && want.key === 'junk') {
    res = setStage(token, leadId, want.label, true);
  }
  return { ok: true, stage: res.stage || l.stage, activity: activityFor_(leadId) };
}

function setStage(token, leadId, stageLabel, quiet) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  var st = stageByLabel_(stageLabel);
  if (!st) return { ok: false, error: 'Unknown stage' };
  var l = leadById_(leadId);
  if (!l) return { ok: false, error: 'Lead not found' };

  var C = cols_(), sh = sheet_(SH_LEADS);
  sh.getRange(l.row, C['Status']).setValue(st.label);
  if (C['Updated by']) sh.getRange(l.row, C['Updated by']).setValue(u.name);
  if (C['Updated at']) sh.getRange(l.row, C['Updated at']).setValue(new Date());
  if (!quiet) addActivity_(leadId, 'stage', u.name, st.label);

  var meta = st.event ? fireEvent_(leadId, st.event) : { skipped: 'no event for this stage' };
  return { ok: true, stage: st.label, meta: meta, activity: activityFor_(leadId) };
}

function setFollowUp(token, leadId, whenIso, text) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  var l = leadById_(leadId);
  if (!l) return { ok: false, error: 'Lead not found' };
  var C = cols_(), sh = sheet_(SH_LEADS);
  if (!C['Next action at']) return { ok: false, error: 'Run setup first' };

  if (!whenIso) {                                   // clearing the reminder
    sh.getRange(l.row, C['Next action at']).setValue('');
    sh.getRange(l.row, C['Next action note']).setValue('');
    addActivity_(leadId, 'followup', u.name, 'Follow-up cleared');
    return { ok: true, nextAt: '', nextNote: '' };
  }
  var when = new Date(whenIso);
  if (isNaN(when.getTime())) return { ok: false, error: 'Bad date' };
  sh.getRange(l.row, C['Next action at']).setValue(when);
  sh.getRange(l.row, C['Next action note']).setValue(String(text || '').slice(0, 300));
  if (C['Owner'] && !l.owner) sh.getRange(l.row, C['Owner']).setValue(u.name);
  addActivity_(leadId, 'followup', u.name, 'Call back ' + fmt_(when) + (text ? ' — ' + text : ''));
  return { ok: true, nextAt: fmt_(when), nextIso: when.toISOString(), nextNote: String(text || '') };
}

function assign(token, leadId, who) {
  var u = user_(token);
  if (!u) return { ok: false, expired: true };
  var l = leadById_(leadId);
  if (!l) return { ok: false, error: 'Lead not found' };
  var C = cols_();
  if (!C['Owner']) return { ok: false, error: 'Run setup first' };
  sheet_(SH_LEADS).getRange(l.row, C['Owner']).setValue(String(who || u.name));
  addActivity_(leadId, 'owner', u.name, 'Owner: ' + (who || u.name));
  return { ok: true, owner: String(who || u.name) };
}

/* ============================= Meta CAPI ============================== */
/*
 * Same contract as the intake script: custom event names, action_source
 * 'website' with the page url and user agent replayed from the lead row, and
 * the "Events sent" ledger as the guard. If that script already sent the
 * event, this one leaves it alone.
 */

function fireEvent_(leadId, eventName) {
  var c = cfg_();
  if (!eventName) return { skipped: 'no event' };
  if (!c.META_TOKEN) return { ok: false, error: 'No Meta token in Script Properties' };

  var sh = sheet_(SH_LEADS), C = cols_();
  var l = leadById_(leadId);
  if (!l) return { ok: false, error: 'lead not found' };

  var ledgerCell = C['Events sent'] ? sh.getRange(l.row, C['Events sent']) : null;
  var ledger = ledgerCell ? String(ledgerCell.getValue() || '') : '';
  if (ledger.indexOf('|' + eventName + '|') >= 0) return { skipped: 'already sent', event: eventName };

  var raw = sh.getRange(l.row, 1, 1, sh.getLastColumn()).getValues()[0];
  var cell = function (name) { return C[name] ? String(raw[C[name] - 1] || '') : ''; };

  var user = {
    ph: [sha_(phone91_(l.phone, c.COUNTRY_CODE))],
    external_id: [sha_(String(leadId).toLowerCase())],
    country: [sha_('in')],
    client_user_agent: cell('User agent') || 'Mozilla/5.0 (Linux; Android 10)'
  };
  if (l.name) user.fn = [sha_(String(l.name).trim().toLowerCase().split(' ')[0])];
  if (cell('fbc')) user.fbc = cell('fbc');
  if (cell('fbp')) user.fbp = cell('fbp');
  if (cell('IP')) user.client_ip_address = cell('IP');

  var custom = {
    lead_id: leadId, lead_source: l.source, lead_status: l.stage,
    content_name: 'LP ' + l.source
  };
  if (eventName === 'HConverted') {
    custom.currency = String(c.CURRENCY || 'INR');
    custom.value = Number(c.CONVERSION_VALUE) || 3000;
  }

  var ev = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: leadId + '-' + eventName,
    action_source: 'website',
    event_source_url: l.pageUrl || (c.SITE_ORIGIN + '/' + l.source + '.html'),
    user_data: user,
    custom_data: custom
  };

  var out = postMeta_([ev], c);
  if (out.ok && ledgerCell) ledgerCell.setValue(ledger + '|' + eventName + '|');
  if (C['Last event']) sh.getRange(l.row, C['Last event']).setValue(eventName);
  if (C['Last sent']) sh.getRange(l.row, C['Last sent']).setValue(new Date());
  if (C['Last result']) sh.getRange(l.row, C['Last result']).setValue(out.ok ? ('OK ' + (out.received || 1)) : ('FAIL ' + out.error).slice(0, 220));
  addActivity_(leadId, 'meta', 'system', eventName + ' → ' + (out.ok ? 'sent' : 'failed: ' + out.error));
  return out;
}

function postMeta_(events, c) {
  if (String(c.SEND_EVENTS).toLowerCase() === 'no') return { ok: true, received: 0, note: 'SEND_EVENTS=no' };
  var payload = { data: events, access_token: c.META_TOKEN };
  if (c.TEST_EVENT_CODE) payload.test_event_code = c.TEST_EVENT_CODE;
  var url = 'https://graph.facebook.com/' + c.API_VERSION + '/' + c.DATASET_ID + '/events';
  try {
    var r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var body = r.getContentText(), j = {};
    try { j = JSON.parse(body); } catch (e) {}
    if (r.getResponseCode() === 200 && j.events_received !== undefined) {
      return { ok: true, received: j.events_received };
    }
    return { ok: false, error: body.slice(0, 200) };
  } catch (err) { return { ok: false, error: String(err) }; }
}

function sha_(v) {
  if (v === null || v === undefined || v === '') return '';
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(v), Utilities.Charset.UTF_8);
  var s = '';
  for (var i = 0; i < b.length; i++) { var x = (b[i] & 0xFF).toString(16); s += (x.length === 1 ? '0' : '') + x; }
  return s;
}
function phone91_(p, cc) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = String(cc || '91') + d;
  return d;
}

/* ========================== daily reminder mail ======================== */
/*
 * Optional. Run installDailyDigest() once from the editor and each morning
 * every active user with an Email in the Users sheet gets their own due list,
 * sent by Gmail from the account that owns the script. No Telegram, no
 * third-party service, nothing to pay for.
 *
 * Add an "Email" column to the Users sheet for this; without it nothing sends.
 */

function installDailyDigest() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(9).everyDays(1).inTimezone(TZ).create();
  return { ok: true, note: 'Digest will go out at 9am ' + TZ };
}

function dailyDigest() {
  var sh = sheet_(SH_USERS);
  if (sh.getLastRow() < 2) return;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var emailCol = head.indexOf('Email');
  if (emailCol < 0) return;                       // no Email column, nothing to send
  var users = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  var leads = allLeads_();
  var now = Date.now();

  users.forEach(function (u) {
    var email = String(u[emailCol] || '').trim();
    if (!email || String(u[5]).toLowerCase() !== 'yes') return;
    var sources = String(u[3] || '').toLowerCase();
    var mine = leads.filter(function (l) {
      if (sources && sources !== 'all' && sources.split(/[,\s]+/).indexOf(l.source.toLowerCase()) < 0) return false;
      return (l.nextAt && new Date(l.nextAt).getTime() <= now + 864e5) || String(l.stage).toLowerCase() === 'new';
    });
    if (!mine.length) return;
    var lines = mine.slice(0, 40).map(function (l) {
      return '• ' + (l.name || 'No name') + ' — ' + l.phone + '  [' + l.stage + ']' +
             (l.nextAt ? '  due ' + fmt_(l.nextAt) : '') + (l.nextNote ? ' — ' + l.nextNote : '');
    });
    MailApp.sendEmail({
      to: email,
      subject: 'Halcyon: ' + mine.length + ' lead' + (mine.length > 1 ? 's' : '') + ' to call today',
      body: 'Due or waiting:\n\n' + lines.join('\n') +
            '\n\nOpen the CRM: ' + ScriptApp.getService().getUrl()
    });
  });
}
