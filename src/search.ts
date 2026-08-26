import Anthropic from "@anthropic-ai/sdk";
import type { DayWeather } from "./weather.js";
import type { Spot, WeatherFit } from "./types.js";

const MODEL = "claude-opus-5";

interface SearchParams {
  homeLabel: string;
  targetDate: string; // YYYY-MM-DD
  targetDateLabel: string; // 例: 2026年8月29日(土)
  weather: DayWeather | null;
}

interface RawSpot {
  name?: unknown;
  category?: unknown;
  reason?: unknown;
  weatherFit?: unknown;
  accessCar?: unknown;
  accessTransit?: unknown;
  url?: unknown;
}

function buildPrompt(params: SearchParams, excludeNames: string[]): string {
  const { homeLabel, targetDateLabel, weather } = params;

  const weatherLine = weather
    ? `その日の天気予報: ${weather.summary}`
    : "天気予報は取得できませんでした。屋内・屋外どちらでも楽しめる場所をバランスよく選んでください。";

  const excludeLine =
    excludeNames.length > 0
      ? `直近6週間以内に提案済みで避けてほしい場所: ${excludeNames.join("、")}`
      : "直近の提案履歴はありません。";

  return `あなたは3歳の子どもを持つ家族向けに、週末のお出かけ先を提案する専門家です。

【条件】
- 出発地点: ${homeLabel}(神奈川県横浜市都筑区)
- 対象日: ${targetDateLabel}
- 移動手段: 自動車、またはバス+電車の組み合わせ(徒歩のみで行ける近所の場所は除く。片道1時間半程度まで)
- ${weatherLine}
- 対象年齢: 3歳児が安全に楽しめること(歩き疲れない範囲、危険が少ない、親子で一緒に楽しめる)
- ${excludeLine}(同じ場所を繰り返し提案しないでください)

Web検索を使って、実在する具体的なスポット(公園、動物園、水族館、室内遊び場、科学館、牧場、農業体験施設、ショッピングモールのキッズスペースなど)を調べてください。天気予報が雨や曇りがちなら屋内中心に、晴れなら屋外も含めてバランスよく選んでください。

候補を4件、以下のJSON形式で出力してください。説明文は日本語で、実際に検索で確認できた情報のみを書き、想像で補完しないでください。アクセス情報(所要時間・最寄り駅・駐車場の有無など)も検索結果に基づいて書いてください。分からない場合は該当フィールドを省略してください。

出力の最後に、他のテキストを一切含めず、次の形式のJSONだけを \`\`\`json コードブロックで出力してください:

\`\`\`json
[
  {
    "name": "施設名",
    "category": "公園 / 水族館 / 室内遊び場 など",
    "reason": "3歳児になぜおすすめか(1〜2文)",
    "weatherFit": "indoor または outdoor または either",
    "accessCar": "${homeLabel}からの車での所要時間や駐車場情報",
    "accessTransit": "最寄り駅+バスなどの公共交通機関でのアクセス情報",
    "url": "公式サイトまたは地図のURL"
  }
]
\`\`\``;
}

function parseWeatherFit(value: unknown): WeatherFit {
  return value === "indoor" || value === "outdoor" ? value : "either";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extractJsonBlock(text: string): string | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1];
  const bracket = text.match(/\[[\s\S]*\]/);
  return bracket ? bracket[0] : null;
}

export async function searchSpots(
  params: SearchParams,
  excludeNames: string[],
): Promise<Spot[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("ANTHROPIC_API_KEY未設定のため、お出かけ先の検索をスキップしました。");
    return [];
  }

  const client = new Anthropic({ apiKey });
  const prompt = buildPrompt(params, excludeNames);

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 8,
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

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  const jsonText = extractJsonBlock(text);
  if (!jsonText) {
    console.error("お出かけ先候補のJSONを抽出できませんでした。応答テキスト:", text.slice(0, 500));
    return [];
  }

  let raw: RawSpot[];
  try {
    raw = JSON.parse(jsonText) as RawSpot[];
  } catch (err) {
    console.error("お出かけ先候補のJSON解析に失敗しました:", (err as Error).message);
    return [];
  }

  const now = new Date().toISOString();
  return raw
    .map((item, i) => {
      const name = asString(item.name);
      if (!name) return null;
      const spot: Spot = {
        id: `${params.targetDate}-${i}`,
        name,
        category: asString(item.category) ?? "お出かけスポット",
        reason: asString(item.reason) ?? "",
        weatherFit: parseWeatherFit(item.weatherFit),
        accessCar: asString(item.accessCar),
        accessTransit: asString(item.accessTransit),
        url: asString(item.url),
        suggestedFor: params.targetDate,
        suggestedAt: now,
      };
      return spot;
    })
    .filter((s): s is Spot => s !== null);
}
