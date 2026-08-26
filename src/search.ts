import type { DayWeather } from "./weather.js";
import type { Spot, WeatherFit } from "./types.js";
import { haversineKm, seededRandom, seededShuffle } from "./geo.js";

// 無料の公開Overpassミラー。単体のインスタンスが混雑/タイムアウトしやすいため複数を順に試す
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 移動時間の上限と、直線距離からの概算に使う係数
const CAR_MAX_MINUTES = 20;
const CAR_AVG_SPEED_KMH = 25;
const TRANSIT_MAX_MINUTES = 60;
const TRANSIT_TRAIN_AVG_SPEED_KMH = 35;
const TRANSIT_OVERHEAD_MINUTES = 12; // 待ち時間・乗り換えの目安
const WALK_METERS_PER_MINUTE = 60; // 子連れの徒歩ペース
const STATION_MAX_KM = 3; // これより駅が遠い場合は「最寄り駅」とみなさない
// 車で20分(≒8.3km)より広く、乗換駅探索も考慮してこの範囲で検索する
const SEARCH_RADIUS_M = 20000;

interface CategoryDef {
  osmTag: { key: string; value: string };
  label: string;
  weatherFit: WeatherFit;
  requireWikidata?: boolean;
  reasons: string[];
}

const CATEGORIES: CategoryDef[] = [
  {
    osmTag: { key: "leisure", value: "park" },
    label: "公園",
    weatherFit: "outdoor",
    requireWikidata: true,
    reasons: [
      "広い敷地でのびのび歩き回れ、3歳児でも歩き疲れにくい公園です。",
      "芝生や遊具があり、体を動かして遊ぶのにぴったりの公園です。",
    ],
  },
  {
    osmTag: { key: "tourism", value: "zoo" },
    label: "動物園",
    weatherFit: "outdoor",
    reasons: ["本物の動物を間近で見られ、3歳児の好奇心を刺激してくれます。"],
  },
  {
    osmTag: { key: "tourism", value: "aquarium" },
    label: "水族館",
    weatherFit: "indoor",
    reasons: ["屋内で天気を気にせず楽しめ、色とりどりの生き物に夢中になれます。"],
  },
  {
    osmTag: { key: "tourism", value: "theme_park" },
    label: "テーマパーク",
    weatherFit: "either",
    requireWikidata: true,
    reasons: ["乗り物やアトラクションが充実し、家族で1日楽しめます。"],
  },
  {
    osmTag: { key: "leisure", value: "water_park" },
    label: "プール・ウォーターパーク",
    weatherFit: "outdoor",
    reasons: ["水遊びが好きな3歳児にぴったりのスポットです(水着・タオルをお忘れなく)。"],
  },
  {
    osmTag: { key: "tourism", value: "museum" },
    label: "博物館・科学館",
    weatherFit: "indoor",
    requireWikidata: true,
    reasons: ["屋内で雨の日でも安心。体験型の展示があれば3歳児も楽しめます。"],
  },
  {
    osmTag: { key: "amenity", value: "planetarium" },
    label: "プラネタリウム",
    weatherFit: "indoor",
    reasons: ["屋内施設で天候に左右されず、星空を見ながらゆったり過ごせます。"],
  },
  {
    osmTag: { key: "shop", value: "mall" },
    label: "ショッピングモール",
    weatherFit: "indoor",
    reasons: ["屋内施設でキッズスペースが併設されていることが多く、雨の日の候補になります。"],
  },
];

// OpenStreetMap上の実際のタグ付けが施設の実態(屋内/屋外など)と食い違うことが
// 確認済みの場所を手動で除外するリスト。見つかり次第ここに追加する。
const KNOWN_MISTAGGED_NAMES = new Set([
  "横浜三渓園", // tourism=museumだが実際は屋外の日本庭園
]);

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function buildPlacesQuery(lat: number, lon: number): string {
  const clauses = CATEGORIES.flatMap((cat) => {
    const wikidataFilter = cat.requireWikidata ? `["wikidata"]` : "";
    return ["node", "way"].map(
      (type) =>
        `  ${type}["${cat.osmTag.key}"="${cat.osmTag.value}"]${wikidataFilter}(around:${SEARCH_RADIUS_M},${lat},${lon});`,
    );
  });
  return `[out:json][timeout:30];\n(\n${clauses.join("\n")}\n);\nout center tags;`;
}

function buildStationQuery(lat: number, lon: number, radiusM: number): string {
  return `[out:json][timeout:25];\n(\n  node["railway"="station"](around:${radiusM},${lat},${lon});\n);\nout;`;
}

