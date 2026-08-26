export interface DayWeather {
  date: string;
  precipitationProbability: number;
  weatherCode: number;
  tempMax: number;
  tempMin: number;
  summary: string;
}

// WMO Weather interpretation codes (open-meteo が使用)
const WEATHER_CODE_JA: Record<number, string> = {
  0: "快晴",
  1: "晴れ",
  2: "晴れ時々くもり",
  3: "くもり",
  45: "霧",
  48: "霧(霜)",
  51: "小雨(弱い霧雨)",
  53: "小雨",
  55: "雨(強い霧雨)",
  56: "みぞれ",
  57: "みぞれ(強)",
  61: "雨(弱)",
  63: "雨",
  65: "雨(強)",
  66: "着氷性の雨",
  67: "着氷性の雨(強)",
  71: "雪(弱)",
  73: "雪",
  75: "雪(強)",
  77: "雪(細かい)",
  80: "にわか雨(弱)",
  81: "にわか雨",
  82: "激しいにわか雨",
  85: "にわか雪(弱)",
  86: "にわか雪(強)",
  95: "雷雨",
  96: "雷雨(ひょうを伴う)",
  99: "雷雨(激しいひょうを伴う)",
};

export function describeWeatherCode(code: number): string {
  return WEATHER_CODE_JA[code] ?? `不明な天気コード(${code})`;
}

export async function fetchWeather(
  lat: number,
  lon: number,
  targetDateIso: string,
): Promise<DayWeather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min` +
    `&timezone=Asia%2FTokyo&forecast_days=16`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`天気予報APIエラー: ${res.status}`);
    const json = (await res.json()) as {
      daily: {
        time: string[];
        precipitation_probability_max: number[];
        weathercode: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
      };
    };

    const idx = json.daily.time.indexOf(targetDateIso);
    if (idx === -1) {
      console.log(`天気予報の対象範囲外の日付です: ${targetDateIso}`);
      return null;
    }

    const weatherCode = json.daily.weathercode[idx];
    const precipitationProbability = json.daily.precipitation_probability_max[idx];
    const tempMax = json.daily.temperature_2m_max[idx];
    const tempMin = json.daily.temperature_2m_min[idx];

    return {
      date: targetDateIso,
      precipitationProbability,
      weatherCode,
      tempMax,
      tempMin,
      summary: `${describeWeatherCode(weatherCode)}・降水確率${precipitationProbability}%・気温${tempMin}〜${tempMax}℃`,
    };
  } catch (err) {
    console.error("天気予報の取得に失敗しました:", (err as Error).message);
    return null;
  }
}
