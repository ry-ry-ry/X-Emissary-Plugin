const MONTHS = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

const MONTH_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function extractDate(text, fallbackIso, dateFormat = "long") {
  const fallback = fallbackIso ? new Date(fallbackIso) : new Date();
  const fromText = findInText(text || "", fallback);
  const date = fromText || fallback;
  return {
    iso: toIsoDate(date),
    label: formatLabel(date, dateFormat),
    source: fromText ? "text" : "posted",
  };
}

function findInText(text, anchor) {
  return (
    matchIso(text) ||
    matchSlash(text) ||
    matchWordMonthFirst(text, anchor) ||
    matchDayThenMonth(text, anchor) ||
    matchRelative(text, anchor)
  );
}

function matchIso(text) {
  const m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (!m) return null;
  return makeDate(+m[1], +m[2] - 1, +m[3]);
}

function matchSlash(text) {
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!m) return null;
  let a = +m[1], b = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  let month, day;
  if (a > 12 && b <= 12) { day = a; month = b - 1; }
  else { month = a - 1; day = b; }
  return makeDate(y, month, day);
}

function matchWordMonthFirst(text, anchor) {
  const re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i;
  const m = text.match(re);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = +m[2];
  const year = m[3] ? +m[3] : anchor.getUTCFullYear();
  return makeDate(year, month, day);
}

function matchDayThenMonth(text, anchor) {
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s+(\d{4}))?\b/i;
  const m = text.match(re);
  if (!m) return null;
  const day = +m[1];
  const month = MONTHS[m[2].toLowerCase()];
  const year = m[3] ? +m[3] : anchor.getUTCFullYear();
  return makeDate(year, month, day);
}

function matchRelative(text, anchor) {
  const lower = text.toLowerCase();
  if (/\btoday\b/.test(lower)) return offsetDays(anchor, 0);
  if (/\btomorrow\b/.test(lower)) return offsetDays(anchor, 1);
  if (/\byesterday\b/.test(lower)) return offsetDays(anchor, -1);
  let m;
  if ((m = lower.match(/\b(\d+)\s+days?\s+ago\b/))) return offsetDays(anchor, -(+m[1]));
  if ((m = lower.match(/\bin\s+(\d+)\s+days?\b/))) return offsetDays(anchor, +m[1]);
  if ((m = lower.match(/\b(\d+)\s+weeks?\s+ago\b/))) return offsetDays(anchor, -(+m[1]) * 7);
  if ((m = lower.match(/\bin\s+(\d+)\s+weeks?\b/))) return offsetDays(anchor, +m[1] * 7);
  if (/\bnext\s+week\b/.test(lower)) return offsetDays(anchor, 7);
  if (/\blast\s+week\b/.test(lower)) return offsetDays(anchor, -7);
  if (/\bnext\s+month\b/.test(lower)) return offsetMonths(anchor, 1);
  if (/\blast\s+month\b/.test(lower)) return offsetMonths(anchor, -1);
  if (/\bnext\s+year\b/.test(lower)) return offsetMonths(anchor, 12);
  if (/\blast\s+year\b/.test(lower)) return offsetMonths(anchor, -12);
  return null;
}

function makeDate(y, m, d) {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d) return null;
  return date;
}

function offsetDays(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + n));
}

function offsetMonths(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, date.getUTCDate()));
}

function toIsoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatLabel(d, mode) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (mode === "iso") return toIsoDate(d);
  if (mode === "short") return `${MONTH_SHORT[m]} ${day}, ${y}`;
  return `${MONTH_LONG[m]} ${day}, ${y}`;
}
