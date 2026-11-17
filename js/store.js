// Data layer: in-memory tables persisted to IndexedDB (localStorage fallback).
import { normalizeName, fa, jIso } from './util.js';

const DB_NAME = 'bashgah', STORE = 'kv', KEY = 'state';
export const DEFAULT_SETTINGS = {
  userName: '', defaultRestSec: 90, weightStep: 2.5, keepScreenOn: true,
  vibrate: true, sound: true, preWarn: false, autoRest: true,
};
function emptyState() {
  return {
    v: 1, nextId: 1,
    programs: [], days: [], exercises: [], dayExercises: [],
    sessions: [], sessionExercises: [], sets: [],
    settings: { ...DEFAULT_SETTINGS },
    onboarded: false,
    rest: null, // {startAt, endAt, total, info}
    hold: null, // {setId, startAt, targetSec}
  };
}
export let S = emptyState();

// ------------------------------------------------------------ persistence
// Every change is written synchronously to localStorage (survives iOS killing the app at any moment)
// and then to IndexedDB. On load the newest/most complete copy wins, so a stale or broken store
// can never replace real data. An empty (not onboarded) state never overwrites an onboarded one.
const LS = 'bashgah_state', LS_BAK = 'bashgah_state_bak';
let idb = null, idbTimer = null, allowWipe = false, storedOnboarded = false;
const withTimeout = (p, ms, v) => Promise.race([p, new Promise((r) => setTimeout(() => r(v), ms))]);
function openIdb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => { const db = r.result; db.onclose = () => { if (idb === db) idb = null; }; db.onversionchange = () => db.close(); res(db); };
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
}
function idbGet(db, key = KEY) {
  return new Promise((res) => {
    try {
      const t = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      t.onsuccess = () => res(t.result ?? null);
      t.onerror = () => res(null);
    } catch { res(null); }
  });
}
function idbPut(db, val) {
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, KEY);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
      tx.onabort = () => res(false);
    } catch { res(false); }
  });
}
function parse(raw) { if (!raw) return null; try { const o = typeof raw === 'string' ? JSON.parse(raw) : raw; return o && typeof o === 'object' ? o : null; } catch { return null; } }
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
const size = (o) => ['programs', 'days', 'exercises', 'dayExercises', 'sessions', 'sessionExercises', 'sets'].reduce((n, k) => n + (o[k]?.length || 0), 0);
/** Best copy: onboarded first, then most recently saved, then the one with more data. */
export function pickBest(list) {
  return list.filter(Boolean).sort((x, y) => (+!!y.onboarded - +!!x.onboarded) || ((y.savedAt || 0) - (x.savedAt || 0)) || (size(y) - size(x)))[0] || null;
}
export async function load() {
  const fromLs = parse(lsGet(LS)), fromBak = parse(lsGet(LS_BAK));
  idb = await withTimeout(openIdb(), 2500, null);
  const fromIdb = idb ? parse(await withTimeout(idbGet(idb), 2500, null)) : null;
  let o = pickBest([fromIdb, fromLs, fromBak]);
  // an explicit «پاک کردن همه» is newer than any copy it replaced
  const wiped = [fromLs, fromIdb].filter((x) => x && x.wipedAt).sort((x, y) => y.wipedAt - x.wipedAt)[0];
  if (wiped && o && wiped !== o && wiped.wipedAt >= (o.savedAt || 0)) o = wiped;
  if (o) {
    S = Object.assign(emptyState(), o);
    S.settings = { ...DEFAULT_SETTINGS, ...(o.settings || {}) };
    storedOnboarded = !!S.onboarded;
    // heal the other copies if they were stale
    save(true);
  }
  requestPersist();
}
export function requestPersist() { try { navigator.storage?.persist?.().catch(() => {}); } catch {} }
export function save(now = false) {
  writeNow();
  clearTimeout(idbTimer);
  if (now) return writeIdb();
  idbTimer = setTimeout(writeIdb, 120);
}
function guard() {
  // never let a blank state replace saved data (only an explicit wipe may)
  if (!S.onboarded && storedOnboarded && !allowWipe) return false;
  return true;
}
let json = '';
function writeNow() {
  if (!guard()) return false;
  S.savedAt = Date.now();
  json = JSON.stringify(S);
  let ok = false;
  try { localStorage.setItem(LS, json); ok = true; } catch {}
  if (S.onboarded) { try { localStorage.setItem(LS_BAK, json); } catch {} storedOnboarded = true; }
  return ok;
}
async function writeIdb() {
  if (!guard() || !json) return false;
  const val = json;
  if (!idb) idb = await withTimeout(openIdb(), 2500, null);
  let ok = idb ? await idbPut(idb, val) : false;
  if (!ok) { // iOS: "Connection to Indexed Database server lost" -> reconnect once
    try { idb?.close(); } catch {}
    idb = await withTimeout(openIdb(), 2500, null);
    ok = idb ? await idbPut(idb, val) : false;
  }
  return ok;
}
export function resetAll() {
  allowWipe = true; storedOnboarded = false;
  S = emptyState(); S.wipedAt = Date.now();
  try { localStorage.removeItem(LS_BAK); } catch {}
  save(true); allowWipe = false;
}

