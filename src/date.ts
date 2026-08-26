// JST(UTC+9、夏時間なし)を基準に日付を扱うヘルパー。
// GitHub Actions(UTC)上でも実行時刻がそのまま日本の週末朝になるよう、
// タイムスタンプへ+9時間して UTC フィールドを読むことでJSTの壁時計時刻を再現する。
export function jstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

export function jstDateString(d: Date = jstNow()): string {
  return d.toISOString().slice(0, 10);
}

// jstNow() で得たDateに対して呼ぶこと。0=日曜 6=土曜
export function jstWeekday(d: Date = jstNow()): number {
  return d.getUTCDay();
}

// 指定日時から見て直近の土曜日(当日が土曜ならそのまま)のDateを返す
export function nextSaturday(d: Date = jstNow()): Date {
  const weekday = jstWeekday(d);
  const daysToSat = weekday === 6 ? 0 : (6 - weekday + 7) % 7;
  const result = new Date(d);
  result.setUTCDate(result.getUTCDate() + daysToSat);
  return result;
}

const WEEKDAY_LABEL_JA = ["日", "月", "火", "水", "木", "金", "土"];

export function formatJstDateLabel(dateIso: string, weekday: number): string {
  const [y, m, d] = dateIso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日(${WEEKDAY_LABEL_JA[weekday]})`;
}
