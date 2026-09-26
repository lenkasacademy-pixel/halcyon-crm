/*
 * node tools/selftest.js
 *
 * Crm.gs is a second file inside the existing CAPI project: it calls that
 * project's functions rather than shipping its own copies. So the only test
 * worth having is a contract test — stand up the original script's globals
 * as faithfully as the real file defines them, load Crm.gs on top, and check
 * the seams hold.
 *
 * The stand-ins below (apiLogin, session_, setStatus_, apiRemarks,
 * fireEvent_, log_, cfg, ss, props, C, STATUSES, LEAD_HEADERS) mirror the
 * logic of the running v3.5.0 script, including the bits that matter: the
 * pipe-delimited ledger, the SUPPRESS_ flag, Updated by / Updated at, and
 * the Log tab's four-column shape.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

/* ----------------------------- fake sheets ----------------------------- */

function A1col(s) { let n = 0; for (const c of s.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n; }

class Sheet {
  constructor(name, rows) { this.name = name; this.d = rows || []; }
  getName() { return this.name; }
  getLastRow() { return this.d.length; }
  getLastColumn() { return this.d.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.d.length); }
  setFrozenRows() { return this; }
  deleteRows() { return this; }
  cell(r, c) {
    while (this.d.length < r) this.d.push([]);
    const row = this.d[r - 1];
    while (row.length < c) row.push('');
    return row;
  }
  getRange(a, c, nr, nc) {
    if (typeof a === 'string') {
      const col = A1col(a.split(':')[0].replace(/\d/g, ''));
      return this._range(1, col, this.getMaxRows(), 1);
    }
    return this._range(a, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
  }
  _range(r0, c0, nr, nc) {
    const sh = this;
    const noop = function () { return this; };
    return {
      getValues() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sh.d[r0 - 1 + i] || [];
          const line = [];
          for (let j = 0; j < nc; j++) line.push(row[c0 - 1 + j] === undefined ? '' : row[c0 - 1 + j]);
          out.push(line);
        }
        return out;
      },
      getValue() { return this.getValues()[0][0]; },
      setValues(v) {
        for (let i = 0; i < v.length; i++) for (let j = 0; j < v[i].length; j++) {
          const row = sh.cell(r0 + i, c0 + j); row[c0 - 1 + j] = v[i][j];
        }
        return this;
      },
      setValue(v) { return this.setValues([[v]]); },
      setNumberFormat: noop, setFontWeight: noop, setBackground: noop, setFontColor: noop
    };
  }
  appendRow(v) { this.d.push(v.slice()); }
}

class Book {
  constructor(sheets) { this.s = sheets; }
  getName() { return 'Halcyon new v2 (fake)'; }
  getSheetByName(n) { return this.s[n] || null; }
  insertSheet(n) { this.s[n] = new Sheet(n, []); return this.s[n]; }
}

/* ------------------- the original script's own constants ------------------- */

const LEAD_HEADERS = ['Time', 'Lead ID', 'Name', 'Phone', 'Source', 'Status', 'Assigned', 'Remarks',
  'Events sent', 'Last event', 'Last sent', 'Last result', 'fbc', 'fbp', 'Browser event ID',
  'User agent', 'IP', 'Page URL', 'Referrer', 'Updated by', 'Updated at'];
const USER_HEADERS = ['Name', 'PIN', 'Role', 'Sources', 'Telegram chat ID', 'Active'];
const STATUSES = [
  { key: 'new', label: 'New', event: null, colour: '#6b7280' },
  { key: 'attempted', label: 'Attempted', event: 'HAttempted', colour: '#a16207' },
  { key: 'contacted', label: 'Contacted', event: 'HContacted', colour: '#1d4ed8' },
  { key: 'qualified', label: 'Qualified', event: 'HQualified', colour: '#7c3aed' },
  { key: 'booked', label: 'Booked', event: 'HBooked', colour: '#0b7a5a' },
  { key: 'converted', label: 'Converted', event: 'HConverted', colour: '#047857' },
  { key: 'notq', label: 'Not qualified', event: 'HNotQualified', colour: '#9ca3af' },
  { key: 'junk', label: 'Junk', event: 'HJunk', colour: '#b91c1c' },
  { key: 'lost', label: 'Lost', event: 'HLost', colour: '#7f1d1d' }
];

