import Anthropic from "@anthropic-ai/sdk";
import type { DayWeather } from "./weather.js";
import type { Spot, WeatherFit, SpotEventInfo } from "./types.js";

const MODEL = "claude-opus-5";

interface EnrichParams {
  homeLabel: string;
  homeLat: number;
  homeLon: number;
  targetDate: string;
  targetDateLabel: string;
  weather: DayWeather | null;
}

function client(): Anthropic | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey ? new Anthropic({ apiKey }) : undefined;
}

function weatherLine(weather: DayWeather | null): string {
  return weather ? `天気予報: ${weather.summary}` : "天気予報は取得できていません。";
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function runWebSearchQuery(c: Anthropic, prompt: string): Promise<string> {
  const message = await c.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 6,
        user_location: {
          type: "approximate",
          city: "Yokohama",
          region: "Kanagawa",
          country: "JP",
          timezone: "Asia/Tokyo",
        },
      },
    ],
    messages: [{ role: "user", content: prompt }],
  });

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function asWeatherFit(value: unknown): WeatherFit {
  return value === "indoor" || value === "outdoor" ? value : "either";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asEventInfo(value: unknown): SpotEventInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const title = asString(v.title);
  const url = asString(v.url);
  if (!title || !url) return undefined;
  return { title, url, snippet: asString(v.snippet) ?? "" };
}

interface VerifyResult {
  keep: boolean;
  category: string;
  weatherFit: WeatherFit;
  reason: string;
  accessCar?: string;
  accessTransit?: string;
  event?: SpotEventInfo;
}

function buildVerifyPrompt(spot: Spot, params: EnrichParams): string {
  return `あなたは3歳の子どもを持つ家族向けに、お出かけ先情報を検証・更新する専門家です。以下の候補地についてWeb検索で最新情報を確認してください。

候補地: ${spot.name}
出発地点: ${params.homeLabel}
対象日: ${params.targetDateLabel}
${weatherLine(params.weather)}
地図データからの推定(誤っている場合があります): カテゴリ「${spot.category}」、屋内/屋外「${spot.weatherFit}」

確認・実施してほしいこと:
1. 実在し、3歳児が安全に楽しめる場所かどうか(閉業・工事中などでないか)
2. 施設が実際には屋内中心か屋外中心か("either"は両方楽しめる場合)。地図データの推定が誤っていれば修正する
3. ${params.homeLabel}からの実際の車での所要時間。20分を大きく超える場合はaccessCarをnullにする
4. ${params.homeLabel}からの実際の電車・バスでのアクセス方法と、乗換・待ち時間を含めた所要時間。1時間を大きく超える場合はaccessTransitをnullにする
5. ${params.targetDateLabel}時点で開催中、またはその前後で開催予定の子供向けイベント・特別展・季節イベントがあれば1件(現在も有効な情報か日付を確認すること。終了済みのイベントは含めない)
6. 車・電車のどちらの条件も満たさない場合は "keep": false にする

出力は次のJSON形式のみ、他のテキストを含めないでください:
\`\`\`json
{
  "keep": true,
  "category": "カテゴリ名",
  "weatherFit": "indoor",
  "reason": "3歳児になぜおすすめか(1〜2文、その日の天気にも触れる)",
  "accessCar": "車で約〇分(補足)",
  "accessTransit": "〇〇駅から...、自宅から計約〇分",
  "event": { "title": "イベント名", "url": "https://...", "snippet": "内容を1文で" }
}
\`\`\`
event情報が見つからない場合は "event": null にしてください。`;
}

export async function verifyAndEnrichSpot(spot: Spot, params: EnrichParams): Promise<Spot | null> {
  const c = client();
  if (!c) return spot;

  try {
    const text = await runWebSearchQuery(c, buildVerifyPrompt(spot, params));
    const parsed = extractJson(text) as Partial<VerifyResult> | null;
    if (!parsed || parsed.keep === false) {
      console.log(`Claude検証によりスポットを除外: ${spot.name}`);
      return null;
    }

    return {
      ...spot,
      category: asString(parsed.category) ?? spot.category,
      weatherFit: asWeatherFit(parsed.weatherFit),
      reason: asString(parsed.reason) ?? spot.reason,
      accessCar: asString(parsed.accessCar),
      accessTransit: asString(parsed.accessTransit),
      eventInfo: asEventInfo(parsed.event),
    };
  } catch (err) {
    console.error(`Claudeによる検証に失敗しました(${spot.name}):`, (err as Error).message);
    return spot;
  }
}

function buildEventDiscoveryPrompt(params: EnrichParams, excludeNames: string[]): string {
  const excludeLine = excludeNames.length > 0 ? `除外してほしい場所名: ${excludeNames.join("、")}` : "";
  return `あなたは3歳の子どもを持つ家族向けに、週末限定・期間限定のイベント情報を探す専門家です。

出発地点: ${params.homeLabel}
対象日: ${params.targetDateLabel}
${weatherLine(params.weather)}
${excludeLine}

Web検索を使い、${params.targetDateLabel}(またはその週末)に、${params.homeLabel}から車で20分以内、または電車・バスで1時間以内の範囲で開催されている・開催予定の、3歳児向けイベントを1件探してください。対象:
- 期間限定・季節のイベント(祭り、マルシェ、ハロウィン/クリスマスイベント、期間限定の遊び場、花火大会、イルミネーションなど)
- 常設施設で開催中の特別展・ワークショップ

公園や動物園など通常営業の施設そのもの(イベントではない)は対象外です。日付が対象日を含む、現在も有効な情報であることを必ず確認してください。見つからない場合は無理に作らないでください。

出力は次のJSON形式のみ、他のテキストを含めないでください:
\`\`\`json
{
  "found": true,
  "name": "イベント名または会場名",
  "category": "週末イベント",
  "reason": "3歳児になぜおすすめか(1〜2文)",
  "weatherFit": "outdoor",
  "accessCar": "車で約〇分(補足)、feasibleでなければnull",
  "accessTransit": "〇〇駅から...、自宅から計約〇分、feasibleでなければnull",
  "url": "https://...",
  "event": { "title": "イベント名", "url": "https://...", "snippet": "内容を1文で" }
}
\`\`\`
見つからない場合は {"found": false} とだけ出力してください。`;
}

export async function findTimelyEventSpot(
  params: EnrichParams,
  excludeNames: string[],
): Promise<Spot | null> {
  const c = client();
  if (!c) return null;

  try {
    const text = await runWebSearchQuery(c, buildEventDiscoveryPrompt(params, excludeNames));
    const parsed = extractJson(text) as
      | (Partial<VerifyResult> & { found?: boolean; name?: string; url?: string })
      | null;
    if (!parsed || parsed.found === false) return null;

    const name = asString(parsed.name);
    const accessCar = asString(parsed.accessCar);
    const accessTransit = asString(parsed.accessTransit);
    if (!name || (!accessCar && !accessTransit)) return null;

    const now = new Date().toISOString();
    return {
      id: `${params.targetDate}-event`,
      name,
      category: asString(parsed.category) ?? "週末イベント",
      reason: asString(parsed.reason) ?? "",
      weatherFit: asWeatherFit(parsed.weatherFit),
      accessCar,
      accessTransit,
      url: asString(parsed.url),
      eventInfo: asEventInfo(parsed.event),
      suggestedFor: params.targetDate,
      suggestedAt: now,
    };
  } catch (err) {
    console.error("Claudeによるイベント探索に失敗しました:", (err as Error).message);
    return null;
  }
}
