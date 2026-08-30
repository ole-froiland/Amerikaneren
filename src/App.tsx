import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import StartWizard from "./StartWizard.tsx";
import type { StartRequest } from "./StartWizard.tsx";
import { createRoom, inviteLink, joinRoom, pollRoom, saveRoomGame } from "./api.ts";
import { loadChoice, saveChoice } from "./setup.ts";
import type { SetupChoice } from "./setup.ts";
import {
  RANK_NAME,
  SUITS,
  SUIT_NAME,
  SUIT_SYMBOL,
  availableBids,
  bidLabel,
  botBid,
  botCard,
  botDiscard,
  botTrump,
  canClaimRest,
  cardLabel,
  chooseTrump,
  claimRest,
  collectTrick,
  createGame,
  createPlayers,
  exchangeCards,
  legalCards,
  nextRound,
  placeBid,
  playCard,
  trickWinner,
} from "./game.ts";
import type { ChessState } from "./chess.ts";
import type { Card, GameKind, GameState, Room, Suit } from "./types.ts";
import { roomLimit } from "./types.ts";

/** Sjakkbrettet lastes først når noen faktisk skal spille sjakk. */
const ChessBoard = lazy(() => import("./ChessBoard.tsx"));

type Screen = "home" | "lobby" | "game" | "rules";

