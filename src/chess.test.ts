import assert from "node:assert/strict";
import test from "node:test";
import {
  START_FEN,
  accuracyOf,
  advantage,
  analyseAt,
  applyChessMove,
  botChessMove,
  createChessGame,
  createChessPlayers,
  describeLast,
  gaugeLabel,
  gaugeShare,
  inCheck,
  legalMoves,
  make,
  moveText,
  parseFen,
  positionOf,
  pseudoMoves,
  reportFrom,
  reviewMove,
  sameMove,
  squareFromName,
  toFen,
  unmake,
} from "./chess.ts";
import type { ChessMove, ChessState, Position } from "./chess.ts";
import type { Difficulty } from "./setup.ts";

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

const game = (fen: string, difficulty: Difficulty = "vanskelig"): ChessState =>
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
  assert.equal(gaugeLabel(done), "#");
  assert.equal(gaugeShare(done), 1);

  const coming = advantage(game("6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1"), 3);
  assert.ok(coming.mate !== null && coming.mate > 0, `ventet matt for hvit, fikk ${JSON.stringify(coming)}`);
});

test("the move line names the opening while the game follows it", () => {
  let state = game(START_FEN);
  state = applyChessMove(state, move("e2", "e4"));
  assert.equal(describeLast(state)?.opening, "Kongebondeåpning");
  state = applyChessMove(state, move("c7", "c5"));
  assert.equal(describeLast(state)?.opening, "Siciliansk");
  state = applyChessMove(state, move("a2", "a3"));
  assert.equal(describeLast(state)?.opening, null);
});

test("the move line says what the move actually does", () => {
  let state = game(START_FEN);
  state = applyChessMove(state, move("e2", "e4"));
  assert.deepEqual(describeLast(state)?.notes, ["tar sentrum"]);

  state = applyChessMove(state, move("e7", "e5"));
  state = applyChessMove(state, move("g1", "f3"));
  const developing = describeLast(state)!.notes;
  assert.ok(developing.includes("utvikler springeren"));
  assert.ok(developing.some((note) => note.startsWith("truer bonden på e5")), developing.join(" · "));
});

test("the move line warns when the piece is left hanging", () => {
  const state = applyChessMove(game("4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1"), move("d1", "d3"));
  assert.ok(describeLast(state)?.notes.includes("dronningen står i slag"));
});

test("the move line calls a fork a fork", () => {
  // Springeren på c7 treffer begge tårnene på én gang. Hvit konge står utenfor e-linjen.
  const forked = applyChessMove(game("r3r2k/8/8/1N6/8/8/8/7K w - - 0 1"), move("b5", "c7"));
  assert.ok(describeLast(forked)!.notes.includes("gaffel: truer to tårn"), describeLast(forked)!.notes.join(" · "));

  // Konge og tårn: sjakken nevnes for seg, tårnet som trusselen det er.
  const checked = applyChessMove(game("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1"), move("b5", "c7"));
  const notes = checked.history.length ? describeLast(checked)!.notes : [];
  assert.ok(notes.includes("sjakk"), notes.join(" · "));
  assert.ok(notes.some((note) => note.startsWith("truer tårnet på a8")), notes.join(" · "));
});

test("every level plays a legal move, and the hardest one answers in time", () => {
  for (const level of ["nybegynner", "lett", "middels", "vanskelig", "umulig"] as const) {
    const state = game("r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1N1P/PP2BPP1/R1BQ1RK1 w - - 0 9", level);
    const started = Date.now();
    const chosen = botChessMove(state);
    assert.ok(legalMoves(positionOf(state)).some((option) => sameMove(option, chosen!)), `${level} spilte ulovlig`);
    assert.ok(Date.now() - started < 1500, `${level} brukte ${Date.now() - started} ms`);
  }
});

test("the review scores a clean game high and a loose one low", () => {
  // Hvit spiller fornuftig, svart gir bort brikker.
  let state = game(START_FEN, "middels");
  for (const [from, to] of [["e2", "e4"], ["b8", "a6"], ["g1", "f3"], ["a6", "b8"], ["b1", "c3"], ["d7", "d5"], ["e4", "d5"], ["d8", "d5"], ["c3", "d5"]]) {
    state = applyChessMove(state, move(from, to));
  }
  const losses = state.history.map((_, index) => analyseAt(state, index)!).filter(Boolean);
  assert.equal(losses.length, state.history.length);
  const report = reportFrom(losses);
  assert.ok(report.hvit.total.score > report.svart.total.score, `hvit ${report.hvit.total.score} mot svart ${report.svart.total.score}`);
  assert.ok(report.svart.blunders >= 1, "å gi bort dronningen skal telles som tabbe");
  assert.equal(report.hvit.åpning.moves + report.hvit.midtspill.moves + report.hvit.sluttspill.moves, report.hvit.total.moves);
});

test("the review splits the game into phases", () => {
  const opening = analyseAt(applyChessMove(game(START_FEN), move("e2", "e4")), 0);
  assert.equal(opening?.phase, "åpning");

  const bare = applyChessMove(game("4k3/4p3/8/8/8/8/4P3/R3K3 w - - 0 40"), move("a1", "a4"));
  assert.equal(analyseAt(bare, 0)?.phase, "sluttspill");
});

test("accuracy falls as the loss grows", () => {
  const at = (loss: number) => accuracyOf([{ by: "hvit", loss, phase: "midtspill" }]);
  assert.equal(at(0), 100);
  assert.ok(at(50) > at(150) && at(150) > at(400));
  assert.ok(at(400) < 20);
});

test("the review sees the move that allowed mate, and gets through a game quickly", () => {
  // Narrematt: 3.a3 slipper Dh4 matt inn.
  let state = game(START_FEN, "middels");
  for (const [from, to] of [["f2", "f3"], ["b8", "c6"], ["g2", "g4"], ["e7", "e5"], ["a2", "a3"], ["d8", "h4"]]) {
    state = applyChessMove(state, move(from, to));
  }
  assert.equal(state.outcome, "matt");
  const started = Date.now();
  const losses = state.history.map((_, index) => analyseAt(state, index)!);
  const spent = Date.now() - started;
  const report = reportFrom(losses);
  assert.ok(report.hvit.blunders >= 1, `å slippe inn matt skal telle som tabbe: ${JSON.stringify(losses)}`);
  assert.ok(report.svart.total.score > report.hvit.total.score);
  assert.ok(spent < 2000, `gjennomgangen brukte ${spent} ms på seks trekk`);
});
