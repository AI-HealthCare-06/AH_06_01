import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rexrun.demo",
  appName: "REXRUN",
  webDir: "dist",
  server: { androidScheme: "https" },
  ios: { contentInset: "automatic" },
  plugins: {
    PushNotifications: { presentationOptions: ["alert", "sound"] },
    FirebaseAuthentication: { skipNativeAuth: true, providers: ["google.com"] },
    CapacitorUpdater: {
      autoUpdate: "off",
      updateUrl: "",
      statsUrl: "",
      channelUrl: "",
      allowModifyUrl: false,
      autoDeleteFailed: false,
      resetWhenUpdate: true,
      appReadyTimeout: 15000,
      version: "1.5.2",
      keepUrlPathAfterReload: true,
    },
  },
};
export default config;
