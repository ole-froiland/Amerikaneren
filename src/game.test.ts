import assert from "node:assert/strict";
import test from "node:test";
import { SUITS, botBid, botCard, botDiscard, botTrump, canClaimRest, chooseTrump, claimRest, collectTrick, createDeck, createGame, createPlayers, exchangeCards, inferredVoids, legalCards, placeBid, playCard, shuffle, sortHand, trickWinner } from "./game.ts";
import type { Card, GameState } from "./types.ts";

test("deals 12 cards to four players and four to the pot", () => {
  const game = createGame(createPlayers(), 0, 1, () => 0.5);
  assert.deepEqual(game.hands.map((hand) => hand.length), [12, 12, 12, 12]);
  assert.equal(game.pot.length, 4);
  assert.equal(new Set([...game.hands.flat(), ...game.pot].map((card) => card.id)).size, 52);
});

test("ends bidding after three opponents pass", () => {
  let game = createGame(createPlayers(), 0, 1, () => 0.5);
  game = placeBid(game, 8);
  game = placeBid(game, "pass");
  game = placeBid(game, "pass");
  game = placeBid(game, "pass");
  assert.equal(game.phase, "exchange");
  assert.equal(game.contract, 8);
  assert.equal(game.hands[1].length, 16);
});

test("exchange removes exactly four cards and trump finds the best missing card", () => {
  let game = createGame(createPlayers(), 0, 1, () => 0.5);
  game = placeBid(game, 7);
  game = placeBid(game, "pass");
  game = placeBid(game, "pass");
  game = placeBid(game, "pass");
  game = exchangeCards(game, game.hands[1].slice(0, 4).map((card) => card.id));
  game = chooseTrump(game, "hearts");
  assert.equal(game.hands[1].length, 12);
  assert.equal(game.phase, "playing");
  assert.equal(game.requestedCard?.suit, "hearts");
  assert.ok(!game.hands[1].some((card) => card.id === game.requestedCard?.id));
});

test("following suit is required and trump wins the trick", () => {
  const game = createGame(createPlayers(), 0, 1, () => 0.5);
  const lead: Card = { id: "hearts-10", suit: "hearts", rank: 10 };
  const follow: Card = { id: "hearts-2", suit: "hearts", rank: 2 };
  const trump: Card = { id: "spades-2", suit: "spades", rank: 2 };
  const state = { ...game, phase: "playing" as const, trump: "spades" as const, turn: 1, trick: [{ playerIndex: 0, card: lead }], hands: [[], [follow, trump], [], []] };
  assert.deepEqual(legalCards(state), [follow]);
  assert.equal(trickWinner([{ playerIndex: 0, card: lead }, { playerIndex: 1, card: trump }], "spades"), 1);
});

test("the bidder opens the first trick with trump", () => {
  const game = createGame(createPlayers(), 0, 1, () => 0.5);
  const heart: Card = { id: "hearts-4", suit: "hearts", rank: 4 };
  const spade: Card = { id: "spades-7", suit: "spades", rank: 7 };
  const state = { ...game, phase: "playing" as const, trump: "spades" as const, bid: { playerIndex: 1, value: 7 }, turn: 1, hands: [[], [heart, spade], [], []] };
  assert.deepEqual(legalCards(state), [spade]);
});

test("deck contains every suit and rank once", () => {
  assert.equal(createDeck().length, 52);
  assert.equal(new Set(createDeck().map((card) => card.id)).size, 52);
});

test("reorders remaining suits to keep red and black alternating", () => {
  const cards: Card[] = [
    { id: "diamonds-3", suit: "diamonds", rank: 3 },
    { id: "clubs-4", suit: "clubs", rank: 4 },
    { id: "hearts-5", suit: "hearts", rank: 5 },
  ];
  assert.deepEqual(sortHand(cards).map((card) => card.suit), ["hearts", "clubs", "diamonds"]);
});

test("bidder receives double positive contract points and history keeps the totals", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const trick = [2, 3, 0, 1].map((playerIndex, index) => ({ playerIndex, card: { id: `clubs-${index + 2}`, suit: "clubs" as const, rank: (index + 2) as Card["rank"] } }));
  const scored = collectTrick({
    ...game, phase: "collecting", trump: "spades", bid: { playerIndex: 0, value: 7 }, contract: 7,
    partnerIndex: 1, partnerRevealed: true, pendingWinner: 2, trick, hands: [[], [], [], []],
    players: game.players.map((player, index) => ({ ...player, tricks: [4, 3, 3, 1][index] })),
  });
  assert.deepEqual(scored.players.map((player) => player.score), [14, 7, 4, 1]);
  assert.deepEqual(scored.scoreHistory[0].scores.map((score) => score.delta), [14, 7, 4, 1]);
});

