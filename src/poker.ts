/**
 * Texas hold'em-motoren bak pokerbordet på /poker.
 *
 * Alt her er rene funksjoner: inn med en tilstand, ut med en ny. Ingen ekte penger –
 * hver spiller får en bunke sjetonger, og potten er bare tall.
 */
import { RANK_NAME, createDeck, shuffle } from "./game.ts";
import type { Difficulty } from "./setup.ts";
import type { Card, Rank, Suit } from "./types.ts";

/** Nivået velges i oppsettet, så typen bor sammen med de andre valgene. */
export type { Difficulty } from "./setup.ts";

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";
export type ActionType = "fold" | "check" | "call" | "raise";

export interface PokerAction {
  type: ActionType;
  /** For «raise»: hvor mye spilleren totalt står inne med i denne budrunden. */
  amount?: number;
}

export interface PokerPlayer {
  id: string;
  name: string;
  isBot: boolean;
  /** Sjetonger foran seg, utenom det som allerede er skjøvet inn. */
  chips: number;
  /** Satset i denne budrunden. */
  bet: number;
  /** Satset i hele hånden. Grunnlaget for sidepotter. */
  committed: number;
  cards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Har handlet siden forrige høyning. Nullstilles når noen høyner. */
  acted: boolean;
  lastAction: string | null;
  /** Blakk – sitter over resten av spillet. */
  out: boolean;
}

export interface PotShare {
  playerId: string;
  amount: number;
  /** Sidepott nummer 0 er hovedpotten. */
  potIndex: number;
}

export interface ShowdownEntry {
  playerId: string;
  best: Card[];
  label: string;
  score: number[];
  won: number;
  /** La kortene ligge skjult – vant fordi alle andre kastet seg. */
  mucked: boolean;
  /** Kastet seg underveis. Hånden er regnet ut i ettertid, «hva hvis». */
  folded: boolean;
}

export interface DifficultyProfile {
  /** Tilfeldig støy på botens vurdering av egen hånd. Mye støy = feilvurderer ofte. */
  noise: number;
  /** Hvor sterk hånden må være før den høyner. */
  raiseAt: number;
  /** Hvor mye bedre enn pottoddsen hånden må være for å syne. Negativt = syner for mye. */
  callMargin: number;
  /** Hvor ofte den satser uten å ha noe. */
  bluff: number;
  /** Hvor stor andel av potten den satser når den først satser. */
  aggression: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  // Ser knapt på kortene: syner alt, høyner nesten aldri.
  nybegynner: { noise: 0.5, raiseAt: 0.97, callMargin: -0.34, bluff: 0.02, aggression: 0.3 },
  // Passiv og godtroende: syner nesten alt, høyner nesten aldri, bommer på styrken.
  lett: { noise: 0.34, raiseAt: 0.92, callMargin: -0.22, bluff: 0.04, aggression: 0.45 },
  middels: { noise: 0.12, raiseAt: 0.82, callMargin: 0.06, bluff: 0.14, aggression: 0.7 },
  // Ser hånden klart, presser med gode kort og legger ned de dårlige.
  vanskelig: { noise: 0.04, raiseAt: 0.7, callMargin: 0.13, bluff: 0.24, aggression: 0.95 },
  // Leser prisen riktig: ingen støy, legger ned alt tvilsomt og presser med resten.
  umulig: { noise: 0, raiseAt: 0.62, callMargin: 0.18, bluff: 0.3, aggression: 1 },
};

/**
 * Et trekk du selv gjorde, med alt som var kjent i øyeblikket.
 * Coachen dømmer ut fra dette – aldri ut fra hvordan hånden endte.
 */
export interface DecisionRecord {
  playerId: string;
  street: Street;
  action: ActionType;
  /** Hva trekket kostet deg der og da. */
  paid: number;
  /** Hva det ville kostet å bli med videre. */
  toCall: number;
  /** Potten før du la noe i den. */
  pot: number;
  /** Hvor mange som fortsatt var med, utenom deg. */
  opponents: number;
  hole: Card[];
  board: Card[];
}

export interface PokerState {
  difficulty: Difficulty;
  players: PokerPlayer[];
  deck: Card[];
  board: Card[];
  /** Setet med dealerknappen. */
  button: number;
  street: Street;
  turn: number;
  /** Høyeste beløp noen står inne med i denne budrunden. */
  currentBet: number;
  /** Minste tillatte høyning over currentBet. */
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  hand: number;
  message: string;
  log: string[];
  showdown: ShowdownEntry[] | null;
  handOver: boolean;
  /** Satt når bare én spiller har sjetonger igjen. */
  winnerId: string | null;
  /** Vis alle hull-kort (showdown eller alle all-in). */
  revealAll: boolean;
  /** Kort som ennå ikke er snudd på bordet, brukt til utdelingsanimasjonen. */
  dealtAt: number;
  /** Dine egne trekk i denne hånden, til bruk i coach-modus. */
  review: DecisionRecord[];
}

export const START_CHIPS = 1000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;

export const BOT_NAMES = ["Trump", "Putin", "Kim Jong-un", "Erna", "Jens"];

