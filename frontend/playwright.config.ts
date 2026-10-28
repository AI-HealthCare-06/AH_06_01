import { defineConfig } from "@playwright/test";
process.env.TZ ||= "Asia/Seoul";
const cloudAuthUi = process.env.REXRUN_AUTH_UI === "1";
const port = process.env.REXRUN_TEST_PORT || (cloudAuthUi ? "4175" : "5173");
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 2,
  reporter: "list",
  use: {
    baseURL,
    timezoneId: "Asia/Seoul",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    env: { VITE_REXRUN_CLOUD: cloudAuthUi ? "true" : "false" },
    reuseExistingServer: !process.env.CI,
  },
});
