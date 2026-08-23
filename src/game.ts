import type { Bid, Card, GameState, Player, Rank, RoundResult, Suit } from "./types.ts";

export const SUITS: Suit[] = ["spades", "hearts", "clubs", "diamonds"];
export const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};
export const SUIT_NAME: Record<Suit, string> = {
  clubs: "Kløver",
  diamonds: "Ruter",
  hearts: "Hjerter",
  spades: "Spar",
};
export const RANK_NAME: Record<Rank, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

const BOT_NAMES = ["Trump", "Putin", "Kim Jong-un", "Dealer"];

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) =>
    Array.from({ length: 13 }, (_, i) => {
      const rank = (i + 2) as Rank;
      return { id: `${suit}-${rank}`, suit, rank };
    }),
  );
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortHand(cards: Card[]): Card[] {
  const present = new Set(cards.map((card) => card.suit));
  const black = (["spades", "clubs"] as Suit[]).filter((suit) => present.has(suit));
  const red = (["hearts", "diamonds"] as Suit[]).filter((suit) => present.has(suit));
  let useRed = red.length > black.length;
  const order: Suit[] = [];
  while (black.length || red.length) {
    const preferred = useRed ? red : black;
    const fallback = useRed ? black : red;
    const next = preferred.shift() ?? fallback.shift();
    if (next) order.push(next);
    useRed = !useRed;
  }
  return [...cards].sort((a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || a.rank - b.rank);
}

export function createPlayers(humanNames: string[] = ["Du"]): Player[] {
  const humans = humanNames.slice(0, 4).map((name, index) => ({
    id: `human-${index}-${crypto.randomUUID()}`,
    name: name.trim() || `Spiller ${index + 1}`,
    isBot: false,
    score: 0,
    tricks: 0,
  }));
  const bots = BOT_NAMES.slice(0, 4 - humans.length).map((name, index) => ({
    id: `bot-${index}-${crypto.randomUUID()}`,
    name,
    isBot: true,
    score: 0,
    tricks: 0,
  }));
  return [...humans, ...bots];
}

export function createGame(players = createPlayers(), dealer = 0, round = 1, random = Math.random, scoreHistory: RoundResult[] = []): GameState {
  const deck = shuffle(createDeck(), random);
  const hands = players.map((_, playerIndex) =>
    sortHand(Array.from({ length: 12 }, (__, cardIndex) => deck[playerIndex + cardIndex * 4])),
  );
  return {
    phase: "bidding",
    players: players.map((p) => ({ ...p, tricks: 0 })),
    hands,
    pot: deck.slice(48),
    dealer,
    turn: (dealer + 1) % 4,
    bid: null,
    passed: [],
    contract: null,
    trump: null,
    requestedCard: null,
    partnerIndex: null,
    partnerRevealed: false,
    trick: [],
    pendingWinner: null,
    completedTricks: [],
    scoreHistory,
    message: `${players[(dealer + 1) % 4].name} starter budrunden`,
    round,
    winnerIndex: null,
  };
}

export function bidLabel(value: Bid["value"]): string {
  return value === "american" ? "Amerikaneren" : `${value} stikk`;
}

export function availableBids(state: GameState): Array<number | "american"> {
  const minimum = typeof state.bid?.value === "number" ? state.bid.value + 1 : 7;
  const values: Array<number | "american"> = [];
  for (let value = minimum; value <= 12; value += 1) values.push(value);
  if (state.bid?.value !== "american") values.push("american");
  return values;
}

export function placeBid(state: GameState, value: number | "american" | "pass"): GameState {
  if (state.phase !== "bidding" || state.passed.includes(state.turn)) return state;
  const current = state.turn;
  const passed = value === "pass" ? [...state.passed, current] : state.passed;
  const bid = value === "pass" ? state.bid : { playerIndex: current, value } as Bid;
  const active = state.players.map((_, i) => i).filter((i) => !passed.includes(i));

  if (!bid && active.length === 0) {
    return createGame(state.players, (state.dealer + 1) % 4, state.round + 1);
  }
  if (bid && (value === "american" || active.length === 1)) {
    return beginContract({ ...state, bid, passed });
  }

  let next = (current + 1) % 4;
  while (passed.includes(next)) next = (next + 1) % 4;
  return {
    ...state,
    bid,
    passed,
    turn: next,
    message: value === "pass"
      ? `${state.players[current].name} passer. ${state.players[next].name} byr.`
      : `${state.players[current].name} byr ${bidLabel(value)}.`,
  };
}

function beginContract(state: GameState): GameState {
  if (!state.bid) return state;
  const bidder = state.bid.playerIndex;
  const hands = state.hands.map((hand, i) => i === bidder ? sortHand([...hand, ...state.pot]) : hand);
  return {
    ...state,
    hands,
    pot: [],
    phase: "exchange",
    contract: state.bid.value,
    turn: bidder,
    message: `${state.players[bidder].name} vant budet og tar potten. Velg 4 kort bort.`,
  };
}

export function exchangeCards(state: GameState, cardIds: string[]): GameState {
  if (state.phase !== "exchange" || cardIds.length !== 4) return state;
  const selected = new Set(cardIds);
  const hand = state.hands[state.turn];
  if (hand.filter((card) => selected.has(card.id)).length !== 4) return state;
  const hands = state.hands.map((cards, i) => i === state.turn ? sortHand(cards.filter((card) => !selected.has(card.id))) : cards);
  return { ...state, hands, phase: "trump", message: "Velg trumf. Makkeren finnes automatisk." };
}

export function chooseTrump(state: GameState, trump: Suit): GameState {
  if (state.phase !== "trump") return state;
  const bidder = state.turn;
  const requestedCard = state.contract === "american" ? null : state.hands
    .filter((_, index) => index !== bidder)
    .flat()
    .filter((card) => card.suit === trump)
    .sort((a, b) => b.rank - a.rank)[0] ?? null;
  const partnerIndex = requestedCard
    ? state.hands.findIndex((hand) => hand.some((card) => card.id === requestedCard.id))
    : null;
  return {
    ...state,
    phase: "playing",
    trump,
    requestedCard,
    partnerIndex: state.contract === "american" || partnerIndex === null || partnerIndex < 0 ? null : partnerIndex,
    turn: bidder,
    message: state.contract === "american"
      ? `${state.players[bidder].name} spiller Amerikaneren alene.`
      : `${state.players[bidder].name} spør etter ${requestedCard ? cardLabel(requestedCard) : "makker"}.`,
  };
}

export function legalCards(state: GameState, playerIndex = state.turn): Card[] {
  const hand = state.hands[playerIndex];
  if (!state.trick.length) {
    const firstLead = state.completedTricks.length === 0 && playerIndex === state.bid?.playerIndex;
    const trumps = firstLead ? hand.filter((card) => card.suit === state.trump) : [];
    return trumps.length ? trumps : hand;
  }
  if (state.completedTricks.length === 0 && state.requestedCard && hand.some((card) => card.id === state.requestedCard?.id)) {
    return hand.filter((card) => card.id === state.requestedCard?.id);
  }
  const leadSuit = state.trick[0].card.suit;
  const follow = hand.filter((card) => card.suit === leadSuit);
  return follow.length ? follow : hand;
}

export function trickWinner(trick: GameState["trick"], trump: Suit): number {
  const leadSuit = trick[0].card.suit;
  return trick.reduce((best, played, index) => {
    const bestCard = trick[best].card;
    const card = played.card;
    const cardPower = card.suit === trump ? 200 + card.rank : card.suit === leadSuit ? 100 + card.rank : card.rank;
    const bestPower = bestCard.suit === trump ? 200 + bestCard.rank : bestCard.suit === leadSuit ? 100 + bestCard.rank : bestCard.rank;
    return cardPower > bestPower ? index : best;
  }, 0);
}

export function playCard(state: GameState, cardId: string): GameState {
  if (state.phase !== "playing" || !state.trump) return state;
  const card = legalCards(state).find((item) => item.id === cardId);
  if (!card) return { ...state, message: "Du må følge fargen som ble spilt ut." };
  const playerIndex = state.turn;
  const hands = state.hands.map((hand, i) => i === playerIndex ? sortHand(hand.filter((item) => item.id !== cardId)) : hand);
  const trick = [...state.trick, { playerIndex, card }];
  const partnerRevealed = state.partnerRevealed || card.id === state.requestedCard?.id;
  if (trick.length < 4) {
    return { ...state, hands, trick, partnerRevealed, turn: (playerIndex + 1) % 4, message: `${state.players[playerIndex].name} la ${cardLabel(card)}.` };
  }
  const winnerPlay = trickWinner(trick, state.trump);
  const winnerIndex = trick[winnerPlay].playerIndex;
  return {
    ...state,
    hands,
    trick,
    partnerRevealed,
    phase: "collecting",
    pendingWinner: winnerIndex,
    turn: winnerIndex,
    message: `${state.players[winnerIndex].name} tar stikket.`,
  };
}

export function collectTrick(state: GameState): GameState {
  if (state.phase !== "collecting" || state.trick.length !== 4 || state.pendingWinner === null) return state;
  const winnerIndex = state.pendingWinner;
  const players = state.players.map((player, index) => ({
    ...player,
    tricks: player.tricks + (index === winnerIndex ? 1 : 0),
  }));
  const completedTricks = [...state.completedTricks, state.trick];
  const next = {
    ...state,
    phase: "playing" as const,
    players,
    trick: [],
    completedTricks,
    pendingWinner: null,
    turn: winnerIndex,
    message: `${players[winnerIndex].name} tok stikket og har utspill.`,
  };
  return state.hands.every((hand) => hand.length === 0) ? scoreRound(next) : next;
}

function scoreRound(state: GameState): GameState {
  if (!state.bid || !state.contract) return state;
  const bidder = state.bid.playerIndex;
  const team = state.partnerIndex === null ? [bidder] : [bidder, state.partnerIndex];
  const teamTricks = team.reduce((sum, index) => sum + state.players[index].tricks, 0);
  const success = state.contract === "american" ? teamTricks === 12 : teamTricks >= state.contract;
  const delta = state.contract === "american" ? (success ? 52 : -52) : (success ? state.contract : -state.contract);
  const roundDeltas = state.players.map((player, index) => index === bidder ? delta * 2 : team.includes(index) ? delta : player.tricks);
  const players = state.players.map((player, index) => ({ ...player, score: player.score + roundDeltas[index] }));
  const scoreHistory: RoundResult[] = [...(state.scoreHistory ?? []), {
    round: state.round,
    contract: state.contract,
    trump: state.trump!,
    bidderIndex: bidder,
    success,
    scores: players.map((player, index) => ({ playerId: player.id, tricks: player.tricks, delta: roundDeltas[index], total: player.score })),
  }];
  const winnerIndex = players.findIndex((player) => player.score >= 52);
  return {
    ...state,
    phase: "scoring",
    players,
    scoreHistory,
    partnerRevealed: true,
    winnerIndex: winnerIndex >= 0 ? winnerIndex : null,
    message: success ? `Kontrakten er i boks med ${teamTricks} stikk.` : `Kontrakten sprakk med ${teamTricks} stikk.`,
  };
}

export function nextRound(state: GameState, random = Math.random): GameState {
  return createGame(state.players, (state.dealer + 1) % 4, state.round + 1, random, state.scoreHistory ?? []);
}

function suitCards(hand: Card[], suit: Suit): Card[] {
  return hand.filter((card) => card.suit === suit).sort((a, b) => a.rank - b.rank);
}

function suitPotential(hand: Card[], suit: Suit): number {
  const cards = suitCards(hand, suit);
  const honorValue: Partial<Record<Rank, number>> = { 11: 0.35, 12: 0.65, 13: 1.05, 14: 1.55 };
  const honors = cards.reduce((score, card) => score + (honorValue[card.rank] ?? 0), 0);
  const length = Math.max(0, cards.length - 3) * 0.72;
  const controls = cards.some((card) => card.rank === 14) ? 0.55 : cards.some((card) => card.rank === 13) && cards.length > 1 ? 0.25 : 0;
  return honors + length + controls;
}

function expectedTeamTricks(hand: Card[]): number {
  const bestTrump = Math.max(...SUITS.map((suit) => suitPotential(hand, suit)));
  const sideWinners = SUITS.reduce((sum, suit) => sum + suitPotential(hand, suit) * 0.48, 0);
  const shortness = SUITS.reduce((sum, suit) => sum + (suitCards(hand, suit).length <= 1 ? 0.35 : 0), 0);
  return 4.5 + bestTrump * 0.48 + sideWinners * 0.52 + shortness * 0.32 + 0.65; // partner card and four-card pot
}

export function botBid(state: GameState, random = Math.random): number | "american" | "pass" {
  const expectation = expectedTeamTricks(state.hands[state.turn]) + (random() - 0.5) * 0.7;
  const target = Math.min(12, Math.max(7, Math.floor(expectation)));
  const numeric = availableBids(state).filter((bid): bid is number => typeof bid === "number");
  const likelyTrump = botTrump(state);
  const trumpCards = suitCards(state.hands[state.turn], likelyTrump);
  const topTrumps = trumpCards.filter((card) => card.rank >= 11).length;
  const sideAces = state.hands[state.turn].filter((card) => card.suit !== likelyTrump && card.rank === 14).length;
  if (trumpCards.length >= 7 && topTrumps >= 4 && sideAces >= 2 && expectation >= 10.8 && state.bid?.value !== "american") return "american";
  return numeric.includes(target) ? target : "pass";
}

export function botTrump(state: GameState): Suit {
  return [...SUITS].sort((a, b) => suitPotential(state.hands[state.turn], b) - suitPotential(state.hands[state.turn], a))[0];
}

export function botDiscard(state: GameState): string[] {
  const hand = state.hands[state.turn];
  const trump = botTrump(state);
  const counts = Object.fromEntries(SUITS.map((suit) => [suit, suitCards(hand, suit).length])) as Record<Suit, number>;
  return [...hand]
    .filter((card) => card.suit !== trump || suitCards(hand, trump).length > 8)
    .sort((a, b) => {
      const value = (card: Card) => card.rank + (card.rank >= 12 ? 8 : 0) + counts[card.suit] * 0.7 + (card.suit === trump ? 20 : 0);
      const shortSuitBonus = (card: Card) => counts[card.suit] <= 2 ? -2.5 : 0;
      return value(a) + shortSuitBonus(a) - value(b) - shortSuitBonus(b);
    })
    .slice(0, 4)
    .map((card) => card.id);
}

function publicTricks(state: GameState): GameState["completedTricks"] {
  return [...state.completedTricks, ...(state.trick.length ? [state.trick] : [])];
}

export function inferredVoids(state: GameState): Array<Set<Suit>> {
  const voids = state.players.map(() => new Set<Suit>());
  for (const trick of publicTricks(state)) {
    if (!trick.length) continue;
    const lead = trick[0].card.suit;
    for (const played of trick.slice(1)) {
      if (played.card.suit !== lead) voids[played.playerIndex].add(lead);
    }
  }
  return voids;
}

function playedCards(state: GameState): Card[] {
  return publicTricks(state).flatMap((trick) => trick.map((played) => played.card));
}

function isMasterCard(card: Card, state: GameState, ownHand: Card[]): boolean {
  const known = new Set([...playedCards(state), ...ownHand].map((item) => item.id));
  return !createDeck().some((other) => other.suit === card.suit && other.rank > card.rank && !known.has(other.id));
}

function knownTeammate(state: GameState, playerIndex: number): number | null {
  const bidder = state.bid?.playerIndex;
  if (bidder === undefined || state.contract === "american") return null;
  if (state.partnerRevealed && state.partnerIndex !== null) {
    if (playerIndex === bidder) return state.partnerIndex;
    if (playerIndex === state.partnerIndex) return bidder;
    return state.players.map((_, index) => index).find((index) => index !== playerIndex && index !== bidder && index !== state.partnerIndex) ?? null;
  }
  const ownsRequest = state.requestedCard && state.hands[playerIndex].some((card) => card.id === state.requestedCard?.id);
  return ownsRequest ? bidder : null;
}

function discardChoice(cards: Card[], trump: Suit): Card {
  const nonTrump = cards.filter((card) => card.suit !== trump);
  const pool = nonTrump.length ? nonTrump : cards;
  const counts = Object.fromEntries(SUITS.map((suit) => [suit, pool.filter((card) => card.suit === suit).length])) as Record<Suit, number>;
  return [...pool].sort((a, b) => counts[a.suit] - counts[b.suit] || a.rank - b.rank)[0];
}

function currentWinnerPlayer(state: GameState): number | null {
  if (!state.trump || !state.trick.length) return null;
  return state.trick[trickWinner(state.trick, state.trump)].playerIndex;
}

function knownOpponents(state: GameState, playerIndex: number, teammate: number | null): number[] {
  return state.players
    .map((_, index) => index)
    .filter((index) => index !== playerIndex && index !== teammate);
}

function opponentsMayHaveTrump(state: GameState, hand: Card[], teammate: number | null, voids: Array<Set<Suit>>): boolean {
  if (!state.trump) return false;
  const trumpsOutside = 13
    - playedCards(state).filter((card) => card.suit === state.trump).length
    - hand.filter((card) => card.suit === state.trump).length;
  if (trumpsOutside <= 0) return false;
  if (teammate === null) return true;
  return knownOpponents(state, state.turn, teammate)
    .some((index) => state.hands[index].length > 0 && !voids[index].has(state.trump!));
}

function teammateWinnerIsSafe(state: GameState, hand: Card[], voids: Array<Set<Suit>>): boolean {
  if (!state.trump || state.trick.length === 3) return true;
  const winner = state.trick[trickWinner(state.trick, state.trump)].card;
  if (!isMasterCard(winner, state, hand)) return false;
  if (winner.suit === state.trump) return true;

  const leadSuit = state.trick[0].card.suit;
  const playersAfterBot = Array.from(
    { length: 3 - state.trick.length },
    (_, offset) => (state.turn + offset + 1) % state.players.length,
  );
  return playersAfterBot.every((index) => !voids[index].has(leadSuit) || voids[index].has(state.trump!));
}

function leadCardFromSuit(cards: Card[], state: GameState, hand: Card[]): Card {
  const ordered = [...cards].sort((a, b) => a.rank - b.rank);
  const top = ordered[ordered.length - 1];
  const supportsTop = ordered.some((card) => card.rank === top.rank - 1);
  if (isMasterCard(top, state, hand) || top.rank >= 10 && supportsTop) return top;
  return ordered[0];
}

function unseenHigherCards(card: Card, state: GameState, hand: Card[]): number {
  const known = new Set([...playedCards(state), ...hand].map((item) => item.id));
  return createDeck().filter((other) => (
    other.suit === card.suit
    && other.rank > card.rank
    && !known.has(other.id)
  )).length;
}

function cardWinsCurrentTrick(state: GameState, card: Card): boolean {
  if (!state.trump) return false;
  const withCard = [...state.trick, { playerIndex: state.turn, card }];
  return trickWinner(withCard, state.trump) === withCard.length - 1;
}

function partnerPressureCard(cards: Card[], state: GameState, hand: Card[]): Card {
  const ordered = [...cards].sort((a, b) => a.rank - b.rank);
  const equivalentWinner = ordered.find((card) => isMasterCard(card, state, hand));
  return equivalentWinner ?? ordered[ordered.length - 1];
}

export function botCard(state: GameState, random = Math.random): Card {
  const legal = legalCards(state);
  const low = [...legal].sort((a, b) => a.rank - b.rank);
  const hand = state.hands[state.turn];
  const trump = state.trump!;
  const teammate = knownTeammate(state, state.turn);
  const voids = inferredVoids(state);

  if (!state.trick.length) {
    const trumps = suitCards(legal, trump);
    const onContractTeam = state.turn === state.bid?.playerIndex || teammate === state.bid?.playerIndex;

    if (onContractTeam && trumps.length && opponentsMayHaveTrump(state, hand, teammate, voids)) {
      const isCallingPartner = state.completedTricks.length === 0
        && state.turn === state.bid?.playerIndex
        && state.requestedCard !== null;
      return isCallingPartner ? trumps[0] : leadCardFromSuit(trumps, state, hand);
    }

    if (teammate !== null) {
      const opponents = knownOpponents(state, state.turn, teammate);
      const ruffLead = low
        .filter((card) => card.suit !== trump && voids[teammate].has(card.suit))
        .sort((a, b) => {
          const aRisk = opponents.filter((index) => voids[index].has(a.suit)).length;
          const bRisk = opponents.filter((index) => voids[index].has(b.suit)).length;
          return aRisk - bRisk || a.rank - b.rank;
        })[0];
      if (ruffLead) return ruffLead;
    }

    const cashWinner = [...legal]
      .filter((card) => card.suit !== trump && isMasterCard(card, state, hand))
      .sort((a, b) => b.rank - a.rank)[0];
    if (cashWinner) return cashWinner;

    const nonTrumpSuits = SUITS.filter((suit) => suit !== trump && legal.some((card) => card.suit === suit));
    const opponents = knownOpponents(state, state.turn, teammate);
    const tieBreak = Object.fromEntries(nonTrumpSuits.map((suit) => [suit, random()])) as Partial<Record<Suit, number>>;
    const leadSuit = nonTrumpSuits.sort((a, b) => {
      const score = (suit: Suit) => {
        const cards = suitCards(hand, suit);
        const top = cards[cards.length - 1];
        const lead = leadCardFromSuit(cards, state, hand);
        const opponentRuffRisk = opponents.filter((index) => voids[index].has(suit)).length;
        const teammateRuff = teammate !== null && voids[teammate].has(suit) ? 1 : 0;
        const sequence = cards.some((card) => card.rank === top.rank - 1) ? 1 : 0;
        const master = isMasterCard(top, state, hand) ? 1 : 0;
        const exposure = Math.min(3, unseenHigherCards(lead, state, hand));
        return cards.length * 1.2 + top.rank * 0.08 + sequence * 1.8 + master * 4
          + teammateRuff * 3 - opponentRuffRisk * 3 - exposure * 0.35;
      };
      const difference = score(b) - score(a);
      return difference || (tieBreak[b] ?? 0) - (tieBreak[a] ?? 0);
    })[0];
    if (leadSuit) {
      const cards = suitCards(legal, leadSuit);
      return leadCardFromSuit(cards, state, hand);
    }
    return leadCardFromSuit(low, state, hand);
  }

  const currentWinner = currentWinnerPlayer(state);
  const teammateWinning = teammate !== null && currentWinner === teammate;
  const winning = low.filter((card) => cardWinsCurrentTrick(state, card));
  const followsSuit = legal[0]?.suit === state.trick[0].card.suit;
  const partnerLed = teammate !== null && state.trick[0].playerIndex === teammate;
  const opponentsStillToPlay = state.trick.length < 3;

  if (partnerLed && opponentsStillToPlay && followsSuit && winning.length) return partnerPressureCard(winning, state, hand);
  if (teammateWinning && teammateWinnerIsSafe(state, hand, voids)) return followsSuit ? low[0] : discardChoice(low, trump);
  if (winning.length) return winning[0];
  if (!followsSuit) return discardChoice(low, trump);
  return low[0];
}

export function cardLabel(card: Card): string {
  return `${RANK_NAME[card.rank]}${SUIT_SYMBOL[card.suit]}`;
}