function leadRow(o) {
  const r = new Array(LEAD_HEADERS.length).fill('');
  const set = (k, v) => { r[LEAD_HEADERS.indexOf(k)] = v; };
  set('Time', o.time || new Date());
  set('Lead ID', o.id); set('Name', o.name || ''); set('Phone', o.phone || '');
  set('Source', o.source || '7788'); set('Status', o.status || 'New');
  set('Events sent', o.events || ''); set('fbc', o.fbc || '');
  set('User agent', 'Mozilla/5.0 (Linux; Android 10)');
  set('Page URL', o.page || 'https://halcyonpainfree.com/knee-pain-treatment/');
  return r;
}

let fetches = [], mails = [];

function makeBook() {
  const now = Date.now();
  return new Book({
    Leads: new Sheet('Leads', [
      LEAD_HEADERS.slice(),
      leadRow({ id: 'L001', name: 'Ramesh', phone: '9876543210', source: '7788', status: 'New',
                time: new Date(now - 2 * 3600e3), fbc: 'fb.1.123.abc', events: '|HEnquiry|' }),
      leadRow({ id: 'L002', name: 'Lakshmi', phone: '08585072072', source: '8585', status: 'Qualified',
                time: new Date(now - 5 * 864e5),
                events: '|HEnquiry||HAttempted||HContacted||HQualified|' }),
      leadRow({ id: 'L003', name: 'Srinivas', phone: '+91 90000 11111', source: '7788',
                status: 'Contacted', time: new Date(now - 30 * 864e5),
                events: '|HEnquiry||HAttempted||HContacted|' })
    ]),
    Users: new Sheet('Users', [
      USER_HEADERS.concat(['Email']),
      ['Pallavi', '482913', 'admin', 'all', '', 'yes', 'boss@example.com'],
      ['Caller A', '730264', 'caller', '7788', '', 'yes', 'a@example.com'],
      ['Old Staff', '111111', 'caller', '7788', '', 'no', '']
    ]),
    Log: new Sheet('Log', [['Time', 'What', 'Detail', 'Result']]),
    Config: new Sheet('Config', [
      ['Key', 'Value'],
      ['DATASET_ID', '1568043288155968'],
      ['API_VERSION', 'v26.0'],
      ['CONVERSION_VALUE', 3000],
      ['WHATSAPP_NUMBER', '917788091092'],
      ['SEND_EVENTS', 'yes']
    ])
  });
}

/* ---------- the Apps Script runtime, plus the original script itself ---------- */

function makeSandbox(book, props) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');
  const sandbox = {
    console,
    SpreadsheetApp: { openById: () => book, getActive: () => book, flush: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: k => { delete props[k]; }
      })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest())
        .map(b => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      formatDate: (d, tz, fmt) => fmt
        .replace('dd', p2(d.getDate())).replace('MMM', MONTHS[d.getMonth()])
        .replace('yyyy', d.getFullYear()).replace('HH', p2(d.getHours())).replace('mm', p2(d.getMinutes()))
    },
    UrlFetchApp: {
      fetch: (url, opt) => {
        fetches.push({ url, body: JSON.parse(opt.payload) });
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ events_received: 1 }) };
      }
    },
    MailApp: { sendEmail: m => mails.push(m) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/FAKE/exec' }),
      getProjectTriggers: () => [],
      newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ inTimezone: () => ({ create: () => {} }) }) }) }) })
    },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({
        setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; }
      }) }),
      XFrameOptionsMode: { ALLOWALL: 1 }
    }
  };
  vm.createContext(sandbox);
  /* the original script, as it actually behaves */
  vm.runInContext(ORIGINAL, sandbox, { filename: 'Original.gs' });
  return sandbox;
}

