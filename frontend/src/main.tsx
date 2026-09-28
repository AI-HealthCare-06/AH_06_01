import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource/inter/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/noto-sans-kr/400.css";
import "@fontsource/noto-sans-kr/700.css";
import "@fontsource/anton/400.css";
import "@fontsource/press-start-2p/400.css";
import "./styles.css";
import App from "./App";
import { NoticeProvider } from "./components/NoticeProvider";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NoticeProvider>
          <App />
        </NoticeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
