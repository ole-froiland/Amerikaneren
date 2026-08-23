import { getStore } from "@netlify/blobs";
import type { Room } from "../../src/types.ts";

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const cleanName = (value: unknown) => String(value ?? "").trim().slice(0, 18);
const cleanCode = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

export default async (request: Request) => {
  const store = getStore({ name: "amerikaneren-rom", consistency: "strong" });
  const url = new URL(request.url);
  const code = cleanCode(url.searchParams.get("code"));

  if (request.method === "GET") {
    if (!code) return reply({ error: "Mangler romkode." }, 400);
    const room = await store.get(code, { type: "json" }) as Room | null;
    return room ? reply(room) : reply({ error: "Fant ikke rommet." }, 404);
  }

  if (request.method !== "POST") return reply({ error: "Metoden støttes ikke." }, 405);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;

  if (action === "create") {
    const name = cleanName(body.name);
    if (!name) return reply({ error: "Skriv inn navnet ditt." }, 400);
    let roomCode = "";
    do {
      roomCode = Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
    } while (await store.get(roomCode));
    const playerId = crypto.randomUUID();
    const room: Room = {
      code: roomCode,
      hostId: playerId,
      players: [{ id: playerId, name, joinedAt: Date.now() }],
      game: null,
      updatedAt: Date.now(),
    };
    await store.setJSON(roomCode, room);
    return reply({ room, playerId }, 201);
  }

  if (action === "join") {
    const roomCode = cleanCode(body.code);
    const name = cleanName(body.name);
    const room = await store.get(roomCode, { type: "json" }) as Room | null;
    if (!room) return reply({ error: "Fant ikke rommet. Sjekk koden." }, 404);
    if (room.game) return reply({ error: "Spillet har allerede startet." }, 409);
    if (room.players.length >= 4) return reply({ error: "Rommet er fullt." }, 409);
    if (!name) return reply({ error: "Skriv inn navnet ditt." }, 400);
    const playerId = crypto.randomUUID();
    room.players.push({ id: playerId, name, joinedAt: Date.now() });
    room.updatedAt = Date.now();
    await store.setJSON(roomCode, room);
    return reply({ room, playerId });
  }

  if (action === "save") {
    const roomCode = cleanCode(body.code);
    const playerId = String(body.playerId ?? "");
    const room = await store.get(roomCode, { type: "json" }) as Room | null;
    if (!room) return reply({ error: "Rommet finnes ikke lenger." }, 404);
    if (!room.players.some((player) => player.id === playerId)) return reply({ error: "Du er ikke med i rommet." }, 403);
    room.game = body.game as Room["game"];
    room.updatedAt = Date.now();
    await store.setJSON(roomCode, room);
    return reply(room);
  }

  return reply({ error: "Ukjent handling." }, 400);
};
