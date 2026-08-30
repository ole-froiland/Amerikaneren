import assert from "node:assert/strict";
import test from "node:test";
import {
  START_FEN,
  advantage,
  applyChessMove,
  botChessMove,
  createChessGame,
  createChessPlayers,
  gaugeLabel,
  gaugeShare,
  inCheck,
  legalMoves,
  make,
  moveText,
  parseFen,
  positionOf,
  pseudoMoves,
  reviewMove,
  squareFromName,
  toFen,
  unmake,
} from "./chess.ts";
import type { ChessMove, ChessState, Position } from "./chess.ts";

/** Teller alle lovlige trekkfølger. Fasiten er kjent, så feil i reglene dukker opp med en gang. */
function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  let total = 0;
  for (const move of pseudoMoves(position)) {
    const mover = position.turn;
    const undo = make(position, move);
    if (!inCheck(position, mover)) total += perft(position, depth - 1);
    unmake(position, undo);
  }
  return total;
}

const game = (fen: string, difficulty: "lett" | "middels" | "vanskelig" = "vanskelig"): ChessState =>
  createChessGame(createChessPlayers(["Du"], difficulty), difficulty, fen);

const move = (from: string, to: string, promotion?: ChessMove["promotion"]): ChessMove =>
  ({ from: squareFromName(from), to: squareFromName(to), ...(promotion ? { promotion } : {}) });

test("the opening position counts out to the known numbers", () => {
  assert.equal(perft(parseFen(START_FEN), 1), 20);
  assert.equal(perft(parseFen(START_FEN), 2), 400);
  assert.equal(perft(parseFen(START_FEN), 3), 8902);
});

test("a middlegame with castling, en passant and promotion counts out", () => {
  const kiwipete = parseFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  assert.equal(perft(kiwipete, 1), 48);
  assert.equal(perft(kiwipete, 2), 2039);
});

test("pinned pieces and promotions count out", () => {
  const endgame = parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
  assert.equal(perft(endgame, 1), 14);
  assert.equal(perft(endgame, 2), 191);
  assert.equal(perft(endgame, 3), 2812);

  const promotions = parseFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
  assert.equal(perft(promotions, 1), 6);
  assert.equal(perft(promotions, 2), 264);
  assert.equal(perft(promotions, 3), 9467);
});

test("the fen we write is the fen we read", () => {
  assert.equal(toFen(parseFen(START_FEN)), START_FEN);
});

test("castling moves the rook along with the king", () => {
  const after = applyChessMove(game("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"), move("e1", "g1"));
  assert.equal(toFen(positionOf(after)).split(" ")[0], "r3k2r/8/8/8/8/8/8/R4RK1");
  assert.equal(after.history[0].text, "0-0");
  assert.equal(after.castling.hvitKort, false);
  assert.equal(after.castling.hvitLang, false);
});

