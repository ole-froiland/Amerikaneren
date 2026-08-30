import assert from "node:assert/strict";
import test from "node:test";
import {
  BIG_BLIND,
  coachReview,
  coachSummary,
  DIFFICULTY,
  equity,
  SMALL_BLIND,
  START_CHIPS,
  act,
  badgeFor,
  botAction,
  buildPots,
  compareScore,
  createPokerGame,
  createPokerPlayers,
  evaluate,
  legalActions,
  startHand,
  totalPot,
} from "./poker.ts";
import type { DecisionRecord, PokerPlayer, PokerState } from "./poker.ts";
import type { Card, Rank, Suit } from "./types.ts";

/** «AsKhQdJcTh» → fem kort. Gjør testene lesbare. */
function hand(text: string): Card[] {
  const ranks: Record<string, Rank> = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
    T: 10, J: 11, Q: 12, K: 13, A: 14,
  };
  const suits: Record<string, Suit> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  return text.match(/../g)!.map(([rank, suit]) => ({ id: `${suits[suit]}-${ranks[rank]}`, rank: ranks[rank], suit: suits[suit] }));
}

const stable = () => 0.5;

test("rangerer de klassiske hendene i riktig rekkefølge", () => {
  const order = [
    "AsKsQsJsTs", // royal flush
    "9h8h7h6h5h", // straight flush
    "7c7d7h7s2c", // fire like
    "KcKdKhQcQd", // fullt hus
    "As9s7s4s2s", // flush
    "9c8d7h6s5c", // straight
    "5c5d5hKsQd", // tre like
    "JcJd4h4sAc", // to par
    "AcAd9h5s2c", // par
    "AcKd9h5s2c", // høyt kort
  ].map((text) => evaluate(hand(text)));

  for (let i = 0; i + 1 < order.length; i += 1) {
    assert.ok(
      compareScore(order[i].score, order[i + 1].score) > 0,
      `${order[i].label} skal slå ${order[i + 1].label}`,
    );
  }
  assert.equal(order[0].label, "Royal flush");
  assert.equal(order[3].label, "Fullt hus, konger over damer");
  assert.equal(order[7].label, "To par, knekter og firere med ess");
  assert.equal(order[8].label, "Par i ess med ni");
});

test("finner beste femkortshånd blant sju kort", () => {
  const value = evaluate(hand("AhKh" + "QhJhTh" + "2c3d"));
  assert.equal(value.label, "Royal flush");
  assert.equal(value.best.length, 5);
});

test("ess teller som ener i den minste straighten", () => {
  const wheel = evaluate(hand("Ac2d3h4s5c"));
  assert.equal(wheel.label, "Straight til fem");
  assert.ok(compareScore(evaluate(hand("2c3d4h5s6c")).score, wheel.score) > 0);
});

test("deler ut to kort hver og legger begge blindene", () => {
  const game = createPokerGame(createPokerPlayers("Ole", 3), "middels", stable);
  assert.equal(game.players.length, 4);
  assert.ok(game.players.every((player) => player.cards.length === 2));
  assert.equal(new Set(game.players.flatMap((p) => p.cards).map((card) => card.id)).size, 8);
  assert.equal(totalPot(game), SMALL_BLIND + BIG_BLIND);
  assert.equal(game.currentBet, BIG_BLIND);
  assert.equal(game.board.length, 0);
});

test("de tre knappene ligger på hvert sitt sete og flytter seg med hånden", () => {
  const game = createPokerGame(createPokerPlayers("Ole", 3), "middels", stable);
  const badges = game.players.map((_, index) => badgeFor(game, index));
  assert.deepEqual([...badges].sort(), ["big", "dealer", "small", null].sort());

  const next = startHand({ ...game, handOver: true }, stable);
  assert.equal(next.button, (game.button + 1) % game.players.length);
});

test("storeblind får siste ord når alle bare syner", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 3), "middels", stable);
  const big = game.players.findIndex((_, index) => badgeFor(game, index) === "big");
  game = act(game, { type: "call" });
  game = act(game, { type: "call" });
  game = act(game, { type: "call" });
  assert.equal(game.street, "preflop", "budrunden skal ikke være over før storeblind har svart");
  assert.equal(game.turn, big);
  game = act(game, { type: "check" });
  assert.equal(game.street, "flop");
  assert.equal(game.board.length, 3);
});

