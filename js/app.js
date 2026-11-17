import * as D from './store.js';
import { S } from './store.js';
import { fa, weightFa, groupedFa, clockFa, durationFa, restFa, setFa, targetFa, secFa, esc, normalizeName, parseWeight, parseReps, num,
  jFull, jShort, jMedium, jNum, timeFa, weekStart, addDays, startOfDay, WEEK_SHORT, jOf } from './util.js';
import { ic } from './icons.js';
import * as P from './share.js';

const VERSION = '1.2.0';
const $app = document.getElementById('app');
const $ov = document.getElementById('ov');
const ui = {
  tab: 'home', stack: [], homeDay: null, recTab: 'ex', recQuery: '', range: 'all', metric: 'e1rm',
  sheet: null, dialog: null, fullRest: false, toast: null, sw: { acc: 0, startAt: null }, onbName: '',
};
const st = () => S.settings;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches);
const top = () => ui.stack[ui.stack.length - 1] || null;

// ============================================================ sound / haptics / wake lock
let ac = null;
function unlockAudio() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = new AC();
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    }
    if (ac.state !== 'running') ac.resume().catch(() => {});
    const b = ac.createBuffer(1, 1, 22050); const s = ac.createBufferSource(); s.buffer = b; s.connect(ac.destination); s.start(0);
  } catch {}
}
function tone(freq, start, dur, vol = 0.35) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start); g.gain.exponentialRampToValueAtTime(vol, start + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(ac.destination); o.start(start); o.stop(start + dur + 0.02);
}
function beep(kind) {
  if (navigator.vibrate && st().vibrate) {
    try { navigator.vibrate(kind === 'end' ? [300, 150, 300] : kind === 'pr' ? [60, 60, 60, 60, 120] : 60); } catch {}
  }
  if (!st().sound || !ac) return;
  try {
    if (ac.state !== 'running') ac.resume().catch(() => {});
    const t = ac.currentTime + 0.02;
    if (kind === 'end') { tone(880, t, 0.18); tone(880, t + 0.25, 0.18); tone(1320, t + 0.5, 0.35); }
    else if (kind === 'warn') tone(660, t, 0.12, 0.25);
    else if (kind === 'go') tone(1320, t, 0.3);
    else if (kind === 'count') tone(660, t, 0.1, 0.25);
    else if (kind === 'pr') { tone(784, t, 0.12); tone(988, t + 0.12, 0.12); tone(1319, t + 0.24, 0.3); }
  } catch {}
}
const hapticLabel = (() => { const l = document.createElement('label'); l.setAttribute('aria-hidden', 'true'); l.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden'; l.innerHTML = '<input type="checkbox" switch>'; document.body.appendChild(l); return l; })();
function haptic() {
  if (navigator.vibrate) { try { if (st().vibrate) navigator.vibrate(12); } catch {} return; }
  try { hapticLabel.click(); } catch {}
}
let wakeLock = null;
async function updateWakeLock() {
  const want = st().keepScreenOn && !!D.openSession() && document.visibilityState === 'visible' && top()?.v === 'workout';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); }
    else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

// ============================================================ navigation (in-app stack; iOS standalone has no back gesture)
function push(v) { clearToast(); ui.stack.push(v); render(true); }
function clearToast() { if (ui.toast) { ui.toast = null; undoFn = null; renderToast(); } }
function pop() { if (ui.stack.length) { ui.stack.pop(); render(true); } }
const goBack = pop;
function resetTo(tab) { ui.stack = []; ui.tab = tab; render(true); }

// ============================================================ helpers
const MOTTOS = {
  morning: ['صبحت پرانرژی! بهترین شروعِ روز همینه ☀️', 'صبح‌ها قهرمان‌ها زودتر بیدار می‌شن.'],
  evening: ['بعد از یه روز طولانی، وقتِ تخلیهٔ انرژیه ⚡', 'خستگی رو پشت در باشگاه جا بذار.'],
  night: ['حتی شب‌ها هم کوتاه نمیای؛ این یعنی اراده 🌙', 'تمرینِ آخرِ شب، خوابِ عمیقِ قهرمان‌ها.'],
  any: ['امروز قوی‌تر از دیروز می‌شی 💪', 'از آینه نپرس، از دفترچهٔ رکوردهات بپرس.', 'انرژیت رو بذار روی هالتر، نه روی بهانه.', 'بدنت هر کاری رو که ذهنت باور کنه انجام می‌ده.',
    'ثبات، رازِ همهٔ پیشرفت‌هاست. فقط بیا و تمرین کن.', 'دردِ امروز، قدرتِ فرداست.', 'رکوردها منتظرن شکسته بشن 🔥', 'سنگین بزن، درست بزن، با افتخار برگرد خونه.',
    'نتیجه دیر میاد، ولی حتماً میاد.', 'هر ست، یک قدم به نسخهٔ بهتر خودت.', 'یک تکرار دیگه؛ همیشه یک تکرار دیگه.', 'تو برای این لحظه آماده‌ای. شروع کن!'],
};
function motto() {
  const h = new Date().getHours();
  const pool = [...MOTTOS.any, ...(h >= 5 && h < 11 ? MOTTOS.morning : h >= 17 && h < 22 ? MOTTOS.evening : h >= 22 || h < 5 ? MOTTOS.night : [])];
  const seed = Math.floor(startOfDay(Date.now()) / 864e5);
  return pool[seed % pool.length];
}
const exName = (eid) => D.exercise(eid)?.name || '';
const isTimed = (eid) => !!D.exercise(eid)?.timed;
function dayStats(did) {
  const des = D.dayExercisesOf(did);
  const sets = des.reduce((a, x) => a + x.targetSets, 0);
  const sec = des.reduce((a, x) => a + x.targetSets * ((isTimed(x.exerciseId) ? x.repMax : 40) + x.restSec), 0);
  return { n: des.length, sets, min: Math.max(1, Math.round(sec / 60)) };
}
function bestOf(rows, timed) {
  if (!rows.length) return null;
  if (timed || rows.every((r) => r.weightKg <= 0)) return rows.reduce((a, b) => (b.reps > a.reps ? b : a));
  return rows.reduce((a, b) => (D.e1rm(b.weightKg, b.reps) > D.e1rm(a.weightKg, a.reps) ? b : a));
}
const sessionDays = () => D.finishedSessions().map((s) => startOfDay(s.startedAt));
function weekStreak() {
  const weeks = new Set(D.finishedSessions().map((s) => weekStart(s.startedAt)));
  let w = weekStart(Date.now()); if (!weeks.has(w)) w = weekStart(addDays(w, -1));
  let n = 0; while (weeks.has(w)) { n++; w = weekStart(addDays(w, -1)); } return n;
}
let undoFn = null;
function toast(msg, undo = false) {
  clearTimeout(ui.toastT);
  ui.toast = { msg, undo };
  ui.toastT = setTimeout(() => { ui.toast = null; undoFn = null; renderToast(); }, undo ? 5000 : 2200);
  renderToast();
}
function withUndo(msg, fn) { undoFn = fn; toast(msg, true); }
function renderToast() {
  let el = document.getElementById('toast');
  if (!ui.toast) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.innerHTML = `<span class="grow">${esc(ui.toast.msg)}</span>${ui.toast.undo ? '<button data-a="undo">بازگردانی</button>' : ''}`;
}
function prToast(html) {
  clearTimeout(ui.prT);
  let el = document.getElementById('prtoast');
  if (!el) { el = document.createElement('div'); el.id = 'prtoast'; el.className = 'prtoast'; document.body.appendChild(el); }
  el.innerHTML = `${ic('trophy', 26)}<span class="grow">${html}</span>`;
  ui.prT = setTimeout(() => el.remove(), 3200);
}

// ============================================================ render
let lastKey = null;
function render(navChanged = false) {
  syncHistory();
  if (!S.onboarded) { $app.className = ''; $app.innerHTML = viewOnboarding(); renderRestBar(); renderOverlay(); return; }
  const t = top();
  let view;
  if (!t) view = ui.tab === 'home' ? viewHome() : ui.tab === 'program' ? viewProgram() : ui.tab === 'records' ? viewRecords() : viewSettings();
  else view = { day: viewDay, workout: viewWorkout, exercise: viewExercise, session: viewSession, summary: viewSummary }[t.v](t);
  if (!view) { ui.stack.pop(); render(true); return; }
  const key = t ? t.v + ':' + (t.id ?? '') : 'tab:' + ui.tab;
  const old = document.getElementById('sc');
  const scrollTop = old && key === lastKey && !navChanged ? old.scrollTop : 0;
  const nav = !t;
  $app.className = nav ? 'with-nav' : '';
  document.body.classList.toggle('resting', !!S.rest);
  $app.innerHTML = (view.header || '') + `<div class="scroll ${view.fab ? 'has-bottom' : ''}" id="sc">${view.html}</div>` + (view.fab || '') + (nav ? navBar() : '');
  const sc = document.getElementById('sc'); if (sc) sc.scrollTop = scrollTop;
  lastKey = key;
  renderRestBar();
  renderOverlay();
  updateWakeLock();
}
function navBar() {
  const items = [['home', 'home', 'خانه'], ['program', 'program', 'برنامه'], ['records', 'trophy', 'رکوردها'], ['settings', 'gear', 'تنظیمات']];
  return `<nav class="nav">${items.map(([k, i, l]) => `<button data-a="tab" data-k="${k}" class="${ui.tab === k ? 'on' : ''}"><span class="pill">${ic(i, 24)}</span>${l}</button>`).join('')}</nav>`;
}
const timerBtn = () => `<button class="iconbtn fill" data-a="timerSheet" aria-label="تایمر">${ic('timer')}</button>`;
const backBtn = () => `<button class="iconbtn" data-a="back" aria-label="بازگشت">${ic('back')}</button>`;

// ------------------------------------------------------------ onboarding
function viewOnboarding() {
  return `<div class="scroll"><div class="onb">
    <img src="icons/icon-512.png" alt="">
    <h1>اسمت چیه؟</h1>
    <input id="onbName" class="field" maxlength="24" autocomplete="given-name" enterkeyhint="done" value="${esc(ui.onbName)}" placeholder="نام">
    <button class="btn" data-a="onbDone">شروع</button>
    <button class="btn ghost" data-a="importJson">${ic('history', 20)} بازیابی از پشتیبان</button>
    ${isIOS && !isStandalone ? `<div class="card onbhint"><div class="row" style="gap:10px"><span class="badge sm">${ic('share', 18)}</span><span class="grow small">اول نصبش کن: <span style="display:inline-block;vertical-align:middle">${ic('share', 15, 'acc')}</span> ← <bdi>Add to Home Screen</bdi></span></div><div class="muted small" style="margin-top:6px">اطلاعات سافاری به اپ نصب‌شده منتقل نمی‌شه.</div></div>` : ''}
    <input type="file" id="fileIn" accept=".json,application/json" class="hidden">
  </div></div>`;
}

// ------------------------------------------------------------ home
function viewHome() {
  const name = st().userName;
  const open = D.openSession();
  const p = D.activeProgram();
  const days = p ? D.daysOf(p.id) : [];
  let h = `<div class="top greet"><h1 class="ell">سلام ${esc(name)} 👋</h1>${timerBtn()}</div><div class="motto">${motto()}</div>`;
  if (isIOS && !isStandalone && !S.hintClosed) h += `<div class="card row" style="gap:12px;border-color:#3a2a22"><span class="badge sm">${ic('share', 18)}</span><span class="grow small">نصب: <span style="display:inline-block;vertical-align:middle">${ic('share', 16, 'acc')}</span> ← <bdi>Add to Home Screen</bdi></span><button class="chip acc sm" data-a="exportJson">انتقال</button><button class="iconbtn" data-a="closeHint" aria-label="بستن">${ic('x', 20)}</button></div>`;
  if (open) {
    const done = D.sessionDoneSets(open.id);
    h += `<div class="card hero"><span class="chip acc sm">${ic('flame', 14)} در جریان</span>
      <div class="t1" style="margin-top:10px">${esc(open.title)}</div><div class="muted small"><span data-tick="elapsed">${clockFa((Date.now() - open.startedAt) / 1000)}</span> · ${fa(done)} ست</div>
      <button class="btn" style="margin-top:16px" data-a="resume">${ic('play', 20)} ادامهٔ تمرین</button></div>`;
  }
  const hasAny = days.some((d) => D.dayExercisesOf(d.id).length);
  if (!open && (!days.length || !hasAny)) {
    const d0 = days[0];
    h += `<div class="card hero"><div class="empty" style="padding:20px 0 4px"><div class="ebig">${ic('dumbbell', 40)}</div><h3>برنامه‌ات رو بساز</h3>
      <button class="btn" data-a="${!p ? 'newProgram' : d0 ? 'openDay' : 'addDayHome'}" data-id="${d0?.id ?? ''}">${ic('plus', 22)} ${p ? 'افزودن حرکت' : 'ساخت برنامه'}</button></div></div>`;
  } else if (!open) {
    const nextId = D.nextDayId();
    const selId = days.some((d) => d.id === ui.homeDay) ? ui.homeDay : nextId;
    const d = D.day(selId);
    const des = D.dayExercisesOf(d.id);
    const hl = D.supersetLabels(des);
    const s = dayStats(d.id);
    h += `<div class="card hero"><div class="row sb" style="align-items:flex-start"><div class="col grow"><div class="big">روز ${fa(d.position + 1)}</div>${d.name ? `<div class="t1 muted">${esc(d.name)}</div>` : ''}</div>
      ${d.id === nextId ? `<span class="chip acc">${ic('flame', 16)} امروز</span>` : ''}</div>`;
    if (des.length) {
      h += `<div class="chips" style="margin-top:14px"><span class="chip">${ic('dumbbell', 16)} ${fa(s.n)} حرکت</span><span class="chip">${ic('check', 16)} ${fa(s.sets)} ست</span><span class="chip">${ic('clock', 16)} ~${fa(s.min)} دقیقه</span></div>
      <ul class="exlist">${des.slice(0, 5).map((x) => `<li><span class="ell">${ssTag(hl.get(x.id), 'xs')}${esc(exName(x.exerciseId))}</span><span class="muted small">${fa(x.targetSets)} × ${targetFa(x.repMin, x.repMax, isTimed(x.exerciseId))}</span></li>`).join('')}
      ${des.length > 5 ? `<li class="dim small">+${fa(des.length - 5)}</li>` : ''}</ul>
      <button class="btn" data-a="start" data-id="${d.id}">${ic('play', 20)} شروع تمرین</button>`;
    } else {
      h += `<div style="margin-top:18px"><button class="btn sec" data-a="openDay" data-id="${d.id}">${ic('plus', 22)} افزودن حرکت</button></div>`;
    }
    h += `</div>`;
    if (days.length > 1) {
      h += `<div class="hscroll">${days.map((x) => `<button class="daychip ${x.id === selId ? 'on' : ''}" data-a="homeDay" data-id="${x.id}"><b>${fa(x.position + 1)}</b>${x.name ? `<span class="ell">${esc(x.name)}</span>` : ''}${x.id === nextId ? '<span class="dot"></span>' : ''}</button>`).join('')}</div>`;
    }
  }
  const ws = weekStart(Date.now()); const today = startOfDay(Date.now());
  const sd = new Set(sessionDays());
  const weekCount = D.finishedSessions().filter((s) => s.startedAt >= ws).length;
  h += `<div class="card"><div class="row sb"><div class="row">${ic('calendar', 22, 'muted')}<span class="t2">این هفته</span></div><span class="acc t2">${fa(weekCount)} جلسه</span></div><div class="week">`;
  for (let i = 0; i < 7; i++) {
    const dms = addDays(ws, i); const j = jOf(dms);
    const cls = sd.has(dms) ? 'done' : dms === today ? 'today' : '';
    h += `<div class="wd ${cls}"><div class="c">${sd.has(dms) ? ic('check', 20) : fa(j.d)}</div>${WEEK_SHORT[i]}</div>`;
  }
  h += `</div>`;
  const sk = weekStreak();
  if (sk >= 1) h += `<div class="streak">${ic('flame', 20)} ${fa(sk)} هفتهٔ پیاپی</div>`;
  h += `</div>`;
  if (!open) h += `<button class="btn ghost" data-a="freeWorkout">${ic('plus', 20)} تمرین آزاد</button>`;
  return { html: h };
}

// ------------------------------------------------------------ program tab
function viewProgram() {
  const p = D.activeProgram();
  let h = `<div class="top"><h1 class="ell">${p ? esc(p.name) : 'برنامه'}</h1>${p ? `<button class="iconbtn fill" data-a="programMenu" aria-label="گزینه‌ها">${ic('more')}</button>` : ''}</div>`;
  if (S.programs.length > 1) h += `<div class="hscroll">${S.programs.map((x) => `<button class="chip ${x.isActive ? 'sel' : ''}" data-a="activateProgram" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>`;
  if (!p) {
    h += `<div class="empty"><div class="ebig">${ic('program', 40)}</div><h3>برنامه‌ای نداری</h3><button class="btn" data-a="newProgram">${ic('plus', 22)} ساخت برنامه</button><button class="btn ghost" style="margin-top:10px" data-a="importOpen">${ic('upload', 20)} وارد کردن برنامه</button></div>`;
    return { html: h };
  }
  for (const d of D.daysOf(p.id)) {
    const s = dayStats(d.id);
    h += `<div class="item" data-a="openDay" data-id="${d.id}"><div class="badge">${fa(d.position + 1)}</div>
      <div class="grow"><div class="t2 ell">${d.name ? esc(d.name) : `روز ${fa(d.position + 1)}`}</div><div class="muted small">${s.n ? `${fa(s.n)} حرکت · ${fa(s.sets)} ست` : 'خالی'}</div></div>
      <button class="iconbtn" data-a="dayMenu" data-id="${d.id}" aria-label="گزینه‌ها">${ic('more')}</button></div>`;
  }
  h += `<button class="btn sec" data-a="addDay" style="margin-top:6px">${ic('plus', 22)} افزودن روز</button>`;
  h += `<div class="row" style="gap:10px;margin-top:12px"><button class="btn ghost grow" data-a="shareProgram" data-id="${p.id}">${ic('share', 20)} اشتراک‌گذاری</button><button class="btn ghost grow" data-a="importOpen">${ic('upload', 20)} وارد کردن</button></div>`;
  return { html: h };
}

// ------------------------------------------------------------ day editor
function ssTag(ss, size = '') { return ss ? `<span class="sstag ${size}" style="--ss:${ss.color}">${ss.letter}${fa(ss.n)}</span>` : ''; }
function ssHeader(ss, rest) {
  return `<div class="sshd"><span class="ssname">${ic('link', 15)} سوپرست ${ss.letter}</span><span class="chip sm">${ic('hourglass', 13)} ${restFa(rest)}</span></div>`;
}
function viewDay(t) {
  const d = D.day(t.id); if (!d) return null;
  const des = D.dayExercisesOf(d.id);
  const labels = D.supersetLabels(des);
  let h = `<div class="top">${backBtn()}<div class="grow"><h2>روز ${fa(d.position + 1)}</h2>${d.name ? `<div class="sub ell">${esc(d.name)}</div>` : ''}</div><button class="iconbtn" data-a="renameDay" data-id="${d.id}" aria-label="تغییر نام">${ic('edit')}</button></div>`;
  if (!des.length) h += `<div class="empty"><div class="ebig">${ic('dumbbell', 40)}</div><h3>بدون حرکت</h3></div>`;
  const item = (x, i) => {
    const e = D.exercise(x.exerciseId); const timed = !!e?.timed; const ss = labels.get(x.id);
    return `<div class="item" data-a="editDe" data-id="${x.id}" style="align-items:flex-start">${ss ? `<div class="badge sm ssb" style="--ss:${ss.color}">${ss.letter}${fa(ss.n)}</div>` : `<div class="badge sm">${fa(i + 1)}</div>`}
      <div class="grow"><div class="t2">${esc(e?.name)}</div><div class="chips" style="margin-top:8px">
      <span class="chip acc sm">${timed ? ic('timer', 13) : ''}${fa(x.targetSets)} × ${targetFa(x.repMin, x.repMax, timed)}</span>
      ${ss ? '' : `<span class="chip sm">${ic('hourglass', 13)} ${restFa(x.restSec)}</span>`}
      ${x.targetWeight ? `<span class="chip sm">${weightFa(x.targetWeight)} کیلو</span>` : ''}
      ${e?.perSide ? '<span class="chip sm">هر سمت</span>' : ''}</div>
      ${x.note ? `<div class="muted small" style="margin-top:6px">${esc(x.note)}</div>` : ''}</div>
      <button class="iconbtn" data-a="deMenu" data-id="${x.id}" aria-label="گزینه‌ها">${ic('more')}</button></div>`;
  };
  // connector between two neighbours: tap to link / unlink
  const lnk = (a, b) => {
    const on = a.supersetId != null && a.supersetId === b.supersetId; const ss = labels.get(a.id);
    return `<div class="lnkrow"><button class="lnk ${on ? 'on' : ''}" ${on ? `style="--ss:${ss.color}"` : ''} data-a="ssToggle" data-id="${a.id}" aria-label="${on ? 'جدا کردن' : 'سوپرست'}">${ic('link', 16)}</button></div>`;
  };
  const blocks = D.blocksOf(des);
  blocks.forEach((bk, k) => {
    const ss = labels.get(bk.items[0].id);
    if (ss) {
      h += `<div class="ssg" style="--ss:${ss.color}">${ssHeader(ss, D.groupRest(des, bk.items[0]))}`;
      bk.items.forEach((x, j) => { h += item(x, des.indexOf(x)); if (j < bk.items.length - 1) h += lnk(x, bk.items[j + 1]); });
      h += `</div>`;
    } else h += item(bk.items[0], des.indexOf(bk.items[0]));
    const nb = blocks[k + 1];
    if (nb) h += lnk(bk.items[bk.items.length - 1], nb.items[0]);
  });
  return { html: h, fab: `<button class="btn fab" data-a="addDe" data-id="${d.id}">${ic('plus', 22)} افزودن حرکت</button>` };
}

// ------------------------------------------------------------ workout
/** Exercises + the order sets should be done in: straight sets, supersets alternate round by round (A1,B1,A2,B2…). */
function workoutModel(s) {
  const ses = D.sessionExercisesOf(s.id);
  const labels = D.supersetLabels(ses);
  const blocks = ses.map((se) => {
    const e = D.exercise(se.exerciseId);
    return { se, e, timed: !!e?.timed, sets: D.setsOf(se.id), prev: D.previousSets(se.exerciseId, s.id), ss: labels.get(se.id) || null };
  });
  const seq = [];
  for (const g of D.blocksOf(ses)) {
    const bis = g.items.map((se) => ses.indexOf(se));
    if (bis.length < 2) { blocks[bis[0]].sets.forEach((x, r) => seq.push({ x, bi: bis[0], r, m: 0, gid: null })); continue; }
    const max = Math.max(...bis.map((i) => blocks[i].sets.length));
    for (let r = 0; r < max; r++) bis.forEach((bi, m) => { const x = blocks[bi].sets[r]; if (x) seq.push({ x, bi, r, m, gid: g.gid }); });
  }
  let total = 0, done = 0; blocks.forEach((b) => { total += b.sets.length; done += b.sets.filter((x) => x.isDone).length; });
  return { ses, blocks, seq, total, done };
}
function nextInfo(m) {
  const q = m.seq.find((y) => !y.x.isDone); if (!q) return '';
  const b = m.blocks[q.bi];
  return `بعدی: ${b.ss ? b.ss.letter + fa(b.ss.n) + ' ' : ''}${b.e.name}، ${setFa(q.x.weightKg, q.x.reps, b.timed)}`;
}
function holdText() {
  const hd = S.hold; if (!hd) return '';
  const now = Date.now();
  if (now < hd.startAt) return fa(Math.ceil((hd.startAt - now) / 1000));
  return clockFa(Math.max(0, hd.targetSec - Math.floor((now - hd.startAt) / 1000)));
}
function viewWorkout() {
  const s = D.openSession(); if (!s) return null;
  const m = workoutModel(s);
  const pct = m.total ? m.done / m.total : 0;
  const C = 2 * Math.PI * 22;
  const header = `<div class="wtop">${backBtn()}<div class="ring"><svg width="52" height="52"><circle cx="26" cy="26" r="22" stroke="#232938" stroke-width="5" fill="none"/><circle cx="26" cy="26" r="22" stroke="#FF6B2C" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg><span>${fa(m.done)}/${fa(m.total)}</span></div>
    <div class="grow"><div class="t2 ell">${esc(s.title)}</div><div class="acc small" style="font-weight:700" data-tick="elapsed">${clockFa((Date.now() - s.startedAt) / 1000)}</div></div>
    ${timerBtn()}<button class="iconbtn" data-a="workoutMenu" aria-label="گزینه‌ها">${ic('more')}</button></div>`;
  const curId = m.seq.find((q) => !q.x.isDone)?.x.id;
  const card = (b, bi) => {
    const doneN = b.sets.filter((x) => x.isDone).length; const all = b.sets.length && doneN === b.sets.length;
    let c = `<div class="exc ${all ? 'alldone' : ''} ${b.ss ? 'inss' : ''}" id="exc-${bi}"><div class="hd">${ssTag(b.ss)}<div class="grow"><div class="nm">${esc(b.e.name)}</div>
      <div class="meta"><span>${fa(doneN)}/${fa(b.sets.length)}</span>${b.se.repMax ? `${ic('target', 14, 'acc')}<span>${targetFa(b.se.repMin, b.se.repMax, b.timed)}</span>` : ''}${b.e.perSide ? '<span class="chip sm acc">هر سمت</span>' : ''}</div></div>
      <button class="iconbtn" data-a="seMenu" data-id="${b.se.id}" aria-label="گزینه‌ها">${ic('more')}</button></div>
      ${b.se.note ? `<div class="note">${esc(b.se.note)}</div>` : ''}
      <div class="sh"><span>ست</span><span>قبلی</span><span>کیلو</span><span>${b.timed ? 'ثانیه' : 'تکرار'}</span><span></span></div>`;
    b.sets.forEach((x, i) => {
      const p = b.prev[i];
      if (S.hold && S.hold.setId === x.id) {
        c += `<div class="sr hold" id="set-${x.id}"><div class="ix">${fa(i + 1)}</div><div class="htime" data-tick="hold">${holdText()}</div><button class="tick" data-a="holdStop" data-id="${x.id}" aria-label="توقف">${ic('stop', 26)}</button></div>`;
        return;
      }
      const cls = x.isDone ? (x.isPr ? 'done pr' : 'done') : x.id === curId ? 'cur' : '';
      const tickBtn = b.timed && !x.isDone
        ? `<button class="tick play" data-a="holdStart" data-id="${x.id}" aria-label="شروع">${ic('play', 26)}</button>`
        : `<button class="tick" data-a="tick" data-id="${x.id}" aria-label="ثبت">${x.isPr ? ic('trophy', 26) : ic('check', 28)}</button>`;
      c += `<div class="sr ${cls}" id="set-${x.id}"><button class="ix" data-a="setMenu" data-id="${x.id}">${x.isPr ? ic('trophy', 18) : fa(i + 1)}</button>
        <button class="prev" data-a="copyPrev" data-id="${x.id}" data-i="${i}">${p ? setFa(p.weightKg, p.reps, b.timed, true) : '–'}</button>
        <button class="val ${x.weightKg > 0 ? '' : 'ph'}" data-a="editSet" data-id="${x.id}">${x.weightKg > 0 ? weightFa(x.weightKg) : '–'}</button>
        <button class="val" data-a="editSet" data-id="${x.id}">${b.timed ? secFa(x.reps) : fa(x.reps)}</button>
        ${tickBtn}</div>`;
    });
    return c + `<button class="addset" data-a="addSet" data-id="${b.se.id}">${ic('plus', 20)} ست</button></div>`;
  };
  let h = '';
  for (const g of D.blocksOf(m.ses)) {
    const bis = g.items.map((se) => m.ses.indexOf(se));
    const ss = m.blocks[bis[0]].ss;
    if (ss) h += `<div class="ssg" style="--ss:${ss.color}">${ssHeader(ss, D.groupRest(m.ses, g.items[0]))}${bis.map((bi) => card(m.blocks[bi], bi)).join('')}</div>`;
    else h += card(m.blocks[bis[0]], bis[0]);
  }
  if (!m.blocks.length) h += `<div class="empty"><div class="ebig">${ic('dumbbell', 40)}</div><h3>بدون حرکت</h3></div>`;
  h += `<button class="btn sec" data-a="addSe">${ic('plus', 22)} افزودن حرکت</button>`;
  return { header, html: h, fab: `<button class="btn fab" data-a="finish">${ic('flag', 20)} پایان تمرین</button>` };
}

// ------------------------------------------------------------ summary
function viewSummary(t) {
  const sm = D.summary(t.id); if (!sm) return null;
  const s = sm.session;
  let h = `<div style="text-align:center;padding-top:10px"><div style="width:96px;height:96px;border-radius:48px;background:var(--grad);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#fff;box-shadow:0 10px 30px rgba(255,107,44,.35)">${ic('flame', 48)}</div>
    <div class="big" style="font-size:28px">عالی بود ${esc(st().userName)}!</div><div class="muted small" style="margin:6px 0 18px">${esc(s.title)} · ${jFull(s.startedAt)}</div></div>
    <div class="grid2">
    <div class="stat"><div class="badge sm">${ic('clock', 18)}</div><div class="v">${durationFa(sm.durationMs)}</div><div class="k">مدت</div></div>
    <div class="stat"><div class="badge sm blue">${ic('dumbbell', 18)}</div><div class="v">${groupedFa(sm.volume)}</div><div class="k">حجم (کیلو)</div></div>
    <div class="stat"><div class="badge sm green">${ic('layers', 18)}</div><div class="v">${fa(sm.doneSets)}</div><div class="k">ست</div></div>
    <div class="stat"><div class="badge sm gold">${ic('trophy', 18)}</div><div class="v ${sm.prs.length ? 'gold' : ''}">${fa(sm.prs.length)}</div><div class="k">رکورد</div></div></div>`;
  if (sm.previousVolume && sm.volume > 0) {
    const pc = ((sm.volume - sm.previousVolume) / sm.previousVolume) * 100;
    h += `<div class="card row sb"><span class="muted">نسبت به دفعهٔ قبل</span><span class="pct ${pc >= 0 ? 'up' : 'dn'}">${pc >= 0 ? '▲' : '▼'} ${fa(num(Math.abs(pc), 1))}٪</span></div>`;
  }
  if (sm.prs.length) {
    h += `<div class="section-t gold">رکوردها 🏆</div>`;
    sm.prs.forEach((p) => {
      const val = p.kind === 'VOLUME' ? `${groupedFa(p.value)} کیلو` : p.kind === 'E1RM' ? `${weightFa(Math.round(p.value * 10) / 10)} کیلو` : setFa(p.weight, p.reps, p.timed);
      h += `<div class="item" style="min-height:60px"><div class="badge sm gold">${ic('trophy', 18)}</div><div class="grow"><div class="t2 ell">${esc(p.name)}</div><div class="small gold">${D.PR_LABEL[p.kind]}</div></div><div class="t2 gold">${val}</div></div>`;
    });
  }
  h += `<div class="section-t">حرکت‌ها</div>`;
  sm.exercises.forEach((e) => {
    h += `<div class="item" style="min-height:60px" data-a="openEx" data-id="${e.exerciseId}">${ssTag(e.ss)}<div class="grow"><div class="t2 ell">${esc(e.name)}</div><div class="muted small">${fa(e.doneSets)} ست${e.volume ? ` · ${groupedFa(e.volume)} کیلو` : ''}</div></div><div class="t2">${setFa(e.best[0], e.best[1], e.timed)}</div></div>`;
  });
  return { html: h, fab: `<button class="btn fab" data-a="home">${ic('home', 22)} خانه</button>` };
}

// ------------------------------------------------------------ records
function exerciseIndex() {
  const out = [];
  for (const e of S.exercises) {
    const hist = D.historyFor(e.id); if (!hist.length) continue;
    out.push({ e, last: hist[hist.length - 1].startedAt, best: bestOf(hist, e.timed), prs: hist.filter((x) => x.isPr).length });
  }
  return out.sort((a, b) => b.last - a.last);
}
const pctChip = (pc, digits = 0) => `<span class="pct ${pc >= 0 ? 'up' : 'dn'}">${pc >= 0 ? '▲' : '▼'} ${fa(num(Math.abs(pc), digits))}٪</span>`;
function viewRecords() {
  let h = `<div class="top"><h1>رکوردها</h1>${timerBtn()}</div>`;
  const fin = D.finishedSessions();
  if (!fin.length) { h += `<div class="empty"><div class="ebig">${ic('trophy', 40)}</div><h3>هنوز تمرینی نیست</h3></div>`; return { html: h }; }
  const ws = weekStart(Date.now()); const weeks = [];
  for (let i = 7; i >= 0; i--) weeks.push({ s: weekStart(addDays(ws, -7 * i)), v: 0, n: 0 });
  for (const s of fin) { const w = weeks.find((x) => x.s === weekStart(s.startedAt)); if (w) { w.v += D.sessionVolume(s.id); w.n++; } }
  const max = Math.max(1, ...weeks.map((w) => w.v));
  // compare the last two complete weeks (avoids a fake drop early in the current week)
  const a = weeks[6], b = weeks[5];
  const pc = a.v > 0 && b.v > 0 ? ((a.v - b.v) / b.v) * 100 : null;
  const totalPrs = S.sets.filter((x) => x.isPr).length;
  h += `<div class="card"><div class="row sb"><span class="t2">حجم هفتگی</span>${pc != null ? pctChip(pc) : ''}</div>
    <div class="bars">${weeks.map((w, i) => `<div class="bcol">${i === 7 && w.v ? `<span class="bl">${groupedFa(w.v)}</span>` : ''}<div class="bar ${i === 7 ? 'cur' : w.v ? 'on' : ''}" style="height:${Math.max(4, (w.v / max) * 120)}px"></div></div>`).join('')}</div>
    <div class="bars lbls">${weeks.map((w) => `<span>${jNum(w.s)}</span>`).join('')}</div>
    <div class="chips" style="margin-top:14px"><span class="chip">${ic('dumbbell', 16)} ${fa(fin.length)} جلسه</span><span class="chip gold">${ic('trophy', 16)} ${fa(totalPrs)} رکورد</span></div></div>`;
  h += `<div class="seg" style="margin-bottom:12px"><button class="${ui.recTab === 'ex' ? 'on' : ''}" data-a="recTab" data-k="ex">حرکت‌ها</button><button class="${ui.recTab === 'ses' ? 'on' : ''}" data-a="recTab" data-k="ses">جلسه‌ها</button></div>`;
  if (ui.recTab === 'ex') {
    h += `<div class="search"><input id="recQ" class="field" placeholder="جستجو" value="${esc(ui.recQuery)}" enterkeyhint="search" autocomplete="off">${ic('search', 22, 'dim')}</div><div id="recList">${recList()}</div>`;
  } else {
    fin.forEach((s) => {
      h += `<div class="item" data-a="openSession" data-id="${s.id}"><div class="badge sm">${ic('calendar', 18)}</div><div class="grow"><div class="t2 ell">${esc(s.title)}</div><div class="muted small">${jFull(s.startedAt)}</div></div>
        <div class="col" style="align-items:flex-end"><span class="t2">${fa(D.sessionDoneSets(s.id))} ست</span><span class="dim small">${durationFa(s.endedAt - s.startedAt)}</span></div></div>`;
    });
  }
  return { html: h };
}
function recList() {
  const q = normalizeName(ui.recQuery);
  const list = exerciseIndex().filter((x) => !q || x.e.name.includes(q));
  if (!list.length) return `<div class="empty">–</div>`;
  return list.map((x) => `<div class="item" data-a="openEx" data-id="${x.e.id}"><div class="badge sm ${x.prs ? 'gold' : ''}">${ic(x.prs ? 'trophy' : 'dumbbell', 18)}</div>
    <div class="grow"><div class="t2 ell">${esc(x.e.name)}</div><div class="muted small">${jShort(x.last)}</div></div><span class="t2">${setFa(x.best.weightKg, x.best.reps, x.e.timed)}</span>${ic('chev', 18, 'dim')}</div>`).join('');
}
function lineChart(pts, fmt) {
  // pts oldest→newest; time flows right→left (RTL), newest on the left
  const W = 340, H = 190, pl = 14, pr = 36, pt = 16, pb = 26;
  const ys = pts.map((p) => p.y); let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) { lo = lo * 0.9; hi = hi * 1.1 + 1; }
  const pad = (hi - lo) * 0.15; lo = Math.max(0, lo - pad); hi += pad;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const X = (t) => (t1 === t0 ? (pl + W - pr) / 2 : pl + (1 - (t - t0) / (t1 - t0)) * (W - pl - pr));
  const Y = (y) => pt + (1 - (y - lo) / (hi - lo)) * (H - pt - pb);
  let g = '';
  for (let i = 0; i <= 3; i++) { const yv = lo + ((hi - lo) * i) / 3; const yy = Y(yv); g += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="#232938" stroke-dasharray="3 4"/><text x="${W - 2}" y="${yy + 4}" fill="#6B7285" font-size="11" text-anchor="end">${fa(num(yv, yv < 10 ? 1 : 0))}</text>`; }
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${path}L${X(t1).toFixed(1)},${H - pb}L${X(t0).toFixed(1)},${H - pb}Z`;
  const last = pts[pts.length - 1];
  const lab = [pts[0], pts.length > 2 ? pts[Math.floor(pts.length / 2)] : null, pts.length > 1 ? last : null].filter(Boolean)
    .map((p) => `<text x="${X(p.t)}" y="${H - 6}" fill="#6B7285" font-size="11" text-anchor="middle">${jNum(p.t)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="lg" x1="1" x2="0"><stop offset="0" stop-color="#FF9F43"/><stop offset="1" stop-color="#FF4E2A"/></linearGradient><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF6B2C" stop-opacity=".35"/><stop offset="1" stop-color="#FF6B2C" stop-opacity="0"/></linearGradient></defs>${g}
    ${pts.length > 1 ? `<path d="${area}" fill="url(#ag)"/><path d="${path}" fill="none" stroke="url(#lg)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    ${pts.map((p) => `<circle cx="${X(p.t)}" cy="${Y(p.y)}" r="3.5" fill="#FF6B2C" stroke="#0B0D12" stroke-width="1.5"/>`).join('')}
    <circle cx="${X(last.t)}" cy="${Y(last.y)}" r="7" fill="#FF6B2C" stroke="#fff" stroke-width="2"/>${lab}</svg>
    <div class="row sb small" style="margin-top:4px"><span class="muted">${jShort(last.t)}</span><span class="t2">${fmt(last.y)}</span></div>`;
}
const setBoxes = (sets, timed) => `<div class="sessbox">${sets.map((x, i) => `<div class="b ${x.isPr ? 'pr' : ''}"><div class="w">${setFa(x.weightKg, x.reps, timed, true)}</div><div class="i">${fa(i + 1)}</div></div>`).join('')}</div>`;
function viewExercise(t) {
  const e = D.exercise(t.id); if (!e) return null;
  const hist = D.historyFor(e.id);
  const timed = !!e.timed; const bw = !timed && hist.length > 0 && hist.every((x) => x.weightKg <= 0);
  let h = `<div class="top">${backBtn()}<h2 class="grow">${esc(e.name)}</h2><button class="iconbtn" data-a="renameEx" data-id="${e.id}" aria-label="تغییر نام">${ic('edit')}</button></div>`;
  if (!hist.length) { h += `<div class="empty"><div class="ebig">${ic('history', 40)}</div><h3>بدون سابقه</h3></div>`; return { html: h }; }
  const bySes = new Map(); hist.forEach((x) => { if (!bySes.has(x.sessionId)) bySes.set(x.sessionId, []); bySes.get(x.sessionId).push(x); });
  const sess = [...bySes.entries()].map(([sid, l]) => ({ sid, at: l[0].startedAt, title: l[0].title, sets: l,
    maxW: Math.max(...l.map((x) => x.weightKg)), e1: Math.max(...l.map((x) => D.e1rm(x.weightKg, x.reps))), vol: l.reduce((a, x) => a + D.volume(x.weightKg, x.reps, timed), 0), maxR: Math.max(...l.map((x) => x.reps)) }));
  const best = bestOf(hist, timed);
  const maxW = Math.max(...hist.map((x) => x.weightKg));
  const bestE = Math.max(...sess.map((s) => s.e1));
  const stat = (cls, icon, v, k) => `<div class="stat"><div class="badge sm ${cls}">${ic(icon, 18)}</div><div class="v">${v}</div><div class="k">${k}</div></div>`;
  h += `<div class="grid2">`;
  if (timed) h += stat('gold', 'trophy', secFa(best.reps), 'بیشترین زمان');
  else if (bw) h += stat('gold', 'trophy', fa(best.reps), 'بیشترین تکرار');
  else h += stat('gold', 'trophy', weightFa(maxW), 'سنگین‌ترین (کیلو)') + stat('', 'bolt', weightFa(Math.round(bestE * 10) / 10), '۱RM تخمینی');
  h += stat('blue', 'calendar', fa(sess.length), 'جلسه');
  const lastS = sess.reduce((p, q) => (q.at > p.at ? q : p));
  if (timed || bw) h += stat('green', 'layers', fa(hist.length), 'ست') + stat('', 'history', timed ? secFa(lastS.maxR) : fa(lastS.maxR), 'آخرین');
  else h += stat('green', 'layers', setFa(best.weightKg, best.reps), 'بهترین ست');
  h += `</div>`;
  const metrics = timed ? [['hold', 'زمان']] : bw ? [['reps', 'تکرار']] : [['e1rm', '۱RM'], ['maxw', 'سنگین‌ترین'], ['vol', 'حجم']];
  const metric = metrics.some((m) => m[0] === ui.metric) ? ui.metric : metrics[0][0];
  const ranges = [['1m', '۱ ماه', 30], ['3m', '۳ ماه', 91], ['1y', '۱ سال', 365], ['all', 'همه', 1e6]];
  const rg = ranges.find((r) => r[0] === ui.range) || ranges[3];
  const since = Date.now() - rg[2] * 864e5;
  const pts = sess.filter((s) => s.at >= since).map((s) => ({ t: s.at, y: metric === 'e1rm' ? s.e1 : metric === 'maxw' ? s.maxW : metric === 'vol' ? s.vol : s.maxR })).sort((a, b) => a.t - b.t);
  const fmt = (y) => (metric === 'hold' ? secFa(Math.round(y)) : metric === 'reps' ? `${fa(Math.round(y))} تکرار` : metric === 'vol' ? `${groupedFa(y)} کیلو` : `${weightFa(Math.round(y * 10) / 10)} کیلو`);
  h += `<div class="card">`;
  if (metrics.length > 1) h += `<div class="seg" style="margin-bottom:12px">${metrics.map((m) => `<button class="${m[0] === metric ? 'on' : ''}" data-a="metric" data-k="${m[0]}">${m[1]}</button>`).join('')}</div>`;
  h += pts.length ? lineChart(pts, fmt) : `<div class="empty">–</div>`;
  h += `<div class="chips" style="margin-top:12px;align-items:center">${ranges.map((r) => `<button class="chip ${r[0] === rg[0] ? 'acc' : ''}" data-a="range" data-k="${r[0]}">${r[1]}</button>`).join('')}`;
  if (pts.length > 1 && pts[0].y > 0) h += `<span style="margin-inline-start:auto">${pctChip(((pts[pts.length - 1].y - pts[0].y) / pts[0].y) * 100)}</span>`;
  h += `</div></div>`;
  if (!timed && !bw) {
    const byW = {}; hist.forEach((x) => { if (!byW[x.weightKg] || x.reps > byW[x.weightKg].reps) byW[x.weightKg] = x; });
    const rows = Object.values(byW).sort((p, q) => q.weightKg - p.weightKg).slice(0, 8);
    h += `<div class="section-t">بهترین تکرار هر وزنه</div><div class="card" style="padding:4px 16px">${rows.map((r) => `<div class="row sb wrow"><span class="t2">${weightFa(r.weightKg)} کیلو</span><span class="muted">${fa(r.reps)} تکرار · ${jShort(r.startedAt)}</span></div>`).join('')}</div>`;
  }
  h += `<div class="section-t">جلسات</div>`;
  sess.sort((p, q) => q.at - p.at).forEach((s) => {
    h += `<div class="card" data-a="openSession" data-id="${s.sid}"><div class="t2">${jFull(s.at)}</div><div class="muted small">${esc(s.title)}</div>${(() => { const p = D.partnersOf(s.sets[0].sessionExerciseId); return p.length ? `<div class="sswith small">${ic('link', 13)} با ${p.map((x) => esc(exName(x.exerciseId))).join('، ')}</div>` : ''; })()}${setBoxes(s.sets, timed)}</div>`;
  });
  return { html: h };
}
function viewSession(t) {
  const s = D.byId(S.sessions, t.id); if (!s || s.endedAt == null) return null;
  const vol = D.sessionVolume(s.id);
  let h = `<div class="top">${backBtn()}<div class="grow"><h2 class="ell">${esc(s.title)}</h2><div class="sub">${jFull(s.startedAt)} · ${timeFa(s.startedAt)}</div></div><button class="iconbtn" data-a="delSession" data-id="${s.id}" aria-label="حذف">${ic('trash')}</button></div>`;
  h += `<div class="chips" style="margin-bottom:14px"><span class="chip">${ic('clock', 16)} ${durationFa(s.endedAt - s.startedAt)}</span><span class="chip">${ic('layers', 16)} ${fa(D.sessionDoneSets(s.id))} ست</span>${vol ? `<span class="chip">${ic('dumbbell', 16)} ${groupedFa(vol)} کیلو</span>` : ''}</div>`;
  const sesl = D.sessionExercisesOf(s.id); const lab = D.supersetLabels(sesl);
  for (const se of sesl) {
    const e = D.exercise(se.exerciseId); const l = D.setsOf(se.id).filter((x) => x.isDone); if (!l.length) continue;
    const ss = lab.get(se.id);
    h += `<div class="card ${ss ? 'sscard' : ''}" ${ss ? `style="--ss:${ss.color}"` : ''} data-a="openEx" data-id="${e.id}"><div class="row sb"><span class="row t2">${ssTag(ss)}${esc(e.name)}</span>${ic('chev', 18, 'dim')}</div>${setBoxes(l, e.timed)}</div>`;
  }
  return { html: h };
}

// ------------------------------------------------------------ settings
function viewSettings() {
  const s = st();
  const tg = (k, label, icon) => `<button class="toggle" data-a="toggleSetting" data-k="${k}"><span class="row">${ic(icon, 22, 'muted')}${label}</span><span class="sw ${s[k] ? 'on' : ''}"></span></button>`;
  let h = `<div class="top"><h1>تنظیمات</h1></div>`;
  h += `<div class="card" style="padding:4px 16px"><button class="toggle" data-a="editName"><span class="row">${ic('user', 22, 'muted')}نام</span><span class="row muted">${esc(s.userName)} ${ic('chev', 18)}</span></button></div>`;
  h += `<div class="card"><div class="lbl" style="margin-top:0">استراحت پیش‌فرض</div>
    <div class="stepper"><button class="sb" data-a="restDef" data-d="-15" aria-label="کم">${ic('minus')}</button><div class="sv">${restFa(s.defaultRestSec)}</div><button class="sb" data-a="restDef" data-d="15" aria-label="زیاد">${ic('plus')}</button></div>
    <div class="lbl">گام وزنه</div><div class="chips">${[1, 1.25, 2.5, 5].map((v) => `<button class="chip ${s.weightStep === v ? 'sel' : ''}" data-a="wstep" data-k="${v}">${weightFa(v)} کیلو</button>`).join('')}</div>
    <div style="margin-top:8px">${tg('autoRest', 'استراحت خودکار', 'timer')}${tg('sound', 'صدا', 'volume')}${tg('preWarn', 'هشدار ۱۰ ثانیه قبل', 'clock')}${tg('keepScreenOn', 'صفحه روشن بماند', 'sun')}</div></div>`;
  h += `<div class="card menu" style="padding:6px 10px"><div class="lbl" style="margin-top:6px">داده‌ها</div>
    <button data-a="exportJson">${ic('share', 22, 'acc')} پشتیبان</button>
    <button data-a="importJson">${ic('file', 22, 'acc')} بازیابی</button>
    <button data-a="exportCsv">${ic('file', 22, 'acc')} خروجی CSV</button>
    <button class="danger" data-a="wipe">${ic('trash', 22)} پاک کردن همه</button></div>
    <input type="file" id="fileIn" accept=".json,application/json" class="hidden">
    <div class="dim small" style="text-align:center;margin-top:16px">باشگاه · نسخهٔ ${fa(VERSION)}</div>`;
  return { html: h };
}

// ============================================================ overlays
function renderOverlay() {
  let h = '';
  if (ui.fullRest && S.rest) h += fullRestHtml();
  if (S.hold && Date.now() < S.hold.startAt && top()?.v === 'workout') h += `<div class="lead" data-a="holdCancel"><div class="muted t1">آماده</div><div class="n" data-tick="lead">${fa(Math.ceil((S.hold.startAt - Date.now()) / 1000))}</div></div>`;
  if (ui.sheet) h += `<div class="scrim" data-a="closeSheet"></div><div class="sheet" id="sheet">${sheetHtml()}</div>`;
  if (ui.dialog) h += `<div class="scrim top" data-a="closeDialog"></div><div class="dialog">${dialogHtml()}</div>`;
  const prevSheet = document.getElementById('sheet');
  const sTop = prevSheet ? prevSheet.scrollTop : 0;
  $ov.innerHTML = h;
  const ns = document.getElementById('sheet');
  if (ui.sheet && ui.sheet !== sheetOpened) { sheetOpened = ui.sheet; sheetSnap = sheetSig(); }
  if (!ui.sheet) sheetOpened = null;
  if (ns) bindSheetSwipe(ns);
  syncHistory();
  if (ns && prevSheet) { ns.style.animation = 'none'; ns.scrollTop = sTop; const sc = $ov.querySelector('.scrim'); if (sc) sc.style.animation = 'none'; }
}
function fullRestHtml() {
  const r = S.rest; const rem = Math.max(0, (r.endAt - Date.now()) / 1000); const C = 2 * Math.PI * 46;
  return `<div class="full" data-a="closeFull"><button class="iconbtn fx" data-a="closeFull" aria-label="بستن">${ic('down', 24)}</button><div class="lab">${r.kind === 'timer' ? 'تایمر' : 'استراحت'}</div>
    <div class="bigring"><svg viewBox="0 0 100 100"><defs><linearGradient id="rg"><stop offset="0" stop-color="#FF4E2A"/><stop offset="1" stop-color="#FF9F43"/></linearGradient></defs><circle cx="50" cy="50" r="46" stroke="#1F2430" stroke-width="5" fill="none"/><circle id="bigarc" cx="50" cy="50" r="46" stroke="url(#rg)" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - rem / r.total)}"/></svg><div class="tt" data-tick="rest">${clockFa(Math.ceil(rem))}</div></div>
    <div class="nx">${esc(r.info || '')}</div>
    <div class="acts"><button class="btn sec" data-a="restAdj" data-d="-15"><span dir="ltr">−۱۵</span></button><button class="btn sec" data-a="restAdj" data-d="15"><span dir="ltr">+۱۵</span></button></div>
    <div class="acts"><button class="btn" data-a="restSkip">${r.kind === 'timer' ? 'توقف' : 'رد کردن'}</button></div></div>`;
}
function renderRestBar() {
  let el = document.getElementById('restbar');
  if (!(S.rest && !ui.fullRest && S.onboarded)) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'restbar'; el.className = 'restbar'; }
  const t = top();
  el.style.bottom = !t ? 'calc(var(--sab) + 82px)' : ['workout', 'day', 'summary'].includes(t.v) ? 'calc(var(--sab) + 86px)' : 'calc(var(--sab) + 14px)';
  el.innerHTML = `<button class="row grow" data-a="openFull" style="gap:10px;min-width:0">${ic('timer', 22, 'acc')}<span class="tm" data-tick="rest">${clockFa(Math.ceil(Math.max(0, (S.rest.endAt - Date.now()) / 1000)))}</span><span class="muted small ell grow" style="text-align:right">${esc(S.rest.info || '')}</span></button>
    <button class="rb" data-a="restAdj" data-d="15"><span dir="ltr">+۱۵</span></button><button class="rb" data-a="restSkip" aria-label="رد کردن">${ic('x', 20)}</button>`;
  if (!el.parentNode) document.body.appendChild(el);
}
function stepper(k, val, big = false, editable = false, mode = 'decimal') {
  return `<div class="stepper ${big ? 'big' : ''}"><button class="sb" data-a="step" data-k="${k}" data-d="-1" aria-label="کم">${ic('minus')}</button>
    ${editable ? `<input class="sv" id="sv-${k}" inputmode="${mode}" value="${val}" placeholder="–" autocomplete="off">` : `<div class="sv" id="sv-${k}">${val}</div>`}
    <button class="sb" data-a="step" data-k="${k}" data-d="1" aria-label="زیاد">${ic('plus')}</button></div>`;
}
function sugsHtml(q) {
  const n = normalizeName(q);
  return S.exercises.map((e) => e.name).filter((x) => x !== n && (!n || x.includes(n))).slice(0, 12)
    .map((x) => `<button class="chip" data-a="pickSug" data-k="${esc(x)}">${esc(x)}</button>`).join('');
}
/** Sheet header: grab handle, title and a ✕ close button (end side). */
function shd(title = '') { return `<div class="grab"></div><div class="shd"><h3 class="ell">${title}</h3><button class="iconbtn sx" data-a="closeSheet" aria-label="بستن">${ic('x', 22)}</button></div>`; }
function sheetHtml() {
  const s = ui.sheet; const g = '<div class="grab"></div>';
  if (s.type === 'menu') return shd(s.title ? esc(s.title) : '') + `<div class="menu">${s.items.map((it, i) => `<button class="${it.danger ? 'danger' : ''}" data-a="menuPick" data-i="${i}">${ic(it.icon, 22, it.danger ? '' : 'muted')}${esc(it.label)}</button>`).join('')}</div>`;
  if (s.type === 'exercise') {
    const f = s.f; const u = f.timed ? 'ثانیه' : 'تکرار';
    return shd(s.deId ? 'ویرایش' : 'حرکت جدید') + `
      <input class="field" id="exName" placeholder="نام حرکت" value="${esc(f.name)}" maxlength="60" enterkeyhint="done" autocomplete="off">
      <div class="sugs" id="sugs">${sugsHtml(f.name)}</div>
      <div class="row" style="margin-top:14px"><div class="seg grow"><button class="${!f.timed ? 'on' : ''}" data-a="fTimed" data-k="0">تکرار</button><button class="${f.timed ? 'on' : ''}" data-a="fTimed" data-k="1">ثانیه</button></div>
      <button class="chip ${f.perSide ? 'sel' : ''}" style="height:54px;border-radius:16px" data-a="fSide">${f.perSide ? ic('check', 16) : ''}هر سمت</button></div>
      <div class="lbl">ست</div>${stepper('sets', fa(f.sets))}
      <div class="row" style="gap:10px"><div class="grow"><div class="lbl">${u}: از</div>${stepper('repMin', fa(f.repMin))}</div><div class="grow"><div class="lbl">تا</div>${stepper('repMax', fa(f.repMax))}</div></div>
      <div class="lbl">استراحت</div>${stepper('rest', restFa(f.restSec))}
      <div class="chips" style="margin-top:8px">${[45, 60, 90, 120, 180].map((v) => `<button class="chip ${f.restSec === v ? 'sel' : ''}" data-a="fRest" data-k="${v}">${restFa(v)}</button>`).join('')}</div>
      <div class="row" style="gap:10px;margin-top:14px"><input class="field" id="exW" inputmode="decimal" placeholder="کیلو" value="${esc(f.weight)}" style="flex:.8;min-width:0" autocomplete="off"><input class="field" id="exNote" placeholder="یادداشت" value="${esc(f.note)}" style="flex:1.2;min-width:0" maxlength="120" autocomplete="off"></div>
      <button class="btn" style="margin-top:18px" data-a="saveDe">ذخیره</button>`;
  }
  if (s.type === 'addSe') {
    const f = s.f;
    return shd('افزودن حرکت') + `<input class="field" id="exName" placeholder="نام حرکت" value="${esc(f.name)}" maxlength="60" autocomplete="off" enterkeyhint="done">
      <div class="sugs" id="sugs">${sugsHtml(f.name)}</div>
      <div class="seg" style="margin-top:14px"><button class="${!f.timed ? 'on' : ''}" data-a="fTimed" data-k="0">تکرار</button><button class="${f.timed ? 'on' : ''}" data-a="fTimed" data-k="1">ثانیه</button></div>
      <div class="lbl">ست</div>${stepper('sets', fa(f.sets))}
      <button class="btn" style="margin-top:18px" data-a="saveSe">افزودن</button>`;
  }
  if (s.type === 'set') {
    const x = D.byId(S.sets, s.setId); if (!x) return '';
    return shd(`${esc(s.name)} · ست ${fa(x.setIndex + 1)}`) + `
      <div class="lbl">کیلو</div>${stepper('w', s.w > 0 ? weightFa(s.w) : '', true, true, 'decimal')}
      <div class="lbl">${s.timed ? 'ثانیه' : 'تکرار'}</div>${stepper('r', fa(s.r), true, true, 'numeric')}
      <div class="row" style="gap:10px;margin-top:20px">${x.isDone ? '' : `<button class="btn" data-a="setSave" data-k="1">${ic('check', 22)} ثبت ست</button>`}<button class="btn ${x.isDone ? '' : 'sec'}" data-a="setSave" data-k="0" ${x.isDone ? '' : 'style="flex:0 0 112px"'}>ذخیره</button></div>`;
  }
  if (s.type === 'timer') {
    const sw = ui.sw; const swSec = (sw.acc + (sw.startAt ? Date.now() - sw.startAt : 0)) / 1000;
    return shd('تایمر') + `<div class="seg" style="margin-bottom:16px"><button class="${s.tab === 'cd' ? 'on' : ''}" data-a="tTab" data-k="cd">تایمر</button><button class="${s.tab === 'sw' ? 'on' : ''}" data-a="tTab" data-k="sw">کرنومتر</button></div>` +
      (s.tab === 'cd'
        ? `${stepper('tsec', clockFa(s.sec), true)}<div class="chips" style="margin-top:12px;justify-content:center">${[30, 60, 90, 120, 180, 300].map((v) => `<button class="chip ${s.sec === v ? 'sel' : ''}" data-a="tPreset" data-k="${v}">${restFa(v)}</button>`).join('')}</div>
           <button class="btn" style="margin-top:18px" data-a="tStart">${ic('play', 20)} شروع</button>`
        : `<div class="swt" data-tick="sw">${clockFa(swSec)}</div>
           <div class="row" style="gap:10px"><button class="btn" data-a="swToggle">${sw.startAt ? 'مکث' : 'شروع'}</button><button class="btn sec" data-a="swReset" style="flex:.6">صفر</button></div>`);
  }
  if (s.type === 'share') {
    const sm = P.summaryOf(s.spec);
    return shd('اشتراک‌گذاری') + `<div class="card prevc"><div class="t2 ell">${esc(s.spec.name)}</div><div class="chips" style="margin-top:8px">${statChips(sm)}</div></div>
      <button class="btn" data-a="shareSend">${ic('share', 22)} ارسال</button>
      <button class="btn sec" style="margin-top:10px" data-a="shareCopy">${ic('copy', 20)} کپی متن</button>
      <div class="muted small center" style="margin-top:12px">روی آیفون و اندروید با «وارد کردن» باز می‌شه.</div>`;
  }
  if (s.type === 'import') {
    return shd('وارد کردن برنامه') + `<textarea class="field imptxt" id="impTxt" rows="6" dir="auto" placeholder="متن برنامه یا جواب ChatGPT رو اینجا بچسبون" autocomplete="off" spellcheck="false">${esc(s.text || '')}</textarea>
      ${s.err ? `<div class="imperr">${ic('info', 16)} ${esc(s.err)}</div>` : ''}
      <div class="row" style="gap:10px;margin-top:10px"><button class="btn sec grow" data-a="impPaste">${ic('copy', 20)} چسباندن</button><button class="btn sec grow" data-a="impFile">${ic('file', 20)} فایل</button></div>
      <button class="btn" style="margin-top:12px" data-a="impNext">ادامه</button>
      <button class="btn ghost" style="margin-top:6px" data-a="copyPrompt">${ic('bolt', 20)} متن برای ChatGPT</button>
      <input type="file" id="progFile" accept=".json,.txt,application/json,text/plain" class="hidden">`;
  }
  if (s.type === 'importPreview') {
    const sm = P.summaryOf(s.spec);
    return shd('پیش‌نمایش') + `<div class="card prevc"><div class="t2 ell">${esc(D.uniqueProgramName(s.spec.name))}</div><div class="chips" style="margin-top:8px">${statChips(sm)}</div></div>
      <div class="prevdays">${s.spec.days.map((d, i) => `<div class="prevday"><span class="badge sm">${fa(i + 1)}</span><div class="grow" style="min-width:0"><div class="t2 ell">${d.name ? esc(d.name) : `روز ${fa(i + 1)}`}</div><div class="muted small ell">${d.exercises.map((x) => esc(x.name)).join('، ') || 'خالی'}</div></div><span class="muted small">${fa(d.exercises.length)}</span></div>`).join('')}</div>
      ${s.warnings?.length ? `<div class="muted small" style="margin-top:8px">${s.warnings.map(esc).join(' · ')}</div>` : ''}
      <div class="row" style="gap:10px;margin-top:16px"><button class="btn sec" style="flex:0 0 110px" data-a="impBack">برگشت</button><button class="btn grow" data-a="impDo">${ic('check', 22)} وارد کن</button></div>`;
  }
  if (s.type === 'text') {
    return shd(esc(s.title)) + `${s.multi ? `<textarea class="field" id="txt" rows="3" maxlength="200">${esc(s.value)}</textarea>` : `<input class="field" id="txt" value="${esc(s.value)}" maxlength="40" placeholder="${esc(s.ph || '')}" enterkeyhint="done" autocomplete="off">`}
      <button class="btn" style="margin-top:16px" data-a="textOk">ذخیره</button>`;
  }
  return '';
}
function dialogHtml() {
  const d = ui.dialog;
  return `<h3>${esc(d.title)}</h3>${d.text ? `<p>${esc(d.text)}</p>` : ''}<div class="acts"><button class="btn sec" data-a="closeDialog">${esc(d.cancel || 'بستن')}</button><button class="btn ${d.danger ? 'danger' : ''}" data-a="dialogOk">${esc(d.ok)}</button></div>`;
}
// ------------------------------------------------------------ closing sheets / back
let sheetOpened = null, sheetSnap = '';
const EDIT_SHEETS = ['exercise', 'addSe', 'set', 'text', 'import'];
function sheetSig() {
  const el = document.getElementById('sheet');
  const vals = el ? [...el.querySelectorAll('input,textarea')].map((i) => i.value).join('\u0001') : '';
  return JSON.stringify(ui.sheet, (k, v) => (typeof v === 'function' ? undefined : v)) + '|' + vals;
}
const sheetDirty = () => !!ui.sheet && (ui.sheet.type === 'import' ? !!document.getElementById('impTxt')?.value.trim() : ui.sheet.type === 'importPreview' || (EDIT_SHEETS.includes(ui.sheet.type) && sheetSig() !== sheetSnap));
function forceCloseSheet() { document.activeElement?.blur?.(); ui.sheet = null; renderOverlay(); }
/** Close the sheet; when it has unsaved edits ask first. */
function requestCloseSheet() {
  if (!ui.sheet) return;
  if (sheetDirty()) { document.activeElement?.blur?.(); confirmDlg('تغییرات ذخیره نشه؟', '', 'دور بریز', forceCloseSheet, true, 'ادامه ویرایش'); return; }
  forceCloseSheet();
}
/** Close the top-most layer (dialog > sheet > full rest > screen). Returns false at the root. */
function closeTop() {
  if (ui.dialog) { ui.dialog = null; renderOverlay(); return true; }
  if (ui.sheet) { requestCloseSheet(); return true; }
  if (ui.fullRest) { A.closeFull(); return true; }
  if (ui.stack.length) { pop(); return true; }
  return false;
}
// Swipe the sheet down to close (from its top, or anywhere when it isn't scrolled).
function bindSheetSwipe(el) {
  if (el._sw) return; el._sw = true;
  let y0 = null, dy = 0, fromHead = false;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { y0 = null; return; }
    fromHead = !!e.target.closest('.grab,.shd');
    if (el.scrollTop > 0 && !fromHead) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { if (e.cancelable) e.preventDefault(); el.style.transition = 'none'; el.style.transform = `translateY(${dy}px)`; }
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (y0 == null) return; y0 = null;
    el.style.transition = 'transform .2s ease'; el.style.transform = '';
    if (dy > 110) requestCloseSheet();
    dy = 0;
  });
}
// Browser back / swipe-back closes layers instead of leaving the app: one history entry per open layer.
let hDepth = 0, ignorePop = 0;
function layerDepth() { return ui.stack.length + (ui.sheet ? 1 : 0) + (ui.dialog ? 1 : 0) + (ui.fullRest ? 1 : 0); }
let syncT = null;
function syncHistory() { if (!syncT) syncT = setTimeout(doSyncHistory, 0); }
function doSyncHistory() {
  syncT = null;
  if (!S.onboarded || ignorePop > 0) return; // a traversal is in flight; re-synced on its popstate
  const want = layerDepth();
  try {
    while (hDepth < want) { history.pushState({ bashgah: ++hDepth }, ''); }
    if (hDepth > want) { ignorePop++; history.go(want - hDepth); hDepth = want; }
  } catch {}
}
window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop--; syncHistory(); return; }
  hDepth = Math.max(0, hDepth - 1);
  if (!closeTop()) return;
  syncHistory();
});
function statChips(sm) {
  return `<span class="chip sm">${ic('calendar', 13)} ${fa(sm.days)} روز</span><span class="chip sm">${ic('dumbbell', 13)} ${fa(sm.exercises)} حرکت</span>${sm.supersets ? `<span class="chip sm">${ic('link', 13)} ${fa(sm.supersets)} سوپرست</span>` : ''}`;
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch {}
  try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch { return false; }
}
function importParse(text) {
  const r = P.parseProgram(text);
  if (!r.ok) { ui.sheet = { type: 'import', text, err: r.error + ' — متن کامل رو بچسبون' }; renderOverlay(); return; }
  haptic(); ui.sheet = { type: 'importPreview', spec: r.program, warnings: r.warnings, text }; renderOverlay();
}
function openMenu(title, items) { ui.sheet = { type: 'menu', title, items }; renderOverlay(); }
function confirmDlg(title, text, ok, fn, danger = true, cancel = '') { ui.dialog = { title, text, ok, fn, danger, cancel }; renderOverlay(); }
function textSheet(title, value, fn, opts = {}) { ui.sheet = { type: 'text', title, value, fn, ...opts }; renderOverlay(); setTimeout(() => document.getElementById('txt')?.focus(), 60); }