/** Entall og flertall på norsk, til setninger som «Par i konger» og «Straight til dame». */
const RANK_SINGULAR: Record<Rank, string> = {
  2: "to", 3: "tre", 4: "fire", 5: "fem", 6: "seks", 7: "sju", 8: "åtte", 9: "ni",
  10: "ti", 11: "knekt", 12: "dame", 13: "konge", 14: "ess",
};
const RANK_PLURAL: Record<Rank, string> = {
  2: "toere", 3: "treere", 4: "firere", 5: "femmere", 6: "seksere", 7: "sjuere", 8: "åttere", 9: "niere",
  10: "tiere", 11: "knekter", 12: "damer", 13: "konger", 14: "ess",
};
const SUIT_IN: Record<Suit, string> = {
  clubs: "kløver", diamonds: "ruter", hearts: "hjerter", spades: "spar",
};

export const CATEGORY_NAME = [
  "Høyt kort", "Par", "To par", "Tre like", "Straight", "Flush", "Fullt hus", "Fire like", "Straight flush",
];

export const cardName = (card: Card) => `${RANK_NAME[card.rank]}${SUIT_IN[card.suit].slice(0, 1)}`;

/* ------------------------------------------------------------------ *
 * Kortverdi
 * ------------------------------------------------------------------ */

/** Alle kombinasjoner av `size` kort. Sju kort gir 21 femkortshender – billig nok. */
function combinations(cards: Card[], size: number): Card[][] {
  if (size === 0) return [[]];
  if (cards.length < size) return [];
  const [first, ...rest] = cards;
  return [...combinations(rest, size - 1).map((combo) => [first, ...combo]), ...combinations(rest, size)];
}

/** Sammenligner to poengrekker leksikografisk. Positivt tall betyr at `a` er best. */
export function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Rangerer nøyaktig fem kort. Første tall er kategorien, resten skiller like kategorier. */
function scoreFive(cards: Card[]): number[] {
  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);

  const unique = [...new Set(ranks)];
  // Ess teller som 1 i den minste straighten, 5-4-3-2-A.
  const forStraight = unique.includes(14) ? [...unique, 1] : unique;
  let straightHigh = 0;
  for (let i = 0; i + 4 < forStraight.length; i += 1) {
    if (forStraight[i] - forStraight[i + 4] === 4) { straightHigh = forStraight[i]; break; }
  }

  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  // Sorter først på antall like, så på verdi: [antall, verdi].
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank];
  if (groups[0].count === 3 && groups[1]?.count === 2) return [6, groups[0].rank, groups[1].rank];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0].count === 3) return [3, groups[0].rank, ...groups.slice(1).map((g) => g.rank)];
  if (groups[0].count === 2 && groups[1]?.count === 2) return [2, groups[0].rank, groups[1].rank, groups[2].rank];
  if (groups[0].count === 2) return [1, groups[0].rank, ...groups.slice(1).map((g) => g.rank)];
  return [0, ...ranks];
}

function labelFor(score: number[], best: Card[]): string {
  const [category, first, second] = score;
  const rank = (value: number) => RANK_SINGULAR[value as Rank] ?? String(value);
  const plural = (value: number) => RANK_PLURAL[value as Rank] ?? String(value);
  switch (category) {
    case 8: return first === 14 ? "Royal flush" : `Straight flush til ${rank(first)}`;
    case 7: return `Fire ${plural(first)}`;
    case 6: return `Fullt hus, ${plural(first)} over ${plural(second)}`;
    case 5: return `Flush i ${SUIT_IN[best[0].suit]}`;
    case 4: return `Straight til ${rank(first)}`;
    case 3: return `Tre ${plural(first)}`;
    // Sidekortet er ofte det som skiller to like hender – ta det med.
    case 2: return `To par, ${plural(first)} og ${plural(second)} med ${rank(score[3])}`;
    case 1: return `Par i ${plural(first)} med ${rank(score[2])}`;
    default: return `Høyt kort, ${rank(first)}`;
  }
}

export interface HandValue {
  score: number[];
  best: Card[];
  label: string;
  category: number;
}

/** Finner den beste femkortshånden blant kortene som sendes inn (typisk to på hånd + fem på bordet). */
export function evaluate(cards: Card[]): HandValue {
  if (cards.length < 5) {
    const score = [0, ...cards.map((card) => card.rank).sort((a, b) => b - a)];
    return { score, best: [...cards], label: labelFor(score, cards), category: 0 };
  }
  let best = cards.slice(0, 5);
  let score = scoreFive(best);
  for (const combo of combinations(cards, 5)) {
    const candidate = scoreFive(combo);
    if (compareScore(candidate, score) > 0) { score = candidate; best = combo; }
  }
  return { score, best, label: labelFor(score, best), category: score[0] };
}

/* ------------------------------------------------------------------ *
 * Oppsett
 * ------------------------------------------------------------------ */

export function createPokerPlayers(humanName: string, botCount: number): PokerPlayer[] {
  const blank = { chips: START_CHIPS, bet: 0, committed: 0, cards: [] as Card[], folded: false, allIn: false, acted: false, lastAction: null, out: false };
  const you: PokerPlayer = { id: `you-${crypto.randomUUID()}`, name: humanName.trim() || "Du", isBot: false, ...blank };
  const bots = BOT_NAMES.slice(0, Math.max(1, Math.min(botCount, BOT_NAMES.length))).map((name, index) => ({
    id: `bot-${index}-${crypto.randomUUID()}`,
    name,
    isBot: true,
    ...blank,
  }));
  return [you, ...bots];
}