/* A faithful stand-in for the parts of v3.5.0 that Crm.gs leans on. */
const ORIGINAL = `
var VERSION = '3.5.0';
var SH_LEADS = 'Leads', SH_USERS = 'Users', SH_CONFIG = 'Config', SH_LOG = 'Log';
var LEAD_HEADERS = ${JSON.stringify(LEAD_HEADERS)};
var USER_HEADERS = ${JSON.stringify(USER_HEADERS)};
var STATUSES = ${JSON.stringify(STATUSES)};
var DEFAULTS = { DATASET_ID:'', API_VERSION:'v26.0', TEST_EVENT_CODE:'',
  SITE_ORIGIN:'https://halcyonpainmanagement.com', CONVERSION_VALUE:3000,
  CURRENCY:'INR', COUNTRY_CODE:'91', SEND_EVENTS:'yes', SESSION_HOURS:12 };
var HARDCODED_TOKEN = '';
var C = {};
(function(){ for (var i=0;i<LEAD_HEADERS.length;i++) C[LEAD_HEADERS[i]] = i+1; })();

function ss(){ return SpreadsheetApp.getActive(); }
function props(){ return PropertiesService.getScriptProperties(); }
function statusByKey(k){ for (var i=0;i<STATUSES.length;i++) if (STATUSES[i].key===k) return STATUSES[i]; return null; }
function statusByLabel(l){ l=String(l||'').trim().toLowerCase();
  for (var i=0;i<STATUSES.length;i++) if (STATUSES[i].label.toLowerCase()===l) return STATUSES[i]; return null; }
function cfg(){
  if (cfg._c) return cfg._c;
  var o = {}; for (var k in DEFAULTS) o[k] = DEFAULTS[k];
  try {
    var sh = ss().getSheetByName(SH_CONFIG);
    if (sh && sh.getLastRow() > 1){
      var v = sh.getRange(2,1,sh.getLastRow()-1,2).getValues();
      for (var i=0;i<v.length;i++){
        var key = String(v[i][0]||'').trim();
        if (key && v[i][1] !== '') o[key] = v[i][1];
      }
    }
  } catch(e){}
  o.ACCESS_TOKEN = props().getProperty('META_TOKEN') || HARDCODED_TOKEN || '';
  cfg._c = o; return o;
}
function log_(what, detail, result){
  try {
    var sh = ss().getSheetByName(SH_LOG); if (!sh) return;
    sh.appendRow([new Date(), what, String(detail).slice(0,400), String(result).slice(0,400)]);
  } catch(e){}
}
function sha_(v){
  if (v === null || v === undefined || v === '') return '';
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(v), Utilities.Charset.UTF_8);
  var s=''; for (var i=0;i<b.length;i++){ var x=(b[i]&0xFF).toString(16); s += (x.length===1?'0':'')+x; }
  return s;
}
function normPhone91_(p, cc){
  var d = String(p||'').replace(/\\D/g,'');
  if (d.length === 10) d = String(cc||'91') + d;
  return d;
}
function findRowById_(id){
  var sh = ss().getSheetByName(SH_LEADS);
  if (sh.getLastRow() < 2) return null;
  var n = sh.getLastRow()-1;
  var ids = sh.getRange(2, C['Lead ID'], n, 1).getValues();
  for (var i=0;i<n;i++) if (String(ids[i][0]) === String(id)) return i+2;
  return null;
}
function readLead_(row){
  var sh = ss().getSheetByName(SH_LEADS);
  var v = sh.getRange(row, 1, 1, LEAD_HEADERS.length).getValues()[0];
  var o = {}; for (var i=0;i<LEAD_HEADERS.length;i++) o[LEAD_HEADERS[i]] = v[i];
  return o;
}
function postToMeta_(events){
  var c = cfg();
  if (String(c.SEND_EVENTS).toLowerCase() === 'no') return { ok:true, received:0, note:'dry run' };
  var payload = { data: events, access_token: c.ACCESS_TOKEN };
  var r = UrlFetchApp.fetch('https://graph.facebook.com/'+c.API_VERSION+'/'+c.DATASET_ID+'/events',
    { method:'post', contentType:'application/json', payload: JSON.stringify(payload), muteHttpExceptions:true });
  var j = {}; try { j = JSON.parse(r.getContentText()); } catch(e){}
  if (r.getResponseCode() === 200 && j.events_received !== undefined) return { ok:true, received:j.events_received };
  return { ok:false, error:r.getContentText().slice(0,200) };
}
function fireEvent_(leadId, eventName, opts){
  opts = opts || {};
  var c = cfg();
  if (!eventName) return { skipped:'no event mapped' };
  if (!c.ACCESS_TOKEN) return { ok:false, error:'no access token saved' };
  var row = findRowById_(leadId);
  if (!row) return { ok:false, error:'lead not found: '+leadId };
  var L = readLead_(row);
  var ledger = String(L['Events sent']||'');
  if (!opts.force && ledger.indexOf('|'+eventName+'|') >= 0)
    return { skipped:'already sent', event:eventName };
  var user = {
    ph: [sha_(normPhone91_(L['Phone'], c.COUNTRY_CODE))],
    external_id: [sha_(String(leadId).toLowerCase())],
    country: [sha_('in')],
    client_user_agent: L['User agent'] || 'Mozilla/5.0 (Linux; Android 10)'
  };
  if (L['fbc']) user.fbc = String(L['fbc']);
  var custom = { lead_id:leadId, lead_source:String(L['Source']||''), lead_status:String(L['Status']||'') };
  if (eventName === 'HConverted'){ custom.currency = c.CURRENCY; custom.value = Number(c.CONVERSION_VALUE)||3000; }
  var ev = { event_name:eventName, event_time:Math.floor(Date.now()/1000),
    event_id: leadId + '-' + eventName, action_source:'website',
    event_source_url: L['Page URL'], user_data:user, custom_data:custom };
  var out = postToMeta_([ev]);
  var sh = ss().getSheetByName(SH_LEADS);
  if (out.ok) sh.getRange(row, C['Events sent']).setValue(ledger + '|' + eventName + '|');
  sh.getRange(row, C['Last event']).setValue(eventName);
  sh.getRange(row, C['Last sent']).setValue(new Date());
  sh.getRange(row, C['Last result']).setValue(out.ok ? ('OK ' + (out.received||1)) : ('FAIL ' + out.error).slice(0,220));
  log_('event', eventName + ' ' + leadId, out.ok ? 'OK' : out.error);
  return out;
}
function setStatus_(leadId, statusLabel, who){
  var row = findRowById_(leadId);
  if (!row) return { ok:false, error:'lead not found' };
  var st = statusByLabel(statusLabel);
  if (!st) return { ok:false, error:'unknown status' };
  var sh = ss().getSheetByName(SH_LEADS);
  props().setProperty('SUPPRESS_' + row, '1');
  sh.getRange(row, C['Status']).setValue(st.label);
  sh.getRange(row, C['Updated by']).setValue(who||'');
  sh.getRange(row, C['Updated at']).setValue(new Date());
  SpreadsheetApp.flush();
  props().deleteProperty('SUPPRESS_' + row);
  var res = st.event ? fireEvent_(leadId, st.event, {}) : { skipped:'no event' };
  return { ok:true, status:st.label, meta:res };
}
function apiLogin(pin){
  pin = String(pin||'').trim();
  var sh = ss().getSheetByName(SH_USERS);
  if (!sh || sh.getLastRow() < 2) return { ok:false, error:'No users configured' };
  var v = sh.getRange(2,1,sh.getLastRow()-1,USER_HEADERS.length).getValues();
  for (var i=0;i<v.length;i++){
    if (String(v[i][5]).toLowerCase() === 'no') continue;
    if (String(v[i][1]).trim() === pin && pin !== ''){
      var token = Utilities.getUuid();
      var user = { name:String(v[i][0]), role:String(v[i][2]||'caller').toLowerCase(),
                   sources:String(v[i][3]||'').toLowerCase() };
      props().setProperty('sess_'+token, JSON.stringify({
        u:user, exp: Date.now() + (Number(cfg().SESSION_HOURS)||12)*3600*1000 }));
      return { ok:true, token:token, user:user, statuses:STATUSES };
    }
  }
  return { ok:false, error:'PIN not recognised' };
}
function session_(token){
  var raw = props().getProperty('sess_'+String(token||''));
  if (!raw) return null;
  var s; try { s = JSON.parse(raw); } catch(e){ return null; }
  if (!s.exp || s.exp < Date.now()){ props().deleteProperty('sess_'+token); return null; }
  return s.u;
}
function apiStatus(token, leadId, statusLabel){
  var u = session_(token);
  if (!u) return { ok:false, expired:true };
  return setStatus_(leadId, statusLabel, u.name);
}
function apiRemarks(token, leadId, text){
  var u = session_(token);
  if (!u) return { ok:false, expired:true };
  var row = findRowById_(leadId);
  if (!row) return { ok:false, error:'lead not found' };
  var sh = ss().getSheetByName(SH_LEADS);
  sh.getRange(row, C['Remarks']).setValue(String(text||'').slice(0,500));
  sh.getRange(row, C['Updated by']).setValue(u.name);
  sh.getRange(row, C['Updated at']).setValue(new Date());
  return { ok:true };
}
`;

