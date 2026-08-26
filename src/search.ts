import type { DayWeather } from "./weather.js";
import type { Spot, WeatherFit } from "./types.js";
import { haversineKm, seededRandom, seededShuffle } from "./geo.js";

// 無料の公開Overpassミラー。単体のインスタンスが混雑/タイムアウトしやすいため複数を順に試す
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CategoryDef {
  osmTag: { key: string; value: string };
  label: string;
  weatherFit: WeatherFit;
  radiusM: number;
  requireWikidata?: boolean;
  reasons: string[];
}

const CATEGORIES: CategoryDef[] = [
  {
    osmTag: { key: "leisure", value: "park" },
    label: "公園",
    weatherFit: "outdoor",
    radiusM: 15000,
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
    radiusM: 30000,
    reasons: ["本物の動物を間近で見られ、3歳児の好奇心を刺激してくれます。"],
  },
  {
    osmTag: { key: "tourism", value: "aquarium" },
    label: "水族館",
    weatherFit: "indoor",
    radiusM: 30000,
    reasons: ["屋内で天気を気にせず楽しめ、色とりどりの生き物に夢中になれます。"],
  },
  {
    osmTag: { key: "tourism", value: "theme_park" },
    label: "テーマパーク",
    weatherFit: "either",
    radiusM: 30000,
    requireWikidata: true,
    reasons: ["乗り物やアトラクションが充実し、家族で1日楽しめます。"],
  },
  {
    osmTag: { key: "leisure", value: "water_park" },
    label: "プール・ウォーターパーク",
    weatherFit: "outdoor",
    radiusM: 25000,
    reasons: ["水遊びが好きな3歳児にぴったりのスポットです(水着・タオルをお忘れなく)。"],
  },
  {
    osmTag: { key: "tourism", value: "museum" },
    label: "博物館・科学館",
    weatherFit: "indoor",
    radiusM: 20000,
    requireWikidata: true,
    reasons: ["屋内で雨の日でも安心。体験型の展示があれば3歳児も楽しめます。"],
  },
  {
    osmTag: { key: "amenity", value: "planetarium" },
    label: "プラネタリウム",
    weatherFit: "indoor",
    radiusM: 30000,
    reasons: ["屋内施設で天候に左右されず、星空を見ながらゆったり過ごせます。"],
  },
  {
    osmTag: { key: "shop", value: "mall" },
    label: "ショッピングモール",
    weatherFit: "indoor",
    radiusM: 15000,
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
        `  ${type}["${cat.osmTag.key}"="${cat.osmTag.value}"]${wikidataFilter}(around:${cat.radiusM},${lat},${lon});`,
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
        return json.elements;
      } catch (err) {
        lastErr = err as Error;
        console.error(`Overpassミラーで取得失敗、次を試します: ${lastErr.message}`);
      }
    }
  }
  throw lastErr ?? new Error("Overpass APIへの接続に失敗しました");
}

function elementLatLon(el: OverpassElement): { lat: number; lon: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon };
  if (el.center) return el.center;
  return null;
}

interface Candidate {
  name: string;
  category: CategoryDef;
  lat: number;
  lon: number;
  distanceKm: number;
  url?: string;
}

function buildCandidates(elements: OverpassElement[], categoryByTag: Map<string, CategoryDef>, home: { lat: number; lon: number }): Candidate[] {
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
    if (distanceKm > category.radiusM / 1000) continue;

    const url = tags.website ?? tags["contact:website"];
    const key = name;
    const existing = seen.get(key);
    if (!existing || distanceKm < existing.distanceKm) {
      seen.set(key, { name, category, lat: pos.lat, lon: pos.lon, distanceKm, url });
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

function formatAccessCar(distanceKm: number): string {
  const avgSpeedKmH = 25;
  const minutes = Math.round((distanceKm / avgSpeedKmH) * 60 / 5) * 5;
  return `車で約${Math.max(minutes, 5)}分(直線距離${distanceKm.toFixed(1)}km・目安、実際の道路状況により変動します)`;
}

function formatAccessTransit(spot: { lat: number; lon: number }, stations: OverpassElement[]): string | undefined {
  let nearest: { name: string; distanceKm: number } | null = null;
  for (const st of stations) {
    const pos = elementLatLon(st);
    const name = st.tags?.name;
    if (!pos || !name) continue;
    const distanceKm = haversineKm(spot, pos);
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { name, distanceKm };
  }
  if (!nearest || nearest.distanceKm > 3) return undefined;

  if (nearest.distanceKm < 0.6) {
    const minutes = Math.max(1, Math.round((nearest.distanceKm * 1000) / 60));
    return `${nearest.name}駅から徒歩約${minutes}分`;
  }
  return `${nearest.name}駅からバスまたはタクシーを利用(駅から直線距離${nearest.distanceKm.toFixed(1)}km・目安)`;
}

export async function searchSpots(
  params: { homeLabel: string; homeLat: number; homeLon: number; targetDate: string; weather: DayWeather | null },
  excludeNames: string[],
): Promise<Spot[]> {
  const home = { lat: params.homeLat, lon: params.homeLon };
  const categoryByTag = new Map(CATEGORIES.map((c) => [`${c.osmTag.key}=${c.osmTag.value}`, c]));
  const maxRadiusM = Math.max(...CATEGORIES.map((c) => c.radiusM));

  let placeElements: OverpassElement[];
  let stationElements: OverpassElement[];
  try {
    // 無料の公開ミラーへの同時接続数を抑えるため、直列で問い合わせる
    placeElements = await queryOverpass(buildPlacesQuery(home.lat, home.lon));
    stationElements = await queryOverpass(buildStationQuery(home.lat, home.lon, maxRadiusM));
  } catch (err) {
    console.error("お出かけ先の検索に失敗しました:", (err as Error).message);
    return [];
  }

  const candidates = buildCandidates(placeElements, categoryByTag, home).filter(
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
      accessCar: formatAccessCar(c.distanceKm),
      accessTransit: formatAccessTransit(c, stationElements),
      url: c.url ?? `https://www.google.com/maps/search/?api=1&query=${c.lat}%2C${c.lon}`,
      suggestedFor: params.targetDate,
      suggestedAt: now,
    } satisfies Spot;
  });
}