// ============================================================ timers (timestamp based: correct after returning from background)
function startRest(sec, info, kind = 'rest') {
  document.body.classList.add('resting');
  const now = Date.now();
  S.rest = { startAt: now, endAt: now + sec * 1000, total: sec, info, kind, warned: false, ended: false };
  D.save(); renderRestBar(); if (ui.fullRest) renderOverlay();
}
function endRest() { S.rest = null; ui.fullRest = false; D.save(); renderRestBar(); renderOverlay(); }
function startHold(setId) {
  const x = D.byId(S.sets, setId); if (!x) return;
  if (S.hold) stopHold();
  if (S.rest) { S.rest = null; ui.fullRest = false; }
  S.hold = { setId, startAt: Date.now() + 3000, targetSec: Math.max(1, x.reps), lastCount: 3 };
  D.save(); render(); beep('count');
}
function stopHold() {
  const hd = S.hold; if (!hd) return;
  const secs = Math.floor((Date.now() - hd.startAt) / 1000);
  if (secs < 1) { S.hold = null; D.save(); render(); return; }
  completeHold(hd, Math.min(secs, hd.targetSec * 3));
}
function completeHold(hd, secs) {
  S.hold = null; beep('end');
  const x = D.byId(S.sets, hd.setId); if (!x) { D.save(); render(); return; }
  D.updateSetValues(x.id, x.weightKg, secs);
  if (!x.isDone) doTick(x.id); else render();
}
let lastSec = -1;
function tick() {
  const now = Date.now();
  if (S.rest) {
    const rem = (S.rest.endAt - now) / 1000;
    if (st().preWarn && !S.rest.warned && rem <= 10 && rem > 0 && S.rest.total > 15) { S.rest.warned = true; beep('warn'); }
    if (rem <= 0 && !S.rest.ended) {
      S.rest.ended = true;
      const fresh = rem > -5;
      if (fresh) beep('end');
      setTimeout(() => { if (S.rest && S.rest.ended) endRest(); }, fresh ? 2500 : 0);
    }
    const t = clockFa(Math.ceil(Math.max(0, rem)));
    document.querySelectorAll('[data-tick="rest"]').forEach((e) => { if (e.textContent !== t) e.textContent = t; });
    const arc = document.getElementById('bigarc'); if (arc) arc.setAttribute('stroke-dashoffset', 2 * Math.PI * 46 * (1 - Math.max(0, rem) / S.rest.total));
  }
  if (S.hold) {
    const hd = S.hold;
    if (now < hd.startAt) {
      const c = Math.ceil((hd.startAt - now) / 1000);
      if (c !== hd.lastCount) { hd.lastCount = c; beep('count'); }
      const l = document.querySelector('[data-tick="lead"]');
      if (l) l.textContent = fa(c); else if (top()?.v === 'workout') renderOverlay();
    } else {
      if (hd.lastCount !== 0) { hd.lastCount = 0; beep('go'); renderOverlay(); }
      if ((now - hd.startAt) / 1000 >= hd.targetSec) completeHold(hd, hd.targetSec);
      else document.querySelectorAll('[data-tick="hold"]').forEach((e) => (e.textContent = holdText()));
    }
  }
  const sec = Math.floor(now / 1000);
  if (sec !== lastSec) {
    lastSec = sec;
    const o = D.openSession();
    if (o) { const t = clockFa((now - o.startedAt) / 1000); document.querySelectorAll('[data-tick="elapsed"]').forEach((e) => (e.textContent = t)); }
  }
  if (ui.sw.startAt) { const e = document.querySelector('[data-tick="sw"]'); if (e) e.textContent = clockFa((ui.sw.acc + now - ui.sw.startAt) / 1000); }
}
setInterval(tick, 200);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.rest && S.rest.endAt < Date.now() - 5000) { S.rest = null; ui.fullRest = false; }
    tick(); if (S.onboarded) render();
  } else D.save(true);
  updateWakeLock();
});
window.addEventListener('pagehide', () => D.save(true));
window.addEventListener('freeze', () => D.save(true));