const id = () => S.nextId++;

// ------------------------------------------------------------ math
export const e1rm = (w, r) => (w <= 0 || r <= 0 ? 0 : r === 1 ? w : w * (1 + Math.min(r, 15) / 30));
export const volume = (w, r, timed) => (timed ? 0 : w > 0 && r > 0 ? w * r : 0);
export const PR_LABEL = { MAX_WEIGHT: 'سنگین‌ترین', E1RM: '۱RM', REPS: 'تکرار بیشتر', VOLUME: 'حجم', HOLD: 'زمان بیشتر' };
export function detectSetPrs(prior, w, r, timed) {
  if (!prior.length || r <= 0) return [];
  if (timed) return r > Math.max(...prior.map((p) => p[1])) ? ['HOLD'] : [];
  const out = [];
  const maxW = Math.max(...prior.map((p) => p[0]));
  if (w > 0 && w > maxW + 1e-9) out.push('MAX_WEIGHT');
  const bestE = Math.max(...prior.map((p) => e1rm(p[0], p[1])));
  if (e1rm(w, r) > bestE + 1e-9) out.push('E1RM');
  const atW = prior.filter((p) => p[0] >= w - 1e-9).map((p) => p[1]);
  if (atW.length && r > Math.max(...atW) && !out.includes('MAX_WEIGHT')) out.push('REPS');
  return out;
}

// ------------------------------------------------------------ lookups
export const byId = (arr, i) => arr.find((x) => x.id === i);
export const program = (i) => byId(S.programs, i);
export const day = (i) => byId(S.days, i);
export const exercise = (i) => byId(S.exercises, i);
export const activeProgram = () => S.programs.find((p) => p.isActive) || null;
export const daysOf = (pid) => S.days.filter((d) => d.programId === pid).sort((a, b) => a.position - b.position);
export const dayExercisesOf = (did) => S.dayExercises.filter((x) => x.dayId === did).sort((a, b) => a.position - b.position);
export const openSession = () => S.sessions.find((s) => s.endedAt == null) || null;
export const finishedSessions = () => S.sessions.filter((s) => s.endedAt != null).sort((a, b) => b.startedAt - a.startedAt);
export const sessionExercisesOf = (sid) => S.sessionExercises.filter((x) => x.sessionId === sid).sort((a, b) => a.position - b.position);
export const setsOf = (seId) => S.sets.filter((x) => x.sessionExerciseId === seId).sort((a, b) => a.setIndex - b.setIndex);
export const dayLabel = (d) => `روز ${fa(d.position + 1)}` + (d.name ? ` – ${d.name}` : '');

/** All done sets of finished sessions for an exercise: [{...set, startedAt, sessionId, title}] */
export function historyFor(exId, excludeSessionId = null) {
  const out = [];
  const sesMap = new Map(S.sessions.map((s) => [s.id, s]));
  const seMap = new Map(S.sessionExercises.filter((x) => x.exerciseId === exId).map((x) => [x.id, x]));
  for (const st of S.sets) {
    if (!st.isDone) continue;
    const se = seMap.get(st.sessionExerciseId); if (!se) continue;
    const s = sesMap.get(se.sessionId); if (!s || s.endedAt == null || s.id === excludeSessionId) continue;
    out.push({ ...st, startedAt: s.startedAt, sessionId: s.id, title: s.title, excluded: !!s.excludeFromTrends });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt || a.setIndex - b.setIndex);
}
/** Done sets from the most recent finished session with this exercise. */
export function previousSets(exId, excludeSessionId) {
  const h = historyFor(exId, excludeSessionId);
  if (!h.length) return [];
  const last = h[h.length - 1].sessionId;
  return h.filter((x) => x.sessionId === last).sort((a, b) => a.setIndex - b.setIndex);
}