/** Lager et nytt bord. Første hånd deles ut med en gang. */
export function createPokerGame(players: PokerPlayer[], difficulty: Difficulty = "middels", random = Math.random): PokerState {
  const seed: PokerState = {
    difficulty,
    players,
    deck: [],
    board: [],
    button: players.length - 1,
    street: "preflop",
    turn: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    hand: 0,
    message: "",
    log: [],
    showdown: null,
    handOver: true,
    winnerId: null,
    revealAll: false,
    dealtAt: 0,
    review: [],
  };
  return startHand(seed, random);
}

const nextSeat = (state: PokerState, from: number, matches: (player: PokerPlayer) => boolean): number => {
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (from + step) % state.players.length;
    if (matches(state.players[index])) return index;
  }
  return from;
};

/** Deler ut en ny hånd: flytter knappen, stokker, legger blinder og setter første tur. */
export function startHand(state: PokerState, random = Math.random): PokerState {
  const deck = shuffle(createDeck(), random);
  const players: PokerPlayer[] = state.players.map((player) => ({
    ...player,
    chips: player.chips,
    bet: 0,
    committed: 0,
    cards: [] as Card[],
    folded: player.chips <= 0,
    allIn: false,
    acted: false,
    lastAction: null,
    out: player.chips <= 0,
  }));

  const seated = players.filter((player) => !player.out);
  if (seated.length < 2) {
    return { ...state, players, handOver: true, winnerId: seated[0]?.id ?? null, message: "Bordet er ferdig." };
  }

  const withPlayers: PokerState = { ...state, players };
  const button = nextSeat(withPlayers, state.button, (player) => !player.out);

  // To spillere: knappen er lilleblind og starter budrunden. Ellers går blindene til venstre for knappen.
  const heads = seated.length === 2;
  const small = heads ? button : nextSeat({ ...withPlayers, button }, button, (p) => !p.out);
  const big = nextSeat({ ...withPlayers, button }, small, (p) => !p.out);

  let cursor = 0;
  for (const player of players) {
    if (player.out) continue;
    player.cards = [deck[cursor], deck[cursor + players.filter((p) => !p.out).length]];
    cursor += 1;
  }
  const dealt = seated.length * 2;

  const post = (index: number, amount: number, label: string) => {
    const player = players[index];
    const paid = Math.min(amount, player.chips);
    player.chips -= paid;
    player.bet = paid;
    player.committed = paid;
    player.allIn = player.chips === 0;
    player.lastAction = label;
  };
  post(small, state.smallBlind, "Lilleblind");
  post(big, state.bigBlind, "Storeblind");

  const base: PokerState = {
    ...state,
    players,
    deck: deck.slice(dealt),
    board: [],
    button,
    street: "preflop",
    currentBet: Math.max(players[big].bet, players[small].bet),
    minRaise: state.bigBlind,
    hand: state.hand + 1,
    message: "",
    log: [],
    showdown: null,
    handOver: false,
    winnerId: null,
    revealAll: false,
    dealtAt: Date.now(),
    review: [],
    turn: 0,
  };
  // Preflop starter til venstre for storeblind – eller på knappen når det bare er to igjen.
  const first = heads ? small : nextSeat(base, big, (player) => !player.out && !player.allIn);
  const state2 = { ...base, turn: first };
  return { ...state2, message: turnMessage(state2) };
}

/* ------------------------------------------------------------------ *
 * Budrunder
 * ------------------------------------------------------------------ */

export const totalPot = (state: PokerState) => state.players.reduce((sum, player) => sum + player.committed, 0);
/** Det som allerede ligger i midten, uten sjetongene spillerne har foran seg i denne runden. */
export const middlePot = (state: PokerState) => state.players.reduce((sum, player) => sum + player.committed - player.bet, 0);

const contenders = (state: PokerState) => state.players.filter((player) => !player.folded && !player.out);
const canAct = (state: PokerState) => contenders(state).filter((player) => !player.allIn);

export interface LegalActions {
  canCheck: boolean;
  callAmount: number;
  canCall: boolean;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export function legalActions(state: PokerState, index = state.turn): LegalActions {
  const player = state.players[index];
  const behind = state.currentBet - player.bet;
  const callAmount = Math.max(0, Math.min(behind, player.chips));
  const maxRaiseTo = player.bet + player.chips;
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo);
  return {
    canCheck: behind <= 0,
    callAmount,
    canCall: behind > 0 && player.chips > 0,
    // Har du mindre enn en full høyning igjen, kan du fortsatt gå all-in.
    canRaise: player.chips > callAmount,
    minRaiseTo,
    maxRaiseTo,
  };
}

const chipText = (amount: number) => `${amount}`;

function turnMessage(state: PokerState): string {
  const player = state.players[state.turn];
  if (!player) return "";
  const { canCheck } = legalActions(state, state.turn);
  if (!player.isBot) return canCheck ? "Din tur – sjekk eller sats" : `Din tur – ${state.currentBet - player.bet} å se`;
  return `${player.name} tenker…`;
}

