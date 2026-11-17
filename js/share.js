// Program sharing: one small JSON format shared by the web app, the Android app and ChatGPT.
// Spec: /PROGRAM_FORMAT.md  ({"bashgah":"program","v":1,"name":..,"days":[{"name":..,"exercises":[..]}]})
// The parser is deliberately lenient: chat text around the JSON, ``` fences, Persian/Arabic digits,
// trailing commas, comments, "8–12" / "8 تا 12" ranges, "1:30" / "2 min" rests, aliases for keys.

export const FORMAT = 'program';
export const FORMAT_VERSION = 1;
const DEF = { sets: 3, repMin: 8, repMax: 12, timeMin: 30, timeMax: 30, rest: 90 };

const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
export const asciiDigits = (s) => String(s).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/٫/g, '.');

// ------------------------------------------------------------ JSON extraction
/** Apply fn to the parts of a JSON-ish text that are outside string literals. */
function outsideStrings(t, fn) {
  let out = '', i = 0;
  const re = /"(?:[^"\\]|\\.)*"/g; let m;
  while ((m = re.exec(t))) { out += fn(t.slice(i, m.index)) + m[0]; i = m.index + m[0].length; }
  return out + fn(t.slice(i));
}
function candidates(text) {
  let t = String(text ?? '').replace(/^\uFEFF/, '');
  const out = [];
  const fences = [...t.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const pool = fences.length ? [...fences, t] : [t];
  for (const p of pool) {
    const a = p.indexOf('{'), b = p.lastIndexOf('}');
    const c = p.indexOf('['), d = p.lastIndexOf(']');
    const obj = a >= 0 && b > a ? p.slice(a, b + 1) : null, arr = c >= 0 && d > c ? p.slice(c, d + 1) : null;
    // whichever bracket opens first is the outermost value
    if (arr && (!obj || c < a)) out.push(arr);
    if (obj) out.push(obj);
  }
  return out;
}
function cleanup(t) {
  t = t.replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"').replace(/[\u2018\u2019]/g, "'");
  return outsideStrings(t, (s) => asciiDigits(s)
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')); // unquoted keys
}
export function extractJson(text) {
  for (const c of candidates(text)) {
    for (const v of [c, cleanup(c)]) { try { return JSON.parse(v); } catch {} }
  }
  return undefined;
}

// ------------------------------------------------------------ value helpers
function get(o, keys) {
  if (!o || typeof o !== 'object') return undefined;
  const low = {}; for (const k of Object.keys(o)) low[k.toLowerCase().replace(/[\s_-]/g, '')] = o[k];
  for (const k of keys) { const v = low[k.toLowerCase().replace(/[\s_-]/g, '')]; if (v !== undefined && v !== null && v !== '') return v; }
  return undefined;
}
const nums = (v) => (asciiDigits(v).match(/\d+(?:\.\d+)?/g) || []).map(Number);
/** [min, max] from 10, "8-12", "8–12", "8 تا 12", "8 to 12", [8, 12], "30s", "1:00". */
export function parseRange(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? [v, v] : null;
  if (Array.isArray(v)) { const n = v.map(Number).filter(isFinite); return n.length ? [Math.min(...n), Math.max(...n)] : null; }
  if (typeof v === 'object') { const a = Number(get(v, ['min', 'from'])), b = Number(get(v, ['max', 'to'])); return isFinite(a) ? [a, isFinite(b) ? b : a] : null; }
  const s = asciiDigits(v);
  const clock = [...s.matchAll(/(\d+):(\d{1,2})/g)].map((m) => +m[1] * 60 + +m[2]);
  if (clock.length) return [Math.min(...clock), Math.max(...clock)];
  let n = nums(s); if (!n.length) return null;
  if (/min|دقیقه|دق/i.test(s) && !/sec|ثانیه|s\b/i.test(s)) n = n.map((x) => x * 60);
  return [Math.min(n[0], n[n.length > 1 ? 1 : 0]), Math.max(n[0], n[n.length > 1 ? 1 : 0])];
}
/** Seconds from 90, "90s", "1:30", "2 min", "۲ دقیقه", "1.5 min". */
export function parseSeconds(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null;
  const s = asciiDigits(v);
  const c = s.match(/(\d+):(\d{1,2})/); if (c) return +c[1] * 60 + +c[2];
  const n = nums(s); if (!n.length) return null;
  if (/min|دقیقه|دق|\bm\b/i.test(s)) return Math.round(n[0] * 60 + (n[1] && /sec|ثانیه|s\b/i.test(s) ? n[1] : 0));
  return Math.round(n[0]);
}
const truthy = (v) => v === true || (typeof v === 'string' && /^(true|yes|y|1|بله|آره|هر\s*سمت)$/i.test(v.trim())) || v === 1;
const looksTimed = (v) => typeof v === 'string' && /(\d\s*(s|sec|secs|second|seconds)\b)|ثانیه|\d\s*ث\b|\d+:\d{2}/i.test(asciiDigits(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------ parse
/**
 * Parse anything a person or a chatbot might paste.
 * Returns { ok: true, program, warnings } or { ok: false, error }.
 * program = { name, days: [{ name, exercises: [{ name, sets, repMin, repMax, timed, perSide, restSec, weight, note, group }] }] }
 */
export function parseProgram(input) {
  let root = typeof input === 'string' ? extractJson(input) : input;
  if (root === undefined) return { ok: false, error: 'متن برنامه پیدا نشد' };
  const warnings = [];
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const inner = get(root, ['program', 'برنامه', 'plan', 'workout']);
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) root = { ...inner, name: get(inner, ['name', 'title']) ?? get(root, ['name', 'title']) };
  }
  let daysRaw = Array.isArray(root) ? root : get(root, ['days', 'روزها', 'workouts', 'sessions', 'schedule', 'week']);
  if (!daysRaw && get(root, ['exercises', 'حرکات', 'حرکت‌ها'])) daysRaw = [root];
  if (daysRaw && !Array.isArray(daysRaw) && typeof daysRaw === 'object') daysRaw = Object.entries(daysRaw).map(([k, v]) => (Array.isArray(v) ? { name: k, exercises: v } : { name: k, ...v }));
  if (!Array.isArray(daysRaw)) return { ok: false, error: 'روزهای برنامه پیدا نشد' };
  // a flat list of exercises (no days) -> one day
  const EXK = ['exercises', 'حرکات', 'حرکت‌ها', 'items', 'moves', 'exercise'];
  if (daysRaw.length && daysRaw.every((d) => typeof d === 'string' || (d && typeof d === 'object' && !Array.isArray(d) && !Array.isArray(get(d, EXK)))) && daysRaw.some((d) => typeof d === 'string' || get(d, ['name', 'exercise', 'title', 'نام', 'حرکت']) !== undefined)) daysRaw = [{ exercises: daysRaw }];
  const defRest = parseSeconds(get(root, ['rest', 'restSec', 'defaultRest'])) ?? DEF.rest;
  let skipped = 0;
  const days = daysRaw.map((d, di) => {
    const list = Array.isArray(d) ? d : get(d, ['exercises', 'حرکات', 'حرکت‌ها', 'items', 'moves', 'exercise']) || [];
    let dayName = Array.isArray(d) || typeof d !== 'object' ? '' : normName(get(d, ['name', 'title', 'نام', 'focus', 'day']) ?? '');
    if (/^(day|روز)\s*\d+$/i.test(asciiDigits(dayName)) && nums(dayName)[0] === di + 1) dayName = ''; // "Day 1" is implied by position
    const exercises = (Array.isArray(list) ? list : []).map((x) => parseExercise(x, defRest)).filter((x) => { if (!x) skipped++; return !!x; });
    return { name: dayName, exercises };
  });
  if (skipped) warnings.push(`${skipped} حرکت بدون نام رد شد`);
  if (!days.some((d) => d.exercises.length)) return { ok: false, error: 'هیچ حرکتی پیدا نشد' };
  // superset groups: consecutive exercises with the same label; a group's rest = its last member's
  let runs = 0;
  for (const d of days) {
    const ex = d.exercises;
    for (let i = 0; i < ex.length; i++) {
      if (ex[i].group == null) continue;
      let j = i; while (j + 1 < ex.length && ex[j + 1].group === ex[i].group) j++;
      if (j === i) ex[i].group = null;
      else { const r = ex[j].restSec; const gid = `g${++runs}`; for (let k = i; k <= j; k++) { ex[k].restSec = r; ex[k].group = gid; } }
      i = j;
    }
  }
  const name = normName(get(root, ['name', 'title', 'programName', 'نام']) ?? '') || 'برنامهٔ وارد‌شده';
  return { ok: true, program: { name: name.slice(0, 60), days }, warnings };
}
function parseExercise(x, defRest) {
  if (typeof x === 'string') x = { name: x };
  if (!x || typeof x !== 'object') return null;
  const name = normName(get(x, ['name', 'exercise', 'title', 'نام', 'حرکت', 'movement']) ?? '');
  if (!name) return null;
  let setsV = get(x, ['sets', 'set', 'ست', 'rounds']);
  let repsV = get(x, ['reps', 'rep', 'repetitions', 'تکرار', 'range']);
  const timeV = get(x, ['time', 'seconds', 'sec', 'duration', 'hold', 'زمان', 'ثانیه']);
  // "4x8-12" in sets or reps
  const sx = [setsV, repsV].find((v) => typeof v === 'string' && /\d\s*[x×*]\s*\d/i.test(asciiDigits(v)));
  if (sx) { const m = asciiDigits(sx).match(/(\d+)\s*[x×*]\s*(.+)/i); setsV = +m[1]; if (repsV == null || repsV === sx) repsV = m[2]; }
  const timed = timeV != null || truthy(get(x, ['timed', 'isTimed'])) || looksTimed(repsV);
  let r = parseRange(timed ? (timeV ?? repsV) : repsV);
  if (!r || r[1] <= 0) r = timed ? [DEF.timeMin, DEF.timeMax] : [DEF.repMin, DEF.repMax];
  const sets = clamp(Math.round(nums(setsV ?? DEF.sets)[0] ?? DEF.sets), 1, 20);
  const restSec = clamp(parseSeconds(get(x, ['rest', 'restSec', 'restSeconds', 'استراحت', 'break'])) ?? defRest, 15, 600);
  const w = Number(nums(get(x, ['weight', 'weightKg', 'kg', 'load', 'وزنه', 'وزن']) ?? '')[0]);
  const g = get(x, ['superset', 'group', 'supersetGroup', 'سوپرست']);
  const note = get(x, ['note', 'notes', 'tip', 'cue', 'یادداشت', 'توضیح']);
  return {
    name: name.slice(0, 60), sets,
    repMin: clamp(Math.round(r[0]), 1, 999), repMax: clamp(Math.round(Math.max(r[0], r[1])), 1, 999),
    timed, perSide: truthy(get(x, ['perSide', 'eachSide', 'unilateral', 'هرسمت', 'هر سمت'])), restSec,
    weight: w > 0 ? Math.round(w * 100) / 100 : null,
    note: note != null && String(note).trim() ? String(note).trim().slice(0, 200) : null,
    group: g === false || g == null ? null : String(asciiDigits(g)).trim().toUpperCase() || null,
  };
}

// ------------------------------------------------------------ export
const LETTERS = 'ABCDEFGHIJ';
/** Canonical, compact export of a parsed-shape program (same output on web and Android). */
export function toFormat(p) {
  return {
    bashgah: FORMAT, v: FORMAT_VERSION, name: p.name,
    days: p.days.map((d) => {
      let gi = 0; const map = new Map();
      return {
        name: d.name || '',
        exercises: d.exercises.map((x) => {
          const o = { name: x.name, sets: x.sets };
          const range = x.repMin === x.repMax ? String(x.repMin) : `${x.repMin}-${x.repMax}`;
          if (x.timed) o.time = range; else o.reps = range;
          o.rest = x.restSec;
          if (x.perSide) o.perSide = true;
          if (x.weight) o.weight = x.weight;
          if (x.group != null) { if (!map.has(x.group)) map.set(x.group, LETTERS[gi++ % LETTERS.length]); o.superset = map.get(x.group); }
          if (x.note) o.note = x.note;
          return o;
        }),
      };
    }),
  };
}
export const toText = (p) => JSON.stringify(toFormat(p), null, 2);
export const fileName = (name) => `${(normName(name) || 'program').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 40)}.bashgah.json`;
export const summaryOf = (p) => ({ days: p.days.length, exercises: p.days.reduce((n, d) => n + d.exercises.length, 0), supersets: p.days.reduce((n, d) => n + new Set(d.exercises.filter((x) => x.group != null).map((x) => x.group)).size, 0) });

// ------------------------------------------------------------ ChatGPT prompt
export const CHATGPT_PROMPT = `یک برنامهٔ تمرینی برای اپ «باشگاه» بساز. خروجی فقط و فقط یک بلوک JSON با همین ساختار باشد، بدون هیچ توضیح اضافه:

{"bashgah":"program","v":1,"name":"نام برنامه","days":[
 {"name":"سینه و پشت‌بازو","exercises":[
  {"name":"پرس سینه هالتر","sets":4,"reps":"8-12","rest":90},
  {"name":"قفسه سینه دمبل","sets":3,"reps":"10-12","rest":60,"superset":"A"},
  {"name":"پشت‌بازو سیم‌کش","sets":3,"reps":"12-15","rest":60,"superset":"A"},
  {"name":"پلانک","sets":3,"time":"30-45","rest":45},
  {"name":"لانج دمبل","sets":3,"reps":"10","rest":60,"perSide":true,"note":"آرام و کنترل‌شده"}
 ]}
]}

قوانین:
- هر روز یک آیتم در days است و ترتیب روزها همان ترتیب تمرین است.
- reps تعداد تکرار است: عدد یا بازه مثل "8-12".
- برای حرکات زمانی (پلانک، نگه‌داشتن و…) به‌جای reps از time به ثانیه استفاده کن، مثل "30-45".
- rest استراحت بعد از هر ست به ثانیه است.
- برای سوپرست، به حرکات پشت‌سرهم یک حرف یکسان بده: "superset":"A" (سوپرست بعدی "B").
- perSide فقط برای حرکات یک‌طرفه: true. note و weight (کیلو) اختیاری‌اند.
- نام حرکات فارسی باشد.

هدف و شرایط من:
`;
