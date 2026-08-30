/**
 * Veiviseren som fører deg fram til bordet: alene eller med venner, hvilket
 * spill, hvor mange, hvor tøffe, coach – og til slutt start eller vent på venner.
 *
 * Ett steg om gangen, og bare de stegene som gjelder for valget ditt. Forsiden
 * og Poker bruker samme veiviser; /poker låser spillet og hopper over de to
 * første stegene.
 */
import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  DIFFICULTY_NAME,
  MAX_HUMANS,
  MAX_OPPONENTS,
  MIN_HUMANS,
  MIN_OPPONENTS,
  difficultyHint,
  gameAvailable,
  stepsFor,
  summaryOf,
} from "./setup.ts";
import type { Difficulty, SetupChoice, SetupGame } from "./setup.ts";
import "./wizard.css";

export type SetupAction = "alene" | "lag-rom" | "bli-med";

export interface StartRequest {
  action: SetupAction;
  choice: SetupChoice;
  name: string;
  code: string;
}

const cleanCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** Startvalget: et låst spill overstyrer, og en invitasjon betyr alltid venner. */
function openingChoice(initial: SetupChoice, lockedGame: SetupGame | undefined, invited: boolean): SetupChoice {
  if (lockedGame) return { ...initial, mode: "alene", game: lockedGame };
  if (invited) return { ...initial, mode: "venner", game: "amerikaneren" };
  return initial;
}