/** Utfører en handling for spilleren som har tur, og driver hånden videre. */
export function act(state: PokerState, action: PokerAction): PokerState {
  if (state.handOver) return state;
  const index = state.turn;
  const players = state.players.map((player) => ({ ...player }));
  const player = players[index];
  if (!player || player.folded || player.out || player.allIn) return state;

  const { canCheck, callAmount, minRaiseTo, maxRaiseTo } = legalActions(state, index);
  // Situasjonen slik den er akkurat nå, før trekket endrer noe. Coachen bruker
  // dette til å dømme valget på egne premisser.
  const before = {
    pot: totalPot(state),
    toCall: callAmount,
    opponents: state.players.filter((other) => other !== player && !other.folded && !other.out).length,
    chipsBefore: player.chips,
  };
  let currentBet = state.currentBet;
  let minRaise = state.minRaise;
  let reopen = false;
  let note = "";

  if (action.type === "fold") {
    player.folded = true;
    player.lastAction = "Kaster seg";
    note = `${player.name} kaster seg`;
  } else if (action.type === "check") {
    if (!canCheck) return state;
    player.lastAction = "Sjekker";
    note = `${player.name} sjekker`;
  } else if (action.type === "call") {
    if (callAmount <= 0) return state;
    player.chips -= callAmount;
    player.bet += callAmount;
    player.committed += callAmount;
    player.allIn = player.chips === 0;
    player.lastAction = player.allIn ? `All-in ${chipText(player.bet)}` : `Syner ${chipText(callAmount)}`;
    note = `${player.name} syner ${callAmount}`;
  } else {
    const target = Math.max(minRaiseTo, Math.min(Math.round(action.amount ?? minRaiseTo), maxRaiseTo));
    const paid = target - player.bet;
    if (paid <= 0 || paid > player.chips) return state;
    const raiseSize = target - currentBet;
    player.chips -= paid;
    player.bet = target;
    player.committed += paid;
    player.allIn = player.chips === 0;
    const opening = currentBet === 0;
    player.lastAction = player.allIn ? `All-in ${chipText(target)}` : `${opening ? "Satser" : "Høyner til"} ${chipText(target)}`;
    note = `${player.name} ${opening ? "satser" : "høyner til"} ${target}`;
    if (raiseSize > 0) {
      // En kort all-in under minstehøyningen åpner ikke budrunden på nytt.
      reopen = raiseSize >= minRaise;
      if (reopen) minRaise = raiseSize;
      currentBet = Math.max(currentBet, target);
    }
  }

  player.acted = true;
  if (reopen) {
    for (const other of players) {
      if (other !== player && !other.folded && !other.out && !other.allIn) other.acted = false;
    }
  }

  const record: DecisionRecord = {
    playerId: player.id,
    street: state.street,
    action: action.type,
    paid: before.chipsBefore - player.chips,
    toCall: before.toCall,
    pot: before.pot,
    opponents: before.opponents,
    hole: [...player.cards],
    board: [...state.board],
  };

  const next: PokerState = {
    ...state,
    players,
    currentBet,
    minRaise,
    log: note ? [...state.log, note] : state.log,
    // Bare dine egne trekk er verdt å gå gjennom etterpå.
    review: player.isBot ? state.review : [...state.review, record],
  };
  return advance(next);
}

/** Legger sjetongene i midten og gjør klar neste budrunde. */
function collectBets(state: PokerState): PokerState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, bet: 0, acted: false, lastAction: player.folded || player.allIn ? player.lastAction : null })),
    currentBet: 0,
    minRaise: state.bigBlind,
  };
}

function dealBoard(state: PokerState, count: number): PokerState {
  // Ett brennkort før hver gate, som ved bordet.
  const deck = state.deck.slice(1);
  return { ...state, board: [...state.board, ...deck.slice(0, count)], deck: deck.slice(count), dealtAt: Date.now() };
}

const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river", "showdown"];
const STREET_LABEL: Record<Street, string> = {
  preflop: "Før flop", flop: "Flop", turn: "Turn", river: "River", showdown: "Showdown",
};
export const streetLabel = (street: Street) => STREET_LABEL[street];

/** Sjekker om budrunden er ferdig og går i så fall videre til neste gate. */
function advance(state: PokerState): PokerState {
  if (contenders(state).length <= 1) return finishHand(state);

  const live = canAct(state);
  const roundDone = live.every((player) => player.acted && player.bet === state.currentBet);
  if (!roundDone) {
    const turn = nextSeat(state, state.turn, (player) => !player.folded && !player.out && !player.allIn);
    const next = { ...state, turn };
    return { ...next, message: turnMessage(next) };
  }

  let next = collectBets(state);
  if (next.street === "river") return finishHand({ ...next, street: "showdown" });

  const streetIndex = STREET_ORDER.indexOf(next.street);
  const nextStreet = STREET_ORDER[streetIndex + 1];
  next = dealBoard(next, nextStreet === "flop" ? 3 : 1);
  next = { ...next, street: nextStreet };

  // Er alle utenom én all-in, er det ingen igjen å by mot: kjør ut resten av bordet.
  if (canAct(next).length <= 1) {
    let runout = { ...next, revealAll: true };
    while (runout.board.length < 5) {
      runout = dealBoard(runout, 1);
      runout = { ...runout, street: STREET_ORDER[STREET_ORDER.indexOf(runout.street) + 1] ?? "river" };
    }
    return finishHand({ ...runout, street: "showdown" });
  }

  // Etter flop starter den første aktive til venstre for knappen.
  const turn = nextSeat(next, next.button, (player) => !player.folded && !player.out && !player.allIn);
  const opened = { ...next, turn, message: "" };
  return { ...opened, message: `${STREET_LABEL[nextStreet]} · ${turnMessage(opened)}` };
}

