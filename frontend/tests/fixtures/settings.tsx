import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { CloudStatus } from "../../src/cloud/CloudStatus";
import { useCloudStore } from "../../src/cloud/sync";
import { MobileUpdateStatus } from "../../src/components/MobileUpdateStatus";
import "../../src/styles.css";
import "../../src/cloud/cloud.css";
import "../../src/ux-review.css";
Capacitor.getPlatform = () => "android";
useCloudStore.setState({
  ready: true,
  email: "qa@example.invalid",
  message: "서버 연결 준비 중",
  consent: false,
});
createRoot(document.getElementById("root")!).render(
  <main className="main-content">
    <CloudStatus />
    <MobileUpdateStatus />
  </main>,
);