// 公開Overpassミラーは混雑時に5xxを返しやすいため、全ミラーを2周まで試す
// (1周目で全滅しても、少し間を置いた2周目で復旧していることがある)
async function queryOverpass(query: string): Promise<OverpassElement[]> {
  let lastErr: Error | undefined;
  for (let round = 0; round < 2; round++) {
    if (round > 0) await sleep(8000);
    for (const url of OVERPASS_URLS) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "*/*",
            "User-Agent": "kids-weekend-outing/1.0 (personal weekend-outing planner)",
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) throw new Error(`Overpass APIエラー(${url}): ${res.status}`);
        const json = (await res.json()) as OverpassResponse;
        // 一部ミラーはデータベースが壊れていてもHTTP 200で空配列を返すことがあるため、
        // 空の結果は失敗扱いにして次のミラーを試す(このアプリの検索範囲で0件は考えにくい)
        if (json.elements.length === 0) {
          throw new Error(`Overpass APIエラー(${url}): 空の結果(ミラーのデータが壊れている可能性)`);
        }
        return json.elements;
      } catch (err) {
        lastErr = err as Error;
        console.error(`Overpassミラーで取得失敗、次を試します: ${lastErr.message}`);
      }
    }
  }
  console.error(`Overpass APIへの接続にすべて失敗しました: ${lastErr?.message}`);
  return [];
}

function elementLatLon(el: OverpassElement): { lat: number; lon: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon };
  if (el.center) return el.center;
  return null;
}

interface NearestStation {
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
}

function nearestStation(point: { lat: number; lon: number }, stations: OverpassElement[]): NearestStation | undefined {
  let nearest: NearestStation | undefined;
  for (const st of stations) {
    const pos = elementLatLon(st);
    const name = st.tags?.name;
    if (!pos || !name) continue;
    const distanceKm = haversineKm(point, pos);
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { name, lat: pos.lat, lon: pos.lon, distanceKm };
  }
  return nearest;
}

function estimateCarMinutes(distanceKm: number): number {
  return (distanceKm / CAR_AVG_SPEED_KMH) * 60;
}

// 自宅最寄り駅→現地最寄り駅の直線距離から、乗車+乗換待ち+両端の徒歩を合算した概算所要時間
function estimateTransitMinutes(homeStation: NearestStation | undefined, spotStation: NearestStation | undefined): number | undefined {
  if (!homeStation || !spotStation) return undefined;
  if (homeStation.distanceKm > STATION_MAX_KM || spotStation.distanceKm > STATION_MAX_KM) return undefined;
  const interStationKm = haversineKm(homeStation, spotStation);
  const trainMinutes = (interStationKm / TRANSIT_TRAIN_AVG_SPEED_KMH) * 60;
  const walkMinutes = ((homeStation.distanceKm + spotStation.distanceKm) * 1000) / WALK_METERS_PER_MINUTE;
  return trainMinutes + walkMinutes + TRANSIT_OVERHEAD_MINUTES;
}

interface Candidate {
  name: string;
  category: CategoryDef;
  lat: number;
  lon: number;
  distanceKm: number;
  carMinutes: number;
  transitMinutes: number | undefined;
  spotStation: NearestStation | undefined;
  url?: string;
}

function buildCandidates(
  elements: OverpassElement[],
  categoryByTag: Map<string, CategoryDef>,
  home: { lat: number; lon: number },
  homeStation: NearestStation | undefined,
  stationElements: OverpassElement[],
): Candidate[] {
  const seen = new Map<string, Candidate>();

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags.name ?? tags["name:ja"];
    if (!name) continue;
    if (KNOWN_MISTAGGED_NAMES.has(name)) continue;

    const pos = elementLatLon(el);
    if (!pos) continue;

    const tagKey = Object.keys(tags).find((k) => categoryByTag.has(`${k}=${tags[k]}`));
    const category = tagKey ? categoryByTag.get(`${tagKey}=${tags[tagKey]}`) : undefined;
    if (!category) continue;

    const distanceKm = haversineKm(home, pos);
    const carMinutes = estimateCarMinutes(distanceKm);
    const spotStation = nearestStation(pos, stationElements);
    const transitMinutes = estimateTransitMinutes(homeStation, spotStation);

    // 車で20分以内、またはバス+電車で1時間以内のどちらかを満たす場所だけを候補にする
    const carOk = carMinutes <= CAR_MAX_MINUTES;
    const transitOk = transitMinutes !== undefined && transitMinutes <= TRANSIT_MAX_MINUTES;
    if (!carOk && !transitOk) continue;

    const url = tags.website ?? tags["contact:website"];
    const key = name;
    const existing = seen.get(key);
    if (!existing || distanceKm < existing.distanceKm) {
      seen.set(key, { name, category, lat: pos.lat, lon: pos.lon, distanceKm, carMinutes, transitMinutes, spotStation, url });
    }
  }

  return [...seen.values()];
}

function weatherBias(weather: DayWeather | null): "indoor" | "outdoor" | "balanced" {
  if (!weather) return "balanced";
  if (weather.precipitationProbability >= 50) return "indoor";
  if (weather.precipitationProbability <= 25) return "outdoor";
  return "balanced";
}

