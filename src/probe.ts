import { botChessMove, createChessGame, createChessPlayers, moveText, positionOf } from "./chess.ts";

const spots = [
  ["utgang", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"],
  ["midtspill", "r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2NP1N1P/PP2BPP1/R1BQ1RK1 w - - 0 9"],
  ["åpen", "r2q1rk1/pb1nbppp/1p2pn2/2pp4/3P1B2/2PBPN2/PP1N1PPP/R2Q1RK1 w - - 0 10"],
  ["taktisk", "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQkq - 0 6"],
];
// Midlertidig: mål dybde 4 og 5 ved å låne nivåene.
for (const [name, fen] of spots) {
  for (const level of ["vanskelig", "umulig"] as const) {
    const state = createChessGame(createChessPlayers(["Du"], level), level, fen);
    const started = Date.now();
    const move = botChessMove(state, () => 0.99);
    console.log(`${level.padEnd(10)} ${name.padEnd(10)} ${moveText(positionOf(state), move!).padEnd(8)} ${Date.now() - started} ms`);
  }
}