test("flop, turn og river kommer med tre, ett og ett kort", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 1), "middels", stable);
  const streets: Array<[string, number]> = [];
  let guard = 0;
  while (!game.handOver && guard < 40) {
    game = act(game, legalActions(game).canCheck ? { type: "check" } : { type: "call" });
    streets.push([game.street, game.board.length]);
    guard += 1;
  }
  assert.deepEqual(
    [...new Map(streets).entries()].filter(([street]) => street !== "preflop"),
    [["flop", 3], ["turn", 4], ["river", 5], ["showdown", 5]],
  );
});

test("en høyning åpner budrunden på nytt for de andre", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  const first = game.turn;
  game = act(game, { type: "raise", amount: 60 });
  assert.equal(game.currentBet, 60);
  assert.notEqual(game.turn, first);
  assert.ok(game.players.filter((p) => !p.folded).every((p) => p.acted === (p === game.players[first])));
});

test("under minstehøyningen er ikke lov, men all-in er", () => {
  const game = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  const tiny = act(game, { type: "raise", amount: game.currentBet + 1 });
  assert.equal(tiny.currentBet, game.currentBet + game.minRaise, "for lav høyning løftes til minstehøyningen");

  const short: PokerState = {
    ...game,
    players: game.players.map((player, index) => index === game.turn ? { ...player, chips: 15 } : player),
  };
  const allIn = act(short, { type: "raise", amount: 999 });
  assert.equal(allIn.players[game.turn].chips, 0);
  assert.ok(allIn.players[game.turn].allIn);
});

test("potten går til den siste som står igjen når alle kaster seg", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  const pot = totalPot(game);
  game = act(game, { type: "fold" });
  game = act(game, { type: "fold" });
  assert.ok(game.handOver);
  const winner = game.players.find((player) => !player.folded)!;
  assert.equal(game.showdown?.[0].playerId, winner.id);
  assert.equal(game.showdown?.[0].won, pot);
  assert.ok(game.showdown?.[0].mucked, "vinneren trenger ikke vise kortene");
  assert.equal(game.players.reduce((sum, player) => sum + player.chips, 0), START_CHIPS * 3);
});

test("sidepott: en kort all-in kan bare vinne det han var med på", () => {
  const players: PokerPlayer[] = [
    { id: "kort", name: "Kort", isBot: false, chips: 0, bet: 0, committed: 50, cards: [], folded: false, allIn: true, acted: true, lastAction: null, out: false },
    { id: "midt", name: "Midt", isBot: true, chips: 0, bet: 0, committed: 200, cards: [], folded: false, allIn: true, acted: true, lastAction: null, out: false },
    { id: "dyp", name: "Dyp", isBot: true, chips: 100, bet: 0, committed: 200, cards: [], folded: false, allIn: false, acted: true, lastAction: null, out: false },
    { id: "kastet", name: "Kastet", isBot: true, chips: 300, bet: 0, committed: 20, cards: [], folded: true, allIn: false, acted: true, lastAction: null, out: false },
  ];
  const pots = buildPots(players);
  assert.equal(pots.reduce((sum, pot) => sum + pot.amount, 0), 470);
  assert.deepEqual(pots[0], { amount: 170, eligible: ["kort", "midt", "dyp"] });
  assert.deepEqual(pots[1], { amount: 300, eligible: ["midt", "dyp"] });
});

test("beste hånd vinner hovedpotten, nest best tar sidepotten", () => {
  const base = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  const board = hand("AhKd9c4s2h");
  const players: PokerPlayer[] = [
    { ...base.players[0], id: "liten", chips: 0, bet: 0, committed: 100, cards: hand("AsAd"), folded: false, allIn: true, acted: true },
    { ...base.players[1], id: "stor", chips: 0, bet: 0, committed: 400, cards: hand("KsKh"), folded: false, allIn: true, acted: true },
    { ...base.players[2], id: "tredje", chips: 0, bet: 0, committed: 400, cards: hand("9s9h"), folded: false, allIn: true, acted: true },
  ];
  const river: PokerState = { ...base, players, board, street: "river", currentBet: 0, deck: [] };
  // Alle er all-in, så neste handling avslutter hånden.
  const done = act({ ...river, turn: 0, players: players.map((p) => ({ ...p, allIn: false, chips: 10 })) }, { type: "check" });

  const won = (id: string) => done.showdown!.find((entry) => entry.playerId === id)!.won;
  assert.ok(done.handOver);
  assert.ok(won("liten") > 0, "tre ess vinner hovedpotten");
  assert.ok(won("stor") > won("liten"), "tre konger tar den store sidepotten");
  assert.equal(won("tredje"), 0);
});