// ------------------------------------------------------------ supersets
// Members of a superset share the same non-null `supersetId` and are always consecutive in a list.
export const SS_COLORS = ['#5B8CFF', '#3DDC97', '#B57BFF', '#FF6FAE', '#2FD1E0', '#FFB020'];
export const SS_LETTERS = 'ABCDEFGHIJ';
/** Fix a sorted list in place: split non-consecutive runs, drop single-member groups. */
export function normalizeSupersets(list) {
  const seen = new Set();
  let i = 0;
  while (i < list.length) {
    const g = list[i].supersetId ?? null;
    let j = i; while (j + 1 < list.length && g != null && (list[j + 1].supersetId ?? null) === g) j++;
    if (g != null) {
      if (j === i) list[i].supersetId = null;
      else if (seen.has(g)) { const n = id(); for (let k = i; k <= j; k++) list[k].supersetId = n; seen.add(n); }
      else seen.add(g);
    } else list[i].supersetId = null;
    i = j + 1;
  }
  return list;
}
/** Blocks for a sorted list: [{gid, items}] — single exercises are blocks of one. */
export function blocksOf(list) {
  const out = [];
  for (const x of list) {
    const last = out[out.length - 1];
    if (x.supersetId != null && last && last.gid === x.supersetId) last.items.push(x);
    else out.push({ gid: x.supersetId ?? null, items: [x] });
  }
  return out;
}
/** id -> {letter, n, size, color, first, last} for grouped items in a sorted list. */
export function supersetLabels(list) {
  const m = new Map(); let gi = 0;
  for (const b of blocksOf(list)) {
    if (b.gid == null || b.items.length < 2) continue;
    const letter = SS_LETTERS[gi % SS_LETTERS.length], color = SS_COLORS[gi % SS_COLORS.length]; gi++;
    b.items.forEach((x, k) => m.set(x.id, { letter, n: k + 1, size: b.items.length, color, first: k === 0, last: k === b.items.length - 1, gid: b.gid }));
  }
  return m;
}
function linkWithNext(list, idx) {
  const a = list[idx], b = list[idx + 1]; if (!a || !b) return false;
  const gid = a.supersetId ?? b.supersetId ?? id();
  const old = b.supersetId;
  if (old != null && old !== gid) list.forEach((x) => { if (x.supersetId === old) x.supersetId = gid; });
  a.supersetId = gid; b.supersetId = gid;
  // one rest for the whole group: use the rest of its last member
  const mem = list.filter((x) => x.supersetId === gid);
  const rest = mem[mem.length - 1].restSec; mem.forEach((x) => (x.restSec = rest));
  normalizeSupersets(list); return true;
}
function unlinkItem(list, idx) { const a = list[idx]; if (!a) return; a.supersetId = null; normalizeSupersets(list); }
/** Move an item; inside a group it swaps with its neighbour, otherwise whole blocks move so groups stay together. */
function moveInList(list, item, delta) {
  const i = list.indexOf(item); if (i < 0) return false;
  const nb = list[i + delta];
  if (item.supersetId != null && nb && nb.supersetId === item.supersetId) { list[i] = nb; list[i + delta] = item; }
  else {
    const blocks = blocksOf(list);
    const bi = blocks.findIndex((b) => b.items.includes(item));
    const bj = bi + delta; if (bj < 0 || bj >= blocks.length) return false;
    [blocks[bi], blocks[bj]] = [blocks[bj], blocks[bi]];
    list.length = 0; blocks.forEach((b) => list.push(...b.items));
  }
  list.forEach((x, k) => (x.position = k));
  return true;
}
export function dayLink(deId) { const d = byId(S.dayExercises, deId); if (!d) return; const l = dayExercisesOf(d.dayId); linkWithNext(l, l.indexOf(d)); save(); }
export function dayUnlink(deId) { const d = byId(S.dayExercises, deId); if (!d) return; const l = dayExercisesOf(d.dayId); unlinkItem(l, l.indexOf(d)); save(); }
export function sessionLink(seId) { const x = byId(S.sessionExercises, seId); if (!x) return; const l = sessionExercisesOf(x.sessionId); linkWithNext(l, l.indexOf(x)); save(); }
export function sessionUnlink(seId) { const x = byId(S.sessionExercises, seId); if (!x) return; const l = sessionExercisesOf(x.sessionId); unlinkItem(l, l.indexOf(x)); save(); }
export const newGroupId = () => id();
/** Other members of a session exercise's superset. */
export function partnersOf(seId) {
  const se = byId(S.sessionExercises, seId); if (!se || se.supersetId == null) return [];
  return sessionExercisesOf(se.sessionId).filter((x) => x.supersetId === se.supersetId && x.id !== se.id);
}
/** Rest after a set: inside a superset it's the group's rest (its last member's). */
export function groupRest(list, item) {
  if (item.supersetId == null) return item.restSec;
  const mem = list.filter((x) => x.supersetId === item.supersetId);
  return mem[mem.length - 1].restSec;
}