test("bidder receives double negative points when the contract fails", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const trick = [2, 3, 0, 1].map((playerIndex, index) => ({ playerIndex, card: { id: `diamonds-${index + 2}`, suit: "diamonds" as const, rank: (index + 2) as Card["rank"] } }));
  const scored = collectTrick({
    ...game, phase: "collecting", trump: "spades", bid: { playerIndex: 0, value: 7 }, contract: 7,
    partnerIndex: 1, partnerRevealed: true, pendingWinner: 2, trick, hands: [[], [], [], []],
    players: game.players.map((player, index) => ({ ...player, tricks: [4, 2, 3, 2][index] })),
  });
  assert.deepEqual(scored.players.map((player) => player.score), [-14, -7, 4, 2]);
});

test("keeps all four cards visible until the trick is collected", () => {
  let game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const cards: Card[] = [
    { id: "hearts-2", suit: "hearts", rank: 2 },
    { id: "hearts-5", suit: "hearts", rank: 5 },
    { id: "hearts-9", suit: "hearts", rank: 9 },
    { id: "hearts-14", suit: "hearts", rank: 14 },
  ];
  game = { ...game, phase: "playing", trump: "spades", bid: { playerIndex: 0, value: 7 }, contract: 7, turn: 0, hands: cards.map((card) => [card]) };
  for (const card of cards) game = playCard(game, card.id);
  assert.equal(game.phase, "collecting");
  assert.equal(game.trick.length, 4);
  assert.equal(game.completedTricks.length, 0);
  game = collectTrick(game);
  assert.equal(game.phase, "scoring");
  assert.equal(game.trick.length, 0);
  assert.equal(game.completedTricks.length, 1);
});

test("infers a void only from cards everyone has seen", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const state = { ...game, trump: "spades" as const, completedTricks: [[
    { playerIndex: 0, card: { id: "hearts-10", suit: "hearts" as const, rank: 10 as const } },
    { playerIndex: 1, card: { id: "clubs-2", suit: "clubs" as const, rank: 2 as const } },
  ]] };
  assert.equal(inferredVoids(state)[1].has("hearts"), true);
  assert.equal(inferredVoids(state)[0].size, 0);
});

test("bot choice does not change when hidden opponent hands are rearranged", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const own: Card[] = [{ id: "hearts-4", suit: "hearts", rank: 4 }, { id: "hearts-12", suit: "hearts", rank: 12 }];
  const state = { ...game, phase: "playing" as const, trump: "spades" as const, turn: 1, bid: { playerIndex: 0, value: 7 as const }, hands: [game.hands[0], own, game.hands[2], game.hands[3]], trick: [{ playerIndex: 0, card: { id: "hearts-10", suit: "hearts" as const, rank: 10 as const } }] };
  const rearranged = { ...state, hands: [state.hands[3], own, state.hands[0], state.hands[2]], partnerIndex: 3 };
  assert.equal(botCard(state, () => 0.5).id, botCard(rearranged, () => 0.5).id);
});

test("bot saves a high card when its known teammate already wins", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const low: Card = { id: "hearts-3", suit: "hearts", rank: 3 };
  const ace: Card = { id: "hearts-14", suit: "hearts", rank: 14 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 2,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[], [], [low, ace], []],
    trick: [
      { playerIndex: 3, card: { id: "hearts-13", suit: "hearts" as const, rank: 13 as const } },
      { playerIndex: 0, card: { id: "hearts-2", suit: "hearts" as const, rank: 2 as const } },
      { playerIndex: 1, card: { id: "hearts-5", suit: "hearts" as const, rank: 5 as const } },
    ],
  };
  assert.equal(botCard(state).id, low.id);
});

test("bot leads low instead of sacrificing an unsupported high card", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const low: Card = { id: "hearts-2", suit: "hearts", rank: 2 };
  const high: Card = { id: "hearts-10", suit: "hearts", rank: 10 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 0,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[low, high], [], [], []],
    completedTricks: [[
      { playerIndex: 0, card: { id: "clubs-2", suit: "clubs" as const, rank: 2 as const } },
      { playerIndex: 1, card: { id: "clubs-3", suit: "clubs" as const, rank: 3 as const } },
      { playerIndex: 2, card: { id: "clubs-4", suit: "clubs" as const, rank: 4 as const } },
      { playerIndex: 3, card: { id: "clubs-5", suit: "clubs" as const, rank: 5 as const } },
    ]],
  };
  assert.equal(botCard(state, () => 0.5).id, low.id);
});