test("sjetongene forsvinner ikke gjennom en hel hånd", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 4), "middels", () => 0.42);
  const total = () => game.players.reduce((sum, player) => sum + player.chips, 0) + totalPot(game);
  const start = total();
  let guard = 0;
  while (!game.handOver && guard < 60) {
    game = act(game, botAction(game, () => 0.42));
    guard += 1;
  }
  assert.ok(game.handOver, "hånden må ta slutt");
  assert.equal(game.players.reduce((sum, player) => sum + player.chips, 0), start);
  assert.equal(start, START_CHIPS * 5);
});

test("botene spiller hånd etter hånd uten å låse seg", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 3), "middels", Math.random);
  for (let round = 0; round < 30 && !game.winnerId; round += 1) {
    let guard = 0;
    while (!game.handOver && guard < 200) {
      game = act(game, botAction(game));
      guard += 1;
    }
    assert.ok(game.handOver, `hånd ${round + 1} stoppet aldri`);
    assert.equal(game.players.reduce((sum, player) => sum + player.chips, 0), START_CHIPS * 4);
    if (game.winnerId) break;
    game = startHand(game);
  }
});


test("vinnersjansen treffer kjente pokertall", () => {
  const sjanse = (kort: string, motstandere: number) => equity(hand(kort), [], motstandere, 4000);
  // Fasit fra standard oddstabeller, med romslig margin for tilfeldig variasjon.
  assert.ok(Math.abs(sjanse("AsAh", 1) - 0.85) < 0.03, "ess mot én skal ligge rundt 85 %");
  assert.ok(Math.abs(sjanse("KsKh", 1) - 0.82) < 0.03, "konger mot én skal ligge rundt 82 %");
  assert.ok(Math.abs(sjanse("7s2h", 1) - 0.35) < 0.04, "sju-to skal ligge rundt 35 %");
  assert.ok(Math.abs(sjanse("AsAh", 5) - 0.49) < 0.04, "ess mot fem skal falle til rundt 49 %");
});

test("vinnersjansen er 100 prosent når hånden ikke kan slås", () => {
  // Royal flush på bordet vi selv sitter med: ingen kan ta den fra oss.
  assert.equal(equity(hand("AsKs"), hand("QsJsTs"), 3, 200), 1);
});

test("vinnersjansen synker med flere motstandere", () => {
  const en = equity(hand("AhKd"), [], 1, 3000);
  const fire = equity(hand("AhKd"), [], 4, 3000);
  assert.ok(en > fire, `${en} skal være større enn ${fire}`);
});

test("lette bots syner billig, vanskelige legger ned det samme", () => {
  const base = createPokerGame(createPokerPlayers("Ole", 1), "middels", stable);
  // Boten sitter med sju-to på et bord uten hjelp, og skal syne 20 i en pott på 200.
  const spot = (difficulty: "lett" | "vanskelig"): PokerState => ({
    ...base,
    difficulty,
    board: hand("AhKdQc"),
    street: "flop",
    turn: 1,
    currentBet: 20,
    players: base.players.map((player, index) => index === 1
      ? { ...player, cards: hand("7s2d"), chips: 1000, bet: 0, committed: 90, isBot: true }
      : { ...player, chips: 1000, bet: 20, committed: 110 }),
  });

  assert.equal(botAction(spot("lett"), () => 0.5).type, "call");
  assert.equal(botAction(spot("vanskelig"), () => 0.5).type, "fold");
});