// ============================================================ actions
function doTick(setId) {
  const s = D.openSession(); if (!s) return;
  const r = D.toggleSet(setId); if (!r) return;
  haptic();
  if (!r.nowDone) { render(); return; }
  const m = workoutModel(s);
  const me = m.seq.find((q) => q.x.id === setId);
  const b = me ? m.blocks[me.bi] : null;
  // superset: go straight to the next exercise of the same round, rest only after the round
  let next = null, roundOver = true;
  if (me && me.gid != null) {
    const g = m.seq.filter((q) => q.gid === me.gid); const k = g.indexOf(me);
    next = [...g.slice(k + 1), ...g.slice(0, k)].find((q) => !q.x.isDone) || null;
    if (next) roundOver = !(next.r === me.r && next.m > me.m);
  }
  if (!roundOver) { if (S.rest && S.rest.kind !== 'timer') endRest(); }
  else if (st().autoRest && m.done < m.total) startRest(r.restSec, nextInfo(m));
  if (r.prs.length) { prToast(`رکورد! ${esc(b?.e.name || '')} · ${setFa(r.set.weightKg, r.set.reps, b?.timed)}`); beep('pr'); }
  render();
  const focusRow = (id) => setTimeout(() => { const el = document.getElementById('set-' + id); if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('pulse'); }, 80);
  if (next) { focusRow(next.x.id); return; }
  if (b && b.sets.every((x) => x.isDone)) {
    const q = m.seq.find((y) => !y.x.isDone);
    if (q) setTimeout(() => document.getElementById('exc-' + q.bi)?.closest('.ssg, .exc')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }
}
function readSetInputs() {
  const s = ui.sheet; if (!s || s.type !== 'set') return;
  const wi = document.getElementById('sv-w'), ri = document.getElementById('sv-r');
  if (wi) { const raw = wi.value.trim(); if (raw === '' || raw === '–') s.w = 0; else { const w = parseWeight(raw); if (w != null) s.w = w; } }
  if (ri) { const r = parseReps(ri.value); if (r != null) s.r = r; }
}
const stamp = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
async function shareFile(name, text, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('ذخیره شد ✅');
}

/** «سوپرست با بعدی / قبلی» and «جدا کردن» menu items for an exercise in a list. */
function ssMenu(list, x, link, unlink) {
  const i = list.indexOf(x); const nx = list[i + 1], pv = list[i - 1]; const out = [];
  const same = (o) => o && x.supersetId != null && o.supersetId === x.supersetId;
  if (nx && !same(nx)) out.push({ icon: 'link', label: `سوپرست با ${exName(nx.exerciseId)}`, fn: () => { link(x.id); haptic(); render(); } });
  if (pv && !same(pv)) out.push({ icon: 'link', label: `سوپرست با ${exName(pv.exerciseId)}`, fn: () => { link(pv.id); haptic(); render(); } });
  if (x.supersetId != null) out.push({ icon: 'unlink', label: 'جدا کردن از سوپرست', fn: () => { unlink(x.id); render(); } });
  return out;
}
const A = {
  tab: (d) => { ui.tab = d.k; ui.stack = []; render(true); },
  back: () => goBack(),
  home: () => resetTo('home'),
  onbDone: () => {
    const inp = document.getElementById('onbName'); const n = normalizeName(inp.value);
    if (!n) { inp.focus(); return; }
    inp.blur();
    S.settings.userName = n; S.onboarded = true; D.requestPersist();
    if (!S.programs.length) D.createProgram('برنامهٔ من');
    D.save(true); render(true);
  },
  timerSheet: () => { ui.sheet = { type: 'timer', tab: 'cd', sec: st().defaultRestSec }; renderOverlay(); },
  tTab: (d) => { ui.sheet.tab = d.k; renderOverlay(); },
  tPreset: (d) => { ui.sheet.sec = +d.k; renderOverlay(); },
  tStart: () => { const sec = ui.sheet.sec; ui.sheet = null; ui.fullRest = true; startRest(sec, '', 'timer'); renderOverlay(); },
  swToggle: () => { const sw = ui.sw; if (sw.startAt) { sw.acc += Date.now() - sw.startAt; sw.startAt = null; } else sw.startAt = Date.now(); renderOverlay(); },
  swReset: () => { ui.sw = { acc: 0, startAt: null }; renderOverlay(); },
  resume: () => push({ v: 'workout' }),
  start: (d) => { D.startWorkout(+d.id); ui.homeDay = null; push({ v: 'workout' }); },
  freeWorkout: () => { D.startWorkout(null); push({ v: 'workout' }); },
  homeDay: (d) => { ui.homeDay = +d.id; render(); },
  openDay: (d) => push({ v: 'day', id: +d.id }),
  addDayHome: () => { const p = D.activeProgram(); push({ v: 'day', id: D.addDay(p.id) }); },
  newProgram: () => textSheet('برنامهٔ جدید', '', (v) => { const id = D.createProgram(v || 'برنامهٔ من'); D.setActiveProgram(id); ui.tab = 'program'; ui.stack = []; render(true); }, { ph: 'نام برنامه' }),
  activateProgram: (d) => { D.setActiveProgram(+d.id); render(); },
  programMenu: () => {
    const p = D.activeProgram();
    openMenu(p.name, [
      { icon: 'edit', label: 'تغییر نام', fn: () => textSheet('تغییر نام', p.name, (v) => { D.renameProgram(p.id, v); render(); }) },
      { icon: 'share', label: 'اشتراک‌گذاری', fn: () => A.shareProgram({ id: p.id }) },
      { icon: 'upload', label: 'وارد کردن برنامه', fn: () => A.importOpen() },
      { icon: 'plus', label: 'برنامهٔ جدید', fn: () => A.newProgram() },
      { icon: 'trash', label: 'حذف', danger: true, fn: () => confirmDlg(`حذف «${p.name}»؟`, 'تاریخچه و رکوردها می‌مونن.', 'حذف', () => { D.deleteProgram(p.id); render(); }) },
    ]);
  },
  addDay: () => { const p = D.activeProgram(); D.addDay(p.id); render(); requestAnimationFrame(() => { const sc = document.getElementById('sc'); sc.scrollTop = sc.scrollHeight; }); },
  dayMenu: (d) => {
    const day = D.day(+d.id);
    openMenu(`روز ${fa(day.position + 1)}`, [
      { icon: 'edit', label: 'تغییر نام', fn: () => A.renameDay({ id: day.id }) },
      { icon: 'copy', label: 'کپی', fn: () => { D.duplicateDay(day.id); render(); } },
      { icon: 'up', label: 'بالا', fn: () => { D.moveDay(day.id, -1); render(); } },
      { icon: 'down', label: 'پایین', fn: () => { D.moveDay(day.id, 1); render(); } },
      { icon: 'trash', label: 'حذف', danger: true, fn: () => { const n = day.position + 1; const snap = D.deleteDay(day.id); withUndo(`روز ${fa(n)} حذف شد`, () => D.restoreDay(snap)); render(); } },
    ]);
  },
  renameDay: (d) => { const day = D.day(+d.id); textSheet(`نام روز ${fa(day.position + 1)}`, day.name, (v) => { D.renameDay(day.id, v); render(); }, { ph: 'مثلاً سینه و پشت‌بازو' }); },
  addDe: (d) => { ui.sheet = { type: 'exercise', dayId: +d.id, deId: null, f: { name: '', timed: false, perSide: false, sets: 3, repMin: 8, repMax: 12, restSec: st().defaultRestSec, weight: '', note: '' } }; renderOverlay(); },
  editDe: (d) => {
    const x = D.byId(S.dayExercises, +d.id); const e = D.exercise(x.exerciseId);
    ui.sheet = { type: 'exercise', dayId: x.dayId, deId: x.id, f: { name: e.name, timed: !!e.timed, perSide: !!e.perSide, sets: x.targetSets, repMin: x.repMin, repMax: x.repMax, restSec: x.restSec, weight: x.targetWeight ? weightFa(x.targetWeight) : '', note: x.note || '' } };
    renderOverlay();
  },
  deMenu: (d) => {
    const x = D.byId(S.dayExercises, +d.id); const name = exName(x.exerciseId);
    openMenu(name, [
      { icon: 'edit', label: 'ویرایش', fn: () => A.editDe({ id: x.id }) },
      { icon: 'up', label: 'بالا', fn: () => { D.moveDayExercise(x.id, -1); render(); } },
      { icon: 'down', label: 'پایین', fn: () => { D.moveDayExercise(x.id, 1); render(); } },
      ...ssMenu(D.dayExercisesOf(x.dayId), x, D.dayLink, D.dayUnlink),
      { icon: 'history', label: 'تاریخچه', fn: () => push({ v: 'exercise', id: x.exerciseId }) },
      { icon: 'trash', label: 'حذف', danger: true, fn: () => { const snap = D.deleteDayExercise(x.id); withUndo(`«${name}» حذف شد`, () => D.restoreDayExercise(snap)); render(); } },
    ]);
  },
  fTimed: (d) => {
    const f = ui.sheet.f; const t = d.k === '1'; if (f.timed === t) return; f.timed = t;
    if (ui.sheet.type === 'exercise') { if (t) { f.repMin = 30; f.repMax = 45; } else { f.repMin = 8; f.repMax = 12; } }
    renderOverlay();
  },
  fSide: () => { ui.sheet.f.perSide = !ui.sheet.f.perSide; renderOverlay(); },
  fRest: (d) => { ui.sheet.f.restSec = +d.k; renderOverlay(); },
  pickSug: (d) => {
    const f = ui.sheet.f; f.name = d.k;
    const e = S.exercises.find((x) => x.name === d.k);
    if (e) {
      const was = f.timed; f.timed = !!e.timed; f.perSide = !!e.perSide;
      if (ui.sheet.type === 'exercise' && was !== f.timed) { if (f.timed) { f.repMin = 30; f.repMax = 45; } else { f.repMin = 8; f.repMax = 12; } }
    }
    renderOverlay();
  },
  step: (d) => {
    const s = ui.sheet; const k = d.k; const dir = +d.d; haptic();
    if (s.type === 'exercise' || s.type === 'addSe') {
      const f = s.f; const rs = f.timed ? 5 : 1;
      if (k === 'sets') f.sets = Math.max(1, Math.min(20, f.sets + dir));
      if (k === 'repMin') { f.repMin = Math.max(1, f.repMin + dir * rs); if (f.repMax < f.repMin) f.repMax = f.repMin; }
      if (k === 'repMax') { f.repMax = Math.max(1, f.repMax + dir * rs); if (f.repMin > f.repMax) f.repMin = f.repMax; }
      if (k === 'rest') f.restSec = Math.max(15, Math.min(600, f.restSec + dir * 15));
      const set = (id, v) => { const el = document.getElementById('sv-' + id); if (el) el.textContent = v; };
      set('sets', fa(f.sets)); set('repMin', fa(f.repMin)); set('repMax', fa(f.repMax)); set('rest', restFa(f.restSec));
      document.querySelectorAll('[data-a="fRest"]').forEach((b) => b.classList.toggle('sel', +b.dataset.k === f.restSec));
    } else if (s.type === 'set') {
      readSetInputs();
      if (k === 'w') { s.w = Math.max(0, Math.round((s.w + dir * st().weightStep) * 100) / 100); document.getElementById('sv-w').value = s.w > 0 ? weightFa(s.w) : ''; }
      if (k === 'r') { s.r = Math.max(0, s.r + dir * (s.timed ? 5 : 1)); document.getElementById('sv-r').value = fa(s.r); }
    } else if (s.type === 'timer') {
      s.sec = Math.max(5, Math.min(3600, s.sec + dir * (s.sec + dir * 15 >= 60 ? 15 : 5)));
      document.getElementById('sv-tsec').textContent = clockFa(s.sec);
      document.querySelectorAll('[data-a="tPreset"]').forEach((b) => b.classList.toggle('sel', +b.dataset.k === s.sec));
    }
  },
  saveDe: () => {
    const s = ui.sheet; const f = s.f; const inp = document.getElementById('exName');
    f.name = normalizeName(inp.value);
    if (!f.name) { inp.focus(); return; }
    const w = parseWeight(document.getElementById('exW').value);
    D.saveDayExercise(s.deId, s.dayId, { ...f, weight: w && w > 0 ? w : null, note: document.getElementById('exNote').value });
    ui.sheet = null; render();
  },
  workoutMenu: () => openMenu(null, [
    { icon: 'plus', label: 'افزودن حرکت', fn: () => A.addSe() },
    { icon: 'trash', label: 'لغو تمرین', danger: true, fn: () => confirmDlg('لغو تمرین؟', 'ست‌های این جلسه پاک می‌شن.', 'لغو تمرین', () => { D.deleteSession(D.openSession().id); ui.fullRest = false; resetTo('home'); }) },
  ]),
  addSe: () => { ui.sheet = { type: 'addSe', f: { name: '', timed: false, sets: 3 } }; renderOverlay(); setTimeout(() => document.getElementById('exName')?.focus(), 60); },
  saveSe: () => {
    const f = ui.sheet.f; const inp = document.getElementById('exName'); f.name = normalizeName(inp.value);
    if (!f.name) { inp.focus(); return; }
    D.addExerciseToSession(D.openSession().id, f.name, { timed: f.timed, sets: f.sets });
    ui.sheet = null; render();
    requestAnimationFrame(() => { const sc = document.getElementById('sc'); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); });
  },
  seMenu: (d) => {
    const se = D.byId(S.sessionExercises, +d.id); const name = exName(se.exerciseId);
    openMenu(name, [
      { icon: 'note', label: 'یادداشت', fn: () => textSheet('یادداشت', se.note || '', (v) => { D.setSessionExerciseNote(se.id, v); render(); }, { multi: true }) },
      { icon: 'history', label: 'تاریخچه', fn: () => push({ v: 'exercise', id: se.exerciseId }) },
      { icon: 'up', label: 'بالا', fn: () => { D.moveSessionExercise(se.id, -1); render(); } },
      { icon: 'down', label: 'پایین', fn: () => { D.moveSessionExercise(se.id, 1); render(); } },
      ...ssMenu(D.sessionExercisesOf(se.sessionId), se, D.sessionLink, D.sessionUnlink),
      { icon: 'trash', label: 'حذف', danger: true, fn: () => { if (S.hold && D.setsOf(se.id).some((x) => x.id === S.hold.setId)) S.hold = null; const snap = D.removeSessionExercise(se.id); withUndo(`«${name}» حذف شد`, () => D.restoreSessionExercise(snap)); render(); } },
    ]);
  },
  tick: (d) => doTick(+d.id),
  ssToggle: (d) => {
    const x = D.byId(S.dayExercises, +d.id); const l = D.dayExercisesOf(x.dayId); const nx = l[l.indexOf(x) + 1];
    if (nx && x.supersetId != null && nx.supersetId === x.supersetId) {
      // break the chain between x and nx: the part after x becomes its own group
      const gid = x.supersetId; const tail = l.slice(l.indexOf(nx)).filter((y) => y.supersetId === gid);
      const n = D.newGroupId(); tail.forEach((y) => (y.supersetId = n)); D.normalizeSupersets(l); D.save();
    } else D.dayLink(x.id);
    haptic(); render();
  },
  holdStart: (d) => startHold(+d.id),
  holdStop: () => stopHold(),
  holdCancel: () => { S.hold = null; D.save(); render(); },
  addSet: (d) => { D.addSet(+d.id); haptic(); render(); },
  copyPrev: (d) => {
    const x = D.byId(S.sets, +d.id); if (!x || x.isDone) return;
    const se = D.byId(S.sessionExercises, x.sessionExerciseId); const p = D.previousSets(se.exerciseId, se.sessionId)[+d.i]; if (!p) return;
    D.updateSetValues(x.id, p.weightKg, p.reps); haptic(); render();
  },
  setMenu: (d) => {
    const x = D.byId(S.sets, +d.id);
    openMenu(`ست ${fa(x.setIndex + 1)}`, [
      { icon: 'edit', label: 'ویرایش', fn: () => A.editSet({ id: x.id }) },
      { icon: 'trash', label: 'حذف ست', danger: true, fn: () => { if (S.hold?.setId === x.id) S.hold = null; const n = x.setIndex + 1; const snap = D.deleteSet(x.id); withUndo(`ست ${fa(n)} حذف شد`, () => D.restoreSet(snap)); render(); } },
    ]);
  },
  editSet: (d) => {
    const x = D.byId(S.sets, +d.id); const se = D.byId(S.sessionExercises, x.sessionExerciseId);
    ui.sheet = { type: 'set', setId: x.id, w: x.weightKg, r: x.reps, timed: isTimed(se.exerciseId), name: exName(se.exerciseId) };
    renderOverlay();
  },
  setSave: (d) => {
    readSetInputs(); const s = ui.sheet; const x = D.byId(S.sets, s.setId);
    document.activeElement?.blur?.();
    D.updateSetValues(x.id, s.w, s.r); ui.sheet = null; renderOverlay();
    if (d.k === '1' && !x.isDone) doTick(x.id); else render();
  },
  finish: () => {
    const s = D.openSession(); const m = workoutModel(s); const rem = m.total - m.done;
    const go = () => {
      S.hold = null;
      const kept = D.finishWorkout(s.id); S.rest = null; ui.fullRest = false;
      if (kept) { ui.tab = 'home'; ui.stack = [{ v: 'summary', id: s.id }]; render(true); } else resetTo('home');
    };
    if (m.done === 0) confirmDlg('پایان تمرین؟', 'ستی ثبت نشده؛ ذخیره نمی‌شه.', 'پایان', go);
    else if (rem > 0) confirmDlg('پایان تمرین؟', `${fa(rem)} ست انجام‌نشده ذخیره نمی‌شه.`, 'پایان', go, false);
    else go();
  },
  openFull: () => { ui.fullRest = true; renderRestBar(); renderOverlay(); },
  closeFull: () => { ui.fullRest = false; renderOverlay(); renderRestBar(); },
  restAdj: (d) => {
    if (!S.rest) return; const dd = +d.d;
    S.rest.endAt = Math.max(Date.now(), S.rest.endAt + dd * 1000); S.rest.total = Math.max(1, S.rest.total + dd);
    S.rest.ended = false; S.rest.warned = false; D.save(); tick();
  },
  restSkip: () => endRest(),
  closeHint: () => { S.hintClosed = true; D.save(); render(); },
  recTab: (d) => { ui.recTab = d.k; render(); },
  openEx: (d) => push({ v: 'exercise', id: +d.id }),
  openSession: (d) => push({ v: 'session', id: +d.id }),
  metric: (d) => { ui.metric = d.k; render(); },
  range: (d) => { ui.range = d.k; render(); },
  renameEx: (d) => { const e = D.exercise(+d.id); textSheet('تغییر نام حرکت', e.name, (v) => { if (!D.renameExercise(e.id, v)) toast('این نام تکراریه'); render(); }); },
  delSession: (d) => confirmDlg('حذف تمرین؟', 'ست‌های این جلسه پاک می‌شن.', 'حذف', () => { D.deleteSession(+d.id); pop(); }),
  editName: () => textSheet('نام', st().userName, (v) => { const n = normalizeName(v); if (n) { S.settings.userName = n; D.save(); } render(); }),
  restDef: (d) => { S.settings.defaultRestSec = Math.max(15, Math.min(600, st().defaultRestSec + +d.d)); D.save(); render(); },
  wstep: (d) => { S.settings.weightStep = +d.k; D.save(); render(); },
  toggleSetting: (d) => { S.settings[d.k] = !S.settings[d.k]; D.save(); if (d.k === 'sound' && S.settings.sound) beep('go'); render(); },
  exportJson: () => shareFile(`bashgah-${stamp()}.json`, D.exportBackup(), 'application/json'),
  exportCsv: () => shareFile(`bashgah-${stamp()}.csv`, D.csv(), 'text/csv'),
  importJson: () => document.getElementById('fileIn').click(),
  wipe: () => confirmDlg('پاک کردن همه؟', 'همهٔ برنامه‌ها و تاریخچه پاک می‌شن.', 'پاک کن', () => { D.resetAll(); ui.stack = []; ui.tab = 'home'; ui.onbName = ''; render(true); }),
  closeSheet: () => requestCloseSheet(),
  shareProgram: (d) => { const spec = D.programSpec(+d.id); if (spec) { ui.sheet = { type: 'share', spec }; renderOverlay(); } },
  shareSend: async () => {
    const spec = ui.sheet.spec; const text = P.toText(spec); const name = P.fileName(spec.name);
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: spec.name }); return; }
      if (navigator.share) { await navigator.share({ title: spec.name, text }); return; }
    } catch (e) { if (e?.name === 'AbortError') return; }
    shareFile(name, text, 'application/json');
  },
  shareCopy: async () => { toast((await copyText(P.toText(ui.sheet.spec))) ? 'کپی شد ✅' : 'کپی نشد'); },
  copyPrompt: async () => { toast((await copyText(P.CHATGPT_PROMPT)) ? 'کپی شد؛ توی ChatGPT بچسبون و هدفت رو بنویس ✅' : 'کپی نشد'); },
  importOpen: () => { ui.sheet = { type: 'import', text: '' }; renderOverlay(); },
  impPaste: async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { importParse(t); return; } } catch {}
    const ta = document.getElementById('impTxt'); ta?.focus(); toast('نگه دار و «Paste» رو بزن');
  },
  impFile: () => document.getElementById('progFile')?.click(),
  impNext: () => importParse(document.getElementById('impTxt')?.value || ''),
  impBack: () => { ui.sheet = { type: 'import', text: ui.sheet.text || '' }; renderOverlay(); },
  impDo: () => {
    const pid = D.importProgram(ui.sheet.spec); const name = D.program(pid)?.name || '';
    ui.sheet = null; ui.tab = 'program'; ui.stack = []; haptic(); render(true); toast(`«${name}» اضافه شد ✅`);
  },
  closeDialog: () => { ui.dialog = null; renderOverlay(); },
  dialogOk: () => { const f = ui.dialog.fn; ui.dialog = null; renderOverlay(); f(); },
  menuPick: (d) => { const it = ui.sheet.items[+d.i]; ui.sheet = null; renderOverlay(); it.fn(); },
  textOk: () => { const v = document.getElementById('txt').value; document.activeElement?.blur?.(); const fn = ui.sheet.fn; ui.sheet = null; renderOverlay(); fn(v); },
  undo: () => { const f = undoFn; undoFn = null; ui.toast = null; renderToast(); if (f) { f(); render(); } },
};