const NAME_KEY = "amerikaneren-navn";
/** Hvor lenge vi venter på verten før en annen spiller driver botene videre. */
const HOST_TIMEOUT = 8000;
const COLLECT_DELAY = 1700;
const DEAL_DELAY = 2100;
const BOT_DELAY = { playing: 850, other: 550 };

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const cleanCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
const inviteCode = () => cleanCode(new URLSearchParams(window.location.search).get("rom") ?? "");
const storedName = () => {
  try { return window.localStorage.getItem(NAME_KEY) ?? ""; } catch { return ""; }
};

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [game, setGame] = useState<GameState | null>(null);
  const [chess, setChess] = useState<ChessState | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState(storedName);
  const [choice, setChoice] = useState<SetupChoice>(loadChoice);
  const [invited, setInvited] = useState(inviteCode);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dealingRound, setDealingRound] = useState<number | null>(null);
  const roomCode = room?.code;

  // Versjonen av romtilstanden vi viser. Alt som kommer inn med lavere versjon
  // er gammelt nytt og ignoreres, slik at et sent svar aldri overskriver et ferskt trekk.
  const versionRef = useRef(0);
  // Settes så snart vi er inne i et rom (opprett/bli med/oppdatering).
  const changedAtRef = useRef(0);
  const gameRef = useRef<GameState | null>(null);
  const roomRef = useRef<Room | null>(null);
  const playerIdRef = useRef("");
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const dealTimerRef = useRef(0);

  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);
  useEffect(() => {
    try { window.localStorage.setItem(NAME_KEY, name); } catch { /* privat modus */ }
  }, [name]);

  const beginDeal = useCallback((round: number) => {
    window.clearTimeout(dealTimerRef.current);
    setDealingRound(round);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 450 : DEAL_DELAY;
    dealTimerRef.current = window.setTimeout(() => setDealingRound(null), delay);
  }, []);

  useEffect(() => () => window.clearTimeout(dealTimerRef.current), []);

  const ownIndex = useMemo(() => {
    if (!game) return 0;
    if (!room) return 0;
    const index = game.players.findIndex((player) => player.id === playerId);
    return index >= 0 ? index : 0;
  }, [game, playerId, room]);

  const kind: GameKind = room ? room.kind : choice.game === "sjakk" ? "sjakk" : "amerikaneren";

  const applyRoom = useCallback((fresh: Room, force = false) => {
    if (!force && fresh.version <= versionRef.current) {
      if (fresh.version === versionRef.current) setRoom(fresh);
      return;
    }
    versionRef.current = fresh.version;
    changedAtRef.current = Date.now();
    setRoom(fresh);
    if (!fresh.game) return;
    if (fresh.kind === "sjakk") {
      setChess(fresh.game);
      setScreen("game");
      return;
    }
    const previous = gameRef.current;
    if (!previous || fresh.game.round > previous.round) beginDeal(fresh.game.round);
    gameRef.current = fresh.game;
    setGame(fresh.game);
    setScreen("game");
  }, [beginDeal]);

  /** Sender tilstanden til rommet. Ett lagringskall om gangen, ellers kan to trekk kollidere. */
  const pushToRoom = useCallback((next: GameState | ChessState) => {
    const current = roomRef.current;
    const id = playerIdRef.current;
    if (!current || !id) return;
    const base = versionRef.current;
    versionRef.current = base + 1;
    changedAtRef.current = Date.now();
    queueRef.current = queueRef.current.then(async () => {
      try {
        const result = await saveRoomGame(current.code, id, next, base);
        if (result.conflict) {
          applyRoom(result.room, true);
        } else {
          versionRef.current = result.room.version;
          changedAtRef.current = Date.now();
          setRoom(result.room);
        }
      } catch (reason) {
        setError((reason as Error).message);
      }
    });
  }, [applyRoom]);

  const commitChess = useCallback((next: ChessState) => {
    setChess(next);
    pushToRoom(next);
  }, [pushToRoom]);

  const commitGame = useCallback((next: GameState, forceDeal = false) => {
    const previous = gameRef.current;
    if (forceDeal || !previous || next.round > previous.round) beginDeal(next.round);
    gameRef.current = next;
    setGame(next);
    setSelected([]);
    pushToRoom(next);
  }, [beginDeal, pushToRoom]);

  /** Bare verten kjører bots og rydder stikk – ellers ville alle fire spilt samme trekk. */
  const canDrive = useCallback(() => {
    const current = roomRef.current;
    if (!current) return true;
    if (current.hostId === playerIdRef.current) return true;
    return Date.now() - changedAtRef.current > HOST_TIMEOUT;
  }, []);

  useEffect(() => {
    if (!roomCode || screen !== "lobby" && screen !== "game") return;
    let active = true;
    const controller = new AbortController();
    const listen = async () => {
      while (active) {
        if (document.hidden) { await sleep(400); continue; }
        try {
          const result = await pollRoom(roomCode, versionRef.current, controller.signal);
          if (!active) return;
          if (!("unchanged" in result)) applyRoom(result);
        } catch {
          if (!active) return;
          await sleep(700);
        }
      }
    };
    void listen();
    return () => { active = false; controller.abort(); };
  }, [roomCode, screen, applyRoom]);

  useEffect(() => {
    if (!game || dealingRound !== null || game.phase === "scoring") return;
    const collecting = game.phase === "collecting";
    const botTurn = !collecting && Boolean(game.players[game.turn]?.isBot);
    if (!collecting && !botTurn) return;
    let timer = 0;
    const act = () => {
      if (!canDrive()) { timer = window.setTimeout(act, 1200); return; }
      if (collecting) return commitGame(collectTrick(game));
      if (game.phase === "bidding") return commitGame(placeBid(game, botBid(game)));
      if (game.phase === "exchange") return commitGame(exchangeCards(game, botDiscard(game)));
      if (game.phase === "trump") return commitGame(chooseTrump(game, botTrump(game)));
      if (game.phase === "playing") return commitGame(playCard(game, botCard(game).id));
    };
    timer = window.setTimeout(act, collecting ? COLLECT_DELAY : game.phase === "playing" ? BOT_DELAY.playing : BOT_DELAY.other);
    return () => window.clearTimeout(timer);
  }, [game, dealingRound, canDrive, commitGame]);

  const startSolo = (player = name) => {
    setRoom(null);
    setPlayerId("");
    versionRef.current = 0;
    const next = createGame(createPlayers([player.trim() || "Du"]));
    gameRef.current = next;
    beginDeal(next.round);
    setGame(next);
    setScreen("game");
  };

  const handleCreate = async (player: string, forGame: GameKind = "amerikaneren") => {
    setBusy(true); setError("");
    try {
      const result = await createRoom(player, forGame);
      versionRef.current = result.room.version;
      changedAtRef.current = Date.now();
      setRoom(result.room); setPlayerId(result.playerId); setScreen("lobby");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const handleJoin = async (roomCodeToJoin: string, player: string) => {
    setBusy(true); setError("");
    try {
      const result = await joinRoom(roomCodeToJoin, player);
      versionRef.current = result.room.version;
      changedAtRef.current = Date.now();
      setRoom(result.room); setPlayerId(result.playerId); setScreen("lobby");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  /** Siste steg i veiviseren: start, lag rom, eller gå videre til Poker. */
  const handleStart = (request: StartRequest) => {
    setChoice(request.choice);
    saveChoice(request.choice);
    setName(request.name);
    if (request.choice.game === "poker") {
      // Poker har sin egen adresse, så pokerkoden lastes først når man skal dit.
      try { window.localStorage.setItem(NAME_KEY, request.name); } catch { /* privat modus */ }
      window.location.assign("/poker?start=1");
      return;
    }
    if (request.choice.game === "sjakk") {
      if (request.action === "alene") { setGame(null); setChess(null); setRoom(null); setPlayerId(""); versionRef.current = 0; setScreen("game"); }
      else if (request.action === "lag-rom") void handleCreate(request.name, "sjakk");
      else void handleJoin(request.code, request.name);
      return;
    }
    if (request.action === "alene") startSolo(request.name);
    else if (request.action === "lag-rom") void handleCreate(request.name);
    else void handleJoin(request.code, request.name);
  };

  const startRoomGame = () => {
    if (!room || room.players.length < 2) return;
    // Sjakkbrettet setter opp partiet selv – det er der brikkene bor.
    if (room.kind === "sjakk") { setScreen("game"); return; }
    const players = createPlayers(room.players.map((player) => player.name)).map((player, index) => ({
      ...player,
      id: room.players[index]?.id ?? player.id,
    }));
    commitGame(createGame(players), true);
    setScreen("game");
  };

  const leave = () => {
    window.clearTimeout(dealTimerRef.current);
    versionRef.current = 0;
    changedAtRef.current = Date.now();
    gameRef.current = null;
    setDealingRound(null);
    // Invitasjonen er brukt opp – neste gang starter veiviseren på første steg.
    setInvited("");
    setGame(null); setChess(null); setRoom(null); setPlayerId(""); setSelected([]); setError(""); setScreen("home");
  };

  return (
    <main className="app-shell">
      <header className="brandbar">
        <button className="brand" onClick={leave} aria-label="Gå til forsiden">
          <span className="brand-mark">A</span>
          <span>Amerikaneren</span>
        </button>
        {screen !== "home" && <button className="quiet-button" onClick={leave}>Avslutt</button>}
      </header>

      {screen === "home" && (
        <StartWizard
          initial={choice}
          initialName={name}
          invitedCode={invited}
          busy={busy}
          error={error}
          onChoice={(next) => { setChoice(next); saveChoice(next); }}
          onName={setName}
          onStart={handleStart}
          onRules={() => setScreen("rules")}
        />
      )}
      {screen === "lobby" && room && (
        <Lobby
          room={room}
          playerId={playerId}
          seats={room.kind === "sjakk" ? roomLimit(room.kind) : choice.humans}
          onStart={startRoomGame}
        />
      )}
      {screen === "rules" && <Rules onPlay={() => startSolo()} />}
      {screen === "game" && kind === "sjakk" && (
        <Suspense fallback={<section className="panel setup-panel"><p className="muted">Setter opp brettet…</p></section>}>
          <ChessBoard
            state={chess}
            humans={room ? room.players.slice(0, 2).map((player) => ({ id: player.id, name: player.name })) : [{ id: "du", name: name.trim() || "Du" }]}
            myId={room ? playerId : "du"}
            difficulty={choice.level}
            canSeed={!room || room.hostId === playerId}
            coach={choice.coach}
            online={Boolean(room)}
            roomCode={room?.code}
            onCommit={commitChess}
          />
        </Suspense>
      )}
      {screen === "game" && kind === "amerikaneren" && game && (
        <GameTable
          game={game}
          ownIndex={ownIndex}
          selected={selected}
          dealing={dealingRound === game.round}
          isOnline={Boolean(room)}
          roomCode={room?.code}
          onSelect={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current)}
          onBid={(value) => commitGame(placeBid(game, value))}
          onExchange={() => commitGame(exchangeCards(game, selected))}
          onTrump={(suit) => commitGame(chooseTrump(game, suit))}
          onPlay={(id) => commitGame(playCard(game, id))}
          onNext={() => commitGame(nextRound(game))}
          onClaim={() => {
            if (!canClaimRest(game, ownIndex)) return false;
            commitGame(claimRest(game, ownIndex));
            return true;
          }}
          onRestart={room
            ? () => commitGame(createGame(game.players.map((player) => ({ ...player, score: 0, tricks: 0 }))), true)
            : () => startSolo()}
        />
      )}
      <div className="sr-status" role="status" aria-live="polite">{error}</div>
    </main>
  );
}

function Lobby({ room, playerId, seats, onStart }: { room: Room; playerId: string; seats: number; onStart: () => void }) {
  const isHost = room.hostId === playerId;
  // Verten valgte hvor mange menneskeplasser bordet skal ha. Resten er bots –
  // bortsett fra i sjakk, der brettet krever to mennesker.
  const limit = roomLimit(room.kind);
  const humans = Math.min(limit, Math.max(seats, room.players.length));
  const missing = humans - room.players.length;
  const [copied, setCopied] = useState("");
  const link = inviteLink(room.code);

  const flash = (label: string) => {
    setCopied(label);
    window.setTimeout(() => setCopied(""), 2000);
  };

  const share = async () => {
    // Del-arket på mobil er raskeste vei inn i rommet for vennene.
    if (navigator.share) {
      try {
        await navigator.share({ title: "Amerikaneren", text: `Bli med i rommet ${room.code}`, url: link });
        return;
      } catch { /* avbrutt – fall tilbake til kopiering */ }
    }
    try { await navigator.clipboard?.writeText(link); flash("link"); } catch { /* ingen utklippstavle */ }
  };

  return (
    <section className="panel lobby-panel">
      <p className="eyebrow">Rommet er klart</p>
      <h1 className="room-code">{room.code}</h1>
      <div className="share-row">
        <button className="primary-cta share-cta" onClick={() => void share()}>{copied === "link" ? "Lenke kopiert ✓" : "Del invitasjon"}</button>
        <button className="copy-button" onClick={() => { void navigator.clipboard?.writeText(room.code); flash("code"); }}>{copied === "code" ? "Kode kopiert ✓" : "Kopier bare koden"}</button>
      </div>
      <p className="muted">Send lenken – vennene dine kommer rett inn i rommet.</p>
      <div className="player-list">
        {room.players.map((player, index) => <div className="lobby-player" key={player.id}><span>{index + 1}</span><b>{player.name}</b>{player.id === room.hostId && <small>Vert</small>}<i>✓</i></div>)}
        {Array.from({ length: missing }, (_, i) => <div className="lobby-player empty" key={`venter-${i}`}><span>{room.players.length + i + 1}</span><b>Venter…</b></div>)}
        {Array.from({ length: limit - humans }, (_, i) => <div className="lobby-player bot" key={`bot-${i}`}><span>{humans + i + 1}</span><b>Bot</b></div>)}
      </div>
      {isHost ? (
        <>
          <button className="primary-cta" disabled={room.players.length < 2} onClick={onStart}>Start spill</button>
          <p className="tiny">
            {room.kind === "sjakk"
              ? (missing ? "Sjakk er to om brettet. Venter på motstanderen din." : "Dere er to. Du spiller hvit.")
              : missing
                ? `Venter på ${missing} til. Du kan starte når som helst – ledige plasser fylles av bots.`
                : "Ledige plasser fylles av bots."}
          </p>
        </>
      ) : <p className="waiting"><span /> Venter på at verten starter</p>}
      {room.kind === "sjakk" && !isHost && <p className="tiny">Du spiller svart.</p>}
    </section>
  );
}

function Rules({ onPlay }: { onPlay: () => void }) {
  return (
    <section className="panel rules-panel">
      <p className="eyebrow">Kort fortalt</p><h1>Slik spiller du</h1>
      <ol>
        <li><b>By på stikk</b><span>By 7–12 eller pass. Høyeste bud vinner kontrakten.</span></li>
        <li><b>Ta potten</b><span>Vinneren får fire kort og legger fire kort bort.</span></li>
        <li><b>Velg trumf</b><span>Appen spør automatisk etter det beste manglende trumfkortet. Den som har kortet blir makker.</span></li>
        <li><b>Ta stikk</b><span>Følg fargen hvis du kan. Høyeste kort – eller høyeste trumf – tar stikket.</span></li>
        <li><b>Nå 52 poeng</b><span>Klarer laget budet, får begge budets poeng. Hvis ikke, får begge minus.</span></li>
      </ol>
      <button className="primary-cta" onClick={onPlay}>Prøv mot bots</button>
    </section>
  );
}

function GameTable(props: {
  game: GameState; ownIndex: number; selected: string[]; dealing: boolean; isOnline: boolean; roomCode?: string;
  onSelect: (id: string) => void; onBid: (value: number | "american" | "pass") => void; onExchange: () => void;
  onTrump: (suit: Suit) => void; onPlay: (id: string) => void; onNext: () => void; onRestart: () => void;
  onClaim: () => boolean;
}) {
  const { game, ownIndex } = props;
  const [showLastTrick, setShowLastTrick] = useState(false);
  const [claimDenied, setClaimDenied] = useState(false);
  const ownTurn = game.turn === ownIndex;
  const legal = game.phase === "playing" && ownTurn ? new Set(legalCards(game).map((card) => card.id)) : new Set<string>();
  const relative = (offset: number) => (ownIndex + offset) % 4;
  const bidder = game.bid ? game.players[game.bid.playerIndex] : null;
  const lastTrick = game.completedTricks.at(-1);
  const lastWinner = lastTrick && game.trump ? lastTrick[trickWinner(lastTrick, game.trump)].playerIndex : null;
  const teammate = (index: number) => sameTeam(game, ownIndex, index);
  const contractTeam = game.bid ? [game.bid.playerIndex, ...(game.partnerIndex === null ? [] : [game.partnerIndex])] : [];
  const teamRole = (index: number) => game.partnerRevealed ? (contractTeam.includes(index) ? "contract" : "defense") : null;
  const contractTricks = contractTeam.reduce((sum, index) => sum + game.players[index].tricks, 0);
  const winnerSeat = game.pendingWinner === null ? null : ["south", "west", "north", "east"][(game.pendingWinner - ownIndex + 4) % 4];
  const winnerOnContract = game.pendingWinner !== null && contractTeam.includes(game.pendingWinner);
  const winningSide = winnerOnContract ? contractTeam : game.players.map((_, index) => index).filter((index) => !contractTeam.includes(index));
  const winningSideTricks = winningSide.reduce((sum, index) => sum + game.players[index].tricks, 0) + (game.phase === "collecting" ? 1 : 0);
  const turnLabel = game.phase === "bidding" ? "Byr"
    : game.phase === "exchange" ? "Velger 4"
      : game.phase === "trump" ? "Velger trumf"
        : game.phase === "collecting" ? "Tok stikket"
          : game.trick.length === 0 ? "Utspill" : `${game.trick.length + 1}. kort`;
  const statusMessage = game.phase === "playing"
    ? ownTurn
      ? game.trick.length === 0 ? "Din tur – spill ut" : "Din tur – spill et kort"
      : `${game.players[game.turn].name} tenker…`
    : game.message;

  return (
    <section className={`game-screen phase-${game.phase} ${ownTurn ? "is-own-turn" : ""} ${props.dealing ? "is-dealing" : ""}`}>
      <div className="score-strip">
        <span>Runde {game.round}</span>
        {game.players.map((player, index) => <div key={player.id} className={`${index === ownIndex ? "you" : ""} ${teammate(index) ? "same-team" : ""} ${teamRole(index) ? `team-${teamRole(index)}` : ""}`}><PlayerAvatar player={player} size="tiny" /><span>{player.name}<small>{player.score} p</small></span></div>)}
        {props.roomCode && <b className="mini-code">{props.roomCode}</b>}
      </div>

      <div className={`felt-table ${game.phase === "collecting" && winnerSeat ? `collecting winner-${winnerSeat}` : ""}`}>
        <Opponent player={game.players[relative(2)]} count={game.hands[relative(2)].length} active={game.turn === relative(2)} wonTrick={game.pendingWinner === relative(2)} position="north" order={3} turnLabel={turnLabel} teamRole={teamRole(relative(2))} />
        <Opponent player={game.players[relative(1)]} count={game.hands[relative(1)].length} active={game.turn === relative(1)} wonTrick={game.pendingWinner === relative(1)} position="west" order={2} turnLabel={turnLabel} teamRole={teamRole(relative(1))} />
        <Opponent player={game.players[relative(3)]} count={game.hands[relative(3)].length} active={game.turn === relative(3)} wonTrick={game.pendingWinner === relative(3)} position="east" order={4} turnLabel={turnLabel} teamRole={teamRole(relative(3))} />

        <div className="contract-pill">
          {game.trump ? <span className={game.trump === "hearts" || game.trump === "diamonds" ? "red" : ""}>{SUIT_SYMBOL[game.trump]} {typeof game.contract === "number" ? game.contract : "A"}</span> : game.bid ? bidLabel(game.bid.value) : "Budrunde"}
          {bidder && <small>{game.requestedCard ? `Spør ${cardLabel(game.requestedCard)}` : bidder.name}</small>}
        </div>

        {game.partnerRevealed && game.bid && game.partnerIndex !== null && (
          <div className="contract-team-card">
            <span className="team-portraits"><PlayerAvatar player={game.players[game.bid.playerIndex]} size="tiny" /><PlayerAvatar player={game.players[game.partnerIndex]} size="tiny" /></span>
            <span><small>Kontraktlaget</small><b>{game.players[game.bid.playerIndex].name} + {game.players[game.partnerIndex].name}</b></span>
            <strong>{contractTricks + (game.phase === "collecting" && winnerOnContract ? 1 : 0)}<small> / {game.contract === "american" ? 12 : game.contract} stikk</small></strong>
          </div>
        )}

        <div className="trick-area" aria-label="Kort i dette stikket">
          {game.trick.map((played, index) => {
            const seat = ["south", "west", "north", "east"][(played.playerIndex - ownIndex + 4) % 4];
            return <div className={`thrown-card from-${seat}`} style={{ "--throw-order": index } as CSSProperties} key={played.card.id}><PlayingCard card={played.card} compact /></div>;
          })}
        </div>

        {game.phase === "collecting" && game.pendingWinner !== null && (
          <div className="trick-winner-toast">
            <PlayerAvatar player={game.players[game.pendingWinner]} size="winner" />
            <span><small>Tar stikket</small><b>{game.players[game.pendingWinner].name}</b><em>{winnerOnContract ? "Kontraktlaget" : "Motlaget"} har nå {winningSideTricks} stikk</em></span>
            <strong>+1<span>stikk</span></strong>
          </div>
        )}

        {lastTrick && lastWinner !== null && <button className="last-trick-button" onClick={() => setShowLastTrick(true)}><PlayerAvatar player={game.players[lastWinner]} size="tiny" /><span><small>Siste stikk</small><b>{game.players[lastWinner].name} vant</b></span><i>Se kortene →</i></button>}

        <div className="status-bubble">
          <span>{statusMessage}</span>
        </div>

        {game.phase === "bidding" && ownTurn && <BidControls game={game} onBid={props.onBid} />}
        {game.phase === "trump" && ownTurn && <TrumpControls onTrump={props.onTrump} />}
        {game.phase === "scoring" && <ScoreSheet game={game} onNext={props.onNext} onRestart={props.onRestart} isOnline={props.isOnline} />}

        {game.phase !== "scoring" && (
          <div className="hand-zone">
            <div className={`hand-meta ${game.pendingWinner === ownIndex ? "won-trick" : ""}`}><span><b className="seat-order">1</b><PlayerAvatar player={game.players[ownIndex]} size="tiny" />{game.players[ownIndex].name}{teamRole(ownIndex) && <em>{teamRole(ownIndex) === "contract" ? "Kontraktlag" : "Motlag"}</em>}{ownTurn && <i>{turnLabel}</i>}</span><strong>{game.players[ownIndex].tricks} <small>stikk</small></strong><small className="hand-count">{game.hands[ownIndex].length} kort</small></div>
            <AnimatedHand
              cards={game.hands[ownIndex]}
              selected={props.selected}
              playable={legal}
              canPlay={game.phase === "playing" && ownTurn}
              canSelect={game.phase === "exchange" && ownTurn}
              onPlay={props.onPlay}
              onSelect={props.onSelect}
            />
            {game.phase === "exchange" && ownTurn && <button className="floating-action" disabled={props.selected.length !== 4} onClick={props.onExchange}>Legg bort {props.selected.length}/4</button>}
            {game.phase === "playing" && ownTurn && game.hands[ownIndex].length > 1 && game.hands[ownIndex].length <= 6 && (
              <button
                className={`claim-button ${claimDenied ? "denied" : ""}`}
                onClick={() => {
                  if (props.onClaim()) return;
                  // Kravet står ikke - knappen rister i stedet for å gjøre noe.
                  setClaimDenied(true);
                  window.setTimeout(() => setClaimDenied(false), 500);
                }}
              >
                <b>Resten står</b><small>ta alle stikkene som er igjen</small>
              </button>
            )}
          </div>
        )}

        {showLastTrick && lastTrick && (
          <div className="last-trick-overlay" role="dialog" aria-modal="true" aria-label="Siste stikk">
            <button className="overlay-close" onClick={() => setShowLastTrick(false)} aria-label="Lukk">×</button>
            <p className="eyebrow">Siste stikk</p>
            <h2>{lastWinner !== null ? `${game.players[lastWinner].name} tok stikket` : "Siste stikk"}</h2>
            <div className="last-trick-cards">{lastTrick.map((played) => <div key={played.card.id}><PlayingCard card={played.card} compact /><small>{game.players[played.playerIndex].name}</small></div>)}</div>
          </div>
        )}

        {props.dealing && <DealTransition round={game.round} />}
      </div>
    </section>
  );
}

function DealTransition({ round }: { round: number }) {
  const seats = ["south", "west", "north", "east"] as const;
  return (
    <div className="deal-transition" role="status" aria-label={`Stokker og deler kort til runde ${round}`}>
      <div className="deal-stage" aria-hidden="true">
        <span className="deal-stack" />
        <span className="shuffle-packet shuffle-left" />
        <span className="shuffle-packet shuffle-right" />
        {Array.from({ length: 8 }, (_, index) => (
          <span
            className={`deal-card to-${seats[index % seats.length]}`}
            style={{ "--deal-index": index } as CSSProperties}
            key={index}
          />
        ))}
      </div>
      <p><b>Stokker og deler</b><span>Runde {round}</span></p>
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

function PlayerAvatar({ player, size = "normal" }: { player: GameState["players"][number]; size?: "tiny" | "normal" | "winner" }) {
  const image = avatarPath(player.name);
  return <span className={`player-avatar ${size} ${image ? "illustrated" : ""}`}>{image ? <img src={image} alt="" /> : player.name.slice(0, 1).toUpperCase()}</span>;
}

function AnimatedHand(props: {
  cards: Card[]; selected: string[]; playable: Set<string>; canPlay: boolean; canSelect: boolean;
  onPlay: (id: string) => void; onSelect: (id: string) => void;
}) {
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const previous = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    for (const card of props.cards) {
      const node = nodes.current.get(card.id);
      if (!node) continue;
      const position = node.getBoundingClientRect();
      const old = previous.current.get(card.id);
      if (old) {
        const x = old.left - position.left;
        const y = old.top - position.top;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) {
          node.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: 430, easing: "cubic-bezier(.2,.8,.2,1)" });
        }
      }
      next.set(card.id, position);
    }
    previous.current = next;
  }, [props.cards]);

  return (
    <div className={`hand ${props.cards.length > 12 ? "many-cards" : ""}`} role="list" aria-label="Kortene dine" style={{ "--hand-count": Math.max(props.cards.length, 2) } as CSSProperties}>
      {props.cards.map((card) => {
        const playable = props.canPlay && props.playable.has(card.id);
        return (
          <div className="hand-card-slot" role="listitem" key={card.id} ref={(node) => { if (node) nodes.current.set(card.id, node); else nodes.current.delete(card.id); }}>
            <PlayingCard card={card} selected={props.selected.includes(card.id)} disabled={!playable && !props.canSelect} onClick={playable ? () => props.onPlay(card.id) : props.canSelect ? () => props.onSelect(card.id) : undefined} />
          </div>
        );
      })}
    </div>
  );
}

