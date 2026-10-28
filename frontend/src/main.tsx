import { Capacitor } from "@capacitor/core";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/press-start-2p/400.css";
import "./styles.css";
import "./pixel.css";
import "./mobile-health.css";
import "./quest-detail.css";
import "./game-customization.css";
import "./dashboard-review.css";
import "./dashboard-refinement.css";
import "./profile-customization.css";
import App from "./App";
import "./cloud/cloud.css";
import "./game-loading.css";
import "./main-tab-motion.css";
import "./dashboard-stitch.css";
import "./review-layout.css";
import { NoticeProvider } from "./components/NoticeProvider";
import { AndroidExitGuard } from "./components/AndroidExitGuard";
import "./ux-review.css";
import { MobileUpdateOverlay } from "./components/MobileUpdateStatus";

import { initializeTextSize } from "./stores/text-size-store";
import "./ux-followup.css";
import { initializeDemoPersona } from "./services/demo-persona";

if (Capacitor.getPlatform() === "android") document.documentElement.dataset.platform = "android";
initializeTextSize();
initializeDemoPersona();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Frequent game-store updates must not defer the route captured by the page transition. */}
      <BrowserRouter useTransitions={false}>
        <NoticeProvider>
          <App />
          <AndroidExitGuard />
          <MobileUpdateOverlay />
        </NoticeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
