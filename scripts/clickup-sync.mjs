import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_INTERVAL_MINUTES = 10;
loadDotEnv();

const exportScriptPath = resolve(process.cwd(), "scripts", "export-clickup-space.mjs");
const intervalMinutes = getRefreshIntervalMinutes();
const intervalMs = intervalMinutes * 60 * 1000;

let running = false;

console.log(
  `Sincronizacao automatica do ClickUp iniciada. Intervalo: ${intervalMinutes} minuto(s).`
);

await runExport();

setInterval(() => {
  void runExport();
}, intervalMs);

async function runExport() {
  if (running) {
    console.log("A exportacao anterior ainda esta em andamento. Pulando este ciclo.");
    return;
  }

  running = true;

  try {
    console.log(`[${new Date().toLocaleString("pt-BR")}] Iniciando exportacao do ClickUp...`);
    await runNodeScript(exportScriptPath);
    console.log(`[${new Date().toLocaleString("pt-BR")}] Exportacao concluida.`);
  } catch (error) {
    console.error(
      `[${new Date().toLocaleString("pt-BR")}] Falha na exportacao automatica do ClickUp.`
    );
    console.error(error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

function runNodeScript(scriptPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: "inherit",
      env: process.env
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`Processo finalizado com codigo ${code}.`));
    });
  });
}

function getRefreshIntervalMinutes() {
  const rawValue = process.env.CLICKUP_REFRESH_INTERVAL_MINUTES?.trim();

  if (!rawValue) {
    return DEFAULT_INTERVAL_MINUTES;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    console.warn(
      `CLICKUP_REFRESH_INTERVAL_MINUTES invalido ("${rawValue}"). Usando ${DEFAULT_INTERVAL_MINUTES} minutos.`
    );
    return DEFAULT_INTERVAL_MINUTES;
  }

  return parsedValue;
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  const contents = readFileSync(envPath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
