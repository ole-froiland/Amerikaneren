/**
 * Sjakkmotoren.
 *
 * Rene funksjoner: inn med en stilling, ut med en ny. Ingen React, ingen
 * nettleser. Brettet er 64 ruter der 0 er a8 og 63 er h1 – samme retning som
 * brettet tegnes på skjermen, slik at UI-et slipper å regne om.
 */
import type { Difficulty } from "./setup.ts";

export type PieceColor = "hvit" | "svart";
export type PieceType = "bonde" | "springer" | "løper" | "tårn" | "dronning" | "konge";

export interface ChessPiece {
  color: PieceColor;
  type: PieceType;
}

export interface ChessMove {
  from: number;
  to: number;
  /** Bonden som når siste rad blir til denne brikken. */
  promotion?: PieceType;
  capture?: boolean;
  castle?: "kort" | "lang";
  enPassant?: boolean;
  /** Bonde to fram – ruta bak den kan slås en passant neste trekk. */
  double?: boolean;
}

export interface ChessPlayer {
  id: string;
  name: string;
  isBot: boolean;
  color: PieceColor;
}

export interface Castling {
  hvitKort: boolean;
  hvitLang: boolean;
  svartKort: boolean;
  svartLang: boolean;
}

export interface MoveRecord {
  move: ChessMove;
  /** Trekket skrevet på norsk notasjon, for trekklisten. */
  text: string;
  by: PieceColor;
}

export type ChessOutcome = "spiller" | "matt" | "patt" | "gjentakelse" | "femti" | "materiell";

export interface ChessState {
  board: (ChessPiece | null)[];
  turn: PieceColor;
  castling: Castling;
  /** Ruta en bonde kan slås på en passant, eller null. */
  enPassant: number | null;
  /** Halvtrekk siden siste slag eller bondetrekk – femtitrekksregelen. */
  halfmove: number;
  fullmove: number;
  players: ChessPlayer[];
  history: MoveRecord[];
  /** Hvor mange ganger hver stilling har stått på brettet. */
  seen: Record<string, number>;
  outcome: ChessOutcome;
  winner: PieceColor | null;
  check: boolean;
  difficulty: Difficulty;
  message: string;
}

export const PIECE_NAME: Record<PieceType, string> = {
  bonde: "Bonde", springer: "Springer", løper: "Løper",
  tårn: "Tårn", dronning: "Dronning", konge: "Konge",
};

/** Bokstavene i norsk notasjon. Bonden skrives uten bokstav. */
export const PIECE_LETTER: Record<PieceType, string> = {
  bonde: "", springer: "S", løper: "L", tårn: "T", dronning: "D", konge: "K",
};

/**
 * Begge farger tegnes med de fylte tegnene. De hule tegnene blir tynne og
 * ujevne på tvers av skrifter – fylt brikke med farge og kant leser bedre.
 */
export const PIECE_GLYPH: Record<PieceType, string> = {
  konge: "♚", dronning: "♛", tårn: "♜", løper: "♝", springer: "♞", bonde: "♟",
};

export const COLOR_NAME: Record<PieceColor, string> = { hvit: "Hvit", svart: "Svart" };

const FILES = "abcdefgh";
const fileOf = (square: number) => square % 8;
const rankOf = (square: number) => Math.floor(square / 8);
const at = (file: number, rank: number) => rank * 8 + file;
const inside = (file: number, rank: number) => file >= 0 && file < 8 && rank >= 0 && rank < 8;
export const squareName = (square: number) => `${FILES[fileOf(square)]}${8 - rankOf(square)}`;
export const squareFromName = (name: string) => at(FILES.indexOf(name[0]), 8 - Number(name[1]));
const other = (color: PieceColor): PieceColor => (color === "hvit" ? "svart" : "hvit");
/** Hvit går oppover brettet, altså mot lavere radindeks. */
const forward = (color: PieceColor) => (color === "hvit" ? -1 : 1);
const homeRank = (color: PieceColor) => (color === "hvit" ? 6 : 1);
const lastRank = (color: PieceColor) => (color === "hvit" ? 0 : 7);

