import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HistoryFile, Spot } from "./types.js";

export const DATA_PATH = "docs/data/history.json";

export async function loadHistory(path = DATA_PATH): Promise<HistoryFile> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as HistoryFile;
  } catch {
    return { updatedAt: new Date().toISOString(), spots: [] };
  }
}

export async function saveHistory(data: HistoryFile, path = DATA_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const sorted = {
    updatedAt: new Date().toISOString(),
    spots: [...data.spots].sort((a, b) => b.suggestedFor.localeCompare(a.suggestedFor)),
  };
  await writeFile(path, JSON.stringify(sorted, null, 2), "utf-8");
}

export function mergeSpots(existing: Spot[], incoming: Spot[]): { merged: Spot[]; addedCount: number } {
  const byId = new Map(existing.map((s) => [s.id, s]));
  let addedCount = 0;
  for (const spot of incoming) {
    if (!byId.has(spot.id)) addedCount++;
    byId.set(spot.id, spot);
  }
  return { merged: [...byId.values()], addedCount };
}

// 直近N日以内に提案した場所の名前一覧(重複提案を避けるための除外リストに使う)
export function recentNames(history: HistoryFile, days: number): string[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const names = new Set<string>();
  for (const spot of history.spots) {
    if (new Date(spot.suggestedFor).getTime() >= cutoff) names.add(spot.name);
  }
  return [...names];
}
