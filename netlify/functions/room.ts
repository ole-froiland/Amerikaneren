import { getStore } from "@netlify/blobs";
import type { Room } from "../../src/types.ts";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const cleanName = (value: unknown) => String(value ?? "").trim().slice(0, 18);
const cleanCode = (value: unknown) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

// Long-poll budget. Holdes godt under Netlify sin funksjonstimeout,
// slik at klienten alltid får svar og kan koble seg på igjen.
const WAIT_MS = 6000;
const CHECK_MS = 220;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Store = ReturnType<typeof getStore>;

async function readRoom(store: Store, code: string): Promise<Room | null> {
  const room = await store.get(code, { type: "json" }) as Room | null;
  if (!room) return null;
  // Rom lagret før versjonsfeltet fantes starter på 0.
  return { ...room, version: room.version ?? 0 };
}

async function writeRoom(store: Store, room: Room): Promise<Room> {
  const next: Room = { ...room, version: (room.version ?? 0) + 1, updatedAt: Date.now() };
  await store.setJSON(next.code, next);
  return next;
}

export default async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const store = getStore({ name: "amerikaneren-rom", consistency: "strong" });
  const url = new URL(request.url);
  const code = cleanCode(url.searchParams.get("code"));

  if (request.method === "GET") {
    if (!code) return reply({ error: "Mangler romkode." }, 400);
    const sinceParam = url.searchParams.get("since");
    const since = sinceParam === null ? null : Number(sinceParam);
    let room = await readRoom(store, code);
    if (!room) return reply({ error: "Fant ikke rommet." }, 404);

    // Klienten er allerede à jour: hold forbindelsen åpen til noe skjer,
    // slik at endringer kommer fram med én gang i stedet for ved neste poll.
    if (since !== null && Number.isFinite(since) && room.version <= since) {
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        if (request.signal.aborted) return reply({ unchanged: true, version: room.version });
        await sleep(CHECK_MS);
        const fresh = await readRoom(store, code);
        if (!fresh) return reply({ error: "Fant ikke rommet." }, 404);
        if (fresh.version > since) {
          room = fresh;
          return reply(room);
        }
      }
      return reply({ unchanged: true, version: room.version });
    }

    return reply(room);
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
      version: 0,
      updatedAt: Date.now(),
    };
    const saved = await writeRoom(store, room);
    return reply({ room: saved, playerId }, 201);
  }

  if (action === "join") {
    const roomCode = cleanCode(body.code);
    const name = cleanName(body.name);
    const room = await readRoom(store, roomCode);
    if (!room) return reply({ error: "Fant ikke rommet. Sjekk koden." }, 404);
    if (room.game) return reply({ error: "Spillet har allerede startet." }, 409);
    if (room.players.length >= 4) return reply({ error: "Rommet er fullt." }, 409);
    if (!name) return reply({ error: "Skriv inn navnet ditt." }, 400);
    const playerId = crypto.randomUUID();
    room.players.push({ id: playerId, name, joinedAt: Date.now() });
    const saved = await writeRoom(store, room);
    return reply({ room: saved, playerId });
  }

  if (action === "save") {
    const roomCode = cleanCode(body.code);
    const playerId = String(body.playerId ?? "");
    const baseVersion = typeof body.baseVersion === "number" ? body.baseVersion : null;
    const room = await readRoom(store, roomCode);
    if (!room) return reply({ error: "Rommet finnes ikke lenger." }, 404);
    if (!room.players.some((player) => player.id === playerId)) return reply({ error: "Du er ikke med i rommet." }, 403);
    // To spillere skrev samtidig. Serveren beholder sin versjon og
    // sender den tilbake, så alle havner på samme tilstand igjen.
    if (baseVersion !== null && room.version !== baseVersion) return reply({ room, conflict: true });
    room.game = body.game as Room["game"];
    const saved = await writeRoom(store, room);
    return reply({ room: saved, conflict: false });
  }

  return reply({ error: "Ukjent handling." }, 400);
};
