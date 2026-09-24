/** Africa/Nairobi is UTC+3 all year (no DST), which keeps these helpers dependency-free (DECISIONS D-12). */

export const TZ = 'Africa/Nairobi';
const OFFSET_MS = 3 * 60 * 60 * 1000;

export function formatDateTime(d: Date | string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-KE', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short', ...opts }).format(new Date(d));
}

export function formatDate(d: Date | string): string {
  return new Intl.DateTimeFormat('en-KE', { timeZone: TZ, dateStyle: 'medium' }).format(new Date(d));
}

export function formatTime(d: Date | string): string {
  return new Intl.DateTimeFormat('en-KE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

/** Minutes since local (Nairobi) midnight. */
export function nairobiMinuteOfDay(d: Date): number {
  const local = new Date(d.getTime() + OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Bad time ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** True if `d` falls inside a quiet window like 21:00-07:00 (may wrap midnight). */
export function inQuietHours(d: Date, start: string, end: string): boolean {
  const t = nairobiMinuteOfDay(d);
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === e) return false;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The instant quiet hours end (next occurrence of `end` in Nairobi), or `d` itself if not in quiet hours. */
export function quietHoursRelease(d: Date, start: string, end: string): Date {
  if (!inQuietHours(d, start, end)) return d;
  const minutesUntil = (parseHHMM(end) - nairobiMinuteOfDay(d) + 1440) % 1440;
  const release = new Date(d.getTime() + minutesUntil * 60000);
  release.setUTCSeconds(0, 0);
  return release;
}

/** Build a Date from a Nairobi local date (YYYY-MM-DD) and time (HH:MM). */
export function nairobiDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

export function nairobiToday(now = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type OpeningHours = Partial<Record<Weekday, { open: string; close: string } | null>>;

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[new Date(`${date}T12:00:00+03:00`).getUTCDay()];
}

export type Slot = { start: Date; end: Date; label: string };

/** Pickup/drop-off slots for a date within opening hours, at least `leadMinutes` from now (PLAN assumption 4). */
export function deliverySlots(date: string, hours: OpeningHours, now = new Date(), leadMinutes = 60, slotMinutes = 120): Slot[] {
  const day = hours[weekdayOf(date)];
  if (!day) return [];
  const open = parseHHMM(day.open);
  const close = parseHHMM(day.close);
  const slots: Slot[] = [];
  for (let m = open; m + slotMinutes <= close; m += slotMinutes) {
    const start = nairobiDateTime(date, hhmm(m));
    if (start.getTime() < now.getTime() + leadMinutes * 60000) continue;
    slots.push({ start, end: nairobiDateTime(date, hhmm(m + slotMinutes)), label: `${hhmm(m)}–${hhmm(m + slotMinutes)}` });
  }
  return slots;
}
