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
export const appStorageKey = (key: string) => (demoMode ? "rexrun-persona:" + key : key);
export function enterDemo() {
  localStorage.setItem("rexrun-persona-mode", "true");
  location.assign("/dashboard");
}
export function exitDemo() {
  localStorage.removeItem("rexrun-persona-mode");
  location.assign("/login");
}
