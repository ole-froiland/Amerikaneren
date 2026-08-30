/**
 * Sjakkbrettet.
 *
 * Brettet eier ingen tilstand selv – den ligger hos App, som også synker den mot
 * rommet når man spiller mot en venn. Her regnes trekkene ut, boten tenker, og
 * brikkene tegnes fra den fargen du selv sitter med.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "./chess.css";
import {
  COLOR_NAME,
  PIECE_GLYPH,
  PIECE_NAME,
  VERDICT_MARK,
  VERDICT_NAME,
  applyChessMove,
  botChessMove,
  createChessGame,
  createChessPlayers,
  movesFrom,
  positionOf,
  reviewMove,
  squareName,
} from "./chess.ts";
import type { ChessMove, ChessPiece, ChessState, CoachNote, PieceColor, PieceType } from "./chess.ts";
import type { Difficulty } from "./setup.ts";

/** Litt pause før boten svarer, så trekket rekker å synke inn. */
const BOT_DELAY = 550;
const PROMOTIONS: PieceType[] = ["dronning", "tårn", "løper", "springer"];

export default function ChessBoard(props: {
  state: ChessState | null;
  humans: { id: string; name: string }[];
  myId: string;
  difficulty: Difficulty;
  canSeed: boolean;
  coach: boolean;
  online: boolean;
  roomCode?: string;
  onCommit: (next: ChessState) => void;
}) {
  const { state, onCommit } = props;
  // Valget hører til stillingen det ble gjort i. Kommer det et trekk fra den andre,
  // faller det bort av seg selv i stedet for å bli ryddet vekk i en effekt.
  const [pick, setPick] = useState<{ square: number; ply: number } | null>(null);
  const [pending, setPending] = useState<{ move: ChessMove; ply: number } | null>(null);
  const [judged, setJudged] = useState<{ note: CoachNote; ply: number; square: number } | null>(null);
  const timer = useRef(0);
  const ply = state?.history.length ?? -1;
  const from = pick?.ply === ply ? pick.square : null;
  const promotion = pending?.ply === ply ? pending.move : null;
  // Dommen blir stående mens motstanderen svarer, og forsvinner når du selv flytter igjen.
  const note = judged && (ply === judged.ply || ply === judged.ply + 1) ? judged.note : null;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Partiet settes opp av den som starter det. De andre får det gjennom rommet.
  useEffect(() => {
    if (state || !props.canSeed) return;
    const players = createChessPlayers(props.humans.map((human) => human.name), props.difficulty)
      .map((player, index) => ({ ...player, id: props.humans[index]?.id ?? player.id }));
    onCommit(createChessGame(players, props.difficulty));
  }, [state, props.canSeed, props.humans, props.difficulty, onCommit]);

  const myColor: PieceColor = useMemo(() => {
    if (!state) return "hvit";
    return state.players.find((player) => player.id === props.myId)?.color ?? "hvit";
  }, [state, props.myId]);

  const yourTurn = Boolean(state) && state!.outcome === "spiller" && state!.turn === myColor;
  const options = useMemo(
    () => (state && from !== null && yourTurn ? movesFrom(positionOf(state), from) : []),
    [state, from, yourTurn],
  );

  // Boten svarer når det er dens tur.
  useEffect(() => {
    if (!state || state.outcome !== "spiller") return;
    const player = state.players.find((seat) => seat.color === state.turn);
    if (!player?.isBot) return;
    timer.current = window.setTimeout(() => {
      const move = botChessMove(state);
      if (move) onCommit(applyChessMove(state, move));
    }, BOT_DELAY);
    return () => window.clearTimeout(timer.current);
  }, [state, onCommit]);

  if (!state) {
    return (
      <section className="panel setup-panel">
        <p className="muted">{props.canSeed ? "Setter opp brettet…" : "Venter på at motstanderen setter opp brettet…"}</p>
      </section>
    );
  }

  const commit = (move: ChessMove) => {
    setPick(null);
    setPending(null);
    if (props.coach) {
      const verdict = reviewMove(state, move);
      setJudged(verdict ? { note: verdict, ply: ply + 1, square: move.to } : null);
    } else {
      setJudged(null);
    }
    onCommit(applyChessMove(state, move));
  };

  const play = (move: ChessMove) => {
    if (move.promotion) { setPending({ move, ply }); return; }
    commit(move);
  };

  const tap = (square: number) => {
    if (!yourTurn) return;
    const move = options.find((option) => option.to === square);
    if (move) { play(move); return; }
    const piece = state.board[square];
    setPick(piece?.color === myColor && square !== from ? { square, ply } : null);
  };

  const finish = (type: PieceType) => {
    if (!promotion) return;
    commit({ ...promotion, promotion: type });
  };

  const restart = () => {
    const players = state.players.map((player) => ({
      ...player,
      // Fargene bytter side, slik at begge får spille hvit.
      color: (player.color === "hvit" ? "svart" : "hvit") as PieceColor,
    }));
    onCommit(createChessGame(players, state.difficulty));
  };

  // Sitter du med svart, snus brettet så dine egne brikker står nærmest.
  const squares = Array.from({ length: 64 }, (_, index) => (myColor === "hvit" ? index : 63 - index));
  const last = state.history.at(-1)?.move ?? null;
  const marked = note && judged ? judged.square : null;
  // Pilen og «var bedre» dukker bare opp når trekket faktisk kostet noe.
  const missed = note ? note.verdict === "unøyaktig" || note.verdict === "bom" || note.verdict === "tabbe" : false;
  const hint = missed && note ? note.best : null;
  const place = (square: number) => {
    const position = myColor === "hvit" ? square : 63 - square;
    return { x: (position % 8) + 0.5, y: Math.floor(position / 8) + 0.5 };
  };
  const opponent = state.players.find((player) => player.color !== myColor);
  const me = state.players.find((player) => player.color === myColor);
  const over = state.outcome !== "spiller";

  return (
    <section className="chess-screen">
      <header className="chess-strip">
        <div className="chess-seat">
          <b>{opponent?.name ?? COLOR_NAME[myColor === "hvit" ? "svart" : "hvit"]}</b>
          <small>{COLOR_NAME[myColor === "hvit" ? "svart" : "hvit"]}{opponent?.isBot ? ` · ${state.difficulty}` : ""}</small>
        </div>
        <Taken board={state.board} color={myColor === "hvit" ? "svart" : "hvit"} />
        {props.roomCode && <span className="chess-code">{props.roomCode}</span>}
      </header>

      <div className={`chess-board ${yourTurn ? "is-your-turn" : ""}`} role="grid" aria-label="Sjakkbrett">
        {squares.map((square, position) => {
          const piece = state.board[square];
          const dark = (Math.floor(square / 8) + square % 8) % 2 === 1;
          const target = options.find((option) => option.to === square);
          const name = squareName(square);
          const classes = [
            "chess-square",
            dark ? "dark" : "light",
            square === from ? "picked" : "",
            target ? (target.capture ? "takes" : "open") : "",
            last && (square === last.from || square === last.to) ? "last" : "",
            state.check && piece?.type === "konge" && piece.color === state.turn ? "checked" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={square}
              className={classes}
              onClick={() => tap(square)}
              disabled={!yourTurn}
              aria-label={`${name}${piece ? ` – ${COLOR_NAME[piece.color]} ${PIECE_NAME[piece.type].toLowerCase()}` : ""}`}
            >
              {position % 8 === 0 && <i className="chess-rank">{name[1]}</i>}
              {position >= 56 && <i className="chess-file">{name[0]}</i>}
              {piece && <span className={`chess-piece ${piece.color}`}>{PIECE_GLYPH[piece.type]}</span>}
              {square === marked && note && (
                <b className={`chess-mark ${note.verdict}`} title={VERDICT_NAME[note.verdict]}>{VERDICT_MARK[note.verdict]}</b>
              )}
            </button>
          );
        })}
        {hint && <Arrow from={place(hint.from)} to={place(hint.to)} />}
      </div>

      <div className="chess-foot">
        <div className="chess-seat">
          <b>{me?.name ?? "Du"}</b>
          <small>{COLOR_NAME[myColor]}</small>
        </div>
        <Taken board={state.board} color={myColor} />
        <p className={`chess-message ${state.check ? "check" : ""}`}>
          {over ? state.message : yourTurn ? (state.check ? "Sjakk! Du må ut av den" : "Din tur") : state.message}
        </p>
      </div>

      {note && (
        <p className={`chess-coach ${note.verdict}`}>
          <b>{VERDICT_MARK[note.verdict]}</b>
          <span>{VERDICT_NAME[note.verdict]}</span>
          {missed && <small>{note.bestText} var bedre</small>}
        </p>
      )}

      <Moves history={state.history} />

      {promotion && (
        <div className="chess-sheet">
          <p>Hva skal bonden bli?</p>
          <div className="chess-promotion">
            {PROMOTIONS.map((type) => (
              <button key={type} onClick={() => finish(type)} aria-label={PIECE_NAME[type]}>
                <span className={`chess-piece ${myColor}`}>{PIECE_GLYPH[type]}</span>
                <small>{PIECE_NAME[type]}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {over && (
        <div className="chess-sheet">
          <p className="chess-result">{state.message}</p>
          {props.online
            ? <p className="tiny">Trykk under, så starter dere på nytt med byttede farger.</p>
            : null}
          <button className="primary-cta" onClick={restart}>Nytt parti</button>
        </div>
      )}
    </section>
  );
}

/** Pilen coachen tegner: fra ruta det beste trekket går fra, til ruta det går til. */
function Arrow({ from, to }: { from: { x: number; y: number }; to: { x: number; y: number } }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  // Starter utenfor brikken og stopper før midten av målruta, så begge er synlige.
  const start = { x: from.x + (dx / length) * 0.32, y: from.y + (dy / length) * 0.32 };
  const end = { x: to.x - (dx / length) * 0.36, y: to.y - (dy / length) * 0.36 };
  return (
    <svg className="chess-arrow" viewBox="0 0 8 8" aria-hidden="true">
      <defs>
        <marker id="chess-arrowhead" markerWidth="3" markerHeight="3" refX="1.6" refY="1.5" orient="auto">
          <path d="M0,0 L3,1.5 L0,3 z" />
        </marker>
      </defs>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} markerEnd="url(#chess-arrowhead)" />
    </svg>
  );
}

/** Brikkene motstanderen har mistet, og hvor mye du leder i materiell. */
function Taken({ board, color }: { board: (ChessPiece | null)[]; color: PieceColor }) {
  const full: Record<PieceType, number> = { bonde: 8, tårn: 2, springer: 2, løper: 2, dronning: 1, konge: 1 };
  const left: Record<PieceType, number> = { bonde: 0, tårn: 0, springer: 0, løper: 0, dronning: 0, konge: 0 };
  for (const piece of board) if (piece?.color === color) left[piece.type] += 1;
  const lost = (Object.keys(full) as PieceType[])
    .flatMap((type) => Array.from({ length: full[type] - left[type] }, () => type))
    .filter((type) => type !== "konge");
  return (
    <div className="chess-taken" aria-label={lost.length ? `${lost.length} brikker slått` : "ingen brikker slått"}>
      {lost.map((type, index) => <span key={`${type}-${index}`} className={`chess-piece ${color}`}>{PIECE_GLYPH[type]}</span>)}
    </div>
  );
}

function Moves({ history }: { history: ChessState["history"] }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ left: list.current.scrollWidth }); }, [history.length]);
  if (!history.length) return <div className="chess-moves" ref={list} />;
  return (
    <div className="chess-moves" ref={list}>
      {history.map((record, index) => (
        <span key={index} className={record.by === "hvit" ? "hvit" : "svart"}>
          {record.by === "hvit" && <i>{Math.floor(index / 2) + 1}.</i>}{record.text}
        </span>
      ))}
    </div>
  );
}