// ============================================================ events
document.addEventListener('click', (ev) => {
  unlockAudio();
  const el = ev.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  // a tap on a button inside the full-screen timer must not also close it
  if (el.classList.contains('full') && ev.target.closest('button')) return;
  ev.stopPropagation();
  fn(el.dataset, el, ev);
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'onbName') ui.onbName = t.value;
  if (t.id === 'exName' && ui.sheet?.f) { ui.sheet.f.name = t.value; const sg = document.getElementById('sugs'); if (sg) sg.innerHTML = sugsHtml(t.value); }
  if (t.id === 'exW' && ui.sheet?.f) ui.sheet.f.weight = t.value;
  if (t.id === 'exNote' && ui.sheet?.f) ui.sheet.f.note = t.value;
  if (t.id === 'recQ') { ui.recQuery = t.value; document.getElementById('recList').innerHTML = recList(); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { if (closeTop()) ev.preventDefault(); return; }
  if (ev.key !== 'Enter') return;
  const t = ev.target;
  if (t.id === 'onbName') { ev.preventDefault(); A.onbDone(); }
  else if (t.id === 'txt' && t.tagName === 'INPUT') { ev.preventDefault(); A.textOk(); }
  else if (t.tagName === 'INPUT') { ev.preventDefault(); t.blur(); }
});
document.addEventListener('focusout', (ev) => {
  const t = ev.target;
  if (ui.sheet?.type === 'set' && (t.id === 'sv-w' || t.id === 'sv-r')) { readSetInputs(); if (t.id === 'sv-w') t.value = ui.sheet.w > 0 ? weightFa(ui.sheet.w) : ''; else t.value = fa(ui.sheet.r); }
  // iOS: undo the page scroll the keyboard leaves behind
  setTimeout(() => { const a = document.activeElement; if (!a || a === document.body) window.scrollTo(0, 0); }, 60);
});
document.addEventListener('change', async (ev) => {
  if (ev.target.id === 'progFile') { const f = ev.target.files[0]; ev.target.value = ''; if (f) importParse(await f.text()); return; }
  if (ev.target.id !== 'fileIn') return;
  const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
  try {
    const data = D.decodeBackup(await f.text());
    confirmDlg('بازیابی پشتیبان؟', `${jMedium(data.exportedAt || Date.now())}: ${fa(data.sessions.length)} جلسه، ${fa(data.sets.length)} ست. داده‌های فعلی جایگزین می‌شن.`, 'بازیابی', () => { D.restoreBackup(data); ui.stack = []; ui.tab = 'home'; toast('بازیابی شد ✅'); render(true); }, false);
  } catch (e) { toast(e.message || 'فایل قابل خواندن نیست'); }
});
document.addEventListener('gesturestart', (e) => e.preventDefault()); // block pinch-zoom on iOS
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// ============================================================ boot
(async function boot() {
  await D.load();
  if (S.hold && !D.byId(S.sets, S.hold.setId)) S.hold = null;
  if (S.rest && S.rest.endAt < Date.now() - 5000) S.rest = null;
  if (S.onboarded && D.openSession()) ui.stack = [{ v: 'workout' }];
  render(true);
  if (S.hold && Date.now() - S.hold.startAt >= S.hold.targetSec * 1000) completeHold(S.hold, S.hold.targetSec);
  document.documentElement.classList.toggle('standalone', !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches));
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    try { await navigator.serviceWorker.register('sw.js'); } catch {}
  }
  window.__bashgah = { S: () => D.S, D, ui };
})();
