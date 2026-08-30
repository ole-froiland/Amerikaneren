import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";

/**
 * Den skjulte pokersiden ligger på /poker. Ingenting på forsiden lenker dit, og
 * koden lastes først når adressen faktisk er åpnet.
 */
const Poker = lazy(() => import("./PokerTable.tsx"));
const isPoker = window.location.pathname.replace(/\/+$/, "").toLowerCase() === "/poker";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPoker
      ? <Suspense fallback={<main className="app-shell" />}><Poker /></Suspense>
      : <App />}
  </StrictMode>,
);
