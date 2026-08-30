/**
 * Bakrommet – pokerbordet på /poker.
 *
 * Ingen ekte penger. Bare et bord, en pott av sjetonger og de tre knappene som
 * går rundt. Veiviseren på forsiden sender deg hit med `?start=1` når alt er valgt.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RANK_NAME, SUIT_SYMBOL, cardLabel } from "./game.ts";
import "./poker.css";
import StartWizard from "./StartWizard.tsx";
import { loadChoice, saveChoice } from "./setup.ts";
import type { SetupChoice } from "./setup.ts";
import {
  BADGE_LABEL,
  BADGE_NAME,
  BIG_BLIND,
  SMALL_BLIND,
  START_CHIPS,
  act,
  badgeFor,
  botAction,
  coachReview,
  coachSummary,
  compareScore,
  createPokerGame,
  createPokerPlayers,
  equity,
  evaluate,
  legalActions,
  startHand,
  streetLabel,
  totalPot,
} from "./poker.ts";
import type { PokerPlayer, PokerState } from "./poker.ts";
import type { Card } from "./types.ts";

const NAME_KEY = "amerikaneren-navn";
const ODDS_KEY = "bakrommet-odds";
/** Færre trekninger enn i hjørnet – her regnes flere valg om gangen. */
const COACH_RUNS = 600;
/** Nok trekninger til at prosenten er stabil på ±2, og raskt nok til å kjøre synkront. */
const EQUITY_RUNS = 1000;
const BOT_DELAY = 950;
const SHOWDOWN_DELAY = 700;

const storedName = () => {
  try { return window.localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};
/** Vinnersjansen er på som standard, men valget huskes. */
const storedOdds = () => {
  try { return window.localStorage.getItem(ODDS_KEY) !== "av"; } catch { return true; }
};
/** Kom du fra veiviseren på forsiden, er alt valgt og bordet åpner med en gang. */
const dealtOnArrival = () => {
  try { return new URLSearchParams(window.location.search).get("start") === "1"; } catch { return false; }
};

const openingTable = (): PokerState | null => {
  if (!dealtOnArrival()) return null;
  const choice = loadChoice();
  return createPokerGame(createPokerPlayers(storedName(), choice.opponents), choice.level);
};

const chips = (amount: number) => amount.toLocaleString("nb-NO");

export default function Poker() {
  const [name, setName] = useState(storedName);
  const [choice, setChoice] = useState<SetupChoice>(loadChoice);
  const [showOdds, setShowOdds] = useState(storedOdds);
  const [game, setGame] = useState<PokerState | null>(openingTable);
  const [raising, setRaising] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { document.title = "Bakrommet"; }, []);
  // Adressen ryddes, så en oppfriskning viser oppsettet i stedet for et nytt bord.
  useEffect(() => {
    if (dealtOnArrival()) window.history.replaceState(null, "", "/poker");
  }, []);
  useEffect(() => {
    try { window.localStorage.setItem(NAME_KEY, name); } catch { /* privat modus */ }
  }, [name]);
  useEffect(() => { saveChoice(choice); }, [choice]);
  useEffect(() => {
    try { window.localStorage.setItem(ODDS_KEY, showOdds ? "på" : "av"); } catch { /* privat modus */ }
  }, [showOdds]);

  const commit = useCallback((next: PokerState) => {
    setRaising(false);
    setGame(next);
  }, []);

  // Botene handler etter tur, med en liten pause så det går an å følge med.
  useEffect(() => {
    if (!game || game.handOver) return;
    const player = game.players[game.turn];
    if (!player?.isBot) return;
    timer.current = window.setTimeout(() => setGame((current) => {
      if (!current || current.handOver || !current.players[current.turn]?.isBot) return current;
      return act(current, botAction(current));
    }), BOT_DELAY);
    return () => window.clearTimeout(timer.current);
  }, [game]);

  const start = (setup: SetupChoice, player: string) =>
    commit(createPokerGame(createPokerPlayers(player, setup.opponents), setup.level));
  const leave = () => { window.clearTimeout(timer.current); setGame(null); };

  return (
    <main className="poker-shell">
      <header className="brandbar">
        <button className="brand" onClick={leave} aria-label="Tilbake til bakrommet">
          <span className="brand-mark poker-mark">♠</span>
          <span>Bakrommet</span>
        </button>
        {game
          ? <button className="quiet-button" onClick={leave}>Reis deg</button>
          : <a className="quiet-button" href="/">Amerikaneren</a>}
      </header>

      {game
        ? (
          <Table
            game={game}
            raising={raising}
            showOdds={showOdds}
            showFolded={choice.showFolded}
            coach={choice.coach}
            onToggleOdds={() => setShowOdds((on) => !on)}
            onRaising={setRaising}
            onAct={commit}
            onNextHand={() => commit(startHand(game))}
            onRestart={() => start(choice, name)}
          />
        )
        : (
          <StartWizard
            lockedGame="bakrommet"
            initial={choice}
            initialName={name}
            intro={(
              <p className="muted">
                Texas hold&apos;em med falske sjetonger. Alle får {chips(START_CHIPS)}, blindene er {SMALL_BLIND}/{BIG_BLIND},
                og den som sitter igjen med alt har vunnet bordet.
              </p>
            )}
            onChoice={setChoice}
            onName={setName}
            onStart={(request) => start(request.choice, request.name)}
          />
        )}
    </main>
  );
}