test("vanskelige bots legger ned og presser mer enn lette", () => {
  // Andeler, ikke totaler: harde bots avslutter hender raskere og tar derfor
  // færre avgjørelser til sammen.
  const andeler = (difficulty: "lett" | "vanskelig") => {
    const teller: Record<string, number> = { fold: 0, check: 0, call: 0, raise: 0 };
    for (let bord = 0; bord < 4; bord += 1) {
      let game = createPokerGame(createPokerPlayers("Ole", 3), difficulty);
      for (let runde = 0; runde < 30 && !game.winnerId; runde += 1) {
        let guard = 0;
        while (!game.handOver && guard < 200) {
          const move = botAction(game);
          teller[move.type] += 1;
          game = act(game, move);
          guard += 1;
        }
        if (game.winnerId) break;
        game = startHand(game);
      }
    }
    const sum = Object.values(teller).reduce((a, b) => a + b, 0);
    return { fold: teller.fold / sum, raise: teller.raise / sum };
  };

  const lett = andeler("lett");
  const vanskelig = andeler("vanskelig");
  assert.ok(vanskelig.fold > lett.fold * 2, `vanskelig kaster ${vanskelig.fold} mot lett ${lett.fold}`);
  assert.ok(vanskelig.raise > lett.raise, `vanskelig høyner ${vanskelig.raise} mot lett ${lett.raise}`);
});

test("profilene skiller seg fra hverandre i riktig retning", () => {
  assert.ok(DIFFICULTY.lett.noise > DIFFICULTY.vanskelig.noise, "lette bots feilvurderer mer");
  assert.ok(DIFFICULTY.lett.callMargin < DIFFICULTY.vanskelig.callMargin, "lette bots syner for mye");
  assert.ok(DIFFICULTY.vanskelig.raiseAt < DIFFICULTY.lett.raiseAt, "vanskelige bots høyner på svakere hender");
});


test("kastede hender regnes ut i ettertid, men kan ikke vinne noe", () => {
  const base = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  const board = hand("AhKd9c4s2h");
  const players: PokerPlayer[] = [
    // Kastet seg med det som ville vært den klart beste hånden.
    { ...base.players[0], id: "angrer", chips: 500, bet: 0, committed: 20, cards: hand("AsAd"), folded: true, allIn: false, acted: true },
    { ...base.players[1], id: "vinner", chips: 0, bet: 0, committed: 200, cards: hand("KsKh"), folded: false, allIn: false, acted: true },
    { ...base.players[2], id: "taper", chips: 0, bet: 0, committed: 200, cards: hand("9s9h"), folded: false, allIn: false, acted: true },
  ];
  const river: PokerState = { ...base, players, board, street: "river", currentBet: 0, deck: [], turn: 1 };
  const done = act(river, { type: "check" });

  const finn = (id: string) => done.showdown!.find((entry) => entry.playerId === id)!;
  assert.ok(done.handOver);
  assert.equal(finn("angrer").folded, true);
  assert.equal(finn("angrer").won, 0, "den som kastet seg får ingenting");
  assert.equal(finn("angrer").label, "Tre ess", "hånden regnes likevel ut");
  // Den kastede hånden var best av alle – det er nettopp det man vil få se.
  assert.ok(compareScore(finn("angrer").score, finn("vinner").score) > 0);
  assert.equal(finn("vinner").won, 420, "potten går til den beste som faktisk var med");
});

test("kastede hender vises ikke når bordet aldri ble ferdig", () => {
  let game = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  game = act(game, { type: "fold" });
  game = act(game, { type: "fold" });
  assert.ok(game.handOver);
  assert.equal(game.board.length, 0);
  assert.ok(!game.showdown!.some((entry) => entry.folded), "uten fem kort på bordet finnes ikke fasiten");
});


test("bordet rakk å bli ferdig selv om alle kastet seg – da finnes fasiten likevel", () => {
  const base = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  const board = hand("AhKd9c4s2h");
  const players: PokerPlayer[] = [
    { ...base.players[0], id: "kastet", chips: 900, bet: 0, committed: 100, cards: hand("AsAd"), folded: true, acted: true },
    { ...base.players[1], id: "tok-potten", chips: 900, bet: 0, committed: 100, cards: hand("7c2d"), folded: false, acted: true },
    { ...base.players[2], id: "kastet-og", chips: 900, bet: 0, committed: 100, cards: hand("KsKh"), folded: true, acted: true },
  ];
  const river: PokerState = { ...base, players, board, street: "river", currentBet: 0, deck: [], turn: 1 };
  const done = act(river, { type: "check" });

  const finn = (id: string) => done.showdown!.find((entry) => entry.playerId === id)!;
  assert.equal(finn("tok-potten").mucked, true, "vinneren viser ikke kortene");
  assert.equal(finn("kastet").label, "Tre ess", "den som kastet seg får likevel se hva hånden var");
  assert.equal(finn("kastet-og").label, "Tre konger");
  assert.equal(finn("kastet").won + finn("kastet-og").won, 0);
});