/* ------------------------------------------------------------------ *
 * Oppgjør
 * ------------------------------------------------------------------ */

interface SidePot { amount: number; eligible: string[] }

/** Deler innsatsene i hoved- og sidepotter ut fra hvor mye hver spiller rakk å satse. */
export function buildPots(players: PokerPlayer[]): SidePot[] {
  const levels = [...new Set(players.filter((p) => p.committed > 0).map((p) => p.committed))].sort((a, b) => a - b);
  const pots: SidePot[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const player of players) amount += Math.min(Math.max(player.committed - previous, 0), level - previous);
    const eligible = players.filter((player) => !player.folded && player.committed >= level).map((player) => player.id);
    const last = pots.at(-1);
    // Slå sammen potter med nøyaktig samme deltakere, ellers blir det bare støy i visningen.
    if (last && last.eligible.length === eligible.length && last.eligible.every((id) => eligible.includes(id))) {
      last.amount += amount;
    } else if (amount > 0) {
      pots.push({ amount, eligible });
    }
    previous = level;
  }
  return pots;
}

function finishHand(state: PokerState): PokerState {
  const players = state.players.map((player) => ({ ...player }));
  const live = players.filter((player) => !player.folded && !player.out);
  const pots = buildPots(players);
  const won = new Map<string, number>();
  const entries: ShowdownEntry[] = [];

  if (live.length === 1) {
    // Alle andre kastet seg – vinneren slipper å vise kortene.
    const winner = live[0];
    const amount = pots.reduce((sum, pot) => sum + pot.amount, 0);
    won.set(winner.id, amount);
    entries.push({ playerId: winner.id, best: [], label: "Alle kastet seg", score: [], won: amount, mucked: true, folded: false });
  } else {
    const values = new Map<string, HandValue>();
    for (const player of live) values.set(player.id, evaluate([...player.cards, ...state.board]));
    for (const pot of pots) {
      const inPot = pot.eligible.filter((id) => live.some((player) => player.id === id));
      if (inPot.length === 0) continue;
      let bestScore: number[] = [];
      let winners: string[] = [];
      for (const id of inPot) {
        const value = values.get(id)!;
        const diff = winners.length === 0 ? 1 : compareScore(value.score, bestScore);
        if (diff > 0) { bestScore = value.score; winners = [id]; }
        else if (diff === 0) winners.push(id);
      }
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // Odde sjetonger går til den første til venstre for knappen.
      const ordered = [...winners].sort((a, b) => seatDistance(state, a) - seatDistance(state, b));
      for (const id of ordered) {
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        won.set(id, (won.get(id) ?? 0) + share + extra);
      }
    }
    for (const player of live) {
      const value = values.get(player.id)!;
      entries.push({ playerId: player.id, best: value.best, label: value.label, score: value.score, won: won.get(player.id) ?? 0, mucked: false, folded: false });
    }
  }

  // Hendene til dem som kastet seg regnes også ut, mot det ferdige bordet, slik at
  // man kan se hva som ville skjedd. De kan ikke vinne noe – de er ute av hånden.
  // Dette gjelder også når alle kastet seg til slutt, så lenge bordet rakk å bli ferdig.
  if (state.board.length === 5) {
    for (const player of players) {
      if (!player.folded || player.out || player.cards.length < 2) continue;
      const value = evaluate([...player.cards, ...state.board]);
      entries.push({ playerId: player.id, best: value.best, label: value.label, score: value.score, won: 0, mucked: false, folded: true });
    }
  }
  entries.sort((a, b) => b.won - a.won || compareScore(b.score, a.score));

  for (const player of players) {
    player.chips += won.get(player.id) ?? 0;
    // Sjetongene foran spillerne er skjøvet inn – potten står oppført under `committed`.
    player.bet = 0;
  }

  const withChips = players.filter((player) => player.chips > 0);
  const top = entries[0];
  const topName = players.find((player) => player.id === top?.playerId)?.name ?? "";
  const shared = entries.filter((entry) => entry.won > 0).length > 1;
  const message = !top ? "Hånden er ferdig."
    : shared ? `Delt pott på ${top.won} sjetonger`
      : top.mucked ? `${topName} tar potten på ${top.won}`
        : `${topName} vinner ${top.won} med ${top.label.toLowerCase()}`;

  return {
    ...state,
    players,
    street: "showdown",
    handOver: true,
    revealAll: live.length > 1,
    showdown: entries,
    message,
    winnerId: withChips.length <= 1 ? withChips[0]?.id ?? null : null,
  };
}