export default function StartWizard(props: {
  initial: SetupChoice;
  initialName: string;
  /** Kom du inn på en invitasjonslenke, står koden her. */
  invitedCode?: string;
  lockedGame?: SetupGame;
  intro?: ReactNode;
  busy?: boolean;
  error?: string;
  onChoice?: (choice: SetupChoice) => void;
  onName?: (name: string) => void;
  onStart: (request: StartRequest) => void;
  onRules?: () => void;
}) {
  const locked = Boolean(props.lockedGame);
  const invited = cleanCode(props.invitedCode ?? "").length === 5;
  const [choice, setChoice] = useState(() => openingChoice(props.initial, props.lockedGame, invited));
  const [name, setName] = useState(props.initialName);
  const [code, setCode] = useState(() => cleanCode(props.invitedCode ?? ""));
  // Er du invitert, mangler du bare navnet – da åpner vi på siste steg.
  const [index, setIndex] = useState(() => (
    invited ? stepsFor(openingChoice(props.initial, props.lockedGame, invited), locked).length - 1 : 0
  ));

  const steps = useMemo(() => stepsFor(choice, locked), [choice, locked]);
  const at = Math.min(index, steps.length - 1);
  const step = steps[at];

  const update = (patch: Partial<SetupChoice>) => {
    const merged = { ...choice, ...patch };
    // Poker finnes ikke med venner. Bytter du modus, følger spillet med.
    if (!gameAvailable(merged.mode, merged.game)) merged.game = "amerikaneren";
    setChoice(merged);
    props.onChoice?.(merged);
  };

  const forward = () => setIndex(at + 1);
  const back = () => setIndex(Math.max(0, at - 1));
  const rename = (value: string) => { setName(value); props.onName?.(value); };
  const start = (action: SetupAction) => props.onStart({ action, choice, name, code });

  const head = (
    <div className="wizard-head">
      {at > 0
        ? <button className="wizard-back" onClick={back}>← Tilbake</button>
        : <span />}
      <span className="wizard-count">Steg {at + 1} av {steps.length}</span>
    </div>
  );
  const first = at === 0 ? props.intro : null;

  if (step === "modus") {
    return (
      <section className="panel setup-panel wizard-panel">
        {head}
        <h1>Hvordan vil du spille?</h1>
        <div className="choice-grid">
          <button
            className={choice.mode === "alene" ? "chosen" : ""}
            aria-pressed={choice.mode === "alene"}
            onClick={() => { update({ mode: "alene" }); forward(); }}
          >
            <b>Spill alene</b>
            <small>Mot bots, med en gang</small>
          </button>
          <button
            className={choice.mode === "venner" ? "chosen" : ""}
            aria-pressed={choice.mode === "venner"}
            onClick={() => { update({ mode: "venner" }); forward(); }}
          >
            <b>Spill med venner</b>
            <small>Del en lenke, spill fra hver deres mobil</small>
          </button>
        </div>
        {props.onRules && <button className="wizard-rules" onClick={props.onRules}>Hvordan spiller man?</button>}
      </section>
    );
  }

  if (step === "spill") {
    const openTable = gameAvailable(choice.mode, "poker");
    return (
      <section className="panel setup-panel wizard-panel">
        {head}
        <h1>Hvilket spill?</h1>
        <div className="choice-grid">
          <button
            className={choice.game === "amerikaneren" ? "chosen" : ""}
            aria-pressed={choice.game === "amerikaneren"}
            onClick={() => { update({ game: "amerikaneren" }); forward(); }}
          >
            <b>Amerikaneren</b>
            <small>Stikkspill for fire. Først til 52 poeng.</small>
          </button>
          <button
            className={choice.game === "sjakk" ? "chosen" : ""}
            aria-pressed={choice.game === "sjakk"}
            onClick={() => { update({ game: "sjakk" }); forward(); }}
          >
            <b>Sjakk</b>
            <small>Vanlige regler, mot bot eller en venn.</small>
          </button>
          <button
            className={choice.game === "poker" ? "chosen" : ""}
            aria-pressed={choice.game === "poker"}
            disabled={!openTable}
            onClick={() => { update({ game: "poker" }); forward(); }}
          >
            <b>Poker</b>
            <small>{openTable ? "Texas hold'em med falske sjetonger." : "Bare alene foreløpig."}</small>
          </button>
        </div>
      </section>
    );
  }

  if (step === "antall") {
    const table = choice.game === "poker";
    const value = table ? choice.opponents : choice.humans;
    const options = table ? range(MIN_OPPONENTS, MAX_OPPONENTS) : range(MIN_HUMANS, MAX_HUMANS);
    return (
      <section className="panel setup-panel wizard-panel">
        {head}
        {first}
        <h1>{table ? "Hvor mange spiller du mot?" : "Hvor mange er dere?"}</h1>
        <p className="muted">{table ? "Hver motstander er en bot." : "Ledige plasser tar bots."}</p>
        <div className="count-grid" style={{ "--options": options.length } as CSSProperties}>
          {options.map((count) => (
            <button
              key={count}
              className={count === value ? "chosen" : ""}
              aria-pressed={count === value}
              onClick={() => { update(table ? { opponents: count } : { humans: count }); forward(); }}
            >
              <b>{count}</b>
              <small>{table
                ? (count === 1 ? "mot én" : "motstandere")
                : (count === MAX_HUMANS ? "fullt bord" : `+ ${MAX_HUMANS - count} ${MAX_HUMANS - count === 1 ? "bot" : "bots"}`)}</small>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (step === "niva") {
    return (
      <section className="panel setup-panel wizard-panel">
        {head}
        <h1>{choice.game === "sjakk" ? "Hvor sterk skal boten være?" : "Hvor tøffe skal de være?"}</h1>
        <p className="muted">{choice.game === "sjakk" ? "Du spiller hvit og begynner." : "Gjelder alle botene."}</p>
        <div className="level-grid">
          {(["lett", "middels", "vanskelig"] as Difficulty[]).map((option) => (
            <button
              key={option}
              className={option === choice.level ? "chosen" : ""}
              aria-pressed={option === choice.level}
              onClick={() => { update({ level: option }); forward(); }}
            >
              <b>{DIFFICULTY_NAME[option]}</b><small>{difficultyHint(choice.game, option)}</small>
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (step === "coach") {
    const board = choice.game === "sjakk";
    return (
      <section className="panel setup-panel wizard-panel">
        {head}
        <h1>Vil du ha hjelp?</h1>
        <label className="switch-row">
          <b>Coach</b>
          <small>
            {board
              ? "Merker hvert trekk du gjør, fra briljant til tabbe, og peker på det bedre trekket."
              : "Går gjennom valgene dine etter hver hånd og sier om prisen var riktig."}
          </small>
          <input type="checkbox" checked={choice.coach} onChange={(event) => update({ coach: event.target.checked })} />
        </label>
        {!board && (
          <label className="switch-row">
            <b>Vis kastede kort</b>
            <small>Etter showdown ser du hendene til dem som kastet seg.</small>
            <input type="checkbox" checked={choice.showFolded} onChange={(event) => update({ showFolded: event.target.checked })} />
          </label>
        )}
        <button className="primary-cta" onClick={forward}>Videre</button>
      </section>
    );
  }

  const alone = choice.mode === "alene";
  const named = name.trim().length > 0;
  const waiting = Boolean(props.busy);
  const joinable = !waiting && named && code.length === 5;
  const primary: SetupAction = alone ? "alene" : invited ? "bli-med" : "lag-rom";
  const nameField = (
    <label>Navnet ditt
      <input
        value={name}
        onChange={(event) => rename(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          if (primary === "bli-med" ? joinable : !waiting && (alone || named)) start(primary);
        }}
        maxLength={18}
        placeholder="For eksempel Ole"
        autoComplete="nickname"
      />
    </label>
  );
  const codeField = (
    <label>Romkode
      <input
        className="code-input"
        value={code}
        onChange={(event) => setCode(cleanCode(event.target.value))}
        maxLength={5}
        placeholder="AB123"
        autoCapitalize="characters"
      />
    </label>
  );

  return (
    <section className="panel setup-panel wizard-panel">
      {head}
      {first}
      <h1>{alone ? "Klar?" : invited ? "Du er invitert" : "Samle bordet"}</h1>
      <p className="muted">
        {alone
          ? "Alt er valgt."
          : invited
            ? `Skriv navnet ditt, så er du inne i rom ${code}.`
            : "Én lager rommet, resten får lenken."}
      </p>
      {/* Den som er invitert har ikke valgt noe selv – da er oppsummeringen bare støy. */}
      {!invited && (
        <ul className="setup-summary">
          {summaryOf(choice).map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
      {nameField}
      {alone && <button className="primary-cta" disabled={waiting} onClick={() => start("alene")}>Sett deg ved bordet</button>}
      {!alone && invited && (
        <>
          {codeField}
          <button className="primary-cta" disabled={!joinable} onClick={() => start("bli-med")}>Bli med</button>
          <div className="divider"><span>eller</span></div>
          <button className="outline-cta" disabled={waiting || !named} onClick={() => start("lag-rom")}>Lag nytt rom</button>
        </>
      )}
      {!alone && !invited && (
        <>
          <button className="primary-cta" disabled={waiting || !named} onClick={() => start("lag-rom")}>Lag nytt rom</button>
          <div className="divider"><span>eller</span></div>
          {codeField}
          <button className="outline-cta" disabled={!joinable} onClick={() => start("bli-med")}>Bli med</button>
        </>
      )}
      {props.error && <p className="error-message">{props.error}</p>}
      {alone && choice.game === "poker" && <p className="tiny">Ingen penger bytter hender. Sjetongene er bare tall.</p>}
      {!alone && choice.game === "sjakk" && <p className="tiny">Den som lager rommet spiller hvit.</p>}
    </section>
  );
}
