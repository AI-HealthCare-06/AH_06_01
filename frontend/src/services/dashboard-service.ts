export type RiskTone = "amber" | "green" | "red";

export type DashboardSnapshot = {
  score: number;
  delta: number;
  risks: {
    name: string;
    current: number;
    projected: number;
    status: string;
    tone: RiskTone;
    projectedTone: RiskTone;
  }[];
};

export interface DashboardService {
  getSnapshot(signal?: AbortSignal): Promise<DashboardSnapshot>;
}

// Figma's sample values, not an inference result. Replace this adapter when the API is ready.
export const dashboardService: DashboardService = {
  async getSnapshot(signal) {
    signal?.throwIfAborted();
    return {
      score: 82,
      delta: 8,
      risks: [
        {
          name: "고혈압",
          current: 32,
          projected: 27,
          status: "주의",
          tone: "amber",
          projectedTone: "amber",
        },
        {
          name: "당뇨",
          current: 18,
          projected: 15,
          status: "낮음",
          tone: "green",
          projectedTone: "green",
        },
        {
          name: "고지혈증",
          current: 41,
          projected: 35,
          status: "관리 필요",
          tone: "red",
          projectedTone: "amber",
        },
      ],
    };
  },
};
