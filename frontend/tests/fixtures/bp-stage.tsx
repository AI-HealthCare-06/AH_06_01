import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { BpStageCard } from "../../src/components/BpStageCard";
import { useCloudStore } from "../../src/cloud/sync";
import { useProfileStore } from "../../src/stores/profile-store";
import { initialProfile } from "../../src/domain/profile";
import { healthSnapshotKey } from "../../src/domain/bp-stage";
import "../../src/styles.css";
import "../../src/pixel.css";
const profile = { ...initialProfile, bloodPressure: null };
useProfileStore.setState({ profile, hasProfileInput: true });
useCloudStore.setState({
  ready: true,
  userId: "00000000-0000-4000-8000-000000000001",
  consent: true,
  pending: 0,
  healthSnapshotKey: healthSnapshotKey(profile, []),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter>
      <main style={{ maxWidth: 420, margin: "auto", padding: 16, background: "#f4e8c8" }}>
        <p>합성 자료 · M1-S 연결 UI 검증</p>
        <BpStageCard />
        <button onClick={() => useCloudStore.setState({ pending: 1, healthSyncPending: false })}>
          게임 저장 대기
        </button>
        <button
          onClick={() =>
            useCloudStore.setState({
              userId: "00000000-0000-4000-8000-000000000002",
              healthSnapshotKey: null,
            })
          }
        >
          다른 계정으로 전환
        </button>
        <button onClick={() => useCloudStore.setState({ consent: false })}>
          서버 저장 동의 철회
        </button>
      </main>
    </MemoryRouter>
  </QueryClientProvider>,
);