// ------------------------------------------------------------ programs
export function createProgram(name) {
  const hasActive = !!activeProgram();
  const p = { id: id(), name: normalizeName(name) || 'برنامهٔ من', isActive: !hasActive, createdAt: Date.now() };
  S.programs.push(p);
  S.days.push({ id: id(), programId: p.id, position: 0, name: '' });
  save(); return p.id;
}
export function renameProgram(pid, name) { const p = program(pid); if (p && normalizeName(name)) p.name = normalizeName(name); save(); }
export function setActiveProgram(pid) { S.programs.forEach((p) => (p.isActive = p.id === pid)); save(); }
export function deleteProgram(pid) {
  const p = program(pid); if (!p) return;
  const dayIds = new Set(daysOf(pid).map((d) => d.id));
  S.dayExercises = S.dayExercises.filter((x) => !dayIds.has(x.dayId));
  S.days = S.days.filter((d) => d.programId !== pid);
  S.programs = S.programs.filter((x) => x.id !== pid);
  if (p.isActive && S.programs.length) S.programs.sort((a, b) => a.createdAt - b.createdAt)[0].isActive = true;
  save();
}
// ------------------------------------------------------------ days
export function addDay(pid) { const n = daysOf(pid).length; const d = { id: id(), programId: pid, position: n, name: '' }; S.days.push(d); save(); return d.id; }
export function renameDay(did, name) { const d = day(did); if (d) d.name = normalizeName(name); save(); }
function reindexDays(pid) { daysOf(pid).forEach((d, i) => (d.position = i)); }
export function duplicateDay(did) {
  const d = day(did); if (!d) return;
  daysOf(d.programId).filter((x) => x.position > d.position).forEach((x) => x.position++);
  const nd = { id: id(), programId: d.programId, position: d.position + 1, name: d.name };
  S.days.push(nd);
  dayExercisesOf(did).forEach((x) => S.dayExercises.push({ ...x, id: id(), dayId: nd.id }));
  save(); return nd.id;
}
export function moveDay(did, delta) {
  const d = day(did); if (!d) return;
  const list = daysOf(d.programId); const i = list.indexOf(d); const j = Math.max(0, Math.min(list.length - 1, i + delta));
  if (i === j) return; list.splice(i, 1); list.splice(j, 0, d); list.forEach((x, k) => (x.position = k)); save();
}
export function deleteDay(did) {
  const d = day(did); if (!d) return null;
  const snap = { day: { ...d }, exercises: dayExercisesOf(did).map((x) => ({ ...x })) };
  S.days = S.days.filter((x) => x.id !== did);
  S.dayExercises = S.dayExercises.filter((x) => x.dayId !== did);
  reindexDays(d.programId); save(); return snap;
}
export function restoreDay(snap) {
  daysOf(snap.day.programId).filter((x) => x.position >= snap.day.position).forEach((x) => x.position++);
  S.days.push(snap.day); S.dayExercises.push(...snap.exercises); save();
}
// ------------------------------------------------------------ exercises
export function exerciseIdFor(name, timed = null, perSide = null) {
  const n = normalizeName(name);
  const e = S.exercises.find((x) => x.name === n);
  if (e) { if (timed != null) e.timed = timed; if (perSide != null) e.perSide = perSide; return e.id; }
  const ne = { id: id(), name: n, note: null, archived: false, timed: !!timed, perSide: !!perSide };
  S.exercises.push(ne); return ne.id;
}
export function renameExercise(eid, name) {
  const n = normalizeName(name); if (!n) return false;
  const o = S.exercises.find((x) => x.name === n); if (o && o.id !== eid) return false;
  const e = exercise(eid); if (!e) return false; e.name = n; save(); return true;
}
export function saveDayExercise(deId, dayId, f) {
  const exId = exerciseIdFor(f.name, f.timed, f.perSide);
  const rMin = Math.max(1, Math.min(999, f.repMin)); const rMax = Math.max(rMin, f.repMax);
  const vals = { exerciseId: exId, targetSets: Math.max(1, Math.min(20, f.sets)), repMin: rMin, repMax: rMax,
    targetWeight: f.weight ?? null, restSec: f.restSec, note: (f.note || '').trim() || null };
  if (deId == null) S.dayExercises.push({ id: id(), dayId, position: dayExercisesOf(dayId).length, supersetId: null, ...vals });
  else {
    const cur = byId(S.dayExercises, deId); Object.assign(cur, vals);
    if (cur.supersetId != null) S.dayExercises.filter((x) => x.dayId === dayId && x.supersetId === cur.supersetId).forEach((x) => (x.restSec = vals.restSec));
  }
  save();
}
export function deleteDayExercise(deId) {
  const d = byId(S.dayExercises, deId); if (!d) return null;
  const groups = dayExercisesOf(d.dayId).map((x) => [x.id, x.supersetId ?? null]);
  S.dayExercises = S.dayExercises.filter((x) => x.id !== deId);
  const l = dayExercisesOf(d.dayId); l.forEach((x, i) => (x.position = i)); normalizeSupersets(l); save(); return { ...d, _groups: groups };
}
export function restoreDayExercise(d) {
  const { _groups, ...de } = d;
  dayExercisesOf(de.dayId).filter((x) => x.position >= de.position).forEach((x) => x.position++);
  S.dayExercises.push(de); restoreGroups(S.dayExercises, _groups); normalizeSupersets(dayExercisesOf(de.dayId)); save();
}
export function moveDayExercise(deId, delta) {
  const d = byId(S.dayExercises, deId); if (!d) return;
  if (moveInList(dayExercisesOf(d.dayId), d, delta)) save();
}
// ------------------------------------------------------------ workout
export function nextDayId() {
  const p = activeProgram(); if (!p) return null;
  const ds = daysOf(p.id); if (!ds.length) return null;
  const last = finishedSessions().find((s) => s.programId === p.id);
  const i = last ? ds.findIndex((d) => d.id === last.programDayId) : -1;
  return ds[i < 0 ? 0 : (i + 1) % ds.length].id;
}
export function startWorkout(dayId) {
  const open = openSession(); if (open) return open.id;
  const d = dayId != null ? day(dayId) : null;
  const s = { id: id(), programId: d?.programId ?? null, programDayId: d?.id ?? null, title: d ? dayLabel(d) : 'تمرین آزاد',
    startedAt: Date.now(), endedAt: null, note: null, excludeFromTrends: false };
  S.sessions.push(s);
  if (d) dayExercisesOf(d.id).forEach((de, idx) => {
    const se = { id: id(), sessionId: s.id, exerciseId: de.exerciseId, position: idx, repMin: de.repMin, repMax: de.repMax, restSec: de.restSec, note: de.note ?? exercise(de.exerciseId)?.note ?? null, supersetId: de.supersetId ?? null };
    S.sessionExercises.push(se);
    const prev = previousSets(de.exerciseId, s.id);
    const timed = !!exercise(de.exerciseId)?.timed;
    for (let i = 0; i < de.targetSets; i++) {
      const p = prev[i] || prev[prev.length - 1];
      S.sets.push({ id: id(), sessionExerciseId: se.id, setIndex: i, weightKg: p?.weightKg ?? de.targetWeight ?? 0,
        reps: p?.reps ?? (timed ? de.repMin : Math.max(de.repMax, de.repMin)), isDone: false, doneAt: null, isPr: false, type: 'NORMAL' });
    }
  });
  save(true); return s.id;
}
export function addExerciseToSession(sid, name, f = {}) {
  const exId = exerciseIdFor(name, f.timed ?? null, f.perSide ?? null);
  const ses = sessionExercisesOf(sid);
  const se = { id: id(), sessionId: sid, exerciseId: exId, position: ses.length ? Math.max(...ses.map((x) => x.position)) + 1 : 0,
    repMin: 0, repMax: 0, restSec: f.restSec ?? S.settings.defaultRestSec, note: exercise(exId)?.note ?? null, supersetId: null };
  S.sessionExercises.push(se);
  const prev = previousSets(exId, sid);
  const timed = !!exercise(exId)?.timed;
  const n = prev.length || f.sets || 3;
  for (let i = 0; i < n; i++) {
    const p = prev[i] || prev[prev.length - 1];
    S.sets.push({ id: id(), sessionExerciseId: se.id, setIndex: i, weightKg: p?.weightKg ?? 0, reps: p?.reps ?? (timed ? 30 : 10), isDone: false, doneAt: null, isPr: false, type: 'NORMAL' });
  }
  save(); return se.id;
}
export function removeSessionExercise(seId) {
  const se = byId(S.sessionExercises, seId); if (!se) return null;
  const snap = { se: { ...se }, sets: setsOf(seId).map((x) => ({ ...x })), groups: sessionExercisesOf(se.sessionId).map((x) => [x.id, x.supersetId ?? null]) };
  S.sessionExercises = S.sessionExercises.filter((x) => x.id !== seId);
  S.sets = S.sets.filter((x) => x.sessionExerciseId !== seId); normalizeSupersets(sessionExercisesOf(se.sessionId)); save(); return snap;
}
function restoreGroups(arr, groups) { if (!groups) return; const m = new Map(groups); arr.forEach((x) => { if (m.has(x.id)) x.supersetId = m.get(x.id); }); }
export function restoreSessionExercise(snap) { S.sessionExercises.push(snap.se); S.sets.push(...snap.sets); restoreGroups(S.sessionExercises, snap.groups); normalizeSupersets(sessionExercisesOf(snap.se.sessionId)); save(); }
export function moveSessionExercise(seId, delta) {
  const se = byId(S.sessionExercises, seId); if (!se) return;
  if (moveInList(sessionExercisesOf(se.sessionId), se, delta)) save();
}
export function setSessionExerciseNote(seId, note) {
  const se = byId(S.sessionExercises, seId); if (!se) return;
  const n = (note || '').trim() || null; se.note = n;
  const e = exercise(se.exerciseId); if (e) e.note = n; save();
}
export function addSet(seId) {
  const l = setsOf(seId); const last = l[l.length - 1];
  const s = { id: id(), sessionExerciseId: seId, setIndex: last ? last.setIndex + 1 : 0, weightKg: last?.weightKg ?? 0, reps: last?.reps ?? 10, isDone: false, doneAt: null, isPr: false, type: 'NORMAL' };
  S.sets.push(s); save(); return s.id;
}
export function deleteSet(setId) {
  const s = byId(S.sets, setId); if (!s) return null;
  S.sets = S.sets.filter((x) => x.id !== setId);
  setsOf(s.sessionExerciseId).forEach((x, i) => (x.setIndex = i));
  recomputePrs(s.sessionExerciseId); save(); return { ...s };
}
export function restoreSet(s) {
  setsOf(s.sessionExerciseId).filter((x) => x.setIndex >= s.setIndex).forEach((x) => x.setIndex++);
  S.sets.push(s); recomputePrs(s.sessionExerciseId); save();
}
export function updateSetValues(setId, w, r) {
  const s = byId(S.sets, setId); if (!s) return;
  s.weightKg = w; s.reps = r; if (s.isDone) recomputePrs(s.sessionExerciseId); save();
}
/** Toggle done; returns {nowDone, prs, restSec}. */
export function toggleSet(setId, forceDone = null) {
  const s = byId(S.sets, setId); if (!s) return null;
  const done = forceDone ?? !s.isDone;
  s.isDone = done; s.doneAt = done ? Date.now() : null; s.isPr = false;
  const prs = recomputePrs(s.sessionExerciseId)[setId] || [];
  const se = byId(S.sessionExercises, s.sessionExerciseId);
  save(); return { nowDone: done, prs: done ? prs : [], restSec: se ? groupRest(sessionExercisesOf(se.sessionId), se) : 90, set: s };
}
function recomputePrs(seId) {
  const se = byId(S.sessionExercises, seId); if (!se) return {};
  const ses = byId(S.sessions, se.sessionId); if (!ses) return {};
  const timed = !!exercise(se.exerciseId)?.timed;
  const prior = historyFor(se.exerciseId, se.sessionId).filter((h) => h.startedAt < ses.startedAt).map((h) => [h.weightKg, h.reps]);
  const had = prior.length > 0; const out = {};
  for (const s of setsOf(seId).filter((x) => x.isDone).sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0))) {
    const prs = had ? detectSetPrs(prior, s.weightKg, s.reps, timed) : [];
    s.isPr = prs.length > 0; out[s.id] = prs; prior.push([s.weightKg, s.reps]);
  }
  setsOf(seId).filter((x) => !x.isDone).forEach((x) => (x.isPr = false));
  return out;
}
export function finishWorkout(sid) {
  const ses = sessionExercisesOf(sid);
  const seIds = new Set(ses.map((x) => x.id));
  const sets = S.sets.filter((x) => seIds.has(x.sessionExerciseId));
  if (!sets.some((x) => x.isDone)) { deleteSession(sid); return false; }
  S.sets = S.sets.filter((x) => !(seIds.has(x.sessionExerciseId) && !x.isDone));
  for (const se of ses) {
    const l = setsOf(se.id);
    if (!l.length) S.sessionExercises = S.sessionExercises.filter((x) => x.id !== se.id);
    else l.forEach((x, i) => (x.setIndex = i));
  }
  normalizeSupersets(sessionExercisesOf(sid));
  byId(S.sessions, sid).endedAt = Date.now();
  S.rest = null; S.hold = null;
  save(true); return true;
}
export function deleteSession(sid) {
  const seIds = new Set(sessionExercisesOf(sid).map((x) => x.id));
  S.sets = S.sets.filter((x) => !seIds.has(x.sessionExerciseId));
  S.sessionExercises = S.sessionExercises.filter((x) => x.sessionId !== sid);
  S.sessions = S.sessions.filter((x) => x.id !== sid);
  const o = openSession(); if (!o) { S.rest = null; S.hold = null; }
  save(true);
}
export function summary(sid) {
  const s = byId(S.sessions, sid); if (!s) return null;
  const ses = sessionExercisesOf(sid);
  const labels = supersetLabels(ses);
  let vol = 0, done = 0; const prs = []; const results = [];
  for (const se of ses) {
    const ex = exercise(se.exerciseId); const timed = !!ex?.timed;
    const l = setsOf(se.id).filter((x) => x.isDone); if (!l.length) continue;
    done += l.length;
    const v = l.reduce((a, x) => a + volume(x.weightKg, x.reps, timed), 0); vol += v;
    const priorH = historyFor(se.exerciseId, sid).filter((h) => h.startedAt < s.startedAt);
    const running = priorH.map((h) => [h.weightKg, h.reps]); const found = {};
    if (running.length) {
      for (const x of [...l].sort((a, b) => (a.doneAt || 0) - (b.doneAt || 0))) {
        for (const k of detectSetPrs(running, x.weightKg, x.reps, timed)) {
          const val = k === 'E1RM' ? e1rm(x.weightKg, x.reps) : k === 'HOLD' || k === 'REPS' ? x.reps : x.weightKg;
          if (!found[k] || val >= found[k].value) found[k] = { name: ex.name, kind: k, weight: x.weightKg, reps: x.reps, value: val, timed };
        }
        running.push([x.weightKg, x.reps]);
      }
      if (!timed) {
        const bySes = {}; priorH.forEach((h) => (bySes[h.sessionId] = (bySes[h.sessionId] || 0) + volume(h.weightKg, h.reps)));
        const best = Math.max(0, ...Object.values(bySes));
        if (v > 0 && v > best + 1e-9) found.VOLUME = { name: ex.name, kind: 'VOLUME', weight: 0, reps: 0, value: v };
      }
    }
    for (const k in found) if (!(k === 'REPS' && found.MAX_WEIGHT)) prs.push(found[k]);
    const best = timed || l.every((x) => x.weightKg <= 0) ? l.reduce((a, b) => (b.reps > a.reps ? b : a)) : l.reduce((a, b) => (e1rm(b.weightKg, b.reps) > e1rm(a.weightKg, a.reps) ? b : a));
    results.push({ name: ex.name, exerciseId: ex.id, doneSets: l.length, volume: v, best: [best.weightKg, best.reps], timed, ss: labels.get(se.id) || null });
  }
  let prevVol = null;
  if (s.programDayId != null) {
    const p = finishedSessions().find((x) => x.programDayId === s.programDayId && x.id !== sid && x.startedAt < s.startedAt);
    if (p) prevVol = sessionVolume(p.id);
  }
  return { session: s, durationMs: (s.endedAt || Date.now()) - s.startedAt, volume: vol, doneSets: done, prs, exercises: results, previousVolume: prevVol };
}
export function sessionVolume(sid) {
  let v = 0;
  for (const se of sessionExercisesOf(sid)) { const t = !!exercise(se.exerciseId)?.timed; setsOf(se.id).filter((x) => x.isDone).forEach((x) => (v += volume(x.weightKg, x.reps, t))); }
  return v;
}
export function sessionDoneSets(sid) { let n = 0; for (const se of sessionExercisesOf(sid)) n += setsOf(se.id).filter((x) => x.isDone).length; return n; }

