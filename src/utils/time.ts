/**
 * أداة إدارة الوقت بنظام 12 ساعة (صباحاً ومساءً / ص و م)
 * Brand Yemen - 12-Hour Time Utilities
 */

export type TimePeriod = 'AM' | 'PM';

export interface TimeParts12h {
  hour12: number;
  minute: string;
  period: TimePeriod;
}

/**
 * تحويل أي نص وقت (24 ساعة أو 12 ساعة) إلى أجزائه بنظام 12 ساعة
 */
export function parseTimeParts(val: string | undefined | null, fallbackHour = 9, fallbackPeriod: TimePeriod = 'AM'): TimeParts12h {
  if (!val) {
    return { hour12: fallbackHour, minute: '00', period: fallbackPeriod };
  }
  const str = String(val).trim();
  if (!str) {
    return { hour12: fallbackHour, minute: '00', period: fallbackPeriod };
  }

  const isPM = /م|مساء|pm/i.test(str);
  const isAM = /ص|صباح|am/i.test(str);
  const clean = str.replace(/[^\d:]/g, '');
  const parts = clean.split(':');

  let h = parseInt(parts[0] || String(fallbackHour), 10);
  let m = parseInt(parts[1] || '0', 10);
  if (isNaN(h)) h = fallbackHour;
  if (isNaN(m)) m = 0;

  let period: TimePeriod = fallbackPeriod;
  if (isPM) {
    period = 'PM';
    if (h > 12) h = h % 12 || 12;
    if (h === 0) h = 12;
  } else if (isAM) {
    period = 'AM';
    if (h > 12) h = h % 12 || 12;
    if (h === 0) h = 12;
  } else {
    // 24-hour string like "22:00" or "09:00"
    period = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
  }

  const mStr = m < 10 ? `0${m}` : `${m}`;
  return { hour12: h, minute: mStr, period };
}

/**
 * تحويل أجزاء نظام 12 ساعة إلى صيغة 24 ساعة قياسية (HH:mm)
 */
export function to24hString(hour12: number, minute: string | number, period: TimePeriod): string {
  let h = Number(hour12) || 12;
  const m = Number(minute) || 0;

  if (period === 'PM') {
    if (h < 12) h += 12;
  } else {
    if (h === 12) h = 0;
  }

  const hStr = h < 10 ? `0${h}` : `${h}`;
  const mStr = m < 10 ? `0${m}` : `${m}`;
  return `${hStr}:${mStr}`;
}

/**
 * تنسيق الوقت بنظام 12 ساعة مع العربية (ص / م أو صباحاً / مساءً)
 * مثال: "09:00" -> "9:00 ص" (أو "9:00 صباحاً" إذا كان fullText = true)
 * مثال: "22:00" -> "10:00 م" (أو "10:00 مساءً" إذا كان fullText = true)
 */
export function formatTime12h(val: string | undefined | null, fullText: boolean = false): string {
  if (!val) return '';
  const { hour12, minute, period } = parseTimeParts(val);
  const periodText = period === 'AM' 
    ? (fullText ? 'صباحاً' : 'ص') 
    : (fullText ? 'مساءً' : 'م');
  return `${hour12}:${minute} ${periodText}`;
}

/**
 * تحويل أي صيغة وقت إلى دقائق من منتصف الليل (0 إلى 1439)
 * تدعم صيغ 24 ساعة و12 ساعة مع ص/م/صباحاً/مساءً
 */
export function timeToMinutes(v: string | undefined | null): number {
  if (!v) return 0;
  const str = String(v).trim();
  const isPM = /م|مساء|pm/i.test(str);
  const isAM = /ص|صباح|am/i.test(str);
  const clean = str.replace(/[^\d:]/g, '');
  const parts = clean.split(':');
  let h = parseInt(parts[0] || '0', 10);
  const m = parseInt(parts[1] || '0', 10);
  if (isNaN(h)) h = 0;
  const minuteVal = isNaN(m) ? 0 : m;

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return h * 60 + minuteVal;
}

/**
 * التحقق مما إذا كان المتجر مفتوحاً الآن
 */
export function isStoreOpenNow(hoursOpen: string | undefined | null, hoursClose: string | undefined | null, date: Date = new Date()): boolean {
  const o = timeToMinutes(hoursOpen || '09:00');
  const c = timeToMinutes(hoursClose || '22:00');
  const t = date.getHours() * 60 + date.getMinutes();
  if (c <= o) {
    // يغلق بعد منتصف الليل
    return t >= o || t < c;
  }
  return t >= o && t < c;
}