const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const BISHOP_RAYS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_RAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const FEN_LETTER: Record<string, PieceType> = {
  p: "bonde", n: "springer", b: "løper", r: "tårn", q: "dronning", k: "konge",
};
const LETTER_FOR: Record<PieceType, string> = {
  bonde: "p", springer: "n", løper: "b", tårn: "r", dronning: "q", konge: "k",
};

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Stillingen uten spillere og historikk – alt reglene trenger. */
export interface Position {
  board: (ChessPiece | null)[];
  turn: PieceColor;
  castling: Castling;
  enPassant: number | null;
  halfmove: number;
  fullmove: number;
}

export function parseFen(fen: string): Position {
  const [layout, turn, rights, ep, half, full] = fen.trim().split(/\s+/);
  const board: (ChessPiece | null)[] = Array.from({ length: 64 }, () => null);
  let square = 0;
  for (const symbol of layout) {
    if (symbol === "/") continue;
    if (symbol >= "1" && symbol <= "8") { square += Number(symbol); continue; }
    const type = FEN_LETTER[symbol.toLowerCase()];
    board[square] = { color: symbol === symbol.toUpperCase() ? "hvit" : "svart", type };
    square += 1;
  }
  return {
    board,
    turn: turn === "b" ? "svart" : "hvit",
    castling: {
      hvitKort: rights?.includes("K") ?? false,
      hvitLang: rights?.includes("Q") ?? false,
      svartKort: rights?.includes("k") ?? false,
      svartLang: rights?.includes("q") ?? false,
    },
    enPassant: ep && ep !== "-" ? squareFromName(ep) : null,
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

export function toFen(position: Position): string {
  let layout = "";
  for (let rank = 0; rank < 8; rank += 1) {
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = position.board[at(file, rank)];
      if (!piece) { empty += 1; continue; }
      if (empty) { layout += String(empty); empty = 0; }
      const letter = LETTER_FOR[piece.type];
      layout += piece.color === "hvit" ? letter.toUpperCase() : letter;
    }
    if (empty) layout += String(empty);
    if (rank < 7) layout += "/";
  }
  const rights = `${position.castling.hvitKort ? "K" : ""}${position.castling.hvitLang ? "Q" : ""}${position.castling.svartKort ? "k" : ""}${position.castling.svartLang ? "q" : ""}` || "-";
  const ep = position.enPassant === null ? "-" : squareName(position.enPassant);
  return `${layout} ${position.turn === "hvit" ? "w" : "b"} ${rights} ${ep} ${position.halfmove} ${position.fullmove}`;
}

/** Nøkkelen som avgjør trekkgjentakelse: brikker, tur, rokaderett og en passant. */
export const positionKey = (position: Position) => toFen(position).split(" ").slice(0, 4).join(" ");

const clonePosition = (position: Position): Position => ({
  ...position,
  board: position.board.slice(),
  castling: { ...position.castling },
});

/** Angriper `color` ruta? Brukes til sjakk, rokade og lovlighetstest. */
export function attacked(board: (ChessPiece | null)[], square: number, color: PieceColor): boolean {
  const file = fileOf(square);
  const rank = rankOf(square);

  for (const [df, dr] of KNIGHT_STEPS) {
    const target = board[at(file + df, rank + dr)];
    if (inside(file + df, rank + dr) && target?.color === color && target.type === "springer") return true;
  }
  for (const [df, dr] of KING_STEPS) {
    const target = board[at(file + df, rank + dr)];
    if (inside(file + df, rank + dr) && target?.color === color && target.type === "konge") return true;
  }
  // Bonden slår motsatt vei av den den går.
  const step = -forward(color);
  for (const df of [-1, 1]) {
    if (!inside(file + df, rank + step)) continue;
    const target = board[at(file + df, rank + step)];
    if (target?.color === color && target.type === "bonde") return true;
  }
  const rays: [number[][], PieceType][] = [[BISHOP_RAYS, "løper"], [ROOK_RAYS, "tårn"]];
  for (const [directions, type] of rays) {
    for (const [df, dr] of directions) {
      let f = file + df;
      let r = rank + dr;
      while (inside(f, r)) {
        const target = board[at(f, r)];
        if (target) {
          if (target.color === color && (target.type === type || target.type === "dronning")) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
  }
  return false;
}

const kingSquare = (board: (ChessPiece | null)[], color: PieceColor) =>
  board.findIndex((piece) => piece?.color === color && piece.type === "konge");

export const inCheck = (position: Position, color: PieceColor) => {
  const king = kingSquare(position.board, color);
  return king >= 0 && attacked(position.board, king, other(color));
};

function pushPawn(moves: ChessMove[], position: Position, from: number, color: PieceColor) {
  const file = fileOf(from);
  const rank = rankOf(from);
  const step = forward(color);
  const promotionRank = lastRank(color);
  const add = (move: ChessMove) => {
    if (rankOf(move.to) === promotionRank) {
      for (const type of ["dronning", "tårn", "løper", "springer"] as PieceType[]) moves.push({ ...move, promotion: type });
    } else {
      moves.push(move);
    }
  };

  const ahead = at(file, rank + step);
  if (inside(file, rank + step) && !position.board[ahead]) {
    add({ from, to: ahead });
    const twoAhead = at(file, rank + step * 2);
    if (rank === homeRank(color) && !position.board[twoAhead]) moves.push({ from, to: twoAhead, double: true });
  }
  for (const df of [-1, 1]) {
    if (!inside(file + df, rank + step)) continue;
    const to = at(file + df, rank + step);
    const target = position.board[to];
    if (target && target.color !== color) add({ from, to, capture: true });
    else if (position.enPassant === to) add({ from, to, capture: true, enPassant: true });
  }
}

/** Alle trekk uten hensyn til om egen konge blir stående i sjakk. */
export function pseudoMoves(position: Position, color = position.turn): ChessMove[] {
  const moves: ChessMove[] = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = position.board[from];
    if (!piece || piece.color !== color) continue;
    const file = fileOf(from);
    const rank = rankOf(from);

    if (piece.type === "bonde") { pushPawn(moves, position, from, color); continue; }

    if (piece.type === "springer" || piece.type === "konge") {
      const steps = piece.type === "springer" ? KNIGHT_STEPS : KING_STEPS;
      for (const [df, dr] of steps) {
        if (!inside(file + df, rank + dr)) continue;
        const to = at(file + df, rank + dr);
        const target = position.board[to];
        if (target?.color === color) continue;
        moves.push({ from, to, capture: Boolean(target) });
      }
      continue;
    }

    const rays = piece.type === "løper" ? BISHOP_RAYS : piece.type === "tårn" ? ROOK_RAYS : [...BISHOP_RAYS, ...ROOK_RAYS];
    for (const [df, dr] of rays) {
      let f = file + df;
      let r = rank + dr;
      while (inside(f, r)) {
        const to = at(f, r);
        const target = position.board[to];
        if (target?.color === color) break;
        moves.push({ from, to, capture: Boolean(target) });
        if (target) break;
        f += df;
        r += dr;
      }
    }
  }

  addCastles(moves, position, color);
  return moves;
}

function addCastles(moves: ChessMove[], position: Position, color: PieceColor) {
  const rank = color === "hvit" ? 7 : 0;
  const king = at(4, rank);
  if (position.board[king]?.type !== "konge" || position.board[king]?.color !== color) return;
  if (attacked(position.board, king, other(color))) return;
  const short = color === "hvit" ? position.castling.hvitKort : position.castling.svartKort;
  const long = color === "hvit" ? position.castling.hvitLang : position.castling.svartLang;

  if (short && !position.board[at(5, rank)] && !position.board[at(6, rank)]
    && position.board[at(7, rank)]?.type === "tårn"
    && !attacked(position.board, at(5, rank), other(color))
    && !attacked(position.board, at(6, rank), other(color))) {
    moves.push({ from: king, to: at(6, rank), castle: "kort" });
  }
  if (long && !position.board[at(3, rank)] && !position.board[at(2, rank)] && !position.board[at(1, rank)]
    && position.board[at(0, rank)]?.type === "tårn"
    && !attacked(position.board, at(3, rank), other(color))
    && !attacked(position.board, at(2, rank), other(color))) {
    moves.push({ from: king, to: at(2, rank), castle: "lang" });
  }
}

interface Undo {
  move: ChessMove;
  captured: ChessPiece | null;
  capturedSquare: number;
  castling: Castling;
  enPassant: number | null;
  halfmove: number;
  rook?: { from: number; to: number };
}

/** Utfører trekket på stillingen. Muterer, og gir tilbake det som skal til for å angre. */
export function make(position: Position, move: ChessMove): Undo {
  const piece = position.board[move.from]!;
  const undo: Undo = {
    move,
    captured: position.board[move.to],
    capturedSquare: move.to,
    castling: { ...position.castling },
    enPassant: position.enPassant,
    halfmove: position.halfmove,
  };

  if (move.enPassant) {
    const victim = at(fileOf(move.to), rankOf(move.from));
    undo.captured = position.board[victim];
    undo.capturedSquare = victim;
    position.board[victim] = null;
  }

  position.board[move.to] = move.promotion ? { color: piece.color, type: move.promotion } : piece;
  position.board[move.from] = null;

  if (move.castle) {
    const rank = rankOf(move.from);
    const rook = move.castle === "kort" ? { from: at(7, rank), to: at(5, rank) } : { from: at(0, rank), to: at(3, rank) };
    position.board[rook.to] = position.board[rook.from];
    position.board[rook.from] = null;
    undo.rook = rook;
  }

  // Rokaderetten faller bort når kongen eller tårnet flytter – eller tårnet blir slått.
  if (piece.type === "konge") {
    if (piece.color === "hvit") { position.castling.hvitKort = false; position.castling.hvitLang = false; }
    else { position.castling.svartKort = false; position.castling.svartLang = false; }
  }
  for (const square of [move.from, move.to]) {
    if (square === at(7, 7)) position.castling.hvitKort = false;
    if (square === at(0, 7)) position.castling.hvitLang = false;
    if (square === at(7, 0)) position.castling.svartKort = false;
    if (square === at(0, 0)) position.castling.svartLang = false;
  }

  position.enPassant = move.double ? at(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2) : null;
  position.halfmove = piece.type === "bonde" || undo.captured ? 0 : position.halfmove + 1;
  if (position.turn === "svart") position.fullmove += 1;
  position.turn = other(position.turn);
  return undo;
}

export function unmake(position: Position, undo: Undo): void {
  const { move } = undo;
  position.turn = other(position.turn);
  if (position.turn === "svart") position.fullmove -= 1;
  const moved = position.board[move.to]!;
  position.board[move.from] = move.promotion ? { color: moved.color, type: "bonde" } : moved;
  position.board[move.to] = null;
  if (undo.captured) position.board[undo.capturedSquare] = undo.captured;
  if (undo.rook) {
    position.board[undo.rook.from] = position.board[undo.rook.to];
    position.board[undo.rook.to] = null;
  }
  position.castling = undo.castling;
  position.enPassant = undo.enPassant;
  position.halfmove = undo.halfmove;
}

/** Trekkene som faktisk er lov: pseudotrekk som ikke lar egen konge stå i sjakk. */
export function legalMoves(position: Position, color = position.turn): ChessMove[] {
  const working = clonePosition(position);
  const legal: ChessMove[] = [];
  for (const move of pseudoMoves(working, color)) {
    const undo = make(working, move);
    if (!inCheck(working, color)) legal.push(move);
    unmake(working, undo);
  }
  return legal;
}

export const movesFrom = (position: Position, square: number) =>
  legalMoves(position).filter((move) => move.from === square);

export const sameMove = (a: ChessMove, b: ChessMove) =>
  a.from === b.from && a.to === b.to && (a.promotion ?? null) === (b.promotion ?? null);

/** Konge og løper mot konge, og lignende – ingen kan sette matt. */
export function deadPosition(board: (ChessPiece | null)[]): boolean {
  const rest: ChessPiece[] = [];
  for (const piece of board) {
    if (!piece || piece.type === "konge") continue;
    if (piece.type === "bonde" || piece.type === "tårn" || piece.type === "dronning") return false;
    rest.push(piece);
  }
  if (rest.length <= 1) return true;
  return rest.length === 2 && rest.every((piece) => piece.type === "springer") && rest[0].color === rest[1].color;
}

/* --- Notasjon --- */

/** Trekket skrevet på norsk notasjon: Sf3, exd5, 0-0, e8D, Dh7#. */
export function moveText(position: Position, move: ChessMove): string {
  if (move.castle) return move.castle === "kort" ? "0-0" : "0-0-0";
  const piece = position.board[move.from];
  if (!piece) return `${squareName(move.from)}${squareName(move.to)}`;
  const target = squareName(move.to);
  const takes = move.capture ? "x" : "";

  let text: string;
  if (piece.type === "bonde") {
    text = `${move.capture ? FILES[fileOf(move.from)] : ""}${takes}${target}`;
    if (move.promotion) text += PIECE_LETTER[move.promotion];
  } else {
    // Kan to like brikker gå til samme rute, må trekket skilles med linje eller rad.
    const rivals = legalMoves(position, piece.color).filter((other_) =>
      other_.to === move.to && other_.from !== move.from && position.board[other_.from]?.type === piece.type);
    let mark = "";
    if (rivals.length) {
      const sameFile = rivals.some((rival) => fileOf(rival.from) === fileOf(move.from));
      const sameRank = rivals.some((rival) => rankOf(rival.from) === rankOf(move.from));
      mark = sameFile && sameRank ? squareName(move.from) : sameFile ? String(8 - rankOf(move.from)) : FILES[fileOf(move.from)];
    }
    text = `${PIECE_LETTER[piece.type]}${mark}${takes}${target}`;
  }

  const after = clonePosition(position);
  make(after, move);
  if (inCheck(after, after.turn)) text += legalMoves(after).length ? "+" : "#";
  return text;
}

/* --- Partiet --- */

const BOT_NAMES = ["Magnus", "Judit", "Bobby", "Vera"];

export function createChessPlayers(names: string[], difficulty: Difficulty): ChessPlayer[] {
  const humans = names.slice(0, 2).map((name, index) => ({
    id: `human-${index}-${crypto.randomUUID()}`,
    name: name.trim() || `Spiller ${index + 1}`,
    isBot: false,
    color: (index === 0 ? "hvit" : "svart") as PieceColor,
  }));
  if (humans.length === 2) return humans;
  const level = difficulty === "lett" ? 2 : difficulty === "middels" ? 0 : 1;
  return [...humans, {
    id: `bot-${crypto.randomUUID()}`,
    name: BOT_NAMES[level],
    isBot: true,
    color: "svart" as PieceColor,
  }];
}

export const positionOf = (state: ChessState): Position => ({
  board: state.board,
  turn: state.turn,
  castling: state.castling,
  enPassant: state.enPassant,
  halfmove: state.halfmove,
  fullmove: state.fullmove,
});

export function createChessGame(players: ChessPlayer[], difficulty: Difficulty = "middels", fen = START_FEN): ChessState {
  const position = parseFen(fen);
  return {
    ...position,
    players,
    history: [],
    seen: { [positionKey(position)]: 1 },
    outcome: "spiller",
    winner: null,
    check: inCheck(position, position.turn),
    difficulty,
    message: `${COLOR_NAME[position.turn]} begynner`,
  };
}

const namedFor = (state: ChessState, color: PieceColor) =>
  state.players.find((player) => player.color === color)?.name ?? COLOR_NAME[color];

/** Utfører trekket hvis det er lov. Ulovlige trekk lar stillingen stå. */
export function applyChessMove(state: ChessState, move: ChessMove): ChessState {
  if (state.outcome !== "spiller") return state;
  const position = positionOf(state);
  const legal = legalMoves(position).find((option) => sameMove(option, move));
  if (!legal) return state;

  const text = moveText(position, legal);
  const next = clonePosition(position);
  make(next, legal);

  const key = positionKey(next);
  const seen = { ...state.seen, [key]: (state.seen[key] ?? 0) + 1 };
  const check = inCheck(next, next.turn);
  const replies = legalMoves(next);

  let outcome: ChessOutcome = "spiller";
  let winner: PieceColor | null = null;
  if (!replies.length) {
    outcome = check ? "matt" : "patt";
    winner = check ? other(next.turn) : null;
  } else if (seen[key] >= 3) outcome = "gjentakelse";
  else if (next.halfmove >= 100) outcome = "femti";
  else if (deadPosition(next.board)) outcome = "materiell";

  const message = outcome === "matt" ? `Matt – ${namedFor(state, winner!)} vant`
    : outcome === "patt" ? "Patt – remis"
    : outcome === "gjentakelse" ? "Remis – samme stilling tre ganger"
    : outcome === "femti" ? "Remis – femti trekk uten slag eller bondetrekk"
    : outcome === "materiell" ? "Remis – ingen kan sette matt"
    : check ? `Sjakk! ${namedFor(state, next.turn)} må ut av den`
    : `${namedFor(state, next.turn)} sin tur`;

  return {
    ...state,
    ...next,
    history: [...state.history, { move: legal, text, by: state.turn }],
    seen,
    outcome,
    winner,
    check,
    message,
  };
}

/* --- Boten --- */

const VALUE: Record<PieceType, number> = {
  bonde: 100, springer: 320, løper: 330, tårn: 500, dronning: 900, konge: 20000,
};

/* Standardtabeller for hvor brikkene står godt. Radene går fra rad 8 til rad 1,
   samme vei som brettet er indeksert, og speiles for svart. */
const SQUARE_BONUS: Record<PieceType, number[]> = {
  bonde: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  springer: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  løper: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  tårn: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  dronning: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  konge: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

const MATE = 100000;

/** Stillingen sett fra den som har trekket. Positivt tall betyr at den står bedre. */
export function evaluate(position: Position): number {
  let score = 0;
  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (!piece) continue;
    const mirrored = piece.color === "hvit" ? square : at(fileOf(square), 7 - rankOf(square));
    const value = VALUE[piece.type] + SQUARE_BONUS[piece.type][mirrored];
    score += piece.color === position.turn ? value : -value;
  }
  return score;
}

/** Slag først, og de som vinner mest for minst – da klipper alfa-beta mer bort. */
const order = (position: Position, moves: ChessMove[]) => moves
  .map((move) => {
    const victim = position.board[move.to];
    const attacker = position.board[move.from];
    const gain = victim ? VALUE[victim.type] - VALUE[attacker!.type] / 10 : 0;
    return { move, rank: gain + (move.promotion ? VALUE[move.promotion] : 0) };
  })
  .sort((a, b) => b.rank - a.rank)
  .map((entry) => entry.move);

/** Ser slagvekslingen ferdig, så boten ikke stopper å regne midt i et bytte. */
function quiet(position: Position, alpha: number, beta: number, depth: number): number {
  const standing = evaluate(position);
  if (depth === 0 || standing >= beta) return standing;
  let best = Math.max(alpha, standing);
  for (const move of order(position, pseudoMoves(position).filter((move) => move.capture))) {
    const undo = make(position, move);
    const illegal = inCheck(position, other(position.turn));
    const score = illegal ? -MATE : -quiet(position, -beta, -best, depth - 1);
    unmake(position, undo);
    if (illegal) continue;
    if (score >= beta) return score;
    if (score > best) best = score;
  }
  return best;
}

function search(position: Position, depth: number, alpha: number, beta: number, ply: number): number {
  if (depth === 0) return quiet(position, alpha, beta, 4);
  let best = -MATE * 2;
  let moved = false;
  for (const move of order(position, pseudoMoves(position))) {
    const undo = make(position, move);
    if (inCheck(position, other(position.turn))) { unmake(position, undo); continue; }
    moved = true;
    const score = -search(position, depth - 1, -beta, -alpha, ply + 1);
    unmake(position, undo);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  // Ingen lovlige trekk: matt regnes dårligere jo lenger unna den ligger, så boten
  // velger den raskeste matten og den seigeste forsvaret.
  if (!moved) return inCheck(position, position.turn) ? -MATE + ply : 0;
  return best;
}

const DEPTH: Record<Difficulty, number> = { lett: 1, middels: 2, vanskelig: 3 };
/** Hvor ofte boten bare slenger ut et tilfeldig trekk. */
const SLIP: Record<Difficulty, number> = { lett: 0.3, middels: 0.07, vanskelig: 0 };

/** Trekket boten vil gjøre, eller null om partiet er slutt. */
export function botChessMove(state: ChessState, random = Math.random): ChessMove | null {
  const position = clonePosition(positionOf(state));
  const moves = legalMoves(position);
  if (!moves.length) return null;
  if (random() < SLIP[state.difficulty]) return moves[Math.floor(random() * moves.length)];

  let best = moves[0];
  let bestScore = -MATE * 2;
  for (const move of order(position, moves)) {
    const undo = make(position, move);
    const score = -search(position, DEPTH[state.difficulty] - 1, -MATE * 2, MATE * 2, 1);
    unmake(position, undo);
    // Litt slingring mellom like gode trekk, så boten ikke spiller identiske partier.
    if (score > bestScore || (score === bestScore && random() < 0.3)) {
      best = move;
      bestScore = score;
    }
  }
  return best;
}
