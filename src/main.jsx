import React from "react";
import { createRoot } from "react-dom/client";
import { GloveApp as App } from "./gloves/GloveApp.jsx";
import "./style.css";
performance.mark("arena-ui-start");
createRoot(document.getElementById("root")).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const register = () =>
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("Offline caching unavailable:", error));
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