/** Fast tallgenerator, så to gjennomganger av samme situasjon gir samme sjanse. */
function fastRandom(seed: number) {
  let state = seed;
  return () => {
    state |= 0; state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bygger en tilstand som bare inneholder trekkene coachen skal vurdere. */
function medTrekk(trekk: Partial<DecisionRecord>[]): PokerState {
  const base = createPokerGame(createPokerPlayers("Ole", 1), "middels", stable);
  const id = base.players[0].id;
  return {
    ...base,
    review: trekk.map((t) => ({
      playerId: id, street: "preflop", action: "call", paid: 0, toCall: 0,
      pot: 100, opponents: 1, hole: hand("AsAh"), board: [], ...t,
    }) as DecisionRecord),
  };
}

test("coachen dømmer etter prisen, ikke etter hvordan det gikk", () => {
  // En all-in med elendig hånd mot fem. Den skal kalles en tabbe uansett utfall.
  const dumdristig = medTrekk([{
    action: "raise", paid: 900, toCall: 20, pot: 60, opponents: 5, hole: hand("7s2d"),
  }]);

  const vant: PokerState = { ...dumdristig, players: dumdristig.players.map((p, i) => i === 0 ? { ...p, chips: 5000 } : p) };
  const tapte: PokerState = { ...dumdristig, players: dumdristig.players.map((p, i) => i === 0 ? { ...p, chips: 0 } : p) };
  const id = dumdristig.players[0].id;

  const etterSeier = coachReview(vant, id, 1500);
  const etterTap = coachReview(tapte, id, 1500);

  assert.equal(etterSeier[0].verdict, "tabbe", "å treffe gjør ikke valget riktig");
  assert.equal(etterTap[0].verdict, "tabbe");
  assert.equal(etterSeier[0].verdict, etterTap[0].verdict, "utfallet skal ikke påvirke dommen");
  assert.ok(etterSeier[0].chance < 0.2, "sjansen var lav i det øyeblikket");
  assert.ok(/flaks/.test(etterSeier[0].detail), "coachen skal si at det var flaks, ikke ros det");
});

test("et riktig priset syn er riktig selv om du taper det", () => {
  const state = medTrekk([{ action: "call", paid: 20, toCall: 20, pot: 200, opponents: 1, hole: hand("AsAh") }]);
  const note = coachReview(state, state.players[0].id, 1500)[0];
  assert.equal(note.verdict, "bra");
  assert.ok(note.chance > note.needed, `${note.chance} skal være over ${note.needed}`);
  // Beløpene må stå der – uten dem er prosentene bare tall i lufta.
  assert.ok(note.detail.includes("20 for å være med i en pott på 220"), note.detail);
});

test("coachen fanger opp at du kastet en hånd du hadde råd til å se", () => {
  const state = medTrekk([{ action: "fold", paid: 0, toCall: 20, pot: 400, opponents: 1, hole: hand("AsAh") }]);
  const note = coachReview(state, state.players[0].id, 1500)[0];
  assert.equal(note.verdict, "tabbe");
  assert.equal(note.headline, "Du kastet en hånd du hadde råd til å se");
});

test("coachen godkjenner et kast når prisen var for høy", () => {
  const state = medTrekk([{ action: "fold", paid: 0, toCall: 500, pot: 100, opponents: 3, hole: hand("7s2d") }]);
  const note = coachReview(state, state.players[0].id, 1500)[0];
  assert.equal(note.verdict, "bra");
  assert.ok(note.needed > note.chance);
});

test("coachen sier fra når en sterk hånd ble sjekket bort", () => {
  const state = medTrekk([{ action: "check", paid: 0, toCall: 0, pot: 200, opponents: 1, hole: hand("AsAh"), board: hand("AdKc7h") }]);
  const note = coachReview(state, state.players[0].id, 1500)[0];
  assert.equal(note.verdict, "greit");
  assert.equal(note.headline, "Her kunne du satset");
});

test("coachen ser bare på dine egne trekk", () => {
  const base = createPokerGame(createPokerPlayers("Ole", 2), "middels", stable);
  let game = base;
  let guard = 0;
  while (!game.handOver && guard < 60) {
    const før = game.turn;
    game = act(game, botAction(game));
    if (før === 0) break;
    guard += 1;
  }
  assert.ok(game.review.every((r) => r.playerId === base.players[0].id), "bare menneskets trekk lagres");
});

test("oppsummeringen teller feilprisede valg", () => {
  const state = medTrekk([
    { action: "call", paid: 20, toCall: 20, pot: 200, opponents: 1, hole: hand("AsAh") },
    { action: "fold", paid: 0, toCall: 20, pot: 400, opponents: 1, hole: hand("AsAh") },
  ]);
  const notes = coachReview(state, state.players[0].id, 1500);
  assert.equal(coachSummary(notes), "1 av 2 valg var feilpriset.");
  assert.equal(coachSummary([]), "Ingen valg å gå gjennom denne hånden.");
});


test("samme situasjon kan aldri gjøre både syn og kast riktig", () => {
  // Slingringsmonnet gjorde tidligere at et grensetilfelle ble stemplet «bra»
  // uansett hva man gjorde – to motsatte valg kan ikke begge være riktige.
  const hender = ["AsAh", "KsQd", "9s8s", "7s2d", "JhTh"];
  for (const kort of hender) {
    for (const motstandere of [1, 2, 4]) {
      const felles = { paid: 20, toCall: 20, pot: 60, opponents: motstandere, hole: hand(kort) };
      const synState = medTrekk([{ ...felles, action: "call" }]);
      const kastState = medTrekk([{ ...felles, action: "fold" }]);
      // Samme frø til begge, ellers sammenligner vi to ulike trekninger.
      const syn = coachReview(synState, synState.players[0].id, 1200, fastRandom(7))[0];
      const kast = coachReview(kastState, kastState.players[0].id, 1200, fastRandom(7))[0];
      assert.ok(
        !(syn.verdict === "bra" && kast.verdict === "bra"),
        `${kort} mot ${motstandere}: både syn og kast ble kalt riktig`,
      );
    }
  }
});

test("grensetilfeller kalles det de er, ikke riktige", () => {
  // Krav på 25 % (20 inn i en pott som blir 80) mot en hånd rundt samme nivå.
  const felles = { paid: 20, toCall: 20, pot: 60, opponents: 4, hole: hand("9s8s") };
  const synState = medTrekk([{ ...felles, action: "call" }]);
  const kastState = medTrekk([{ ...felles, action: "fold" }]);
  const syn = coachReview(synState, synState.players[0].id, 2000, fastRandom(42))[0];
  const kast = coachReview(kastState, kastState.players[0].id, 2000, fastRandom(42))[0];
  assert.equal(syn.chance, kast.chance, "samme frø skal gi samme sjanse");
  assert.equal(Math.round(syn.needed * 100), 25);
  if (Math.abs(syn.chance - syn.needed) <= 0.03) {
    assert.equal(syn.verdict, "greit", "på vippen skal ikke stemples som riktig");
    assert.equal(kast.verdict, "greit");
    assert.equal(syn.headline, "På vippen");
  }
});

test("the five levels are a scale, not five names", () => {
  const levels = ["nybegynner", "lett", "middels", "vanskelig", "umulig"] as const;
  for (let i = 1; i < levels.length; i += 1) {
    const softer = DIFFICULTY[levels[i - 1]];
    const harder = DIFFICULTY[levels[i]];
    assert.ok(softer.noise > harder.noise, `${levels[i]} skal feilvurdere mindre enn ${levels[i - 1]}`);
    assert.ok(softer.callMargin < harder.callMargin, `${levels[i]} skal syne mer nøkternt enn ${levels[i - 1]}`);
    assert.ok(softer.raiseAt > harder.raiseAt, `${levels[i]} skal høyne på svakere hender enn ${levels[i - 1]}`);
  }
});
