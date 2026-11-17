// Formatting, Persian digits, Jalali calendar
const FA = '۰۱۲۳۴۵۶۷۸۹';
export function fa(v) {
  const s = String(v);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c >= '0' && c <= '9') out += FA[c.charCodeAt(0) - 48];
    else if (c === '.' && i > 0 && i < s.length - 1 && /\d/.test(s[i - 1]) && /\d/.test(s[i + 1])) out += '٫';
    else out += c;
  }
  return out;
}
export function num(v, maxDec = 2) {
  if (!isFinite(v)) return '0';
  const p = Math.pow(10, maxDec);
  const r = Math.round(v * p) / p;
  return String(r);
}
export const weightFa = (v) => fa(num(v));
export function groupedFa(v) {
  const n = Math.round(v);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return fa((n < 0 ? '-' : '') + s);
}
export function normalizeNum(s) {
  let out = '';
  for (const c of String(s)) {
    const cc = c.charCodeAt(0);
    if (cc >= 0x6f0 && cc <= 0x6f9) out += String.fromCharCode(48 + cc - 0x6f0);
    else if (cc >= 0x660 && cc <= 0x669) out += String.fromCharCode(48 + cc - 0x660);
    else if ('٫,،/'.includes(c)) out += '.';
    else if ((c >= '0' && c <= '9') || c === '.') out += c;
  }
  return out;
}
export function parseWeight(s) {
  const n = parseFloat(normalizeNum(s));
  return isFinite(n) && n >= 0 && n < 2000 ? n : null;
}
export function parseReps(s) {
  const n = parseInt(normalizeNum(s).split('.')[0], 10);
  return isFinite(n) && n >= 0 && n <= 999 ? n : null;
}
export function clockFa(totalSec) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (x) => String(x).padStart(2, '0');
  return fa(h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`);
}
export function durationFa(ms) {
  const t = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(t / 60), m = t % 60;
  if (h > 0 && m > 0) return `${fa(h)} ساعت و ${fa(m)} دقیقه`;
  if (h > 0) return `${fa(h)} ساعت`;
  return `${fa(m)} دقیقه`;
}
export function restFa(sec) {
  if (sec < 60) return `${fa(sec)}ث`;
  if (sec % 60 === 0) return `${fa(sec / 60)} دقیقه`;
  return clockFa(sec);
}
export const repsLabel = (a, b) => (b > a ? `${fa(a)}–${fa(b)}` : fa(a));
export const secFa = (s) => `${fa(s)}ث`;
export function setFa(w, r, timed = false, compact = false) {
  const rr = timed ? secFa(r) : fa(r);
  if (w > 0) return `${weightFa(w)}×${rr}`;
  if (timed || compact) return rr;
  return `${rr} تکرار`;
}
export const targetFa = (a, b, timed) => repsLabel(a, b) + (timed ? 'ث' : '');
export const ltr = (s) => `\u2066${s}\u2069`;
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const normalizeName = (s) => String(s || '').trim().replace(/\s+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک');

// ---- Jalali
export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const WD = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']; // JS getDay 0=Sun
export const WEEK_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export function toJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  let jm, jd;
  if (days < 186) { jm = 1 + Math.floor(days / 31); jd = 1 + (days % 31); }
  else { jm = 7 + Math.floor((days - 186) / 30); jd = 1 + ((days - 186) % 30); }
  return { y: jy, m: jm, d: jd };
}
export function jOf(ms) { const d = new Date(ms); return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
export const weekdayFa = (ms) => WD[new Date(ms).getDay()];
export function jFull(ms) { const j = jOf(ms); return `${weekdayFa(ms)} ${fa(j.d)} ${MONTHS[j.m - 1]} ${fa(j.y)}`; }
export function jMedium(ms) { const j = jOf(ms); return `${fa(j.d)} ${MONTHS[j.m - 1]} ${fa(j.y)}`; }
export function jShort(ms) { const j = jOf(ms); return `${fa(j.d)} ${MONTHS[j.m - 1]}`; }
export function jNum(ms) { const j = jOf(ms); return fa(`${j.m}/${j.d}`); }
export function jIso(ms) { const j = jOf(ms); const p = (x) => String(x).padStart(2, '0'); return `${j.y}/${p(j.m)}/${p(j.d)}`; }
export function timeFa(ms) { const d = new Date(ms); return fa(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`); }
export function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
/** Saturday-start week (Iranian week). */
export function weekStart(ms) {
  const d = new Date(ms); d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 1) % 7; // Sat=0
  d.setDate(d.getDate() - back);
  return d.getTime();
}
export function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