const seatDistance = (state: PokerState, playerId: string) => {
  const index = state.players.findIndex((player) => player.id === playerId);
  return (index - state.button + state.players.length) % state.players.length;
};

/* ------------------------------------------------------------------ *
 * Roller rundt bordet
 * ------------------------------------------------------------------ */

export type Badge = "dealer" | "small" | "big";

/** Hvilken av de tre knappene et sete har i denne hånden. */
export function badgeFor(state: PokerState, index: number): Badge | null {
  const seated = state.players.filter((player) => !player.out).length;
  if (seated < 2) return null;
  const small = seated === 2 ? state.button : nextSeat(state, state.button, (player) => !player.out);
  const big = nextSeat(state, small, (player) => !player.out);
  if (index === state.button) return "dealer";
  if (index === small) return "small";
  if (index === big) return "big";
  return null;
}

export const BADGE_LABEL: Record<Badge, string> = { dealer: "D", small: "SB", big: "BB" };
export const BADGE_NAME: Record<Badge, string> = { dealer: "Dealer", small: "Lilleblind", big: "Storeblind" };

/* ------------------------------------------------------------------ *
 * Bots
 * ------------------------------------------------------------------ */

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** Chen-formelen: en grov, velprøvd poengsum for to starthånd-kort. */
function startingScore(cards: Card[]): number {
  const [high, low] = [...cards].sort((a, b) => b.rank - a.rank);
  const base = (rank: Rank) => rank === 14 ? 10 : rank === 13 ? 8 : rank === 12 ? 7 : rank === 11 ? 6 : rank / 2;
  if (high.rank === low.rank) return Math.max(base(high.rank) * 2, 5);
  let score = base(high.rank);
  if (high.suit === low.suit) score += 2;
  const gap = high.rank - low.rank - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && high.rank < 12) score += 1;
  return Math.max(0, Math.ceil(score));
}

const CATEGORY_STRENGTH = [0.1, 0.4, 0.66, 0.8, 0.88, 0.92, 0.96, 0.99, 1];

/** Teller om vi sitter med fire like farger eller fire kort på rad – da er det verdt å se ett kort til. */
function drawBonus(cards: Card[]): number {
  const suits = new Map<Suit, number>();
  for (const card of cards) suits.set(card.suit, (suits.get(card.suit) ?? 0) + 1);
  const flushDraw = [...suits.values()].some((count) => count === 4);

  const ranks = [...new Set(cards.map((card) => card.rank))].sort((a, b) => a - b);
  let straightDraw = false;
  for (let i = 0; i + 3 < ranks.length; i += 1) {
    if (ranks[i + 3] - ranks[i] <= 4) straightDraw = true;
  }
  return (flushDraw ? 0.16 : 0) + (straightDraw ? 0.09 : 0);
}

/** Hvor godt boten synes den ligger an, som et tall mellom 0 og 1. */
export function handStrength(state: PokerState, index: number): number {
  const player = state.players[index];
  if (player.cards.length < 2) return 0;
  if (state.board.length === 0) return clamp((startingScore(player.cards) - 1) / 15);

  const all = [...player.cards, ...state.board];
  const value = evaluate(all);
  let strength = CATEGORY_STRENGTH[value.category] ?? 0.1;

  if (value.category === 1) {
    // Par teller lite hvis det ligger på bordet og alle deler det.
    const pairRank = value.score[1];
    const onBoard = state.board.filter((card) => card.rank === pairRank).length;
    const topBoard = Math.max(...state.board.map((card) => card.rank));
    if (onBoard >= 2) strength = 0.22;
    else if (pairRank >= topBoard) strength = 0.55;
    else strength = 0.33;
  }
  if (value.category === 0) {
    strength = player.cards.some((card) => card.rank === 14) ? 0.18 : 0.1;
  }
  if (state.board.length < 5) strength += drawBonus(all);
  return clamp(strength);
}

/**
 * Velger et trekk for en bot. Den regner på potten og bløffer av og til, men hvor
 * godt den ser hånden sin og hvor hardt den presser styres av vanskelighetsgraden.
 */
export function botAction(state: PokerState, random = Math.random): PokerAction {
  const index = state.turn;
  const player = state.players[index];
  const profile = DIFFICULTY[state.difficulty] ?? DIFFICULTY.middels;
  const { canCheck, callAmount, canRaise, minRaiseTo, maxRaiseTo } = legalActions(state, index);
  const pot = totalPot(state);
  const strength = clamp(handStrength(state, index) + (random() - 0.5) * profile.noise);

  const raiseTo = (fraction: number) => clamp(
    Math.round(state.currentBet + Math.max(pot * fraction * profile.aggression, state.minRaise)),
    minRaiseTo,
    maxRaiseTo,
  );

  if (canCheck) {
    const bets = strength > profile.raiseAt - 0.1 ? 0.75
      : strength > 0.55 ? 0.4
        : random() < profile.bluff ? 0.5 : 0;
    if (bets > 0 && canRaise) return { type: "raise", amount: raiseTo(bets) };
    return { type: "check" };
  }

  const odds = callAmount / (pot + callAmount);
  const stackShare = callAmount / Math.max(player.chips, 1);

  // Nok til å høyne: bare med en solid hånd, og litt sjeldnere jo dyrere det blir.
  if (canRaise && strength > profile.raiseAt && random() < 0.62 && state.currentBet < player.chips * 0.6) {
    return { type: "raise", amount: raiseTo(strength > 0.93 ? 0.9 : 0.6) };
  }
  if (strength >= odds + profile.callMargin) return { type: "call" };
  // Billige syn er verdt det når hånden kan bli noe.
  if (stackShare < 0.06 && strength > 0.2) return { type: "call" };
  if (strength > 0.35 && random() < 0.25) return { type: "call" };
  return { type: "fold" };
}

