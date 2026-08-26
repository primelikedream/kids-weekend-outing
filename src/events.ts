export interface EventInfo {
  title: string;
  url: string;
  snippet: string;
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

// 子供向けイベントかどうかを簡易判定するためのキーワード
const KIDS_KEYWORDS = ["子供", "子ども", "こども", "キッズ", "親子", "ファミリー", "幼児", "赤ちゃん"];

function looksKidsRelated(text: string): boolean {
  return KIDS_KEYWORDS.some((kw) => text.includes(kw));
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

// その週末に開催中/近日の子供向けイベント情報をWeb検索で探す。
// TAVILY_API_KEY未設定、またはAPI呼び出し失敗時はundefinedを返し(検索自体は継続)。
export async function fetchKidsEventInfo(spotName: string, targetDate: string): Promise<EventInfo | undefined> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return undefined;

  const [year, month] = targetDate.split("-");
  const query = `${spotName} 子供 イベント ${year}年${Number(month)}月`;

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        search_depth: "basic",
        topic: "general",
        time_range: "month",
      }),
    });
    if (!res.ok) {
      console.error(`イベント検索APIエラー(${spotName}): ${res.status}`);
      return undefined;
    }
    const json = (await res.json()) as TavilyResponse;

    const hit = json.results?.find((r) => looksKidsRelated(r.title) || looksKidsRelated(r.content));
    if (!hit) return undefined;

    return {
      title: truncate(hit.title, 60),
      url: hit.url,
      snippet: truncate(hit.content, 100),
    };
  } catch (err) {
    console.error(`イベント検索に失敗しました(${spotName}):`, (err as Error).message);
    return undefined;
  }
}