test("bot leads the top of a connected high-card sequence", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const cards: Card[] = [
    { id: "hearts-3", suit: "hearts", rank: 3 },
    { id: "hearts-11", suit: "hearts", rank: 11 },
    { id: "hearts-12", suit: "hearts", rank: 12 },
  ];
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 0,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [cards, [], [], []],
    completedTricks: [[
      { playerIndex: 0, card: { id: "clubs-2", suit: "clubs" as const, rank: 2 as const } },
      { playerIndex: 1, card: { id: "clubs-3", suit: "clubs" as const, rank: 3 as const } },
      { playerIndex: 2, card: { id: "clubs-4", suit: "clubs" as const, rank: 4 as const } },
      { playerIndex: 3, card: { id: "clubs-5", suit: "clubs" as const, rank: 5 as const } },
    ]],
  };
  assert.equal(botCard(state, () => 0.5).id, "hearts-12");
});

test("contract team stops drawing trump after both opponents show void", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const trump: Card = { id: "spades-2", suit: "spades", rank: 2 };
  const sideCard: Card = { id: "hearts-10", suit: "hearts", rank: 10 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 0,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    requestedCard: { id: "spades-14", suit: "spades" as const, rank: 14 as const },
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[trump, sideCard], [], [], []],
    completedTricks: [[
      { playerIndex: 0, card: { id: "spades-13", suit: "spades" as const, rank: 13 as const } },
      { playerIndex: 1, card: { id: "spades-14", suit: "spades" as const, rank: 14 as const } },
      { playerIndex: 2, card: { id: "clubs-6", suit: "clubs" as const, rank: 6 as const } },
      { playerIndex: 3, card: { id: "diamonds-7", suit: "diamonds" as const, rank: 7 as const } },
    ]],
  };
  assert.equal(botCard(state, () => 0.5).id, sideCard.id);
});

test("contract team leads low from unsupported trumps", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const low: Card = { id: "spades-2", suit: "spades", rank: 2 };
  const high: Card = { id: "spades-10", suit: "spades", rank: 10 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 0,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[low, high], [], [{ id: "hearts-2", suit: "hearts" as const, rank: 2 as const }], [{ id: "clubs-2", suit: "clubs" as const, rank: 2 as const }]],
  };
  assert.equal(botCard(state, () => 0.5).id, low.id);
});

test("bot protects a teammate's vulnerable trick when opponents still play", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const low: Card = { id: "hearts-2", suit: "hearts", rank: 2 };
  const ace: Card = { id: "hearts-14", suit: "hearts", rank: 14 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 1,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[], [low, ace], [], []],
    trick: [{ playerIndex: 0, card: { id: "hearts-10", suit: "hearts" as const, rank: 10 as const } }],
  };
  assert.equal(botCard(state).id, ace.id);
});

test("bot pressures high after a teammate's low lead", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const middle: Card = { id: "hearts-8", suit: "hearts", rank: 8 };
  const king: Card = { id: "hearts-13", suit: "hearts", rank: 13 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 1,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[], [middle, king], [], []],
    trick: [{ playerIndex: 0, card: { id: "hearts-2", suit: "hearts" as const, rank: 2 as const } }],
  };
  assert.equal(botCard(state).id, king.id);
});

test("bot uses the cheaper of equivalent top cards when supporting partner", () => {
  const game = createGame(createPlayers([]), 0, 1, () => 0.5);
  const king: Card = { id: "hearts-13", suit: "hearts", rank: 13 };
  const ace: Card = { id: "hearts-14", suit: "hearts", rank: 14 };
  const state = {
    ...game,
    phase: "playing" as const,
    trump: "spades" as const,
    turn: 1,
    bid: { playerIndex: 0, value: 7 as const },
    contract: 7 as const,
    partnerIndex: 1,
    partnerRevealed: true,
    hands: [[], [king, ace], [], []],
    trick: [{ playerIndex: 0, card: { id: "hearts-2", suit: "hearts" as const, rank: 2 as const } }],
  };
  assert.equal(botCard(state).id, king.id);
});

