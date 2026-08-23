import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createRoom, getRoom, joinRoom, saveRoomGame } from "./api.ts";
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
  cardLabel,
  chooseTrump,
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
import type { Card, GameState, Room, Suit } from "./types.ts";

type Screen = "home" | "solo" | "online" | "lobby" | "game" | "rules";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [game, setGame] = useState<GameState | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const roomCode = room?.code;

  const ownIndex = useMemo(() => {
    if (!game) return 0;
    if (!room) return 0;
    const index = game.players.findIndex((player) => player.id === playerId);
    return index >= 0 ? index : 0;
  }, [game, playerId, room]);

  const commitGame = (next: GameState) => {
    setGame(next);
    setSelected([]);
    if (room && playerId) {
      void saveRoomGame(room.code, playerId, next)
        .then(setRoom)
        .catch((reason: Error) => setError(reason.message));
    }
  };

  useEffect(() => {
    if (!roomCode || screen !== "lobby" && screen !== "game") return;
    const timer = window.setInterval(() => {
      void getRoom(roomCode).then((fresh) => {
        setRoom(fresh);
        if (fresh.game) {
          setGame(fresh.game);
          setScreen("game");
        }
      }).catch(() => undefined);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [roomCode, screen]);

  useEffect(() => {
    if (!game || game.phase !== "collecting") return;
    const timer = window.setTimeout(() => commitGame(collectTrick(game)), 3400);
    return () => window.clearTimeout(timer);
    // collecting is a timed state-machine transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  useEffect(() => {
    if (!game || game.phase === "scoring" || !game.players[game.turn]?.isBot) return;
    const timer = window.setTimeout(() => {
      if (game.phase === "bidding") commitGame(placeBid(game, botBid(game)));
      if (game.phase === "exchange") commitGame(exchangeCards(game, botDiscard(game)));
      if (game.phase === "trump") commitGame(chooseTrump(game, botTrump(game)));
      if (game.phase === "playing") commitGame(playCard(game, botCard(game).id));
    }, game.phase === "playing" ? 1500 : 850);
    return () => window.clearTimeout(timer);
    // game is intentionally the state-machine trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  const startSolo = () => {
    setRoom(null);
    setGame(createGame(createPlayers([name.trim() || "Du"])));
    setScreen("game");
  };

  const handleCreate = async () => {
    setBusy(true); setError("");
    try {
      const result = await createRoom(name);
      setRoom(result.room); setPlayerId(result.playerId); setScreen("lobby");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const handleJoin = async () => {
    setBusy(true); setError("");
    try {
      const result = await joinRoom(code, name);
      setRoom(result.room); setPlayerId(result.playerId); setScreen("lobby");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const startRoomGame = () => {
    if (!room || room.players.length < 2) return;
    const players = createPlayers(room.players.map((player) => player.name)).map((player, index) => ({
      ...player,
      id: room.players[index]?.id ?? player.id,
    }));
    commitGame(createGame(players));
    setScreen("game");
  };

  const leave = () => {
    setGame(null); setRoom(null); setPlayerId(""); setSelected([]); setError(""); setScreen("home");
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

      {screen === "home" && <Home onSolo={() => setScreen("solo")} onOnline={() => setScreen("online")} onRules={() => setScreen("rules")} />}
      {screen === "solo" && <SoloSetup name={name} onName={setName} onStart={startSolo} />}
      {screen === "online" && (
        <OnlineSetup
          name={name} code={code} busy={busy} error={error}
          onName={setName} onCode={setCode} onCreate={handleCreate} onJoin={handleJoin}
        />
      )}
      {screen === "lobby" && room && <Lobby room={room} playerId={playerId} onStart={startRoomGame} />}
      {screen === "rules" && <Rules onPlay={startSolo} />}
      {screen === "game" && game && (
        <GameTable
          game={game}
          ownIndex={ownIndex}
          selected={selected}
          isOnline={Boolean(room)}
          roomCode={room?.code}
          onSelect={(id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current)}
          onBid={(value) => commitGame(placeBid(game, value))}
          onExchange={() => commitGame(exchangeCards(game, selected))}
          onTrump={(suit) => commitGame(chooseTrump(game, suit))}
          onPlay={(id) => commitGame(playCard(game, id))}
          onNext={() => commitGame(nextRound(game))}
          onRestart={room
            ? () => commitGame(createGame(game.players.map((player) => ({ ...player, score: 0, tricks: 0 }))))
            : startSolo}
        />
      )}
      <div className="sr-status" role="status" aria-live="polite">{error}</div>
    </main>
  );
}

function Home({ onSolo, onOnline, onRules }: { onSolo: () => void; onOnline: () => void; onRules: () => void }) {
  return (
    <section className="home-screen">
      <div className="hero-copy">
        <p className="eyebrow">Det klassiske stikkspillet</p>
        <h1>Fire rundt bordet.<br /><em>Ett bud på seier.</em></h1>
        <p className="intro">By, finn makkeren din og spill dere til 52 poeng. Enkelt å starte. Vanskelig å legge fra seg.</p>
        <div className="home-actions">
          <button className="primary-button" onClick={onSolo}><span className="button-icon">♠</span><span>Spill alene<small>mot tre smarte bots</small></span><b>→</b></button>
          <button className="secondary-button" onClick={onOnline}><span className="button-icon">♣</span><span>Spill med venner<small>opprett eller bli med i rom</small></span><b>→</b></button>
        </div>
        <button className="rules-link" onClick={onRules}>Hvordan spiller man?</button>
      </div>
      <div className="card-fan" aria-hidden="true">
        <div className="hero-card card-one"><span>A</span><span>♠</span></div>
        <div className="hero-card card-two red"><span>K</span><span>♥</span></div>
        <div className="hero-card card-three"><span>Q</span><span>♣</span></div>
      </div>
      <p className="home-note">12 kort · 4 i potten · Først til 52</p>
    </section>
  );
}

function SoloSetup({ name, onName, onStart }: { name: string; onName: (value: string) => void; onStart: () => void }) {
  return (
    <section className="panel setup-panel solo-panel">
      <p className="eyebrow">Spill mot bots</p>
      <h1>Hva heter du?</h1>
      <p className="muted">Du møter Trump, Putin og Kim Jong-un rundt bordet.</p>
      <label>Navnet ditt<input value={name} onChange={(event) => onName(event.target.value)} maxLength={18} placeholder="For eksempel Ole" autoComplete="nickname" /></label>
      <button className="primary-cta" onClick={onStart}>Sett deg ved bordet</button>
    </section>
  );
}

function OnlineSetup(props: { name: string; code: string; busy: boolean; error: string; onName: (v: string) => void; onCode: (v: string) => void; onCreate: () => void; onJoin: () => void }) {
  return (
    <section className="panel setup-panel">
      <p className="eyebrow">Spill med venner</p>
      <h1>Samle bordet</h1>
      <p className="muted">Alle åpner appen på sin mobil. Én lager rommet, resten skriver inn koden.</p>
      <label>Navnet ditt<input value={props.name} onChange={(e) => props.onName(e.target.value)} maxLength={18} placeholder="For eksempel Ole" autoComplete="nickname" /></label>
      <button className="primary-cta" disabled={props.busy || !props.name.trim()} onClick={props.onCreate}>Lag nytt rom</button>
      <div className="divider"><span>eller</span></div>
      <label>Romkode<input className="code-input" value={props.code} onChange={(e) => props.onCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))} maxLength={5} placeholder="AB123" autoCapitalize="characters" /></label>
      <button className="outline-cta" disabled={props.busy || props.code.length !== 5 || !props.name.trim()} onClick={props.onJoin}>Bli med</button>
      {props.error && <p className="error-message">{props.error}</p>}
    </section>
  );
}

function Lobby({ room, playerId, onStart }: { room: Room; playerId: string; onStart: () => void }) {
  const isHost = room.hostId === playerId;
  return (
    <section className="panel lobby-panel">
      <p className="eyebrow">Rommet er klart</p>
      <h1 className="room-code">{room.code}</h1>
      <button className="copy-button" onClick={() => void navigator.clipboard?.writeText(room.code)}>Kopier kode</button>
      <p className="muted">Del koden med de du vil spille med.</p>
      <div className="player-list">
        {room.players.map((player, index) => <div className="lobby-player" key={player.id}><span>{index + 1}</span><b>{player.name}</b>{player.id === room.hostId && <small>Vert</small>}<i>✓</i></div>)}
        {Array.from({ length: 4 - room.players.length }, (_, i) => <div className="lobby-player empty" key={i}><span>{room.players.length + i + 1}</span><b>Venter…</b></div>)}
      </div>
      {isHost ? (
        <><button className="primary-cta" disabled={room.players.length < 2} onClick={onStart}>Start spill</button><p className="tiny">Ledige plasser fylles av bots.</p></>
      ) : <p className="waiting"><span /> Venter på at verten starter</p>}
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
  game: GameState; ownIndex: number; selected: string[]; isOnline: boolean; roomCode?: string;
  onSelect: (id: string) => void; onBid: (value: number | "american" | "pass") => void; onExchange: () => void;
  onTrump: (suit: Suit) => void; onPlay: (id: string) => void; onNext: () => void; onRestart: () => void;
}) {
  const { game, ownIndex } = props;
  const [showLastTrick, setShowLastTrick] = useState(false);
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

  return (
    <section className="game-screen">
      <div className="score-strip">
        <span>Runde {game.round}</span>
        {game.players.map((player, index) => <div key={player.id} className={`${index === ownIndex ? "you" : ""} ${teammate(index) ? "same-team" : ""} ${teamRole(index) ? `team-${teamRole(index)}` : ""}`}><PlayerAvatar player={player} size="tiny" /><span>{player.name}<small>{player.score} p {teamRole(index) && `· ${teamRole(index) === "contract" ? "Budlag" : "Motlag"}`}</small></span></div>)}
        {props.roomCode && <b className="mini-code">{props.roomCode}</b>}
      </div>

      <div className={`felt-table ${game.phase === "collecting" && winnerSeat ? `collecting winner-${winnerSeat}` : ""}`}>
        <div className="play-direction" aria-label="Spillerekkefølge med klokken"><span>1</span> → <span>2</span> → <span>3</span> → <span>4</span> ↻</div>
        <Opponent player={game.players[relative(2)]} count={game.hands[relative(2)].length} active={game.turn === relative(2)} wonTrick={game.pendingWinner === relative(2)} position="north" order={3} turnLabel={turnLabel} teamRole={teamRole(relative(2))} />
        <Opponent player={game.players[relative(1)]} count={game.hands[relative(1)].length} active={game.turn === relative(1)} wonTrick={game.pendingWinner === relative(1)} position="west" order={2} turnLabel={turnLabel} teamRole={teamRole(relative(1))} />
        <Opponent player={game.players[relative(3)]} count={game.hands[relative(3)].length} active={game.turn === relative(3)} wonTrick={game.pendingWinner === relative(3)} position="east" order={4} turnLabel={turnLabel} teamRole={teamRole(relative(3))} />

        <div className="contract-pill">
          {game.trump ? <span className={game.trump === "hearts" || game.trump === "diamonds" ? "red" : ""}>{SUIT_SYMBOL[game.trump]} {typeof game.contract === "number" ? game.contract : "A"}</span> : game.bid ? bidLabel(game.bid.value) : "Budrunde"}
          {bidder && <small>{bidder.name}</small>}
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
          {!game.trick.length && game.phase === "playing" && <span className="lead-hint">{ownTurn ? "Din tur – spill ut" : `${game.players[game.turn].name} tenker…`}</span>}
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
          {game.partnerRevealed && game.partnerIndex !== null && game.bid && <b>Kontraktlag: {game.players[game.bid.playerIndex].name} + {game.players[game.partnerIndex].name}</b>}
          <span>{game.message}</span>
        </div>

        {game.phase === "bidding" && ownTurn && <BidControls game={game} onBid={props.onBid} />}
        {game.phase === "trump" && ownTurn && <TrumpControls onTrump={props.onTrump} />}
        {game.phase === "scoring" && <ScoreSheet game={game} onNext={props.onNext} onRestart={props.onRestart} isOnline={props.isOnline} />}

        {game.phase !== "scoring" && (
          <div className="hand-zone">
            <div className={`hand-meta ${game.pendingWinner === ownIndex ? "won-trick" : ""}`}><span><b className="seat-order">1</b><PlayerAvatar player={game.players[ownIndex]} size="tiny" />{game.players[ownIndex].name}{teamRole(ownIndex) && <em>{teamRole(ownIndex) === "contract" ? "Kontraktlag" : "Motlag"}</em>}{ownTurn && <i>{turnLabel}</i>}</span><strong>{game.players[ownIndex].tricks} <small>stikk</small></strong><small>{game.hands[ownIndex].length} kort</small></div>
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
      </div>
    </section>
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
    <div className="hand" role="list" aria-label="Kortene dine">
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
          <tfoot><tr><th colSpan={2}>Totalt</th>{game.players.map((player) => <th key={player.id}>{player.score}</th>)}</tr></tfoot>
        </table>
      </div>
      <button className="primary-cta score-next" onClick={game.winnerIndex !== null && !isOnline ? onRestart : onNext}>{game.winnerIndex !== null ? "Spill på nytt" : "Neste omgang"}</button>
    </div>
  );
}
