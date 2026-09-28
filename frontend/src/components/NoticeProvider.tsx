import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const NoticeContext = createContext<(message: string) => void>(() => {});
// eslint-disable-next-line react-refresh/only-export-components
export function useNotice() {
  return useContext(NoticeContext);
}
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div className={`notice ${message ? "visible" : ""}`} role="status" aria-live="polite">
        {message}
        {message && (
          <button aria-label="알림 닫기" onClick={() => setMessage("")}>
            ×
          </button>
        )}
      </div>
    </NoticeContext.Provider>
  );
}
