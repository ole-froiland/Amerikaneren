import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETUP, SETUP_KEYS, gameAvailable, readChoice, stepsFor, summaryOf, writeChoice } from "./setup.ts";
import type { SetupChoice } from "./setup.ts";

const choiceWith = (patch: Partial<SetupChoice>): SetupChoice => ({ ...DEFAULT_SETUP, ...patch });

const store = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    read: (key: string) => map.get(key) ?? null,
    write: (key: string, value: string) => { map.set(key, value); },
  };
};

test("solo Amerikaneren asks nothing beyond mode, game and ready", () => {
  assert.deepEqual(stepsFor(choiceWith({ mode: "alene", game: "amerikaneren" })), ["modus", "spill", "klar"]);
});

test("Amerikaneren with friends adds the player count", () => {
  assert.deepEqual(
    stepsFor(choiceWith({ mode: "venner", game: "amerikaneren" })),
    ["modus", "spill", "antall", "klar"],
  );
});

test("Poker adds count, difficulty and coach", () => {
  assert.deepEqual(
    stepsFor(choiceWith({ game: "poker" })),
    ["modus", "spill", "antall", "niva", "coach", "klar"],
  );
});

test("a locked game drops the two first steps", () => {
  assert.deepEqual(stepsFor(choiceWith({ game: "poker" }), true), ["antall", "niva", "coach", "klar"]);
});

test("Poker is only available alone", () => {
  assert.equal(gameAvailable("alene", "poker"), true);
  assert.equal(gameAvailable("venner", "poker"), false);
  assert.equal(gameAvailable("venner", "amerikaneren"), true);
});

test("an empty store gives the defaults", () => {
  assert.deepEqual(readChoice(store().read), DEFAULT_SETUP);
});

test("keeps the old poker keys so earlier choices survive", () => {
  const saved = store({ [SETUP_KEYS.level]: "vanskelig", [SETUP_KEYS.coach]: "på" });
  const choice = readChoice(saved.read);
  assert.equal(choice.level, "vanskelig");
  assert.equal(choice.coach, true);
});

test("counts outside the table size are pulled back in", () => {
  const saved = store({ [SETUP_KEYS.humans]: "9", [SETUP_KEYS.opponents]: "0" });
  const choice = readChoice(saved.read);
  assert.equal(choice.humans, 4);
  assert.equal(choice.opponents, 1);
});

test("junk values fall back instead of throwing", () => {
  const saved = store({ [SETUP_KEYS.humans]: "tre", [SETUP_KEYS.level]: "grusom", [SETUP_KEYS.game]: "ludo" });
  const choice = readChoice(saved.read);
  assert.equal(choice.humans, DEFAULT_SETUP.humans);
  assert.equal(choice.level, DEFAULT_SETUP.level);
  assert.equal(choice.game, "amerikaneren");
});

test("Poker with friends is not a combination we can restore", () => {
  const saved = store({ [SETUP_KEYS.mode]: "venner", [SETUP_KEYS.game]: "poker" });
  const choice = readChoice(saved.read);
  assert.equal(choice.mode, "venner");
  assert.equal(choice.game, "amerikaneren");
});

test("the old name for poker still points at the poker table", () => {
  const saved = store({ [SETUP_KEYS.game]: "bakrommet" });
  assert.equal(readChoice(saved.read).game, "poker");
});

test("what is written comes back unchanged", () => {
  const saved = store();
  const choice = choiceWith({ mode: "venner", humans: 3, opponents: 5, level: "lett", coach: true });
  writeChoice(choice, saved.write);
  assert.deepEqual(readChoice(saved.read), choice);
});

test("the summary names what you picked", () => {
  assert.deepEqual(
    summaryOf(choiceWith({ game: "poker", opponents: 3, level: "vanskelig", coach: true })),
    ["Poker", "mot 3", "vanskelig", "coach på"],
  );
  assert.deepEqual(summaryOf(choiceWith({ mode: "alene" })), ["Amerikaneren", "du + 3 bots"]);
  assert.deepEqual(summaryOf(choiceWith({ mode: "venner", humans: 3 })), ["Amerikaneren", "3 spillere + 1 bot"]);
  assert.deepEqual(summaryOf(choiceWith({ mode: "venner", humans: 4 })), ["Amerikaneren", "fullt bord"]);
});

test("chess asks about the bot only when you play alone", () => {
  assert.deepEqual(stepsFor(choiceWith({ game: "sjakk", mode: "alene" })), ["modus", "spill", "niva", "coach", "klar"]);
  assert.deepEqual(stepsFor(choiceWith({ game: "sjakk", mode: "venner" })), ["modus", "spill", "coach", "klar"]);
});

test("chess can be played with friends, poker cannot", () => {
  assert.equal(gameAvailable("venner", "sjakk"), true);
  assert.equal(gameAvailable("venner", "poker"), false);
});

test("the chess summary says who is across the board", () => {
  assert.deepEqual(summaryOf(choiceWith({ game: "sjakk", mode: "alene", level: "lett" })), ["Sjakk", "mot bot", "lett", "coach av"]);
  assert.deepEqual(summaryOf(choiceWith({ game: "sjakk", mode: "venner", coach: true })), ["Sjakk", "to spillere", "coach på"]);
});
