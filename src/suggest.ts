import { fetchWeather, type DayWeather } from "./weather.js";
import { searchSpots } from "./search.js";
import { fetchKidsEventInfo } from "./events.js";
import { verifyAndEnrichSpot, findTimelyEventSpot } from "./enrich.js";
import { loadHistory, saveHistory, mergeSpots, recentNames } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import { buildDigestMail, type DaySuggestion } from "./digest.js";
import { jstNow, jstDateString, formatJstDateLabel, nextFriday, addDays } from "./date.js";
import type { Spot } from "./types.js";

const HOME_LAT = Number(process.env.HOME_LAT ?? "35.5165");
const HOME_LON = Number(process.env.HOME_LON ?? "139.5890");
const HOME_LABEL = process.env.HOME_LABEL ?? "横浜市都筑区川向町";
const RECENT_EXCLUDE_DAYS = 42;

async function suggestForDate(
  targetDate: string,
  targetDateLabel: string,
  excludeNames: string[],
): Promise<{ weather: DayWeather | null; spots: Spot[] }> {
  const weather = await fetchWeather(HOME_LAT, HOME_LON, targetDate);
  if (weather) console.log(`[${targetDateLabel}] 天気予報: ${weather.summary}`);

  const useAI = Boolean(process.env.ANTHROPIC_API_KEY);
  // Claudeによる検証で一部が脱落する前提で、地図データからは多めに候補を取得する
  const osmCount = useAI ? 6 : 4;

  let spots = await searchSpots(
    { homeLabel: HOME_LABEL, homeLat: HOME_LAT, homeLon: HOME_LON, targetDate, weather, count: osmCount },
    excludeNames,
  );
  console.log(`[${targetDateLabel}] 地図データから${spots.length}件の候補を取得しました。`);

  if (useAI) {
    const enrichParams = { homeLabel: HOME_LABEL, homeLat: HOME_LAT, homeLon: HOME_LON, targetDate, targetDateLabel, weather };

    const verified: Spot[] = [];
    for (const spot of spots) {
      if (verified.length >= 3) break;
      const result = await verifyAndEnrichSpot(spot, enrichParams);
      if (result) verified.push(result);
    }
    console.log(`[${targetDateLabel}] Claudeによる検証後: ${verified.length}件。`);

    const eventSpot = await findTimelyEventSpot(enrichParams, [...excludeNames, ...verified.map((s) => s.name)]);
    if (eventSpot) {
      verified.push(eventSpot);
      console.log(`[${targetDateLabel}] タイムリーなイベントを発見: ${eventSpot.name}`);
    }

    spots = verified;
  } else if (process.env.TAVILY_API_KEY) {
    for (const spot of spots) {
      spot.eventInfo = await fetchKidsEventInfo(spot.name, targetDate);
    }
    console.log(`[${targetDateLabel}] イベント情報: ${spots.filter((s) => s.eventInfo).length}件見つかりました。`);
  } else {
    console.log(`[${targetDateLabel}] ANTHROPIC_API_KEY/TAVILY_API_KEY未設定のため、イベント情報の検索をスキップしました。`);
  }

  console.log(`[${targetDateLabel}] 最終的に${spots.length}件を提案します。`);
  return { weather, spots };
}

async function main() {
  const now = jstNow();
  // 実行タイミングに関わらず、直近の週末(土曜・日曜)2日分をまとめて提案する
  const friday = nextFriday(now);

  const days = [
    { date: addDays(friday, 1), weekday: 6 },
    { date: addDays(friday, 2), weekday: 0 },
  ].map(({ date, weekday: wd }) => ({
    targetDate: jstDateString(date),
    targetDateLabel: formatJstDateLabel(jstDateString(date), wd),
  }));

  console.log(`対象: ${days.map((d) => d.targetDateLabel).join(" / ")}`);

  const history = await loadHistory();
  const baseExclude = recentNames(history, RECENT_EXCLUDE_DAYS);

  const results: DaySuggestion[] = [];
  let excludeNames = [...baseExclude];
  for (const day of days) {
    const { weather, spots } = await suggestForDate(day.targetDate, day.targetDateLabel, excludeNames);
    results.push({ targetDateLabel: day.targetDateLabel, weather, spots });
    // 同じ回の別日で同じ場所を繰り返し提案しないよう、候補名を除外リストに積み上げる
    excludeNames = [...excludeNames, ...spots.map((s) => s.name)];
  }

  const allSpots = results.flatMap((r) => r.spots);
  const { merged, addedCount } = mergeSpots(history.spots, allSpots);
  await saveHistory({ updatedAt: new Date().toISOString(), spots: merged });
  console.log(`履歴に${addedCount}件を追加しました。`);

  const mail = buildDigestMail({ days: results });
  await sendDigestMail(mail);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
