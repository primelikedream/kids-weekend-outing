import { fetchWeather } from "./weather.js";
import { searchSpots } from "./search.js";
import { fetchKidsEventInfo } from "./events.js";
import { verifyAndEnrichSpot, findTimelyEventSpot } from "./enrich.js";
import { loadHistory, saveHistory, mergeSpots, recentNames } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import { buildDigestMail } from "./digest.js";
import { jstNow, jstDateString, jstWeekday, formatJstDateLabel, nextSaturday } from "./date.js";

const HOME_LAT = Number(process.env.HOME_LAT ?? "35.5165");
const HOME_LON = Number(process.env.HOME_LON ?? "139.5890");
const HOME_LABEL = process.env.HOME_LABEL ?? "横浜市都筑区川向町";
const RECENT_EXCLUDE_DAYS = 42;

async function main() {
  const now = jstNow();
  let weekday = jstWeekday(now);
  let target = now;

  if (weekday !== 0 && weekday !== 6) {
    if (process.env.FORCE_RUN !== "true") {
      console.log("平日のため週末おでかけ提案の実行はスキップしました(土日のみ実行)。");
      return;
    }
    console.log("FORCE_RUN=true のため、平日ですが直近の土曜日として実行します(動作確認用)。");
    target = nextSaturday(now);
    weekday = 6;
  }

  const targetDate = jstDateString(target);
  const targetDateLabel = formatJstDateLabel(targetDate, weekday);
  console.log(`対象日: ${targetDateLabel}`);

  const weather = await fetchWeather(HOME_LAT, HOME_LON, targetDate);
  if (weather) console.log(`天気予報: ${weather.summary}`);

  const history = await loadHistory();
  const excludeNames = recentNames(history, RECENT_EXCLUDE_DAYS);

  const useAI = Boolean(process.env.ANTHROPIC_API_KEY);
  // Claudeによる検証で一部が脱落する前提で、地図データからは多めに候補を取得する
  const osmCount = useAI ? 6 : 4;

  let spots = await searchSpots(
    { homeLabel: HOME_LABEL, homeLat: HOME_LAT, homeLon: HOME_LON, targetDate, weather, count: osmCount },
    excludeNames,
  );
  console.log(`地図データから${spots.length}件の候補を取得しました。`);

  if (useAI) {
    const enrichParams = { homeLabel: HOME_LABEL, homeLat: HOME_LAT, homeLon: HOME_LON, targetDate, targetDateLabel, weather };

    const verified: typeof spots = [];
    for (const spot of spots) {
      if (verified.length >= 3) break;
      const result = await verifyAndEnrichSpot(spot, enrichParams);
      if (result) verified.push(result);
    }
    console.log(`Claudeによる検証後: ${verified.length}件。`);

    const eventSpot = await findTimelyEventSpot(enrichParams, [...excludeNames, ...verified.map((s) => s.name)]);
    if (eventSpot) {
      verified.push(eventSpot);
      console.log(`タイムリーなイベントを発見: ${eventSpot.name}`);
    }

    spots = verified;
  } else if (process.env.TAVILY_API_KEY) {
    for (const spot of spots) {
      spot.eventInfo = await fetchKidsEventInfo(spot.name, targetDate);
    }
    console.log(`イベント情報: ${spots.filter((s) => s.eventInfo).length}件見つかりました。`);
  } else {
    console.log("ANTHROPIC_API_KEY/TAVILY_API_KEY未設定のため、イベント情報の検索をスキップしました。");
  }

  console.log(`最終的に${spots.length}件を提案します。`);

  const { merged, addedCount } = mergeSpots(history.spots, spots);
  await saveHistory({ updatedAt: new Date().toISOString(), spots: merged });
  console.log(`履歴に${addedCount}件を追加しました。`);

  const mail = buildDigestMail({ targetDateLabel, weather, spots });
  await sendDigestMail(mail);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
