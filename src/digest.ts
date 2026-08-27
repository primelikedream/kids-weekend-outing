import type { DayWeather } from "./weather.js";
import type { Spot } from "./types.js";
import type { DigestMail } from "./mailer.js";

const DEFAULT_DASHBOARD_URL = "https://primelikedream.github.io/kids-weekend-outing/";

export interface DaySuggestion {
  targetDateLabel: string;
  weather: DayWeather | null;
  spots: Spot[];
}

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
  if (spot.eventInfo) {
    lines.push(`   🎪 ${spot.eventInfo.title} — ${spot.eventInfo.snippet}`);
    lines.push(`      ${spot.eventInfo.url}`);
  }
  return lines.join("\n");
}

function dayTextBlock(day: DaySuggestion): string {
  const weatherLine = day.weather ? `天気予報: ${day.weather.summary}` : "天気予報は取得できませんでした。";
  const body =
    day.spots.length > 0
      ? day.spots.map(spotTextBlock).join("\n\n")
      : "今回は候補を見つけられませんでした。";
  return `■ ${day.targetDateLabel}\n${weatherLine}\n\n${body}`;
}

function spotHtmlCard(spot: Spot): string {
  const access = [
    spot.accessCar ? `<div>🚗 ${escapeHtml(spot.accessCar)}</div>` : "",
    spot.accessTransit ? `<div>🚌 ${escapeHtml(spot.accessTransit)}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const eventBlock = spot.eventInfo
    ? `<div style="margin-top:8px;padding:8px;background:#fff3e0;border-radius:8px;font-size:0.85em;">
        🎪 <a href="${spot.eventInfo.url}" style="color:#c2571a;font-weight:bold;">${escapeHtml(spot.eventInfo.title)}</a>
        <div style="color:#666;margin-top:2px;">${escapeHtml(spot.eventInfo.snippet)}</div>
      </div>`
    : "";

  return `
    <div style="border:1px solid #f0d9b5;border-radius:12px;padding:16px;margin-bottom:14px;background:#fffaf0;">
      <div style="font-size:1.1em;font-weight:bold;color:#c2571a;">${escapeHtml(spot.name)}</div>
      <div style="font-size:0.85em;color:#7a5c2e;margin:2px 0 8px;">${escapeHtml(spot.category)} ・ ${WEATHER_FIT_LABEL[spot.weatherFit]}</div>
      ${spot.reason ? `<div style="margin-bottom:8px;">${escapeHtml(spot.reason)}</div>` : ""}
      <div style="font-size:0.9em;color:#555;">${access}</div>
      ${spot.url ? `<div style="margin-top:8px;"><a href="${spot.url}" style="color:#c2571a;">詳細を見る →</a></div>` : ""}
      ${eventBlock}
    </div>`;
}

function dayHtmlSection(day: DaySuggestion): string {
  const weatherLine = day.weather ? `天気予報: ${day.weather.summary}` : "天気予報は取得できませんでした。";
  return `
    <h2 style="color:#c2571a;border-bottom:2px solid #f0d9b5;padding-bottom:6px;">${escapeHtml(day.targetDateLabel)}</h2>
    <p style="color:#666;">${escapeHtml(weatherLine)}</p>
    ${day.spots.length > 0 ? day.spots.map(spotHtmlCard).join("") : "<p>今回は候補を見つけられませんでした。</p>"}
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDigestMail(params: { days: DaySuggestion[] }): DigestMail {
  const { days } = params;
  const totalSpots = days.reduce((sum, d) => sum + d.spots.length, 0);
  const dateLabelsShort = days.map((d) => d.targetDateLabel.replace(/^\d+年/, "")).join("・");

  const subject =
    totalSpots > 0
      ? `【週末おでかけ提案】${dateLabelsShort} 計${totalSpots}件`
      : `【週末おでかけ提案】${dateLabelsShort}は候補を見つけられませんでした`;

  const disclaimer =
    "屋内/屋外の分類やアクセス情報は地図データからの推定・目安です。🎪のイベント情報はWeb検索による自動抽出のため、最新情報は各施設の公式サイトでご確認ください。";

  const dashboardUrl = process.env.DASHBOARD_URL ?? DEFAULT_DASHBOARD_URL;

  const text =
    totalSpots > 0
      ? `今週末のおでかけ候補です。\n\n${days.map(dayTextBlock).join("\n\n\n")}\n\n※${disclaimer}\n\nダッシュボード: ${dashboardUrl}`
      : `今週末のおでかけ候補を見つけられませんでした。\n\nダッシュボード: ${dashboardUrl}`;

  const html = `
    <h1 style="color:#c2571a;">今週末のおでかけ候補</h1>
    ${days.map(dayHtmlSection).join("")}
    ${totalSpots > 0 ? `<p style="font-size:0.8em;color:#999;">※${escapeHtml(disclaimer)}</p>` : ""}
    <p style="margin-top:16px;"><a href="${dashboardUrl}" style="display:inline-block;padding:0.6em 1.2em;background:#c2571a;color:#fff;text-decoration:none;border-radius:6px;">ダッシュボードを見る →</a></p>
  `;

  return { subject, text, html };
}
