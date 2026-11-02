// Demo storage is separate from every signed-in account and existing local save.
export const demoMode = (() => {
  try {
    return (
      localStorage.getItem("rexrun-persona-mode") === "true" ||
      import.meta.env.VITE_REXRUN_DEMO_PERSONA === "true"
    );
  } catch {
    return false;
  }
})();
const personaNamespace = (() => {
  try {
    return (localStorage.getItem("rexrun-persona-id") ??
      import.meta.env.VITE_REXRUN_DEMO_PERSONA_ID) === "office-month-v1"
      ? "office-month:"
      : "";
  } catch {
    return "";
  }
})();
export const appStorageKey = (key: string) =>
  demoMode ? "rexrun-persona:" + personaNamespace + key : key;
export function enterDemo(persona = "htn-diabetes-v1") {
  localStorage.setItem(
    "rexrun-persona-id",
    persona === "office-month-v1" ? persona : "htn-diabetes-v1",
  );
  localStorage.setItem("rexrun-persona-mode", "true");
  location.assign("/dashboard");
}
export function exitDemo() {
  localStorage.removeItem("rexrun-persona-mode");
  localStorage.removeItem("rexrun-persona-id");
  location.assign("/login");
}
