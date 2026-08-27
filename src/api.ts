import { Capacitor } from "@capacitor/core";
import type { GameState, Room } from "./types.ts";

const productionOrigin = "https://amerikaneren-spill.netlify.app";
const apiOrigin = Capacitor.isNativePlatform() ? productionOrigin : "";
const endpoint = `${apiOrigin}/.netlify/functions/room`;

/** Adressen venner kan åpne. I native-appen finnes ikke nettadressen, så vi peker på nettsiden. */
export const siteOrigin = Capacitor.isNativePlatform() ? productionOrigin : window.location.origin;

export const inviteLink = (code: string) => `${siteOrigin}/?rom=${code}`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Noe gikk galt.");
  return data;
}

const post = <T>(body: object) => request<T>(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const createRoom = (name: string) => post<{ room: Room; playerId: string }>({ action: "create", name });
export const joinRoom = (code: string, name: string) => post<{ room: Room; playerId: string }>({ action: "join", code, name });
export const getRoom = (code: string) => request<Room>(`${endpoint}?code=${encodeURIComponent(code)}`);

export const saveRoomGame = (code: string, playerId: string, game: GameState, baseVersion: number) =>
  post<{ room: Room; conflict: boolean }>({ action: "save", code, playerId, game, baseVersion });

export type PollResult = Room | { unchanged: true; version: number };

/**
 * Henter rommet med long-polling: serveren holder svaret til noe endrer seg
 * (eller ~6 sekunder), slik at trekk fra de andre kommer fram nesten umiddelbart.
 */
export const pollRoom = (code: string, since: number, signal: AbortSignal) =>
  request<PollResult>(`${endpoint}?code=${encodeURIComponent(code)}&since=${since}`, { signal });
