/**
 * Valgene man tar før spillet starter, og reglene for hvilke steg som gjelder.
 *
 * Rene funksjoner uten React eller nettleser. Veiviseren i StartWizard.tsx er
 * bare skallet rundt dette, og både forsiden og Bakrommet bruker samme steg.
 */

export type SetupMode = "alene" | "venner";
export type SetupGame = "amerikaneren" | "bakrommet";
export type SetupStep = "modus" | "spill" | "antall" | "niva" | "coach" | "klar";
export type Difficulty = "lett" | "middels" | "vanskelig";

export const DIFFICULTY_NAME: Record<Difficulty, string> = {
  lett: "Lett", middels: "Middels", vanskelig: "Vanskelig",
};

export const DIFFICULTY_HINT: Record<Difficulty, string> = {
  lett: "syner for mye, høyner sjelden",
  middels: "spiller stort sett fornuftig",
  vanskelig: "presser hardt og legger ned søppel",
};

export const GAME_NAME: Record<SetupGame, string> = {
  amerikaneren: "Amerikaneren", bakrommet: "Bakrommet",
};

/** Amerikaneren spilles alltid fire rundt bordet, så det er bare menneskene som telles. */
export const MIN_HUMANS = 2;
export const MAX_HUMANS = 4;
export const MIN_OPPONENTS = 1;
export const MAX_OPPONENTS = 5;

export interface SetupChoice {
  mode: SetupMode;
  game: SetupGame;
  /** Hvor mange mennesker det er plass til i rommet. Resten fylles av bots. */
  humans: number;
  /** Hvor mange bots du spiller mot i Bakrommet. */
  opponents: number;
  level: Difficulty;
  coach: boolean;
  showFolded: boolean;
}

export const DEFAULT_SETUP: SetupChoice = {
  mode: "alene",
  game: "amerikaneren",
  humans: MAX_HUMANS,
  opponents: 3,
  level: "middels",
  coach: false,
  showFolded: true,
};

/** Bakrommet har ingen onlinerom, så det bordet kan bare spilles alene. */
export const gameAvailable = (mode: SetupMode, game: SetupGame) =>
  game === "amerikaneren" || mode === "alene";

/**
 * Stegene som gjelder for et valg. Bakrommet trenger nivå og coach, Amerikaneren
 * trenger bare antall når man venter på venner. Er spillet allerede gitt – som
 * på /poker – faller de to første stegene bort.
 */
export function stepsFor(choice: SetupChoice, locked = false): SetupStep[] {
  const steps: SetupStep[] = locked ? [] : ["modus", "spill"];
  if (choice.game === "bakrommet") steps.push("antall", "niva", "coach");
  else if (choice.mode === "venner") steps.push("antall");
  steps.push("klar");
  return steps;
}

/** Kort oppsummering av valgene, vist på siste steg før man starter. */
export function summaryOf(choice: SetupChoice): string[] {
  const lines = [GAME_NAME[choice.game]];
  if (choice.game === "bakrommet") {
    lines.push(choice.opponents === 1 ? "mot én" : `mot ${choice.opponents}`);
    lines.push(DIFFICULTY_NAME[choice.level].toLowerCase());
    lines.push(choice.coach ? "coach på" : "coach av");
    return lines;
  }
  if (choice.mode === "alene") {
    lines.push("du + 3 bots");
    return lines;
  }
  const bots = MAX_HUMANS - choice.humans;
  lines.push(bots === 0 ? "fullt bord" : `${choice.humans} spillere + ${bots} ${bots === 1 ? "bot" : "bots"}`);
  return lines;
}

/** Nøklene i localStorage. De gamle beholdes, så valg fra før veiviseren overlever. */
export const SETUP_KEYS = {
  mode: "amerikaneren-modus",
  game: "amerikaneren-spill",
  humans: "amerikaneren-spillere",
  opponents: "bakrommet-motstandere",
  level: "bakrommet-niva",
  coach: "bakrommet-coach",
  folded: "bakrommet-kastede",
} as const;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const count = (raw: string | null, fallback: number, low: number, high: number) => {
  const value = Number(raw);
  return Number.isFinite(value) && raw !== null && raw !== "" ? clamp(Math.round(value), low, high) : fallback;
};

export function readChoice(read: (key: string) => string | null): SetupChoice {
  const saved = read(SETUP_KEYS.level);
  const mode: SetupMode = read(SETUP_KEYS.mode) === "venner" ? "venner" : "alene";
  const game: SetupGame = read(SETUP_KEYS.game) === "bakrommet" ? "bakrommet" : "amerikaneren";
  return {
    mode,
    // Lagret kombinasjon som ikke finnes lenger faller tilbake på Amerikaneren.
    game: gameAvailable(mode, game) ? game : "amerikaneren",
    humans: count(read(SETUP_KEYS.humans), DEFAULT_SETUP.humans, MIN_HUMANS, MAX_HUMANS),
    opponents: count(read(SETUP_KEYS.opponents), DEFAULT_SETUP.opponents, MIN_OPPONENTS, MAX_OPPONENTS),
    level: saved === "lett" || saved === "middels" || saved === "vanskelig" ? saved : DEFAULT_SETUP.level,
    // Coachen er av som standard – den er der for den som vil ha den.
    coach: read(SETUP_KEYS.coach) === "på",
    // Kastede kort vises som standard – det er slik man lærer av hendene.
    showFolded: read(SETUP_KEYS.folded) !== "av",
  };
}

export function writeChoice(choice: SetupChoice, write: (key: string, value: string) => void): void {
  write(SETUP_KEYS.mode, choice.mode);
  write(SETUP_KEYS.game, choice.game);
  write(SETUP_KEYS.humans, String(choice.humans));
  write(SETUP_KEYS.opponents, String(choice.opponents));
  write(SETUP_KEYS.level, choice.level);
  write(SETUP_KEYS.coach, choice.coach ? "på" : "av");
  write(SETUP_KEYS.folded, choice.showFolded ? "på" : "av");
}

/** Leser valgene fra forrige gang. Privat modus uten lagring gir standardvalgene. */
export const loadChoice = (): SetupChoice => {
  try { return readChoice((key) => window.localStorage.getItem(key)); }
  catch { return DEFAULT_SETUP; }
};

export const saveChoice = (choice: SetupChoice): void => {
  try { writeChoice(choice, (key, value) => window.localStorage.setItem(key, value)); }
  catch { /* privat modus */ }
};
