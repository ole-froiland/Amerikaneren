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

import type { ChessState } from "./chess.ts";

/** Spillene som kan spilles i et rom. Poker har ingen onlinevariant. */
export type GameKind = "amerikaneren" | "sjakk";

export interface RoomPlayer {
  id: string;
  name: string;
  joinedAt: number;
}

interface RoomBase {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  version: number;
  updatedAt: number;
}

/**
 * Rommet vet hvilket spill det er, og tilstanden følger av det. Serveren rører
 * aldri innholdet – den lagrer det som kom inn og teller versjonen opp.
 */
export type Room =
  | (RoomBase & { kind: "amerikaneren"; game: GameState | null })
  | (RoomBase & { kind: "sjakk"; game: ChessState | null });

/** Så mange mennesker det er plass til. Ledige plasser i Amerikaneren tas av bots. */
export const roomLimit = (kind: GameKind) => (kind === "sjakk" ? 2 : 4);
