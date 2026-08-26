export type WeatherFit = "indoor" | "outdoor" | "either";

export interface SpotEventInfo {
  title: string;
  url: string;
  snippet: string;
}

export interface Spot {
  id: string;
  name: string;
  category: string;
  reason: string;
  weatherFit: WeatherFit;
  accessCar?: string;
  accessTransit?: string;
  url?: string;
  eventInfo?: SpotEventInfo;
  suggestedFor: string; // ISO date (YYYY-MM-DD) of the target weekend day
  suggestedAt: string; // ISO datetime
}

export interface HistoryFile {
  updatedAt: string;
  spots: Spot[];
}
