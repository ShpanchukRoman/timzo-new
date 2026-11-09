export const DEFAULT_LIMITS = [26,26,26,26,26,20,20];
export function weekStart(value) {
  if (!/^\d{4}-W\d{2}$/.test(value || '')) return null;
  const [year, week] = value.split('-W').map(Number);
  if (year < 2000 || year > 2200 || week < 1 || week > 53) return null;
  const d = new Date(Date.UTC(year,0,4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay()+6)%7) + (week-1)*7);
  return isoWeek(d) === value ? d : null;
}
export function isoWeek(date) {
  const d=new Date(date);d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const year=d.getUTCFullYear();
  return `${year}-W${String(Math.ceil((((d-new Date(Date.UTC(year,0,1)))/86400000)+1)/7)).padStart(2,'0')}`;
}
export function shiftHours(value) {
  if (!value) return 0;
  const match = /^(\d{1,2})(?::([0-5]\d))?\s*-\s*(\d{1,2})(?::([0-5]\d))?$/.exec(value.trim());
  if (!match || +match[1]>23 || +match[3]>23) return null;
  const start=+match[1]*60+(+match[2]||0), end=+match[3]*60+(+match[4]||0);
  return end>start ? (end-start)/60 : null;
}
export function entryHours(entry) {
  if (entry.locked) return 0;
  const total=(shiftHours(entry.primary)||0)+(shiftHours(entry.secondary)||0);
  return total>=5.75 ? Math.max(total-1,0) : total;
}
export function entryDate(week, dayIndex) {
  const date=weekStart(week); if (!date) return null;
  date.setUTCDate(date.getUTCDate()+dayIndex);return date;
}
export function validHours(value) { return (typeof value==='number'||typeof value==='string') && value!=='' && Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=100000; }