test("four bots can finish a complete round without getting stuck", () => {
  let game = createGame(createPlayers([]), 0, 1, () => 0.42);
  let actions = 0;
  while (game.phase !== "scoring" && actions < 200) {
    if (game.phase === "bidding") game = placeBid(game, botBid(game, () => 0.42));
    else if (game.phase === "exchange") game = exchangeCards(game, botDiscard(game));
    else if (game.phase === "trump") game = chooseTrump(game, botTrump(game));
    else if (game.phase === "collecting") game = collectTrick(game);
    else game = playCard(game, botCard(game, () => 0.42).id);
    actions += 1;
  }
  assert.equal(game.phase, "scoring");
  assert.equal(game.completedTricks.length, 12);
  assert.equal(game.players.reduce((sum, player) => sum + player.tricks, 0), 12);
});

const claimCard = (suit: Card["suit"], rank: Card["rank"]): Card => ({ id: `${suit}-${rank}`, suit, rank });

function claimState(hands: Card[][], overrides: Partial<GameState> = {}): GameState {
  const game = createGame(createPlayers(), 0, 1, () => 0.5);
  return {
    ...game,
    phase: "playing",
    trump: "spades",
    bid: { playerIndex: 0, value: 7 },
    contract: 7,
    partnerIndex: 2,
    turn: 0,
    trick: [],
    hands,
    completedTricks: [[], [], [], [], [], [], []] as GameState["completedTricks"],
    ...overrides,
  };
}

test("claim stands when every remaining card is a top trump", () => {
  const state = claimState([
    [claimCard("spades", 14), claimCard("spades", 13)],
    [claimCard("spades", 12), claimCard("hearts", 14)],
    [claimCard("spades", 11), claimCard("hearts", 13)],
    [claimCard("clubs", 14), claimCard("clubs", 13)],
  ]);
  assert.equal(canClaimRest(state, 0), true);
});

test("claim fails when an opponent holds a higher trump", () => {
  const state = claimState([
    [claimCard("spades", 13), claimCard("spades", 12)],
    [claimCard("spades", 14), claimCard("hearts", 14)],
    [claimCard("hearts", 13), claimCard("hearts", 12)],
    [claimCard("clubs", 14), claimCard("clubs", 13)],
  ]);
  assert.equal(canClaimRest(state, 0), false);
});

test("claim fails when a side-suit winner can be trumped", () => {
  const state = claimState([
    [claimCard("hearts", 14), claimCard("hearts", 13)],
    [claimCard("spades", 2), claimCard("clubs", 5)],
    [claimCard("hearts", 12), claimCard("hearts", 11)],
    [claimCard("clubs", 14), claimCard("clubs", 13)],
  ]);
  assert.equal(canClaimRest(state, 0), false);
});

test("claim stands on side-suit tops once no opponent holds trump", () => {
  const state = claimState([
    [claimCard("hearts", 14), claimCard("clubs", 14)],
    [claimCard("hearts", 13), claimCard("clubs", 13)],
    [claimCard("hearts", 12), claimCard("clubs", 12)],
    [claimCard("hearts", 11), claimCard("clubs", 11)],
  ]);
  assert.equal(canClaimRest(state, 0), true);
});

test("claim stands when top trumps can draw the outstanding trump first", () => {
  const state = claimState([
    [claimCard("spades", 14), claimCard("spades", 13), claimCard("hearts", 14)],
    [claimCard("spades", 4), claimCard("hearts", 13), claimCard("clubs", 9)],
    [claimCard("hearts", 12), claimCard("clubs", 13), claimCard("clubs", 8)],
    [claimCard("hearts", 11), claimCard("clubs", 12), claimCard("clubs", 7)],
  ]);
  assert.equal(canClaimRest(state, 0), true);
});

test("claim fails when there are more outstanding trumps than top trumps to draw them", () => {
  const state = claimState([
    [claimCard("spades", 14), claimCard("hearts", 14), claimCard("hearts", 13)],
    [claimCard("spades", 4), claimCard("spades", 3), claimCard("clubs", 9)],
    [claimCard("hearts", 12), claimCard("clubs", 13), claimCard("clubs", 8)],
    [claimCard("hearts", 11), claimCard("clubs", 12), claimCard("clubs", 7)],
  ]);
  assert.equal(canClaimRest(state, 0), false);
});