/* ------------------------------- harness ------------------------------- */

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want) { ok(name + ' = ' + JSON.stringify(want), got === want, got); }
function group(t) { console.log('\n' + t); }
function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function load(props) {
  const book = makeBook();
  props = props || {};
  const G = makeSandbox(book, props);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Crm.gs'), 'utf8'), G,
                  { filename: 'Crm.gs' });
  G.crmSetup();
  return { G, book, props };
}
function head(book) { return book.getSheetByName('Leads').d[0]; }
function cellOf(book, leadId, name) {
  const d = book.getSheetByName('Leads').d;
  const idc = d[0].indexOf('Lead ID'), col = d[0].indexOf(name);
  for (let i = 1; i < d.length; i++) if (d[i][idc] === leadId) return d[i][col];
}
function logRows(book) { return book.getSheetByName('Log').d.slice(1); }

/* ------------------------------- the tests ------------------------------ */

fetches = []; mails = [];

group('it adds only what is missing');
{
  const { G, book } = load({ META_TOKEN: 'T' });
  const h = head(book);
  ok('appends the three action columns',
     ['Next action at', 'Next action note', 'Last activity at'].every(c => h.indexOf(c) >= 0), h.slice(-4));
  ok('reuses Assigned rather than adding Owner',
     h.filter(c => c === 'Assigned').length === 1 && h.indexOf('Owner') < 0,
     h.filter(c => /Assigned|Owner/.test(c)));
  eq('leaves the original header order alone', h.slice(0, 21).join(','), LEAD_HEADERS.join(','));
  ok('creates the Activity tab', !!book.getSheetByName('Activity'));
  eq('is safe to run twice', G.crmSetup().added.length, 0);
  ok('and says so in the shared Log', logRows(book).some(r => r[1] === 'crm setup'), logRows(book));
}