function sameTeam(game: GameState, first: number, second: number): boolean {
  if (first === second) return true;
  if (!game.partnerRevealed || game.bid === null) return false;
  const contract = new Set([game.bid.playerIndex, ...(game.partnerIndex === null ? [] : [game.partnerIndex])]);
  return contract.has(first) === contract.has(second);
}

function Opponent({ player, count, active, wonTrick, position, order, turnLabel, teamRole }: { player: GameState["players"][number]; count: number; active: boolean; wonTrick: boolean; position: string; order: number; turnLabel: string; teamRole: "contract" | "defense" | null }) {
  return <div className={`opponent ${position} ${active ? "active" : ""} ${wonTrick ? "won-trick" : ""} ${teamRole ? `team-${teamRole}` : ""}`}><b className="seat-order">{order}</b><PlayerAvatar player={player} /><span><b>{player.name}</b>{teamRole && <em>{teamRole === "contract" ? "Kontraktlag" : "Motlag"}</em>}<small>{count} kort igjen</small></span><strong className="trick-count"><b>{player.tricks + (wonTrick ? 1 : 0)}</b><small>stikk</small></strong>{active && <i className="turn-tag">{turnLabel}</i>}</div>;
}

function PlayingCard({ card, compact = false, selected = false, disabled = false, onClick }: { card: Card; compact?: boolean; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  const red = card.suit === "hearts" || card.suit === "diamonds";
  return (
    <button type="button" className={`playing-card ${compact ? "compact" : ""} ${red ? "red" : ""} ${selected ? "selected" : ""}`} disabled={disabled} onClick={onClick} aria-label={cardLabel(card)} aria-pressed={selected}>
      <span>{RANK_NAME[card.rank]}</span><b>{SUIT_SYMBOL[card.suit]}</b>
    </button>
  );
}

function BidControls({ game, onBid }: { game: GameState; onBid: (value: number | "american" | "pass") => void }) {
  return <div className="action-sheet"><div><p className="eyebrow">Din tur</p><h2>Hva byr du?</h2></div><div className="bid-grid">{availableBids(game).filter((v) => v !== "american").map((value) => <button key={value} onClick={() => onBid(value)}>{value}</button>)}</div><button className="american-bid" onClick={() => onBid("american")}><span>★</span> Amerikaneren <small>Ta alle stikk alene</small></button><button className="pass-button" onClick={() => onBid("pass")}>Pass</button></div>;
}

function TrumpControls({ onTrump }: { onTrump: (suit: Suit) => void }) {
  return <div className="action-sheet"><div><p className="eyebrow">Du vant budet</p><h2>Velg trumf</h2><p className="muted">Vi spør automatisk etter det beste kortet du mangler.</p></div><div className="suit-grid">{SUITS.map((suit) => <button className={suit === "hearts" || suit === "diamonds" ? "red" : ""} key={suit} onClick={() => onTrump(suit)}><span>{SUIT_SYMBOL[suit]}</span>{SUIT_NAME[suit]}</button>)}</div></div>;
}

function ScoreSheet({ game, onNext, onRestart, isOnline }: { game: GameState; onNext: () => void; onRestart: () => void; isOnline: boolean }) {
  const bidderIndex = game.bid?.playerIndex ?? -1;
  const team = [bidderIndex, game.partnerIndex].filter((v): v is number => v !== null && v >= 0);
  const history = game.scoreHistory ?? [];
  const latest = history.at(-1);
  const scoreFor = (playerId: string) => latest?.scores.find((score) => score.playerId === playerId);
  const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;
  return (
    <div className="score-sheet score-board">
      <p className="eyebrow">Runde {game.round} er ferdig</p>
      <h2>{game.winnerIndex !== null ? `${game.players[game.winnerIndex].name} vant!` : game.message}</h2>
      <div className="result-columns" aria-hidden="true"><span>Spiller</span><span>Stikk</span><span>Runden</span><span>Totalt</span></div>
      <div className="round-results">
        {game.players.map((player, index) => {
          const result = scoreFor(player.id);
          return <div key={player.id} className={team.includes(index) ? "contract-team" : "defense-team"} style={{ "--score-row": index } as CSSProperties}><span className="result-player"><PlayerAvatar player={player} /><span><b>{player.name}</b><small>{index === bidderIndex ? "Budgiver · doble poeng" : team.includes(index) ? "Makker · kontraktlag" : "Motlaget"}</small></span></span><b className="result-tricks">{player.tricks}<small> stikk</small></b><strong className={(result?.delta ?? 0) >= 0 ? "positive" : "negative"}>{signed(result?.delta ?? 0)}</strong><em>{player.score}<small> p</small></em></div>;
        })}
      </div>
      <div className="history-wrap">
        <small className="history-hint">Dra sidelengs for alle →</small>
        <table className="score-history">
          <thead><tr><th>Runde</th><th>Bud</th>{game.players.map((player) => <th key={player.id}>{player.name}</th>)}</tr></thead>
          <tbody>{history.map((round) => <tr key={round.round}><td>{round.round}</td><td>{round.contract === "american" ? "A" : round.contract}{SUIT_SYMBOL[round.trump]}</td>{game.players.map((player) => { const score = round.scores.find((item) => item.playerId === player.id); return <td className={(score?.delta ?? 0) >= 0 ? "positive" : "negative"} key={player.id}>{signed(score?.delta ?? 0)}</td>; })}</tr>)}</tbody>
          <tfoot><tr><th scope="row">Totalt</th><th aria-hidden="true" />{game.players.map((player) => <th key={player.id}>{player.score}</th>)}</tr></tfoot>
        </table>
      </div>
      <button className="primary-cta score-next" onClick={game.winnerIndex !== null && !isOnline ? onRestart : onNext}>{game.winnerIndex !== null ? "Spill på nytt" : "Neste omgang"}</button>
    </div>
  );
}