test("claim mid-trick stands only when the current trick cannot be lost", () => {
  const safe = claimState([
    [claimCard("spades", 14), claimCard("spades", 13)],
    [claimCard("spades", 4), claimCard("clubs", 9)],
    [claimCard("spades", 5), claimCard("clubs", 8)],
    [claimCard("clubs", 7)],
  ], { turn: 0, trick: [{ playerIndex: 3, card: claimCard("hearts", 9) }] });
  assert.equal(canClaimRest(safe, 0), true);

  const risky = claimState([
    [claimCard("hearts", 14), claimCard("spades", 13)],
    [claimCard("spades", 4), claimCard("clubs", 9)],
    [claimCard("spades", 5), claimCard("clubs", 8)],
    [claimCard("clubs", 7)],
  ], { turn: 0, trick: [{ playerIndex: 3, card: claimCard("hearts", 9) }] });
  assert.equal(canClaimRest(risky, 0), false);
});

test("claiming plays out every remaining trick for the claimer", () => {
  const state = claimState([
    [claimCard("spades", 14), claimCard("spades", 13)],
    [claimCard("spades", 12), claimCard("hearts", 14)],
    [claimCard("spades", 11), claimCard("hearts", 13)],
    [claimCard("clubs", 14), claimCard("clubs", 13)],
  ]);
  const done = claimRest(state, 0);
  assert.equal(done.players[0].tricks, 2);
  assert.deepEqual(done.players.slice(1).map((player) => player.tricks), [0, 0, 0]);
  assert.deepEqual(done.hands.map((hand) => hand.length), [0, 0, 0, 0]);
  assert.equal(done.phase, "scoring");
});

test("claiming a hand that does not stand changes nothing", () => {
  const state = claimState([
    [claimCard("spades", 13), claimCard("spades", 12)],
    [claimCard("spades", 14), claimCard("hearts", 14)],
    [claimCard("hearts", 13), claimCard("hearts", 12)],
    [claimCard("clubs", 14), claimCard("clubs", 13)],
  ]);
  assert.equal(claimRest(state, 0), state);
});

test("claim is unavailable when it is not your turn or only one card is left", () => {
  const hands = [
    [claimCard("spades", 14), claimCard("spades", 13)],
    [claimCard("spades", 12), claimCard("hearts", 14)],
    [claimCard("spades", 11), claimCard("hearts", 13)],
    [claimCard("clubs", 14), claimCard("clubs", 13)],
  ];
  assert.equal(canClaimRest(claimState(hands, { turn: 1 }), 0), false);
  const single = claimState([
    [claimCard("spades", 14)],
    [claimCard("spades", 12)],
    [claimCard("spades", 11)],
    [claimCard("clubs", 14)],
  ]);
  assert.equal(canClaimRest(single, 0), false);
});

/** Prøver alle lovlige forsvarsrekker og sier fra hvis motstanderne kan ta et eneste stikk. */
function defenceAlwaysLoses(state: GameState, playerIndex: number, sequence: Card[], step = 0): boolean {
  if (state.phase === "collecting") {
    if (state.pendingWinner !== playerIndex) return false;
    return defenceAlwaysLoses(collectTrick(state), playerIndex, sequence, step);
  }
  if (state.phase !== "playing" || state.hands.every((hand) => !hand.length)) return true;
  if (state.turn === playerIndex) {
    return defenceAlwaysLoses(playCard(state, sequence[step].id), playerIndex, sequence, step + 1);
  }
  return legalCards(state).every((option) =>
    defenceAlwaysLoses(playCard(state, option.id), playerIndex, sequence, step));
}

test("a claim that stands cannot be beaten by any defence", () => {
  let seed = 20260827;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let claims = 0;
  for (let deal = 0; deal < 500; deal += 1) {
    const size = 2 + Math.floor(random() * 3);
    const deck = shuffle(createDeck(), random);
    const hands = [0, 1, 2, 3].map((seat) => sortHand(deck.slice(seat * size, seat * size + size)));
    const trump = SUITS[Math.floor(random() * 4)];
    const state = claimState(hands, { trump });
    if (!canClaimRest(state, 0)) continue;
    claims += 1;
    const played = claimRest(state, 0);
    const sequence = played.completedTricks
      .slice(7)
      .flatMap((trick) => trick.filter((entry) => entry.playerIndex === 0).map((entry) => entry.card));
    assert.equal(sequence.length, size, "kravet må spille ut hele hånden");
    assert.ok(defenceAlwaysLoses(state, 0, sequence), `forsvaret kunne ta et stikk med trumf ${trump}`);
  }
  assert.ok(claims >= 10, `for få krav å teste (${claims})`);
});