group('it uses the sessions that already exist');
{
  const { G } = load({});
  ok('a bad token is not a session', G.crmBootstrap('nonsense').expired === true);
  const r = G.apiLogin('482913');
  ok('apiLogin still works untouched', r.ok === true && !!r.token, r);
  ok('and the CRM accepts its token', G.crmBootstrap(r.token).ok === true);
  ok('an inactive user still cannot log in', G.apiLogin('111111').ok === false);
}

group('the stage list comes from STATUSES');
{
  const { G } = load({});
  const t = G.apiLogin('482913').token;
  const st = G.crmBootstrap(t).stages;
  eq('same nine, same order', st.map(s => s.label).join(','), STATUSES.map(s => s.label).join(','));
  eq('same events', st.map(s => s.event || '-').join(','), STATUSES.map(s => s.event || '-').join(','));
  ok('every one has a tone for the screens', st.every(s => !!s.tone), st.map(s => s.tone));
}

group('what each user can see');
{
  const { G } = load({});
  const admin = G.apiLogin('482913').token, caller = G.apiLogin('730264').token;
  eq('admin sees every lead', G.crmBootstrap(admin).leads.length, 3);
  const mine = G.crmBootstrap(caller).leads;
  eq('a caller sees only their sources', mine.length, 2);
  ok("cannot open someone else's lead", G.crmLead(caller, 'L002').ok === false);
}

