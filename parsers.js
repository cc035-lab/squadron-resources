/* Squadron Resources: on-device readers for CAP eServices Excel/CSV reports.
   Runs the same way on iPhone (Safari), Android (Chrome) and inside the Android APK.
   Nothing is uploaded: files are read from the phone's memory only. */
(function () {
'use strict';
const MAX_BYTES = 15000000, MAX_UNZIPPED = 30000000;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const REGIONS = new Set(['NER','MER','GLR','SER','NCR','SWR','RMR','PCR','NHQ']);
const isRegion = s => REGIONS.has(clean(s));
const isUnit = s => /^([A-Z]{3}-)?[A-Z]{2}-\d{3}$/.test(clean(s));
function fail(msg) { throw new Error(msg); }
function check(ok, msg) { if (!ok) fail(msg); }

/* ---------------- dates ---------------- */
function ymd(y, m, d) {
  if (y < 1950 || y > 2150 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
function anyDate(s) {
  s = String(s ?? '');
  let m = s.match(/\b(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4})\b/);
  if (m) { const mi = MONTHS.indexOf(m[2].toLowerCase()) + 1; if (mi) return ymd(+m[3], mi, +m[1]); }
  m = s.match(/\b(\d{4})-(\d{2})-(\d{2})/); if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return ymd(y, +m[1], +m[2]); }
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})\b/);
  if (m) { const mi = MONTHS.indexOf(m[1].toLowerCase()) + 1; if (mi) return ymd(+m[3], mi, +m[2]); }
  return null;
}
function excelDate(v) {
  const n = parseFloat(v); if (!(n > 20000 && n < 80000)) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const cellDate = v => anyDate(v) || (/^\d{5}(\.\d+)?$/.test(String(v ?? '').trim()) ? excelDate(v) : null);
function addYear(iso) { // 29 Feb + 1 year -> 28 Feb (same as Java Calendar)
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${pad(m)}-${pad(Math.min(d, last))}`;
}
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
const todayIso = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };

/* ---------------- names ---------------- */
function displayName(raw) {
  raw = clean(String(raw ?? '').replace(/\s+-\s+\d{6}.*$/, ''));
  const c = raw.indexOf(',');
  return c > 0 ? clean(raw.slice(c + 1) + ' ' + raw.slice(0, c)) : raw;
}
function titleCase(s) { return clean(s).toLowerCase().split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
const member = (capid, name, rank) => ({ capid, name: clean(name), rank: clean(rank) });
function result(type, members, records, warnings, extra) {
  return Object.assign({ type, members: [...members.values()], records, warnings,
    summary: { records: records.length, members: members.size } }, extra || {});
}

/* ---------------- zip / xlsx ---------------- */
const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4B;
const isPdf = b => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
function unzip(bytes) {
  check(isZip(bytes), 'Expected a ZIP or Excel (.xlsx) file');
  let total = 0, count = 0;
  const files = window.fflate.unzipSync(bytes, { filter: f => {
    if (/(^|\/)\.\.(\/|$)/.test(f.name) || f.name.startsWith('/')) fail('Invalid ZIP entry path');
    total += f.originalSize; count++;
    if (total > MAX_UNZIPPED || count > 300) fail('ZIP is too large');
    return true; } });
  return files;
}
const td = new TextDecoder('utf-8');
function xml(bytes) {
  check(bytes, 'Required worksheet missing');
  const text = td.decode(bytes);
  check(!/<!doctype|<!entity/i.test(text), 'External XML entities are not supported');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  check(!doc.getElementsByTagName('parsererror').length, 'The worksheet could not be read');
  return doc;
}
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function ref(a) { const m = /^([A-Z]+)(\d+)$/.exec(a || ''); return m ? [+m[2], colIndex(m[1])] : null; }

/** First worksheet as cells {row, col, end (merged last column), v}. */
function readSheet(files) {
  let path = 'xl/worksheets/sheet1.xml';
  if (!files[path]) path = Object.keys(files).filter(k => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  check(path, 'This Excel file has no worksheet');
  const sheet = xml(files[path]);
  const shared = files['xl/sharedStrings.xml'] ? tags(xml(files['xl/sharedStrings.xml']), 'si').map(si => tags(si, 't').map(t => t.textContent).join('')) : [];
  const mergeEnd = new Map();
  for (const mc of tags(sheet, 'mergeCell')) {
    const [a, b] = (mc.getAttribute('ref') || '').split(':'); const ra = ref(a), rb = ref(b);
    if (ra && rb) mergeEnd.set(ra[0] + ':' + ra[1], rb[1]);
  }
  const cells = [];
  for (const c of tags(sheet, 'c')) {
    const rc = ref(c.getAttribute('r')); if (!rc) continue;
    const t = c.getAttribute('t'); const v = tags(c, 'v')[0];
    let value;
    if (t === 's' && v) { const i = parseInt(v.textContent, 10); value = shared[i] ?? ''; }
    else if (v) value = v.textContent;
    else value = tags(c, 't').map(x => x.textContent).join('');
    value = clean(value).replace(/^(\d+)\.0$/, '$1');
    if (!value) continue;
    cells.push({ row: rc[0], col: rc[1], end: mergeEnd.get(rc[0] + ':' + rc[1]) ?? rc[1], v: value });
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return cells;
}
function byRow(cells) { const rows = new Map(); for (const c of cells) { if (!rows.has(c.row)) rows.set(c.row, []); rows.get(c.row).push(c); } return rows; }
const keyOf = s => s.toLowerCase().replace(/[^a-z]/g, '');
/** Matches data cells to header cells by overlapping (merged) column spans. */
function headerMap(headerCells) {
  const spans = headerCells.map(c => ({ key: keyOf(c.v), col: c.col, end: c.end }));
  return cell => {
    let best = null, bestOverlap = 0, bestDist = 99;
    for (const h of spans) {
      const overlap = Math.min(cell.end, h.end) - Math.max(cell.col, h.col) + 1;
      const dist = Math.min(Math.abs(cell.col - h.col), Math.abs(cell.end - h.end));
      if (overlap > bestOverlap || (overlap === bestOverlap && overlap <= 0 && dist < bestDist)) { best = h.key; bestOverlap = overlap; bestDist = dist; }
    }
    return best && (bestOverlap > 0 || bestDist <= 2) ? best : null;
  };
}
function rowObject(rowCells, assign) { const o = {}; for (const c of rowCells) { const k = assign(c); if (k && o[k] === undefined) o[k] = c.v; } return o; }
const textOf = cells => cells.slice(0, 400).map(c => c.v).join(' \n ').toLowerCase();

/* ---------------- Duty Assignment Report (Excel) ---------------- */
function duty(cells) {
  const rows = byRow(cells);
  let headerRow = null;
  for (const [r, rc] of rows) { const ks = rc.map(c => keyOf(c.v)); if (ks.includes('capid') && ks.includes('duty')) { headerRow = r; break; } }
  check(headerRow, 'Duty Assignment columns not found');
  const assign = headerMap(rows.get(headerRow));
  const totals = cells.map(c => /Total Members:\s*(\d+),\s*Assignments:\s*(\d+)/i.exec(c.v)).find(Boolean);
  const records = [], members = new Map(), warnings = []; let section = 'Duty Assignments', current = null;
  for (const [r, rc] of rows) {
    if (r <= headerRow) continue;
    const o = rowObject(rc, assign);
    const capid = String(o.capid || '').trim();
    if (!/^\d{6}$/.test(capid)) {
      const label = clean(o.duty || (rc.length === 1 ? rc[0].v : ''));
      if (label && !isRegion(label) && !isUnit(label)) { section = label; current = null; }
      continue;
    }
    if (o.duty) current = clean(o.duty);
    if (!current) { warnings.push(`Row ${r}: no duty position for ${capid}`); continue; }
    const kind = clean(o.type).toUpperCase();
    if (!['P', 'A', 'T'].includes(kind)) warnings.push(`Row ${r}: assignment type unclear for ${capid}`);
    records.push({ capid, duty: current, section, assignment_type: ['P', 'A', 'T'].includes(kind) ? kind : '?',
      assigned: anyDate(o.assigned), removed: anyDate(o.removed), assigned_by: clean(o.assignedby) });
    if (o.member) members.set(capid, member(capid, o.member, o.rank));
  }
  check(records.length >= 1, 'No duty assignments found in this report');
  const extra = { layout: 'eServices Duty Assignment (Excel)' };
  if (totals) {
    extra.totals = { members: +totals[1], records: +totals[2] };
    if (+totals[2] !== records.length) warnings.push(`Report says ${totals[2]} assignments; ${records.length} were read`);
    if (+totals[1] !== members.size) warnings.push(`Report says ${totals[1]} members; ${members.size} were read`);
  }
  return result('duty', members, records, warnings, extra);
}

/* ---------------- All Qualification Listing (Excel) ---------------- */
const MEMBER_CELL = /^(.+?)\s+-\s+(.+?)\s+-\s+(\d{6})$/;
function qualifications(cells) {
  const rows = byRow(cells);
  let headerRow = null;
  for (const [r, rc] of rows) { const ks = rc.map(c => keyOf(c.v)); if (ks.includes('completed') && ks.includes('expiration')) { headerRow = r; break; } }
  check(headerRow, 'Qualification Listing columns not found');
  const assign = headerMap(rows.get(headerRow));
  const records = [], members = new Map(), warnings = [], quals = new Set(); let active = null;
  for (const [r, rc] of rows) {
    if (r <= headerRow) continue;
    const who = rc.map(c => MEMBER_CELL.exec(c.v)).find(Boolean);
    if (!who) {
      const label = rc.length === 1 ? clean(rc[0].v) : '';
      if (label && !isRegion(label) && !/^[A-Z]{2}$/.test(label) && !/^\d{3}$/.test(label) && !isUnit(label)) active = label;
      continue;
    }
    if (!active) { warnings.push(`Row ${r}: member listed before any qualification`); continue; }
    const o = {}; for (const c of rc) { if (MEMBER_CELL.test(c.v)) continue; const k = assign(c); if (k) o[k] = c.v; }
    const expText = clean(o.expiration);
    const capid = who[3];
    if (!expText) warnings.push(`Row ${r}: missing expiration for ${capid} / ${active}`);
    records.push({ capid, qualification: active, completed: cellDate(o.completed),
      expires: /does not expire/i.test(expText) ? null : cellDate(expText), expiration_text: expText });
    members.set(capid, member(capid, displayName(who[1]), who[2]));
    quals.add(active);
  }
  check(records.length >= 1, 'No qualification entries found in this report');
  return result('qualifications', members, records, warnings, { layout: 'eServices All Qualification Listing (Excel)', categories: quals.size });
}

/* ---------------- Specialty Track Report (Excel) ---------------- */
function tracks(cells) {
  const rows = byRow(cells);
  let assign = null;
  for (const [, rc] of rows) { const ks = rc.map(c => keyOf(c.v)); if (ks.includes('capid') && ks.includes('completed')) { assign = headerMap(rc); break; } }
  check(assign, 'Specialty Track columns not found');
  const records = [], members = new Map(), emails = new Map(), names = new Set(); let track = null, level = null;
  for (const [, rc] of rows) {
    const o = rowObject(rc, assign);
    const capid = String(o.capid || '').trim();
    if (/^\d{6}$/.test(capid)) {
      if (!track || !level) continue;
      members.set(capid, member(capid, o.member, o.rank));
      const lvl = level.toUpperCase() === 'NONE' ? 'Enrolled' : titleCase(level);
      records.push({ capid, track: titleCase(track), level: lvl, completed: cellDate(o.completed) });
      names.add(track);
      const em = clean(o.email); if (/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(em)) emails.set(capid, em);
      continue;
    }
    if (rc.length !== 1) continue;
    const t = clean(rc[0].v);
    if (/^level\s*-\s*/i.test(t)) level = clean(t.replace(/^level\s*-\s*/i, ''));
    else if (t === t.toUpperCase() && /[A-Z]/.test(t) && t !== 'CAPID') { track = t; level = null; }
  }
  check(records.length >= 1, 'No specialty track ratings found in this report');
  return { data: result('tracks', members, records, [], { layout: 'eServices Specialty Track Report (Excel)', tracks: names.size }), emails, members };
}

/* ---------------- Cadet Protection Completion (Excel) ---------------- */
function cppCompletion(cells) {
  const rows = byRow(cells);
  let headerRow = null;
  for (const [r, rc] of rows) if (rc.some(c => keyOf(c.v) === 'capid')) { headerRow = r; break; }
  check(headerRow, 'CAPID header not found in the Cadet Protection report');
  const assign = headerMap(rows.get(headerRow));
  check(rows.get(headerRow).some(c => keyOf(c.v) === 'fullname'), 'Unexpected Cadet Protection report columns');
  const unit = (cells.find(c => c.row > headerRow && /^[A-Z]{3}-[A-Z]{2}-\d{3}$/.test(c.v)) || {}).v;
  const generated = todayIso(); // eServices leaves the workbook date blank; the import day is used
  const records = [], members = new Map(), warnings = [];
  for (const [r, rc] of rows) {
    if (r <= headerRow) continue;
    const o = rowObject(rc, assign);
    const capid = String(o.capid || '').trim(); if (!/^\d{6}$/.test(capid)) continue;
    const name = displayName(o.fullname);
    const type = clean(o.type).toUpperCase();
    const basic = anyDate(o.basic), cadetCourse = anyDate(o.cadets), advanced = anyDate(o.advanced);
    const curr = clean(o.curr).toUpperCase();
    const youthCadet = type.startsWith('CADET') && !type.includes('SPONSOR');
    let completed = null, course = null, expires = null, basis = '';
    if (basic) { completed = basic; course = 'Cadet Protection Basic'; }
    if (advanced && (!completed || advanced > completed)) { completed = advanced; course = 'Cadet Protection Advanced'; }
    if (completed) { expires = addYear(completed); basis = '12 months after last course'; }
    else if (cadetCourse) { completed = cadetCourse; course = 'Cadet course'; basis = 'Report status'; }
    const days = /(-?\d+)/.exec(curr); if (days) { expires = addDays(generated, +days[1]); basis = 'Days left in report'; }
    const statusText = curr.startsWith('E') ? 'Expired / needs training' : curr.startsWith('C') ? 'Current' : (curr.startsWith('O') || curr.startsWith('0')) ? 'Not complete' : curr;
    if (!completed && !curr.startsWith('E')) warnings.push(`${name} (${capid}): no course date in report`);
    const rec = { capid, course: course || 'Cadet Protection', completed, expires, status_text: statusText, report_status: curr,
      member_type: titleCase(type), basis, bgc: clean(o.bgc), quiz: clean(o.quiz), conversation: clean(o.conv),
      basic, advanced, cadet_course: cadetCourse, youth_cadet: youthCadet };
    if (/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(clean(o.email))) rec.email = clean(o.email);
    records.push(rec); members.set(capid, member(capid, name, ''));
  }
  check(records.length >= 1, 'No members found in the Cadet Protection report');
  return result('cpp', members, records, warnings, { unit, report_date: generated, layout: 'eServices Cadet Protection Completion' });
}

/* ---------------- generic tables (other CPP / contact formats) ---------------- */
function cellsToTable(cells) {
  const out = []; let last = 0;
  for (const [r, rc] of byRow(cells)) { while (++last < r) out.push([]); const row = []; for (const c of rc) { while (row.length < c.col) row.push(''); row[c.col] = c.v; } out.push(row); }
  return out;
}
function csv(bytes) {
  let text = td.decode(bytes); if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  check(!/\u0000/.test(text.slice(0, 4096)), 'Unsupported file. Use an Excel (.xlsx), CSV, or ZIP export.');
  const delim = /\t/.test(text.split('\n', 1)[0]) && !/,/.test(text.split('\n', 1)[0]) ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(clean(cell)); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(clean(cell)); cell = ''; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(clean(cell)); rows.push(row); }
  return rows;
}
const at = (row, i) => (i >= 0 && i < row.length ? row[i] || '' : '');
function headerRowOf(rows) {
  for (let i = 0; i < Math.min(rows.length, 60); i++) if (rows[i].some(c => keyOf(c) === 'capid')) return i;
  for (let i = 0; i < Math.min(rows.length, 60); i++) if (rows[i].some(c => keyOf(c).includes('capid'))) return i;
  return -1;
}
function column(header, used, ...keys) {
  for (let i = 0; i < header.length; i++) { if (used.has(i)) continue; const h = String(header[i] || '').toLowerCase(); if (keys.some(k => h.includes(k))) { used.add(i); return i; } }
  return -1;
}
function capidIn(row, capCol) {
  if (capCol >= 0) { const v = String(at(row, capCol)).replace(/\.0$/, ''); return /^\d{6}$/.test(v) ? v : null; }
  for (const c of row) { const v = String(c || '').replace(/\.0$/, ''); if (/^\d{6}$/.test(v)) return v; }
  return null;
}
const looksLikeName = c => /^[A-Za-z][A-Za-z' .-]*,\s*[A-Za-z][A-Za-z' .-]*$/.test(c) && c.length < 60;
function nameFrom(row, nameCol, firstCol, lastCol) {
  if (firstCol >= 0 && lastCol >= 0 && (at(row, firstCol) || at(row, lastCol))) return clean(at(row, firstCol) + ' ' + at(row, lastCol));
  if (nameCol >= 0 && at(row, nameCol)) return displayName(at(row, nameCol));
  const c = row.find(x => looksLikeName(x || '')); return c ? displayName(c) : '';
}
const EMAIL_G = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_G = /(?<!\d)(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})(?!\d)/g;
function contactsTable(rows) {
  const h = headerRowOf(rows), header = h >= 0 ? rows[h] : [];
  const used = new Set(); const capCol = header.findIndex(c => keyOf(c || '').includes('capid')); if (capCol >= 0) used.add(capCol);
  const emailCols = [], phoneCols = [];
  header.forEach((x, i) => { const l = String(x || '').toLowerCase(); if (l.includes('mail')) { emailCols.push(i); used.add(i); } else if (/phone|cell|mobile/.test(l)) { phoneCols.push(i); used.add(i); } });
  const typeCol = column(header, used, 'type', 'method', 'kind'), firstCol = column(header, used, 'first name', 'first'), lastCol = column(header, used, 'last name', 'last'),
    nameCol = column(header, used, 'name', 'member'), rankCol = column(header, used, 'grade', 'rank');
  const people = new Map(), members = new Map(), warnings = [];
  for (let i = h + 1; i < rows.length; i++) {
    const row = rows[i]; const capid = capidIn(row, capCol); if (!capid) continue;
    const name = nameFrom(row, nameCol, firstCol, lastCol);
    if (!people.has(capid)) people.set(capid, { capid, phones: [], emails: [], seen: new Set() });
    const who = people.get(capid);
    if (name || !members.has(capid)) members.set(capid, member(capid, name, at(row, rankCol)));
    const rowType = typeCol >= 0 ? titleCase(at(row, typeCol)) : '';
    row.forEach((cell, j) => {
      if (!cell || [capCol, nameCol, firstCol, lastCol, rankCol, typeCol].includes(j)) return;
      const label = rowType || (header[j] ? titleCase(header[j]) : '');
      for (const m of String(cell).matchAll(EMAIL_G)) { const k = 'e:' + m[0].toLowerCase(); if (!who.seen.has(k)) { who.seen.add(k); who.emails.push({ label: label || 'Email', value: m[0] }); } }
      const phoneOk = phoneCols.includes(j) || (!phoneCols.length && !emailCols.includes(j) && !/mail/i.test(rowType));
      if (!phoneOk || String(cell).includes('@')) return;
      for (const m of String(cell).matchAll(PHONE_G)) { const d = m[1] + m[2] + m[3]; if (!who.seen.has('p:' + d)) { who.seen.add('p:' + d); who.phones.push({ label: label || 'Phone', value: `(${m[1]}) ${m[2]}-${m[3]}`, digits: d }); } }
    });
  }
  const records = [...people.values()].filter(p => p.phones.length || p.emails.length).map(({ seen, ...p }) => p);
  if (people.size > records.length) warnings.push(`${people.size - records.length} member(s) listed without any phone or email`);
  return { records, members, warnings };
}
function cppTable(rows) {
  const h = headerRowOf(rows), header = h >= 0 ? rows[h] : [];
  const used = new Set(); const capCol = header.findIndex(c => keyOf(c || '').includes('capid')); if (capCol >= 0) used.add(capCol);
  const expCol = column(header, used, 'expir', 'due', 'renew', 'valid', 'until', 'next'), compCol = column(header, used, 'complet', 'taken', 'passed', 'achiev', 'date'),
    statusCol = column(header, used, 'status', 'current'), courseCol = column(header, used, 'course', 'training', 'module', 'requirement', 'item', 'program'),
    firstCol = column(header, used, 'first name', 'first'), lastCol = column(header, used, 'last name', 'last'), nameCol = column(header, used, 'name', 'member'), rankCol = column(header, used, 'grade', 'rank');
  const records = [], members = new Map(), warnings = [];
  for (let i = h + 1; i < rows.length; i++) {
    const row = rows[i]; const capid = capidIn(row, capCol); if (!capid) continue;
    let completed = compCol >= 0 ? cellDate(at(row, compCol)) : null, expires = expCol >= 0 ? cellDate(at(row, expCol)) : null;
    if (compCol < 0 && expCol < 0) { const ds = row.map(anyDate).filter(Boolean).sort(); if (ds.length === 1) completed = ds[0]; else if (ds.length > 1) { completed = ds[0]; expires = ds[ds.length - 1]; } }
    let status = statusCol >= 0 ? at(row, statusCol) : '';
    if (!status) status = row.find(c => c && c.length < 40 && !anyDate(c) && /\b(current|expired|overdue|incomplete|not complete[d]?|completed?|due|missing|required|pending)\b/i.test(c)) || '';
    const course = courseCol >= 0 && at(row, courseCol) ? at(row, courseCol) : 'Cadet Protection Program Training';
    if (!completed && !expires && !status) warnings.push(`Row ${i + 1}: no dates or status for ${capid}`);
    records.push({ capid, course: clean(course), completed, expires, status_text: clean(status) });
    const name = nameFrom(row, nameCol, firstCol, lastCol); if (name || !members.has(capid)) members.set(capid, member(capid, name, at(row, rankCol)));
  }
  check(records.length >= 1, 'No CAPID rows found. Is this the Cadet Protection report?');
  if (h < 0) warnings.push('No CAPID header row found; dates were read by position. Check the preview carefully.');
  else if (expCol < 0) warnings.push('No expiration column found; renewals will not be tracked unless the report supplies them.');
  return result('cpp', members, records, warnings);
}

/* ---------------- entry point ---------------- */
const KIND = [['duty', 'duty assignment report'], ['qualifications', 'all qualification listing'], ['tracks', 'specialty track report'], ['cpp', 'cadet protection completion'], ['contacts', 'contact report']];
function detect(cells) { const t = textOf(cells); const k = KIND.find(([, s]) => t.includes(s)); return k ? k[0] : null; }
function contactsFromWorkbook(files) {
  const cells = readSheet(files);
  if (/no information was found/i.test(textOf(cells))) return { empty: true };
  const t = contactsTable(cellsToTable(cells)); return t;
}
function parse(bytes, fileName, requested) {
  check(bytes && bytes.length, 'The selected file is empty');
  check(bytes.length <= MAX_BYTES, 'File exceeds the 15 MB import limit');
  check(!isPdf(bytes), 'PDF reports can only be read by the Android app. In eServices, choose the Excel (.xlsx) download instead.');
  if (!isZip(bytes)) { // CSV
    const rows = csv(bytes);
    if (requested === 'contacts') { const c = contactsTable(rows); check(c.records.length, 'No phone numbers or email addresses were found next to a CAPID'); return result('contacts', c.members, c.records, c.warnings); }
    if (requested === 'cpp') return cppTable(rows);
    fail('This report must be the Excel (.xlsx) download from eServices.');
  }
  let files = unzip(bytes), inner = files, contactBook = null;
  if (!files['xl/workbook.xml']) { // a ZIP that contains workbooks (e.g. Specialty_Track_Report.xlsx.zip)
    const names = Object.keys(files).filter(n => /\.(xlsx|csv)$/i.test(n));
    check(names.length, 'No Excel or CSV file found inside the ZIP');
    const main = names.find(n => !/contact/i.test(n)) || names[0];
    const contact = names.find(n => /contact/i.test(n) && n !== main);
    if (/\.csv$/i.test(main)) return parse(files[main], main, requested);
    inner = unzip(files[main]);
    if (contact && /\.xlsx$/i.test(contact)) contactBook = unzip(files[contact]);
  }
  const cells = readSheet(inner);
  const kind = detect(cells) || requested;
  if (kind === 'duty') return duty(cells);
  if (kind === 'qualifications') return qualifications(cells);
  if (kind === 'cpp') return detect(cells) === 'cpp' ? cppCompletion(cells) : cppTable(cellsToTable(cells));
  if (kind === 'tracks') {
    const t = tracks(cells); const out = t.data;
    const contactRecs = new Map(); const warnings = [];
    if (contactBook) {
      try { const c = contactsFromWorkbook(contactBook); if (c.empty) warnings.push('The Contact Report in the ZIP is empty, so phone numbers were not included. Emails come from the Specialty Track sheet.'); else for (const r of c.records) contactRecs.set(r.capid, r); }
      catch (e) { warnings.push('Contact Report in ZIP could not be read: ' + e.message); }
    }
    for (const [capid, em] of t.emails) {
      const r = contactRecs.get(capid) || { capid, phones: [], emails: [] };
      if (!r.emails.some(x => x.value.toLowerCase() === em.toLowerCase())) r.emails.push({ label: 'Email (specialty track report)', value: em });
      contactRecs.set(capid, r);
    }
    out.warnings.push(...warnings);
    if (contactRecs.size) out.contacts = result('contacts', new Map([...contactRecs.keys()].filter(k => t.members.has(k)).map(k => [k, t.members.get(k)])), [...contactRecs.values()], []);
    return out;
  }
  if (kind === 'contacts') {
    const c = contactsFromWorkbook(inner); check(!c.empty, 'This Contact Report is empty ("No information was found").');
    check(c.records.length, 'No phone numbers or email addresses were found next to a CAPID');
    return result('contacts', c.members, c.records, c.warnings);
  }
  fail('This file was not recognized as a CAP eServices report.');
}
window.Parsers = { parse, detect, anyDate, addYear, version: '1.4' };
})();