// ------------------------------------------------------------ backup (compatible with Android app format)
export function exportBackup() {
  const { programs, days, exercises, dayExercises, sessions, sessionExercises, sets, settings } = S;
  return JSON.stringify({ format: 'bashgah-backup', version: 2, exportedAt: Date.now(), programs, days, exercises, dayExercises, sessions, sessionExercises, sets, settings });
}
export function decodeBackup(text) {
  let d; try { d = JSON.parse(text); } catch { throw new Error('فایل پشتیبان معتبر نیست'); }
  if (!d || d.format !== 'bashgah-backup') throw new Error('این فایل مربوط به اپ باشگاه نیست');
  if (d.version > 3) throw new Error('این پشتیبان با نسخهٔ جدیدتر ساخته شده');
  for (const k of ['programs', 'days', 'exercises', 'dayExercises', 'sessions', 'sessionExercises', 'sets']) if (!Array.isArray(d[k])) throw new Error('فایل پشتیبان معتبر نیست');
  return d;
}
export function restoreBackup(d) {
  const keepName = S.settings.userName;
  const t = (a) => a.map((x) => ({ ...x }));
  S.programs = t(d.programs); S.days = t(d.days); S.dayExercises = d.dayExercises.map((x) => ({ supersetId: null, ...x }));
  S.exercises = d.exercises.map((x) => ({ note: null, archived: false, timed: false, perSide: false, ...x }));
  S.sessions = d.sessions.map((x) => ({ note: null, excludeFromTrends: false, ...x }));
  S.sessionExercises = d.sessionExercises.map((x) => ({ supersetId: null, ...x })); S.sets = d.sets.map((x) => ({ isPr: false, type: 'NORMAL', ...x }));
  if (d.settings) S.settings = { ...DEFAULT_SETTINGS, ...d.settings, userName: d.settings.userName || keepName };
  const all = [S.programs, S.days, S.exercises, S.dayExercises, S.sessions, S.sessionExercises, S.sets].flat();
  S.nextId = all.reduce((m, x) => Math.max(m, x.id || 0, x.supersetId || 0), 0) + 1;
  S.days.forEach((dd) => normalizeSupersets(dayExercisesOf(dd.id)));
  S.sessions.forEach((ss) => normalizeSupersets(sessionExercisesOf(ss.id)));
  if (S.programs.length && !S.programs.some((p) => p.isActive)) S.programs[0].isActive = true;
  S.rest = null; S.hold = null; S.onboarded = true;
  save(true);
}
export function csv() {
  const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
  const p2 = (x) => String(x).padStart(2, '0');
  let out = '\uFEFFdate_jalali,date_iso,time,workout,exercise,superset,set,weight_kg,reps,seconds,volume,e1rm,pr\n';
  const rows = [];
  const lab = new Map(); S.sessions.forEach((ss) => supersetLabels(sessionExercisesOf(ss.id)).forEach((v, k) => lab.set(k, v.letter + v.n)));
  for (const e of S.exercises) for (const h of historyFor(e.id)) rows.push({ h, e });
  rows.sort((a, b) => a.h.startedAt - b.h.startedAt || a.e.name.localeCompare(b.e.name) || a.h.setIndex - b.h.setIndex);
  for (const { h, e } of rows) {
    const d = new Date(h.startedAt);
    out += [jIso(h.startedAt), `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, `${p2(d.getHours())}:${p2(d.getMinutes())}`,
      q(h.title), q(e.name), lab.get(h.sessionExerciseId) || '', h.setIndex + 1, +h.weightKg.toFixed(2), e.timed ? '' : h.reps, e.timed ? h.reps : '',
      +volume(h.weightKg, h.reps, e.timed).toFixed(2), e.timed ? '' : +e1rm(h.weightKg, h.reps).toFixed(1), h.isPr ? 1 : 0].join(',') + '\n';
  }
  return out;
}

// ------------------------------------------------------------ program sharing (format in share.js)
/** A program in the neutral sharing shape: {name, days:[{name, exercises:[{name, sets, repMin, repMax, timed, perSide, restSec, weight, note, group}]}]} */
export function programSpec(pid) {
  const p = program(pid); if (!p) return null;
  return {
    name: p.name,
    days: daysOf(pid).map((d) => ({
      name: d.name || '',
      exercises: dayExercisesOf(d.id).map((x) => {
        const e = exercise(x.exerciseId) || {};
        return { name: e.name || '', sets: x.targetSets, repMin: x.repMin, repMax: x.repMax, timed: !!e.timed, perSide: !!e.perSide,
          restSec: x.restSec, weight: x.targetWeight || null, note: x.note || null, group: x.supersetId != null ? String(x.supersetId) : null };
      }),
    })),
  };
}
/** Name not used by another program: «X», «X (۲)», «X (۳)»… */
export function uniqueProgramName(name) {
  const base = normalizeName(name) || 'برنامهٔ وارد‌شده';
  const used = new Set(S.programs.map((p) => p.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) { const c = `${base} (${fa(n)})`; if (!used.has(c)) return c; }
}
/** Adds the program as a NEW program (never touches existing ones) and makes it active. Returns its id. */
export function importProgram(spec) {
  const p = { id: id(), name: uniqueProgramName(spec.name), isActive: false, createdAt: Date.now() };
  S.programs.push(p);
  const days = spec.days.length ? spec.days : [{ name: '', exercises: [] }];
  days.forEach((d, i) => {
    const day = { id: id(), programId: p.id, position: i, name: normalizeName(d.name || '') };
    S.days.push(day);
    const gids = new Map();
    let prev = null;
    d.exercises.forEach((x, k) => {
      let gid = null;
      if (x.group != null) {
        // a label only groups consecutive exercises
        if (prev && prev.group === x.group) gid = gids.get(x.group);
        else { gid = id(); gids.set(x.group, gid); }
      }
      const exId = exerciseIdFor(x.name, !!x.timed, !!x.perSide);
      S.dayExercises.push({ id: id(), dayId: day.id, exerciseId: exId, position: k, targetSets: x.sets, repMin: x.repMin, repMax: Math.max(x.repMin, x.repMax),
        targetWeight: x.weight || null, restSec: x.restSec, note: x.note || null, supersetId: gid });
      prev = x;
    });
    const l = dayExercisesOf(day.id); normalizeSupersets(l);
    for (const b of blocksOf(l)) if (b.gid != null) { const r = b.items[b.items.length - 1].restSec; b.items.forEach((y) => (y.restSec = r)); }
  });
  setActiveProgram(p.id);
  save(true);
  return p.id;
}
