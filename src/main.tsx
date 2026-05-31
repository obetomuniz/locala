import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ExperimentalRoute } from "./experimental/ExperimentalRoute";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <ExperimentalRoute />
  </StrictMode>,
);
