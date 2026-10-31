import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/fonts.css";
import "./gallery.css";
import { Gallery } from "./Gallery";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