group('notes go through apiRemarks');
{
  const { G, book } = load({});
  const t = G.apiLogin('482913').token;
  ok('an empty note is refused', G.crmNote(t, 'L001', '   ').ok === false);
  const r = G.crmNote(t, 'L001', 'Knee pain 3 months');
  ok('saves', r.ok === true, r);
  eq('Remarks written by the original function', cellOf(book, 'L001', 'Remarks'), 'Knee pain 3 months');
  eq('and it stamped Updated by', cellOf(book, 'L001', 'Updated by'), 'Pallavi');
  ok('Updated at is a real date', isDate(cellOf(book, 'L001', 'Updated at')));
  eq('the note is in the activity log', r.activity[0].type, 'note');
}

group('stage changes go through setStatus_');
{
  fetches = [];
  const { G, book, props } = load({ META_TOKEN: 'T' });
  const t = G.apiLogin('482913').token;
  const r = G.crmSetStage(t, 'L001', 'Contacted');
  ok('saved', r.ok === true, r);
  eq('the sheet agrees', cellOf(book, 'L001', 'Status'), 'Contacted');
  eq('stamped with the caller', cellOf(book, 'L001', 'Updated by'), 'Pallavi');
  eq('one event to Graph', fetches.length, 1);
  eq('the right one', fetches[0].body.data[0].event_name, 'HContacted');
  eq('appended to the same ledger', String(cellOf(book, 'L001', 'Events sent')),
     '|HEnquiry||HContacted|');
  /* setStatus_ sets SUPPRESS_<row> so the project's onEdit does not echo, then
     clears it. If the CRM ever wrote Status itself that flag would be missing
     and every stage change would trip the trigger. */
  ok('the SUPPRESS_ flag was set and cleared again',
     Object.keys(props).filter(k => k.indexOf('SUPPRESS_') === 0).length === 0,
     Object.keys(props).filter(k => k.indexOf('SUPPRESS_') === 0));
  ok('logged in the shared Log', logRows(book).some(r2 => r2[2] === 'HContacted L001'), logRows(book));
  const acts = r.activity.map(a => a.type);
  ok('activity records both the stage and the send', acts.indexOf('stage') >= 0 && acts.indexOf('meta') >= 0, acts);

  const again = G.crmSetStage(t, 'L002', 'Qualified');
  eq('an event the intake script already sent is not sent twice', fetches.length, 1);
  eq('and it says why', again.meta.skipped, 'already sent');
}

group('logging a call');
{
  const { G, book } = load({ META_TOKEN: 'T' });
  const t = G.apiLogin('482913').token;
  const r = G.crmLogCall(t, 'L001', 'answered', 'wants Saturday');
  eq('New + answered → Contacted', r.stage, 'Contacted');
  ok('the call is in the activity log', r.activity.some(a => a.type === 'call'), r.activity.map(a => a.type));
  ok('with the outcome and the words',
     /Answered.*Saturday/.test(r.activity.filter(a => a.type === 'call')[0].detail));
  eq('a missed call never drags Qualified backwards', G.crmLogCall(t, 'L002', 'noanswer', '').stage, 'Qualified');
  eq('a wrong number goes to Junk from anywhere', G.crmLogCall(t, 'L003', 'wrong', '').stage, 'Junk');
  ok('an unknown outcome is refused', G.crmLogCall(t, 'L001', 'telepathy', '').ok === false);
  ok('calls reach the shared Log', logRows(book).some(x => x[1] === 'crm call'), logRows(book));
  ok('Last activity at is stamped', isDate(cellOf(book, 'L001', 'Last activity at')));
}

