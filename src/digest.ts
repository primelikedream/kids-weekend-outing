import type { DayWeather } from "./weather.js";
import type { Spot } from "./types.js";
import type { DigestMail } from "./mailer.js";

const WEATHER_FIT_LABEL: Record<Spot["weatherFit"], string> = {
  indoor: "室内向き",
  outdoor: "屋外向き",
  either: "室内・屋外どちらも",
};

function spotTextBlock(spot: Spot, i: number): string {
  const lines = [`${i + 1}. ${spot.name}(${spot.category} / ${WEATHER_FIT_LABEL[spot.weatherFit]})`];
  if (spot.reason) lines.push(`   ${spot.reason}`);
  if (spot.accessCar) lines.push(`   車: ${spot.accessCar}`);
  if (spot.accessTransit) lines.push(`   バス+電車: ${spot.accessTransit}`);
  if (spot.url) lines.push(`   ${spot.url}`);
  return lines.join("\n");
}

function spotHtmlCard(spot: Spot): string {
  const access = [
    spot.accessCar ? `<div>🚗 ${escapeHtml(spot.accessCar)}</div>` : "",
    spot.accessTransit ? `<div>🚌 ${escapeHtml(spot.accessTransit)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <div style="border:1px solid #f0d9b5;border-radius:12px;padding:16px;margin-bottom:14px;background:#fffaf0;">
      <div style="font-size:1.1em;font-weight:bold;color:#c2571a;">${escapeHtml(spot.name)}</div>
      <div style="font-size:0.85em;color:#7a5c2e;margin:2px 0 8px;">${escapeHtml(spot.category)} ・ ${WEATHER_FIT_LABEL[spot.weatherFit]}</div>
      ${spot.reason ? `<div style="margin-bottom:8px;">${escapeHtml(spot.reason)}</div>` : ""}
      <div style="font-size:0.9em;color:#555;">${access}</div>
      ${spot.url ? `<div style="margin-top:8px;"><a href="${spot.url}" style="color:#c2571a;">詳細を見る →</a></div>` : ""}
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDigestMail(params: {
  targetDateLabel: string;
  weather: DayWeather | null;
  spots: Spot[];
}): DigestMail {
  const { targetDateLabel, weather, spots } = params;

  const subject =
    spots.length > 0
      ? `【週末おでかけ提案】${targetDateLabel}の候補 ${spots.length}件`
      : `【週末おでかけ提案】${targetDateLabel}は候補を見つけられませんでした`;

  const weatherLine = weather ? `天気予報: ${weather.summary}` : "天気予報は取得できませんでした。";

  const disclaimer =
    "屋内/屋外の分類やアクセス情報は地図データからの推定・目安です。営業時間・休園日は各施設の公式サイトでご確認ください。";

  const text =
    spots.length > 0
      ? `${targetDateLabel}のおでかけ候補です。\n${weatherLine}\n\n${spots.map(spotTextBlock).join("\n\n")}\n\n※${disclaimer}`
      : `${targetDateLabel}のおでかけ候補を見つけられませんでした。\n${weatherLine}`;

  const html = `
    <h2 style="color:#c2571a;">${escapeHtml(targetDateLabel)}のおでかけ候補</h2>
    <p style="color:#666;">${escapeHtml(weatherLine)}</p>
    ${spots.length > 0 ? spots.map(spotHtmlCard).join("") : "<p>今回は候補を見つけられませんでした。</p>"}
    ${spots.length > 0 ? `<p style="font-size:0.8em;color:#999;">※${escapeHtml(disclaimer)}</p>` : ""}
  `;

  return { subject, text, html };
}
