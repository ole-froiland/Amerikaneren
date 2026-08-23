import type { GameState, Room } from "./types.ts";

const endpoint = "/.netlify/functions/room";

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
export const saveRoomGame = (code: string, playerId: string, game: GameState) => post<Room>({ action: "save", code, playerId, game });