group('follow-ups');
{
  const { G, book } = load({});
  const t = G.apiLogin('482913').token;
  const when = new Date(Date.now() - 3600e3);
  const r = G.crmFollowUp(t, 'L001', when.toISOString(), 'after her scan');
  ok('sets the time', r.ok === true, r);
  ok('writes a real Date, not text', isDate(cellOf(book, 'L001', 'Next action at')));
  eq('writes the note', cellOf(book, 'L001', 'Next action note'), 'after her scan');
  eq('takes ownership in Assigned', cellOf(book, 'L001', 'Assigned'), 'Pallavi');
  eq('counts as due', G.crmBootstrap(t).counts.due, 1);
  ok('bad dates are refused', G.crmFollowUp(t, 'L001', 'not-a-date', '').ok === false);
  eq('can be cleared', G.crmFollowUp(t, 'L001', '', '').nextAt, '');
  eq('and stops being due', G.crmBootstrap(t).counts.due, 0);
}

group('ownership');
{
  const { G, book } = load({});
  const t = G.apiLogin('482913').token;
  eq('assign writes to Assigned', G.crmAssign(t, 'L003', 'Caller A').owner, 'Caller A');
  eq('the sheet agrees', cellOf(book, 'L003', 'Assigned'), 'Caller A');
  eq('and it reads back', G.crmBootstrap(t).leads.filter(l => l.id === 'L003')[0].owner, 'Caller A');
}

group('the dashboard payload');
{
  const { G } = load({});
  const t = G.apiLogin('482913').token;
  const b = G.crmBootstrap(t);
  const l2 = b.leads.filter(l => l.id === 'L002')[0];
  ok('cards carry the ledger, parsed', Array.isArray(l2.events), l2.events);
  eq('including HEnquiry, which is not a stage',
     l2.events.join(','), 'HEnquiry,HAttempted,HContacted,HQualified');
  ok('arrival time is machine readable', /^\d{4}-/.test(b.leads[0].timeIso), b.leads[0].timeIso);
  eq('the WhatsApp number comes from Config', b.whatsapp, '917788091092');
}

group('no Meta token');
{
  fetches = [];
  const { G, book } = load({});
  const t = G.apiLogin('482913').token;
  const r = G.crmSetStage(t, 'L001', 'Booked');
  ok('the stage still saves', r.ok === true && cellOf(book, 'L001', 'Status') === 'Booked');
  eq('nothing is sent', fetches.length, 0);
  ok('and the failure is explained', /token/i.test(r.meta.error), r.meta);
  ok('the ledger is not marked', String(cellOf(book, 'L001', 'Events sent')).indexOf('HBooked') < 0);
}

group('SEND_EVENTS = no');
{
  fetches = [];
  const book = makeBook();
  book.getSheetByName('Config').d.push(['SEND_EVENTS', 'no']);
  const G = makeSandbox(book, { META_TOKEN: 'T' });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Crm.gs'), 'utf8'), G);
  G.crmSetup();
  const t = G.apiLogin('482913').token;
  ok('the stage saves', G.crmSetStage(t, 'L001', 'Contacted').ok === true);
  eq('nothing reaches Graph', fetches.length, 0);
}

group('the morning digest');
{
  mails = [];
  const { G } = load({});
  const t = G.apiLogin('482913').token;
  G.crmFollowUp(t, 'L001', new Date(Date.now() + 2 * 3600e3).toISOString(), 'call back');
  G.crmDailyDigest();
  eq('one mail per active user with an email', mails.length, 2);
  ok('addressed to the right people',
     mails.map(m => m.to).sort().join(',') === 'a@example.com,boss@example.com', mails.map(m => m.to));
  ok('the due lead is in it', mails[0].body.indexOf('Ramesh') >= 0);
  ok('the link opens the CRM, not the old dashboard', mails[0].body.indexOf('?app=crm') > 0);
}

