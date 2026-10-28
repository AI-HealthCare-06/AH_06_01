import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const python =
  process.env.REXRUN_DIET_PYTHON ||
  resolve(
    root,
    ".cache/diet-f6/venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
if (!existsSync(python))
  throw new Error(
    "Create .cache/diet-f6/venv and install services/diet-f6/requirements.txt first.",
  );
const child = spawn(
  python,
  [
    "-m",
    "uvicorn",
    "f6_diet.api:app",
    "--app-dir",
    resolve(root, "services/diet-f6"),
    "--host",
    "127.0.0.1",
    "--port",
    "8006",
    "--no-access-log",
  ],
  { cwd: root, env: { ...process.env, F6_APP_ENV: "local" }, stdio: "inherit", windowsHide: true },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
child.on("exit", (code) => process.exit(code ?? 1));
