export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  score: number;
  tricks: number;
}

export interface Bid {
  playerIndex: number;
  value: number | "american";
}

export interface PlayedCard {
  playerIndex: number;
  card: Card;
}

export interface RoundScore {
  playerId: string;
  tricks: number;
  delta: number;
  total: number;
}

export interface RoundResult {
  round: number;
  contract: number | "american";
  trump: Suit;
  bidderIndex: number;
  success: boolean;
  scores: RoundScore[];
}

export type GamePhase = "bidding" | "exchange" | "trump" | "playing" | "collecting" | "scoring";

export interface GameState {
  phase: GamePhase;
  players: Player[];
  hands: Card[][];
  pot: Card[];
  dealer: number;
  turn: number;
  bid: Bid | null;
  passed: number[];
  contract: number | "american" | null;
  trump: Suit | null;
  requestedCard: Card | null;
  partnerIndex: number | null;
  partnerRevealed: boolean;
  trick: PlayedCard[];
  pendingWinner: number | null;
  completedTricks: PlayedCard[][];
  scoreHistory: RoundResult[];
  message: string;
  round: number;
  winnerIndex: number | null;
}

export interface RoomPlayer {
  id: string;
  name: string;
  joinedAt: number;
}

export interface Room {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  game: GameState | null;
  updatedAt: number;
}
