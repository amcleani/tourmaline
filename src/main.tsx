import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { preventPageZoom } from "./platform/pageZoom";
import "./styles/pdfjs-text-layer.css";
import "./styles/app.css";

preventPageZoom();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