test("you cannot castle out of, through or into check", () => {
  const through = game("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  assert.equal(applyChessMove(through, move("e1", "g1")).history.length, 1);
  const attacked = game("4k3/8/8/8/8/8/8/R3K1rR w KQ - 0 1");
  assert.equal(applyChessMove(attacked, move("e1", "g1")).history.length, 0);
  const fromCheck = game("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  assert.equal(applyChessMove(fromCheck, move("e1", "c1")).history.length, 1);
});

test("en passant takes the pawn that just passed", () => {
  const before = game("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
  const after = applyChessMove(before, move("e5", "d6"));
  assert.equal(toFen(positionOf(after)).split(" ")[0], "4k3/8/3P4/8/8/8/8/4K3");
  assert.equal(after.history[0].text, "exd6");
});

test("a pawn on the last rank becomes the piece you picked", () => {
  const before = game("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(legalMoves(positionOf(before)).filter((option) => option.from === squareFromName("a7")).length, 4);
  const after = applyChessMove(before, move("a7", "a8", "springer"));
  assert.equal(after.board[squareFromName("a8")]?.type, "springer");
  assert.equal(after.history[0].text, "a8S");
});

test("fool's mate ends the game", () => {
  let state = game(START_FEN);
  state = applyChessMove(state, move("f2", "f3"));
  state = applyChessMove(state, move("e7", "e5"));
  state = applyChessMove(state, move("g2", "g4"));
  state = applyChessMove(state, move("d8", "h4"));
  assert.equal(state.outcome, "matt");
  assert.equal(state.winner, "svart");
  assert.equal(state.history.at(-1)?.text, "Dh4#");
});

test("stalemate is a draw, not a win", () => {
  const state = applyChessMove(game("7k/5Q2/8/8/8/8/8/K7 w - - 0 1"), move("f7", "g6"));
  assert.equal(state.outcome, "patt");
  assert.equal(state.winner, null);
});

test("the same position three times is a draw", () => {
  let state = game("4k3/8/8/8/8/8/8/R3K2R w - - 0 1");
  for (const [from, to] of [["a1", "b1"], ["e8", "d8"], ["b1", "a1"], ["d8", "e8"], ["a1", "b1"], ["e8", "d8"], ["b1", "a1"], ["d8", "e8"]]) {
    state = applyChessMove(state, move(from, to));
  }
  assert.equal(state.outcome, "gjentakelse");
});

test("fifty moves without a capture or a pawn is a draw", () => {
  const state = applyChessMove(game("4k3/8/8/8/8/8/R7/4K3 w - - 99 60"), move("a2", "a3"));
  assert.equal(state.outcome, "femti");
});

test("king and bishop cannot mate", () => {
  const state = applyChessMove(game("4k3/8/8/8/8/8/4B3/4K1R1 w - - 0 1"), move("g1", "g8"));
  assert.equal(state.outcome, "spiller");
  const traded = applyChessMove(game("4k3/1r6/8/8/8/8/6B1/7K w - - 0 1"), move("g2", "b7"));
  assert.equal(traded.outcome, "materiell");
});

test("an illegal move leaves the position alone", () => {
  const before = game(START_FEN);
  assert.equal(applyChessMove(before, move("e2", "e5")), before);
  // Bonden er bundet av løperen på h4 – flytter den, står kongen i sjakk.
  const pinned = game("4k3/8/8/8/7b/8/5P2/4K3 w - - 0 1");
  assert.equal(applyChessMove(pinned, move("f2", "f4")).history.length, 0);
});

test("two knights that reach the same square are told apart", () => {
  const state = game("4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1");
  assert.equal(moveText(positionOf(state), move("c3", "e4")), "Sce4");
  assert.equal(moveText(positionOf(state), move("g3", "e4")), "Sge4");
});

test("the bot mates in one when it can", () => {
  const state = game("6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1", "vanskelig");
  const chosen = botChessMove(state, () => 0.99);
  assert.equal(moveText(positionOf(state), chosen!), "Ta8#");
});

test("the bot does not leave a free queen standing", () => {
  const state = game("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1", "vanskelig");
  const chosen = botChessMove(state, () => 0.99);
  assert.equal(chosen?.to, squareFromName("d5"));
});

test("the bot answers within a second", () => {
  const state = game("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1", "vanskelig");
  const started = Date.now();
  const chosen = botChessMove(state, () => 0.99);
  assert.ok(chosen);
  assert.ok(Date.now() - started < 1000, `boten brukte ${Date.now() - started} ms`);
});

test("every level plays a legal move", () => {
  for (const level of ["lett", "middels", "vanskelig"] as const) {
    const state = game(START_FEN, level);
    const chosen = botChessMove(state);
    assert.ok(legalMoves(positionOf(state)).some((option) => option.from === chosen!.from && option.to === chosen!.to));
  }
});

test("the coach calls a hanging queen a blunder and names the move instead", () => {
  // Dronningene står mot hverandre: slår du, vinner du henne. Går du til d5, blir hun tatt.
  const state = game("3qk3/8/8/8/8/8/8/3QK3 w - - 0 1", "vanskelig");
  const note = reviewMove(state, move("d1", "d5"));
  assert.equal(note?.verdict, "tabbe");
  assert.ok(note!.loss >= 250, `tapte ${note!.loss}`);
  assert.equal(note?.bestText, "Dxd8+");
});

test("the coach recognises the move it would have played itself", () => {
  const state = game("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1", "vanskelig");
  const note = reviewMove(state, move("e4", "d5"));
  assert.equal(note?.verdict, "beste");
  assert.equal(note?.loss, 0);
});

test("the coach judges within a moment", () => {
  const state = game("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1", "middels");
  const started = Date.now();
  assert.ok(reviewMove(state, move("g8", "f6")));
  assert.ok(Date.now() - started < 1200, `coachen brukte ${Date.now() - started} ms`);
});

test("the gauge knows who is ahead", () => {
  const even = advantage(game(START_FEN));
  assert.ok(Math.abs(even.score) < 60, `utgangsstillingen skulle vært jevn, var ${even.score}`);
  assert.equal(gaugeLabel(even), "0,0");

  const white = advantage(game("4k3/8/8/8/8/8/8/3QK3 w - - 0 1"));
  assert.ok(white.score > 500, `hvit med dronning mer: ${white.score}`);
  assert.ok(gaugeShare(white) > 0.85);

  const black = advantage(game("3qk3/8/8/8/8/8/8/4K3 w - - 0 1"));
  assert.ok(black.score < -500, `svart med dronning mer: ${black.score}`);
  assert.equal(gaugeLabel(black).startsWith("−"), true);
  assert.ok(gaugeShare(black) < 0.15);
});

test("the gauge counts a mate instead of pawns", () => {
  const mated = applyChessMove(game("6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1"), move("a1", "a8"));
  const done = advantage(mated);
  assert.equal(done.mate, 0);
  assert.equal(gaugeLabel(done), "matt");
  assert.equal(gaugeShare(done), 1);

  const coming = advantage(game("6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1"), 3);
  assert.ok(coming.mate !== null && coming.mate > 0, `ventet matt for hvit, fikk ${JSON.stringify(coming)}`);
});
