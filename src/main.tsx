import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preventPageZoom } from "./platform/pageZoom";
import { trapModalFocus } from "./ui/focusTrap";
import "./styles/pdfjs-text-layer.css";
import "./styles/app.css";

preventPageZoom();
trapModalFocus();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