/* ------------------------------------------------------------------ *
 * Vinnersjanse
 * ------------------------------------------------------------------ */

/** Alle 21 måter å velge fem kort av sju. Bygges én gang. */
const COMBOS_7_5 = (() => {
  const out: number[][] = [];
  const pick = [0, 1, 2, 3, 4];
  for (;;) {
    out.push([...pick]);
    let i = 4;
    while (i >= 0 && pick[i] === 7 - 5 + i) i -= 1;
    if (i < 0) break;
    pick[i] += 1;
    for (let j = i + 1; j < 5; j += 1) pick[j] = pick[j - 1] + 1;
  }
  return out;
})();

/** Beste femkortspoeng av sju kort. Som evaluate(), men uten å bygge kombinasjonslister. */
function bestOfSeven(cards: Card[], buffer: Card[]): number[] {
  let best: number[] | null = null;
  for (const combo of COMBOS_7_5) {
    for (let i = 0; i < 5; i += 1) buffer[i] = cards[combo[i]];
    const score = scoreFive(buffer);
    if (best === null || compareScore(score, best) > 0) best = score;
  }
  return best!;
}

/**
 * Anslår sjansen for å vinne hånden, som et tall mellom 0 og 1.
 *
 * Motstandernes kort er ukjente, så vi trekker tilfeldige hender og resten av
 * bordet mange ganger og teller hvor ofte vi står igjen best. Delt pott teller
 * som en brøkdel, slik at to like hender gir 0,5 hver.
 */
export function equity(
  hole: Card[],
  board: Card[],
  opponents: number,
  runs = 800,
  random = Math.random,
): number {
  if (hole.length < 2 || opponents < 1) return 0;
  const seen = new Set([...hole, ...board].map((card) => card.id));
  const deck = createDeck().filter((card) => !seen.has(card.id));
  const needed = (5 - board.length) + opponents * 2;
  if (needed > deck.length) return 0;

  const mine = [hole[0], hole[1], ...board, ...new Array(5 - board.length)] as Card[];
  const theirs = new Array(7) as Card[];
  const buffer = new Array(5) as Card[];
  let won = 0;

  for (let run = 0; run < runs; run += 1) {
    // Delvis Fisher-Yates: vi trenger bare de første `needed` kortene.
    for (let i = 0; i < needed; i += 1) {
      const j = i + Math.floor(random() * (deck.length - i));
      const swap = deck[i]; deck[i] = deck[j]; deck[j] = swap;
    }
    let next = 0;
    for (let i = board.length; i < 5; i += 1) mine[2 + i] = deck[next++];
    const myScore = bestOfSeven(mine, buffer);

    let ties = 1;
    let beaten = false;
    for (let seat = 0; seat < opponents; seat += 1) {
      theirs[0] = deck[next++];
      theirs[1] = deck[next++];
      for (let i = 0; i < 5; i += 1) theirs[2 + i] = mine[2 + i];
      const diff = compareScore(bestOfSeven(theirs, buffer), myScore);
      if (diff > 0) { beaten = true; break; }
      if (diff === 0) ties += 1;
    }
    if (!beaten) won += 1 / ties;
  }
  return won / runs;
}

/* ------------------------------------------------------------------ *
 * Coach
 * ------------------------------------------------------------------ */

export type Verdict = "bra" | "greit" | "tabbe";

export interface CoachNote {
  street: Street;
  action: ActionType;
  verdict: Verdict;
  /** Vinnersjansen du hadde i det øyeblikket, mellom 0 og 1. */
  chance: number;
  /** Andelen du måtte vinne for at synet skulle gå i null. */
  needed: number;
  headline: string;
  detail: string;
}

/** Hvor stor del av bunken du risikerer før en ren bløff blir uforsvarlig. */
const RECKLESS_SHARE = 0.4;
/** Slingringsmonn, så helt marginale valg ikke blir kalt feil. */
const MARGIN = 0.03;

const pct = (value: number) => `${Math.round(value * 100)} %`;
const sum = (value: number) => value.toLocaleString("nb-NO");

/**
 * Går gjennom dine egne trekk i hånden og sier hva som var riktig.
 *
 * Det viktige: dommen bygger utelukkende på det du visste da du valgte – kortene
 * dine, bordet, prisen og hvor mange som var med. Om hånden endte godt eller
 * dårlig er uten betydning. En all-in med 1 % sjanse er en tabbe selv om den
 * traff, og et riktig syn er riktig selv om du tapte det.
 */