function Table(props: {
  game: PokerState; raising: boolean; showOdds: boolean; showFolded: boolean; coach: boolean;
  onToggleOdds: () => void;
  onRaising: (value: boolean) => void; onAct: (next: PokerState) => void;
  onNextHand: () => void; onRestart: () => void;
}) {
  const { game } = props;
  const you = game.players[0];
  const yourTurn = !game.handOver && game.turn === 0 && !you.folded && !you.allIn && !you.out;
  const seats = game.players.slice(1);

  const yourHand = useMemo(
    () => you.cards.length === 2 && game.board.length >= 3 ? evaluate([...you.cards, ...game.board]).label : null,
    [you.cards, game.board],
  );

  // Hvor mye du er opp eller ned siden du satte deg. Sjetongene foran deg er det
  // som faktisk er dine – det som står i potten er ikke avgjort ennå.
  const net = you.chips - START_CHIPS;

  /** Skal kortene til denne spilleren ligge åpne? */
  const revealed = (player: PokerPlayer) => {
    if (player.out || player.cards.length < 2) return false;
    if (game.revealAll && !player.folded) return true;
    // Kastede hender vises bare når fasiten finnes, altså etter et ekte showdown.
    return props.showFolded && Boolean(game.showdown?.some((entry) => entry.playerId === player.id && entry.folded));
  };

  const live = game.players.filter((player) => !player.folded && !player.out && player.id !== you.id).length;
  /**
   * Vinnersjansen. Tung nok til at den bare skal regnes når kortene faktisk endrer
   * seg – ikke ved hver eneste opptegning. Derfor nøkler vi på hånd, gate og
   * hvor mange som fortsatt er med.
   */
  const winChance = useMemo(() => {
    if (!props.showOdds || you.folded || you.out || you.cards.length < 2 || live < 1) return null;
    if (game.handOver) return null;
    return equity(you.cards, game.board, live, EQUITY_RUNS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.showOdds, you.folded, you.out, game.hand, game.board.length, live, game.handOver]);

  return (
    <section className={`poker-screen ${yourTurn ? "is-your-turn" : ""}`}>
      <div className="poker-strip">
        <span><b>Hånd {game.hand}</b><small>{streetLabel(game.street)}</small></span>
        <span><b>{game.smallBlind}/{game.bigBlind}</b><small>blinder</small></span>
        <span className={`strip-net ${net > 0 ? "up" : net < 0 ? "down" : ""}`}>
          <b>{net > 0 ? `+${chips(net)}` : net < 0 ? `−${chips(-net)}` : "0"}</b>
          <small>{net === 0 ? "i null" : net > 0 ? "opp" : "ned"}</small>
        </span>
        <span className="strip-pot"><b>{chips(totalPot(game))}</b><small>i potten</small></span>
        <span className="odds-corner">
          {props.showOdds && (
            <span className="odds-value" aria-live="polite">
              <b>{winChance === null ? "–" : `${Math.round(winChance * 100)} %`}</b>
              <small>å vinne</small>
            </span>
          )}
          <button
            className="odds-toggle"
            onClick={props.onToggleOdds}
            aria-pressed={props.showOdds}
            title={props.showOdds ? "Skjul vinnersjansen" : "Vis vinnersjansen"}
          >
            {props.showOdds ? "Skjul" : "Sjanse"}
          </button>
        </span>
      </div>

      <div className="poker-felt">
        <div className="seat-row" data-count={seats.length}>
          {seats.map((player, index) => (
            <Seat
              key={player.id}
              player={player}
              badge={badgeFor(game, index + 1)}
              active={!game.handOver && game.turn === index + 1}
              reveal={revealed(player)}
              won={game.showdown?.find((entry) => entry.playerId === player.id)?.won ?? 0}
              label={game.showdown?.find((entry) => entry.playerId === player.id)?.label}
            />
          ))}
        </div>

        <div className="board-area">
          <div className="pot-pill" aria-label={`Potten er ${totalPot(game)} sjetonger`}>
            <span className="pot-chip" aria-hidden="true" />
            <b>{chips(totalPot(game))}</b>
          </div>
          <div className="board-cards" aria-label="Kortene på bordet">
            {Array.from({ length: 5 }, (_, index) => {
              const card = game.board[index];
              return card
                ? <PokerCard key={card.id} card={card} />
                : <span className="board-slot" key={`slot-${index}`} aria-hidden="true" />;
            })}
          </div>
          <p className="poker-message" role="status">{game.message}</p>
        </div>

        <YourSeat game={game} you={you} badge={badgeFor(game, 0)} handLabel={yourHand} />
      </div>

      {game.handOver
        ? <HandOver game={game} showFolded={props.showFolded} coach={props.coach} onNextHand={props.onNextHand} onRestart={props.onRestart} />
        : yourTurn && (
          <>
            {/* Knapperaden blir liggende i flyt, så bordet ikke hopper når du åpner høyningen. */}
            <ActionBar game={game} onRaise={() => props.onRaising(true)} onAct={(action) => props.onAct(act(game, action))} />
            {props.raising && (
              <RaisePanel
                // Ny budrunde eller ny innsats å svare på: slideren starter forfra.
                key={`${game.hand}-${game.street}-${game.currentBet}`}
                game={game}
                onCancel={() => props.onRaising(false)}
                onAct={(action) => props.onAct(act(game, action))}
              />
            )}
          </>
        )}
    </section>
  );
}

function Seat(props: { player: PokerPlayer; badge: ReturnType<typeof badgeFor>; active: boolean; reveal: boolean; won: number; label?: string }) {
  const { player } = props;
  return (
    <div className={`seat ${props.active ? "active" : ""} ${player.folded ? "folded" : ""} ${props.won > 0 ? "winner" : ""}`}>
      <div className="seat-cards">
        {player.out || player.cards.length === 0
          ? <span className="poker-card empty" aria-hidden="true" />
          : player.cards.map((card) => props.reveal
            ? <PokerCard key={card.id} card={card} small />
            : <span className={`poker-card back small ${player.folded ? "gone" : ""}`} key={card.id} aria-hidden="true" />)}
      </div>
      <div className="seat-body">
        <Avatar player={player} />
        <span className="seat-name">
          <b>{player.name}</b>
          <small>{player.out ? "Blakk" : `${chips(player.chips)} sjetonger`}</small>
        </span>
        {props.badge && <i className={`seat-badge badge-${props.badge}`} title={BADGE_NAME[props.badge]}>{BADGE_LABEL[props.badge]}</i>}
      </div>
      {props.label && !player.folded && <em className="seat-hand">{props.label}</em>}
      {player.lastAction && !props.label && <em className="seat-action">{player.lastAction}</em>}
      {player.bet > 0 && <b className="seat-bet">{chips(player.bet)}</b>}
      {props.won > 0 && <b className="seat-won">+{chips(props.won)}</b>}
    </div>
  );
}

function YourSeat({ game, you, badge, handLabel }: { game: PokerState; you: PokerPlayer; badge: ReturnType<typeof badgeFor>; handLabel: string | null }) {
  const entry = game.showdown?.find((item) => item.playerId === you.id);
  return (
    <div className={`your-seat ${game.turn === 0 && !game.handOver ? "active" : ""} ${you.folded ? "folded" : ""}`}>
      <div className="your-meta">
        <Avatar player={you} />
        <span className="seat-name">
          <b>{you.name}</b>
          <small>{you.out ? "Blakk" : `${chips(you.chips)} sjetonger`}</small>
        </span>
        {badge && <i className={`seat-badge badge-${badge}`} title={BADGE_NAME[badge]}>{BADGE_LABEL[badge]}</i>}
        {you.bet > 0 && <b className="seat-bet inline">{chips(you.bet)}</b>}
      </div>
      <div className="your-cards">
        {you.cards.map((card) => <PokerCard key={card.id} card={card} />)}
      </div>
      {you.folded
        ? <em className="your-hand muted-hand">Du kastet deg</em>
        : (entry?.label ?? handLabel) && <em className="your-hand">{entry?.label ?? handLabel}</em>}
    </div>
  );
}

function ActionBar(props: {
  game: PokerState;
  onRaise: () => void;
  onAct: (action: { type: "fold" | "check" | "call" | "raise"; amount?: number }) => void;
}) {
  const { game } = props;
  const actions = legalActions(game, 0);
  const opening = game.currentBet === 0;

  return (
    <div className="action-bar">
      <button className="act-fold" onClick={() => props.onAct({ type: "fold" })}>Kast<small>gi fra deg hånden</small></button>
      {actions.canCheck
        ? <button className="act-call" onClick={() => props.onAct({ type: "check" })}>Sjekk<small>gratis videre</small></button>
        : <button className="act-call" onClick={() => props.onAct({ type: "call" })}>
          Syn {chips(actions.callAmount)}<small>{actions.callAmount >= game.players[0].chips ? "alt du har" : "match innsatsen"}</small>
        </button>}
      {actions.canRaise && (
        <button className="act-raise" onClick={props.onRaise}>
          {opening ? "Sats" : "Høyn"}<small>{actions.minRaiseTo >= actions.maxRaiseTo ? "all-in" : `fra ${chips(actions.minRaiseTo)}`}</small>
        </button>
      )}
    </div>
  );
}

/** Legger seg over knapperaden i stedet for å presse bordet sammen. */
function RaisePanel(props: {
  game: PokerState;
  onCancel: () => void;
  onAct: (action: { type: "raise"; amount: number }) => void;
}) {
  const { game } = props;
  const actions = legalActions(game, 0);
  const [amount, setAmount] = useState(actions.minRaiseTo);
  const pot = totalPot(game);
  const opening = game.currentBet === 0;

  const preset = (fraction: number) => Math.min(
    Math.max(Math.round((game.currentBet + pot * fraction) / game.bigBlind) * game.bigBlind, actions.minRaiseTo),
    actions.maxRaiseTo,
  );

  return (
    <div className="raise-panel">
      <div className="raise-head">
        <span><small>{opening ? "Satser" : "Høyner til"}</small><b>{chips(amount)}</b></span>
        <button className="quiet-button" onClick={props.onCancel}>Avbryt</button>
      </div>
      <input
        className="raise-slider"
        type="range"
        min={actions.minRaiseTo}
        max={actions.maxRaiseTo}
        step={game.bigBlind}
        value={amount}
        aria-label="Hvor mye vil du satse?"
        onChange={(event) => setAmount(Math.min(Number(event.target.value), actions.maxRaiseTo))}
      />
      <div className="raise-presets">
        <button onClick={() => setAmount(preset(0.5))}>½ pott</button>
        <button onClick={() => setAmount(preset(1))}>Pott</button>
        <button onClick={() => setAmount(actions.maxRaiseTo)}>All-in</button>
      </div>
      <button className="primary-cta" onClick={() => props.onAct({ type: "raise", amount })}>
        {amount >= actions.maxRaiseTo ? `All-in ${chips(amount)}` : `${opening ? "Sats" : "Høyn til"} ${chips(amount)}`}
      </button>
    </div>
  );
}

function HandOver({ game, showFolded, coach, onNextHand, onRestart }: { game: PokerState; showFolded: boolean; coach: boolean; onNextHand: () => void; onRestart: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), SHOWDOWN_DELAY);
    return () => window.clearTimeout(id);
  }, []);

  const youBusted = game.players[0].chips <= 0;
  const over = Boolean(game.winnerId) || youBusted;
  const champion = game.players.find((player) => player.id === game.winnerId);

  // Kastet du hånden som ville tatt potten? Det er verdt å få vite.
  /** Gjennomgangen er tung nok til at den bare skal kjøres én gang per hånd. */
  const notes = useMemo(
    () => (coach ? coachReview(game, game.players[0].id, COACH_RUNS) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coach, game.hand, game.handOver],
  );

  const yours = game.showdown?.find((entry) => entry.playerId === game.players[0].id);
  // Bare når hver eneste hånd er kjent. Vant noen uten å vise kortene, finnes
  // ingen fasit å påstå noe om.
  const allKnown = Boolean(game.showdown?.every((entry) => !entry.mucked));
  const missed = Boolean(
    showFolded && allKnown && yours?.folded
    && game.showdown!.every((entry) => entry === yours || compareScore(yours.score, entry.score) > 0),
  );

  return (
    <div className={`hand-over ${ready ? "shown" : ""}`}>
      <p className="eyebrow">{over ? "Bordet er ferdig" : `Hånd ${game.hand}`}</p>
      <h2>{over ? (youBusted ? "Du er blakk" : `${champion?.name} tok bordet`) : game.message}</h2>
      {!over && game.showdown && game.showdown.some((entry) => !entry.mucked) && (
        <div className="showdown-list">
          {/* Sortert på hendenes styrke, ikke på gevinst, så det er tydelig
              hvem som faktisk hadde den beste og den dårligste hånden. */}
          {[...game.showdown]
            // Den som vant fordi alle kastet seg viser ikke kortene sine – det er
            // ingen hånd å rangere, bare et navn.
            .filter((entry) => !entry.mucked)
            .filter((entry) => showFolded || !entry.folded)
            .sort((a, b) => compareScore(b.score, a.score))
            .map((entry, index, list) => {
              const player = game.players.find((item) => item.id === entry.playerId)!;
              const delt = index > 0 && compareScore(entry.score, list[index - 1].score) === 0;
              const plass = delt ? "=" : String(index + 1);
              const siste = index === list.length - 1 && list.length > 2;
              return (
                <div className={`${entry.won > 0 ? "won" : ""} ${entry.folded ? "gave-up" : ""}`} key={entry.playerId}>
                  <i className="showdown-rank">{plass}</i>
                  <span className="showdown-cards">{entry.best.map((card) => <PokerCard key={card.id} card={card} small />)}</span>
                  <span>
                    <b>{player.name}</b>
                    <small>{entry.label}</small>
                  </span>
                  {entry.folded && <em className="showdown-tag gave-up">Kastet</em>}
                  {/* Alltid tilstede, så kolonnene står i takt selv uten merke. */}
                  {!entry.folded && (
                    <em className={`showdown-tag ${index === 0 ? "best" : siste ? "worst" : "none"}`}>
                      {index === 0 ? "Best" : siste ? "Svakest" : ""}
                    </em>
                  )}
                  <strong>{entry.won > 0 ? `+${chips(entry.won)}` : "–"}</strong>
                </div>
              );
            })}
        </div>
      )}
      {coach && (
        <div className="coach-box">
          <p className="coach-head">
            <b>Coach</b>
            <span>{coachSummary(notes)}</span>
          </p>
          {notes.length > 0 && (
            <p className="coach-key">
              Slik leser du det: <b>«må vinne oftere enn X»</b> er hva prisen krever,
              <b> «din vant Y»</b> er hånden din. Er Y størst, var valget riktig.
              <span>
                Kravet flytter seg fordi det følger innsatsen, ikke kortene: satser de ¼ av
                potten trenger du 17 %, ved halve potten 25 %, ved hele potten 33 %.
                Stor innsats er dyr å se, liten er billig.
              </span>
            </p>
          )}
          {notes.length > 0 && (
            <div className="coach-list">
              {notes.map((note, index) => (
                <div className={`coach-note ${note.verdict}`} key={index}>
                  <i className="coach-mark">{note.verdict === "bra" ? "✓" : note.verdict === "tabbe" ? "✕" : "~"}</i>
                  <span>
                    <b>{streetLabel(note.street)}: {note.headline}</b>
                    <small>{note.detail}</small>
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="coach-foot">
            Alt er regnet ut fra kortene, prisen og hvor mange som var med i det øyeblikket du
            valgte – ikke fra hvordan hånden endte. Et riktig priset syn er riktig selv om du
            tapte det. Sjansen antar at motstanderne har tilfeldige kort, så den er litt
            optimistisk når noen presser deg.
          </p>
        </div>
      )}

      {missed && (
        <p className="missed-note">
          Du kastet den beste hånden – <b>{yours!.label.toLowerCase()}</b> ville tatt potten.
        </p>
      )}
      <button className="primary-cta" onClick={over ? onRestart : onNextHand}>
        {over ? "Nytt bord" : "Neste hånd"}
      </button>
    </div>
  );
}

function avatarPath(name: string): string | null {
  const normalized = name.toLowerCase();
  if (normalized === "trump") return "/avatars/trump.png";
  if (normalized === "putin") return "/avatars/putin.png";
  if (normalized === "kim jong-un") return "/avatars/kim-jong-un.png";
  return null;
}

function Avatar({ player }: { player: PokerPlayer }) {
  const image = avatarPath(player.name);
  return (
    <span className={`player-avatar ${image ? "illustrated" : ""}`}>
      {image ? <img src={image} alt="" /> : player.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function PokerCard({ card, small = false }: { card: Card; small?: boolean }) {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <span className={`poker-card ${red ? "red" : ""} ${small ? "small" : ""}`} aria-label={cardLabel(card)}>
      <b>{RANK_NAME[card.rank]}</b><i>{SUIT_SYMBOL[card.suit]}</i>
    </span>
  );
}
