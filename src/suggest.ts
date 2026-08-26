import { fetchWeather } from "./weather.js";
import { searchSpots } from "./search.js";
import { loadHistory, saveHistory, mergeSpots, recentNames } from "./store.js";
import { sendDigestMail } from "./mailer.js";
import { buildDigestMail } from "./digest.js";
import { jstNow, jstDateString, jstWeekday, formatJstDateLabel } from "./date.js";

const HOME_LAT = Number(process.env.HOME_LAT ?? "35.5165");
const HOME_LON = Number(process.env.HOME_LON ?? "139.5890");
const HOME_LABEL = process.env.HOME_LABEL ?? "横浜市都筑区川向町";
const RECENT_EXCLUDE_DAYS = 42;

async function main() {
  const now = jstNow();
  const weekday = jstWeekday(now);

  if (weekday !== 0 && weekday !== 6) {
    console.log("平日のため週末おでかけ提案の実行はスキップしました(土日のみ実行)。");
    return;
  }

  const targetDate = jstDateString(now);
  const targetDateLabel = formatJstDateLabel(targetDate, weekday);
  console.log(`対象日: ${targetDateLabel}`);

  const weather = await fetchWeather(HOME_LAT, HOME_LON, targetDate);
  if (weather) console.log(`天気予報: ${weather.summary}`);

  const history = await loadHistory();
  const excludeNames = recentNames(history, RECENT_EXCLUDE_DAYS);

  const spots = await searchSpots(
    { homeLabel: HOME_LABEL, targetDate, targetDateLabel, weather },
    excludeNames,
  );
  console.log(`${spots.length}件の候補を取得しました。`);

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
