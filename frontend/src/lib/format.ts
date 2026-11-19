const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** API dates are ISO UTC; people see Asia/Kolkata. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : IST.format(d);
}

const IST_DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
});
const IST_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** An ISO calendar date (YYYY-MM-DD) shown as "5 Jan 2026"; "-" when empty. */
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const d = new Date(`${isoDate}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? '-' : IST_DAY.format(d);
}

/** Today's calendar date in Asia/Kolkata as YYYY-MM-DD (hospital "today"). */
export function todayIso(): string {
  return IST_ISO.format(new Date());
}