function matchesBias(fit: WeatherFit, bias: "indoor" | "outdoor" | "balanced"): boolean {
  if (bias === "balanced") return true;
  return fit === bias || fit === "either";
}

function selectCandidates(candidates: Candidate[], bias: "indoor" | "outdoor" | "balanced", rand: () => number, count: number): Candidate[] {
  const preferred = seededShuffle(
    candidates.filter((c) => matchesBias(c.category.weatherFit, bias)),
    rand,
  );
  const rest = seededShuffle(
    candidates.filter((c) => !matchesBias(c.category.weatherFit, bias)),
    rand,
  );

  const selected: Candidate[] = [];
  const usedCategories = new Set<string>();

  // 1周目: カテゴリの重複を避けつつ天気に合う候補から選ぶ
  for (const c of preferred) {
    if (selected.length >= count) break;
    if (usedCategories.has(c.category.label)) continue;
    selected.push(c);
    usedCategories.add(c.category.label);
  }
  // 2周目: 天気に合う候補で埋める(カテゴリ重複可)
  for (const c of preferred) {
    if (selected.length >= count) break;
    if (selected.includes(c)) continue;
    selected.push(c);
  }
  // 3周目: それでも足りなければ天気に合わない候補も使う
  for (const c of rest) {
    if (selected.length >= count) break;
    selected.push(c);
  }

  return selected.sort((a, b) => a.distanceKm - b.distanceKm);
}

// 車で20分以内の場合だけアクセス情報を出す(それを超える候補はtransit側で選ばれている)
function formatAccessCar(distanceKm: number, carMinutes: number): string | undefined {
  if (carMinutes > CAR_MAX_MINUTES) return undefined;
  const minutes = Math.max(5, Math.round(carMinutes / 5) * 5);
  return `車で約${minutes}分(直線距離${distanceKm.toFixed(1)}km・目安、実際の道路状況により変動します)`;
}

// バス+電車で1時間以内の場合だけアクセス情報を出す
function formatAccessTransit(spotStation: NearestStation | undefined, transitMinutes: number | undefined): string | undefined {
  if (!spotStation || transitMinutes === undefined || transitMinutes > TRANSIT_MAX_MINUTES) return undefined;

  if (spotStation.distanceKm < 0.6) {
    const walkMinutes = Math.max(1, Math.round((spotStation.distanceKm * 1000) / WALK_METERS_PER_MINUTE));
    return `${spotStation.name}駅から徒歩約${walkMinutes}分(自宅から乗換・待ち時間含め計約${Math.round(transitMinutes / 5) * 5}分・目安)`;
  }
  return `${spotStation.name}駅からバスまたはタクシーを利用(自宅から計約${Math.round(transitMinutes / 5) * 5}分・目安)`;
}

export async function searchSpots(
  params: { homeLabel: string; homeLat: number; homeLon: number; targetDate: string; weather: DayWeather | null },
  excludeNames: string[],
): Promise<Spot[]> {
  const home = { lat: params.homeLat, lon: params.homeLon };
  const categoryByTag = new Map(CATEGORIES.map((c) => [`${c.osmTag.key}=${c.osmTag.value}`, c]));

  let placeElements: OverpassElement[];
  let stationElements: OverpassElement[];
  try {
    // 無料の公開ミラーへの同時接続数を抑えるため、直列で問い合わせる
    placeElements = await queryOverpass(buildPlacesQuery(home.lat, home.lon));
    stationElements = await queryOverpass(buildStationQuery(home.lat, home.lon, SEARCH_RADIUS_M));
  } catch (err) {
    console.error("お出かけ先の検索に失敗しました:", (err as Error).message);
    return [];
  }

  const homeStation = nearestStation(home, stationElements);
  const candidates = buildCandidates(placeElements, categoryByTag, home, homeStation, stationElements).filter(
    (c) => !excludeNames.includes(c.name),
  );

  const bias = weatherBias(params.weather);
  const rand = seededRandom(params.targetDate);
  const selected = selectCandidates(candidates, bias, rand, 4);

  const now = new Date().toISOString();
  return selected.map((c, i) => {
    const reasons = c.category.reasons;
    const reason = reasons[Math.floor(rand() * reasons.length)];
    return {
      id: `${params.targetDate}-${i}`,
      name: c.name,
      category: c.category.label,
      reason,
      weatherFit: c.category.weatherFit,
      accessCar: formatAccessCar(c.distanceKm, c.carMinutes),
      accessTransit: formatAccessTransit(c.spotStation, c.transitMinutes),
      url: c.url ?? `https://www.google.com/maps/search/?api=1&query=${c.lat}%2C${c.lon}`,
      suggestedFor: params.targetDate,
      suggestedAt: now,
    } satisfies Spot;
  });
}