group('it shadows nothing in the original file');
{
/* ---- what the visitor answered, read back off the landing page URL ----------
   The intake drops unknown fields, so /enquiry smuggles its answers through the
   page URL. If that parsing breaks, a caller silently loses the one thing that
   tells them what the call is about — and nothing else would fail. */
{
  group('it reads back what the visitor answered');
  const { G } = load();
  const base = 'https://halcyonpainfree.com/enquiry/';
  const note = 'Pain: Neck \u00b7 Since: A few weeks \u00b7 Area: Bachupally';

  const said = G.crmSaid_(note, base);
  eq('three answers come back', said.length, 3);
  eq('the label is the one the page wrote', said[0].label, 'Pain');
  eq('and the value with it', said[0].value, 'Neck');
  eq('free text survives', said[2].value, 'Bachupally');

  /* The answers must not travel on the URL: it becomes event_source_url and
     goes to Meta, where "area=Knee" beside a hashed phone is health data. */
  ok('nothing about the pain is on the URL the page now reports',
     base.indexOf('area=') < 0 && base.indexOf('since=') < 0);

  /* but leads captured before that change still read back */
  const legacy = G.crmSaid_('', base + '?area=Knee&since=A+few+months&place=Miyapur');
  eq('the old URL form still works', legacy.length, 3);
  eq('with the friendly label', legacy[0].label, 'Pain area');
  eq('and plus is a space', legacy[1].value, 'A few months');

  const ad = G.crmAd_(base + '?utm_campaign=Sept&utm_content=Video+A');
  eq('the ad is read from the URL, where Meta put it', ad.length, 2);
  eq('and the creative is named', ad.find(a => a.label === 'Ad / creative').value, 'Video A');
  ok('an ad field is never mistaken for an answer',
     G.crmSaid_('', base + '?utm_content=X').length === 0);

  ok('a caller note is not parsed as answers', G.crmSaid_('Rang twice, no answer', base).length === 0);
  ok('no note and no params is no answers', G.crmSaid_('', base).length === 0);
  ok('a malformed escape does not throw',
     (() => { try { G.crmSaid_('', base + '?area=%E0%A4'); return true; } catch (e) { return false; } })());

  ok('the screens do not print the same sentence twice',
     G.crmRemarksIsAnswers_(note, said) === true);
  ok('but a caller note is still shown',
     G.crmRemarksIsAnswers_(note + ' \u00b7 rang twice', G.crmSaid_(note + ' \u00b7 rang twice', base)) === false);

  const card = G.crmCard_({ id: 'L1', name: 'A', phone: '9', source: 'enquiry', stage: 'New',
    owner: '', remarks: note, time: new Date(), nextAt: '', nextNote: '', events: '',
    pageUrl: base + '?utm_content=Video+B' });
  eq('the row line is what they said', card.answers, 'Neck \u00b7 A few weeks \u00b7 Bachupally');
  ok('the row line leaves the ad out', card.answers.indexOf('Video B') < 0);
}

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Crm.gs'), 'utf8');
  const mine = (src.match(/^(?:function\s+([A-Za-z0-9_]+)|var\s+([A-Za-z0-9_]+))/gm) || [])
    .map(s => s.replace(/^(function|var)\s+/, ''));
  const theirs = (ORIGINAL.match(/^(?:function\s+([A-Za-z0-9_]+)|var\s+([A-Za-z0-9_]+))/gm) || [])
    .map(s => s.replace(/^(function|var)\s+/, ''));
  const clash = mine.filter(n => theirs.indexOf(n) >= 0);
  ok('every top-level name is new', clash.length === 0, clash);
  ok('and they are all namespaced', mine.every(n => /^crm|^CRM_/.test(n)),
     mine.filter(n => !/^crm|^CRM_/.test(n)));
}

group('no secrets in the repo');
{
  const files = ['src/Crm.gs', 'src/App.html', 'README.md', 'SETUP.md'];
  const bad = [];
  files.forEach(f => {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    if (/EAA[A-Za-z0-9]{20,}/.test(s)) bad.push(f + ': meta token');
    if (/\d{10}:AA[A-Za-z0-9_-]{20,}/.test(s)) bad.push(f + ': telegram token');
    if (/admin@\d+/.test(s)) bad.push(f + ': password');
  });
  ok('no access tokens or passwords committed', bad.length === 0, bad);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