export function coachReview(state: PokerState, playerId: string, runs = 600, random = Math.random): CoachNote[] {
  return state.review
    .filter((record) => record.playerId === playerId && record.opponents > 0)
    .map((record) => {
      const needed = record.toCall > 0 ? record.toCall / (record.pot + record.toCall) : 0;
      const chance = equity(record.hole, record.board, record.opponents, runs, random);
      // Potten du kjemper om hvis du blir med: det som ligger der pluss ditt eget syn.
      const target = record.pot + record.toCall;
      // Kronene først, så regnestykket. Uten beløpene er prosentene bare tall i lufta.
      const pris = `${sum(record.toCall)} for å være med i en pott på ${sum(target)}`;
      const regnestykke = `Da må hånden vinne oftere enn ${pct(needed)} for å lønne seg. Din vant ${pct(chance)}.`;

      // Ligger hånden og prisen innenfor slingringsmonnet av hverandre, er det for
      // jevnt til å kalle noe riktig. Ellers ville både syn og kast blitt stemplet
      // «bra» i samme situasjon – to motsatte råd for samme tall.
      const vippen = Math.abs(chance - needed) <= MARGIN;
      const lonner = chance > needed;

      if (record.action === "fold" || record.action === "call") {
        const kostet = record.action === "call" ? `Du betalte ${pris}.` : `Det ville kostet ${pris}.`;
        if (vippen) {
          return {
            ...base(record, chance, needed), verdict: "greit" as const,
            headline: "På vippen",
            detail: `${kostet} ${regnestykke} Så jevnt at både syn og kast forsvarer seg.`,
          };
        }
        const riktig = record.action === "call" ? lonner : !lonner;
        if (record.action === "call") {
          return riktig
            ? {
              ...base(record, chance, needed), verdict: "bra" as const,
              headline: "Riktig pris å syne",
              detail: `${kostet} ${regnestykke} Billig nok.`,
            }
            : {
              ...base(record, chance, needed), verdict: "tabbe" as const,
              headline: "For dyrt syn",
              detail: `${kostet} ${regnestykke} Du betalte mer enn hånden var verdt.`,
            };
        }
        return riktig
          ? {
            ...base(record, chance, needed), verdict: "bra" as const,
            headline: "Riktig å kaste",
            detail: `${kostet} ${regnestykke} For dyrt.`,
          }
          : {
            ...base(record, chance, needed), verdict: "tabbe" as const,
            headline: "Du kastet en hånd du hadde råd til å se",
            detail: `${kostet} ${regnestykke} Det var billigere enn hånden var verdt.`,
          };
      }

      if (record.action === "check") {
        return chance > 0.7
          ? {
            ...base(record, chance, needed), verdict: "greit" as const,
            headline: "Her kunne du satset",
            detail: `Hånden din vant ${pct(chance)} – du var favoritt. En sjekk gir bort sjansen til å bygge potten.`,
          }
          : {
            ...base(record, chance, needed), verdict: "bra" as const,
            headline: "Greit å sjekke",
            detail: `Å sjekke koster ingenting, så det kan nesten aldri være feil. Hånden din vant ${pct(chance)} slik den sto.`,
          };
      }

      // Høyning. En bløff er et legitimt trekk, så den dømmes bare når prisen
      // er urimelig i forhold til hva du faktisk hadde.
      const share = record.paid / Math.max(record.paid + (record.pot - record.toCall), 1);
      const risky = record.paid > 0 && share > RECKLESS_SHARE;
      const satset = `Du satset ${sum(record.paid)} i en pott på ${sum(record.pot)}`;
      if (chance >= 0.55) {
        return {
          ...base(record, chance, needed), verdict: "bra" as const,
          headline: "God høyning",
          detail: `${satset}. Hånden din vant ${pct(chance)} – du var favoritt, og da er det verdt å bygge potten.`,
        };
      }
      if (chance < 0.3 && risky) {
        return {
          ...base(record, chance, needed), verdict: "tabbe" as const,
          headline: "For stor risiko på for lite",
          detail: `${satset}, med bare ${pct(chance)} sjanse. Det tjener bare hvis alle kaster seg – og går det inn, var det flaks, ikke et godt valg.`,
        };
      }
      return {
        ...base(record, chance, needed), verdict: "greit" as const,
        headline: chance < 0.3 ? "Bløff" : "Halvsterk høyning",
        detail: chance < 0.3
          ? `${satset}. Hånden vant bare ${pct(chance)}, så den tjener når de kaster seg. Greit i små doser.`
          : `${satset}. Hånden din vant ${pct(chance)} – den kan gå begge veier.`,
      };
    });
}

const base = (record: DecisionRecord, chance: number, needed: number) => ({
  street: record.street,
  action: record.action,
  chance,
  needed,
});

/** Kort oppsummering av hvordan hånden ble spilt. */
export function coachSummary(notes: CoachNote[]): string {
  if (notes.length === 0) return "Ingen valg å gå gjennom denne hånden.";
  const mistakes = notes.filter((note) => note.verdict === "tabbe").length;
  if (mistakes === 0) return `Alle ${notes.length} valg var fornuftig priset.`;
  return `${mistakes} av ${notes.length} valg var feilpriset.`;
}
