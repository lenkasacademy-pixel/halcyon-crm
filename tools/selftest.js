/*
 * node tools/selftest.js
 *
 * Runs src/Code.gs against a fake spreadsheet, so the logic can be checked on a
 * laptop instead of by pasting it into Google and hoping. It stubs only what the
 * script actually touches: SpreadsheetApp, PropertiesService, Utilities,
 * UrlFetchApp, MailApp, ScriptApp.
 *
 * It does not test App.html — that needs a browser. It tests the parts that can
 * quietly corrupt the sheet or double-fire a Meta event.
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const crypto = require('crypto');

/* ----------------------------- fake sheets ----------------------------- */

function A1col(s) { let n = 0; for (const c of s.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64); return n; }

class Sheet {
  constructor(name, rows) { this.name = name; this.d = rows || []; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() { return this.d.length; }
  getLastColumn() { return this.d.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this.d.length); }
  setFrozenRows(n) { this.frozen = n; return this; }
  cell(r, c) { while (this.d.length < r) this.d.push([]); const row = this.d[r - 1];
                while (row.length < c) row.push(''); return row; }
  getRange(a, c, nr, nc) {
    if (typeof a === 'string') {                       // "A:A"
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

/* the real header row from the user's sheet */
const LEAD_HEADERS = ['Time', 'Lead ID', 'Name', 'Phone', 'Source', 'Status', 'Assigned', 'Remarks',
  'Events sent', 'Last event', 'Last sent', 'Last result', 'fbc', 'fbp', 'Browser event ID',
  'User agent', 'IP', 'Page URL', 'Referrer', 'Updated by', 'Updated at'];

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

let fetches = [];
let mails = [];

function makeBook() {
  const now = Date.now();
  return new Book({
    Leads: new Sheet('Leads', [
      LEAD_HEADERS.slice(),
      leadRow({ id: 'L001', name: 'Ramesh', phone: '9876543210', source: '7788', status: 'New',
                time: new Date(now - 2 * 3600e3), fbc: 'fb.1.123.abc' }),
      leadRow({ id: 'L002', name: 'Lakshmi', phone: '08585072072', source: '8585', status: 'Qualified',
                time: new Date(now - 5 * 864e5), events: '|HAttempted||HContacted||HQualified|' }),
      leadRow({ id: 'L003', name: 'Srinivas', phone: '+91 90000 11111', source: '7788',
                status: 'Contacted', time: new Date(now - 30 * 864e5),
                events: '|HAttempted||HContacted|' })
    ]),
    Users: new Sheet('Users', [
      ['Name', 'PIN', 'Role', 'Sources', 'Spare', 'Active', 'Email'],
      ['Pallavi', '482913', 'admin', 'all', '', 'yes', 'boss@example.com'],
      ['Caller A', '730264', 'caller', '7788', '', 'yes', 'a@example.com'],
      ['Old Staff', '111111', 'caller', '7788', '', 'no', '']
    ]),
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

/* --------------------------- fake Apps Script -------------------------- */

function makeSandbox(book, props) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = n => String(n).padStart(2, '0');
  return {
    console,
    SpreadsheetApp: { openById: () => book },
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
    HtmlService: { createTemplateFromFile: () => ({ evaluate: () => ({}) }) },
    ContentService: { createTextOutput: () => ({ setMimeType: () => ({}) }), MimeType: { JSON: 'json' } }
  };
}

/* ------------------------------- harness ------------------------------- */

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function eq(name, got, want) { ok(name + ' = ' + JSON.stringify(want), got === want, got); }

function load(props) {
  const book = makeBook();
  const sandbox = makeSandbox(book, Object.assign({ SHEET_ID: 'fake-sheet-id' }, props || {}));
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  sandbox.setup();
  return { G: sandbox, book };
}
function col(book, name) { return book.getSheetByName('Leads').d[0].indexOf(name); }
function cellOf(book, leadId, name) {
  const d = book.getSheetByName('Leads').d;
  const idc = d[0].indexOf('Lead ID');
  for (let i = 1; i < d.length; i++) if (d[i][idc] === leadId) return d[i][col(book, name)];
}

function group(title) { console.log('\n' + title); }
/* the script runs in its own vm realm, so its Dates are not our `Date` */
function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

/* ------------------------------- the tests ------------------------------ */

fetches = []; mails = [];

group('setup');
{
  const { G, book } = load({ META_TOKEN: 'FAKE_TOKEN' });
  const head = book.getSheetByName('Leads').d[0];
  ok('appends the four columns', ['Owner', 'Next action at', 'Next action note', 'Last activity at']
      .every(c => head.indexOf(c) >= 0), head.slice(-5));
  eq('leaves the original header order alone', head.slice(0, 21).join(','), LEAD_HEADERS.join(','));
  ok('creates the Activity tab', !!book.getSheetByName('Activity'));
  const again = G.setup();
  eq('is safe to run twice', again.added.length, 0);
}

group('login');
{
  const { G } = load({});
  ok('rejects a wrong PIN', G.login('000000').ok === false);
  ok('rejects an inactive user', G.login('111111').ok === false);
  const r = G.login('482913');
  ok('accepts the admin PIN', r.ok === true, r);
  eq('reads the role', r.user.role, 'admin');
  ok('a bad token is not a session', G.bootstrap('nonsense').expired === true);
  G.logout(r.token);
  ok('logout ends the session', G.bootstrap(r.token).expired === true);
}

group('what each user can see');
{
  const { G } = load({});
  const admin = G.login('482913').token, caller = G.login('730264').token;
  eq('admin sees every lead', G.bootstrap(admin).leads.length, 3);
  const mine = G.bootstrap(caller).leads;
  eq('a caller sees only their sources', mine.length, 2);
  ok('and not the other number', mine.every(l => l.source === '7788'), mine.map(l => l.source));
  ok("cannot open someone else's lead", G.lead(caller, 'L002').ok === false);
}

group('notes');
{
  const { G, book } = load({});
  const t = G.login('482913').token;
  ok('an empty note is refused', G.note(t, 'L001', '   ').ok === false);
  const r = G.note(t, 'L001', 'Knee pain 3 months, wants Saturday');
  ok('saves', r.ok === true, r);
  eq('shows in the activity log', r.activity[0].type, 'note');
  eq('and mirrors into Remarks', cellOf(book, 'L001', 'Remarks'), 'Knee pain 3 months, wants Saturday');
  eq('names who wrote it', r.activity[0].by, 'Pallavi');
}

group('follow-ups');
{
  const { G, book } = load({});
  const t = G.login('482913').token;
  const when = new Date(Date.now() - 3600e3);              // an hour ago: already due
  const r = G.setFollowUp(t, 'L001', when.toISOString(), 'after her scan');
  ok('sets the time', r.ok === true, r);
  eq('writes the note', cellOf(book, 'L001', 'Next action note'), 'after her scan');
  ok('writes a real Date, not text', isDate(cellOf(book, 'L001', 'Next action at')));
  eq('takes ownership when nobody had it', cellOf(book, 'L001', 'Owner'), 'Pallavi');
  const b = G.bootstrap(t);
  eq('counts as due', b.counts.due, 1);
  ok('bad dates are refused', G.setFollowUp(t, 'L001', 'not-a-date', '').ok === false);
  const c = G.setFollowUp(t, 'L001', '', '');
  eq('can be cleared', c.nextAt, '');
  eq('and stops being due', G.bootstrap(t).counts.due, 0);
}

group('stages and Meta events');
{
  fetches = [];
  const { G, book } = load({ META_TOKEN: 'FAKE_TOKEN' });
  const t = G.login('482913').token;

  const r = G.setStage(t, 'L001', 'Contacted');
  ok('saves the stage', r.ok === true, r);
  eq('the sheet agrees', cellOf(book, 'L001', 'Status'), 'Contacted');
  ok('the event went out', r.meta.ok === true, r.meta);
  eq('one call to Graph', fetches.length, 1);
  const ev = fetches[0].body.data[0];
  eq('the right event name', ev.event_name, 'HContacted');
  eq('action_source', ev.action_source, 'website');
  eq('deduplicable event id', ev.event_id, 'L001-HContacted');
  eq('the real landing page', ev.event_source_url, 'https://halcyonpainfree.com/knee-pain-treatment/');
  ok('the click id is replayed', ev.user_data.fbc === 'fb.1.123.abc');
  ok('the phone is hashed', /^[a-f0-9]{64}$/.test(ev.user_data.ph[0]));
  ok('and it is the 91 form', ev.user_data.ph[0] ===
      crypto.createHash('sha256').update('919876543210').digest('hex'), ev.user_data.ph[0]);
  ok('no raw phone anywhere in the payload',
      JSON.stringify(fetches[0].body).indexOf('9876543210') < 0);
  ok('the token is not in the event itself', !JSON.stringify(ev).includes('FAKE_TOKEN'));
  eq('the ledger records it', cellOf(book, 'L001', 'Events sent'), '|HContacted|');
  eq('Last result', String(cellOf(book, 'L001', 'Last result')), 'OK 1');

  const r2 = G.setStage(t, 'L001', 'Contacted');
  eq('setting the same stage again sends nothing', fetches.length, 1);
  G.setStage(t, 'L001', 'Attempted');
  G.setStage(t, 'L001', 'Contacted');
  eq('going back and forth does not re-send', fetches.filter(f =>
      f.body.data[0].event_name === 'HContacted').length, 1);

  fetches = [];
  G.setStage(t, 'L002', 'Converted');
  eq('conversion value is attached', fetches[0].body.data[0].custom_data.value, 3000);
  eq('with a currency', fetches[0].body.data[0].custom_data.currency, 'INR');

  fetches = [];
  G.setStage(t, 'L003', 'New');
  eq('New has no event', fetches.length, 0);
  ok('an unknown stage is refused', G.setStage(t, 'L001', 'Marinating').ok === false);
}

group('events the old script already sent are left alone');
{
  fetches = [];
  const { G } = load({ META_TOKEN: 'FAKE_TOKEN' });
  const t = G.login('482913').token;
  const r = G.setStage(t, 'L002', 'Qualified');   // ledger already has |HQualified|
  eq('nothing sent', fetches.length, 0);
  eq('and it says why', r.meta.skipped, 'already sent');
}

group('no Meta token');
{
  fetches = [];
  const { G, book } = load({});                   // no META_TOKEN
  const t = G.login('482913').token;
  const r = G.setStage(t, 'L001', 'Booked');
  ok('the stage still saves', r.ok === true && cellOf(book, 'L001', 'Status') === 'Booked');
  eq('nothing is sent', fetches.length, 0);
  ok('and the failure is explained', /token/i.test(r.meta.error), r.meta);
  ok('the ledger is not marked', String(cellOf(book, 'L001', 'Events sent')).indexOf('HBooked') < 0);
}

group('logging a call');
{
  const { G, book } = load({ META_TOKEN: 'FAKE_TOKEN' });
  const t = G.login('482913').token;

  const r = G.logCall(t, 'L001', 'answered', 'wants Saturday 11am');
  eq('New + answered → Contacted', r.stage, 'Contacted');
  const c = r.activity.filter(a => a.type === 'call')[0];
  ok('logged as a call', !!c, r.activity.map(a => a.type));
  ok('with the outcome and the words', /Answered.*Saturday/.test(c.detail), c.detail);
  eq('and the Meta send is logged too', r.activity[0].type, 'meta');

  const q = G.logCall(t, 'L002', 'noanswer', '');
  eq('a missed call never drags Qualified backwards', q.stage, 'Qualified');

  const w = G.logCall(t, 'L003', 'wrong', '');
  eq('a wrong number goes to Junk from anywhere', w.stage, 'Junk');

  ok('an unknown outcome is refused', G.logCall(t, 'L001', 'telepathy', '').ok === false);
  ok('Last activity at is stamped', isDate(cellOf(book, 'L001', 'Last activity at')));
}

group('the morning digest');
{
  mails = [];
  const { G } = load({});
  const t = G.login('482913').token;
  G.setFollowUp(t, 'L001', new Date(Date.now() + 2 * 3600e3).toISOString(), 'call back');
  G.dailyDigest();
  eq('one mail per active user with an email', mails.length, 2);
  ok('addressed to the right people',
      mails.map(m => m.to).sort().join(',') === 'a@example.com,boss@example.com', mails.map(m => m.to));
  ok('the due lead is in it', mails[0].body.indexOf('Ramesh') >= 0);
  ok('it links back to the app', mails[0].body.indexOf('/exec') > 0);
}

group('SEND_EVENTS = no');
{
  fetches = [];
  const book = makeBook();
  book.getSheetByName('Config').d.push(['SEND_EVENTS', 'no']);
  const sandbox = makeSandbox(book, { SHEET_ID: 'fake-sheet-id', META_TOKEN: 'FAKE_TOKEN' });
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8'), sandbox);
  sandbox.setup();
  const t = sandbox.login('482913').token;
  const r = sandbox.setStage(t, 'L001', 'Contacted');
  eq('nothing reaches Graph', fetches.length, 0);
  ok('but the stage saves', r.ok === true);
}

group('no secrets in the repo');
{
  const files = ['src/Code.gs', 'src/App.html', 'src/appsscript.json', 'README.md', 'SETUP.md'];
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
