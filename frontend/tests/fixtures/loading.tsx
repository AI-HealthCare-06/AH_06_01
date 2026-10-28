import React from "react";
import { createRoot } from "react-dom/client";
import { GameLoadingScreen } from "../../src/components/GameLoadingScreen";
import "../../src/styles.css";
import "../../src/pixel.css";
import "../../src/game-loading.css";

const applying = new URLSearchParams(location.search).get("stage") === "applying";
createRoot(document.getElementById("root")!).render(
  <GameLoadingScreen
    stage={applying ? "applying" : "account"}
    progress={applying ? 100 : undefined}
    version={applying ? "1.3.3" : undefined}
  />,
);
