import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rexrun.demo",
  appName: "REXRUN",
  webDir: "dist",
  server: { androidScheme: "https" },
  ios: { contentInset: "automatic" },
};
export default config;
