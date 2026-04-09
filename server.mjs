import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { exportClickupSpace } from "./lib/clickup-export-next.mjs";

loadDotEnv();

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const DEFAULT_INTERVAL_MINUTES = 10;
const projectRoot = process.cwd();
const distDir = resolve(projectRoot, "dist");
const dataPath = resolve(projectRoot, "data", "clickup-space.json");
const autoRefreshEnabled = getAutoRefreshEnabled();
const refreshIntervalMinutes = getRefreshIntervalMinutes();
const refreshIntervalMs = refreshIntervalMinutes * 60 * 1000;

let refreshInFlight = null;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && url.pathname === "/api/clickup-data") {
    return sendClickupData(response);
  }

  if (request.method === "POST" && url.pathname === "/api/clickup-refresh") {
    return handleRefresh(response);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return sendJson(response, 405, { error: "Metodo nao permitido." });
  }

  return serveStaticAsset(url.pathname, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Monitoramento IGPE disponivel em http://${HOST}:${PORT}`);

  if (autoRefreshEnabled) {
    console.log(
      `Atualizacao automatica em segundo plano ativada. Intervalo: ${refreshIntervalMinutes} minuto(s).`
    );

    void runScheduledRefresh("Inicial");
    setInterval(() => {
      void runScheduledRefresh("Agendada");
    }, refreshIntervalMs);
  } else {
    console.log("Atualizacao automatica em segundo plano desativada por configuracao.");
  }
});

function sendClickupData(response) {
  if (!existsSync(dataPath)) {
    return sendJson(response, 404, {
      error: "Arquivo de dados do ClickUp ainda nao foi gerado."
    });
  }

  try {
    const contents = readFileSync(dataPath, "utf8");
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(contents);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Falha ao ler os dados do ClickUp."
    });
  }
}

async function handleRefresh(response) {
  try {
    if (!refreshInFlight) {
      refreshInFlight = runExport();
    }

    const exportData = await refreshInFlight;

    sendJson(response, 200, {
      message: "Dados do ClickUp atualizados com sucesso.",
      exportedAt: exportData.exportedAt,
      data: exportData
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Falha ao atualizar o ClickUp."
    });
  } finally {
    refreshInFlight = null;
  }
}

function runExport() {
  return exportClickupSpace({ persist: true });
}

async function runScheduledRefresh(label) {
  try {
    await handleBackgroundRefresh();
    console.log(
      `[${new Date().toLocaleString("pt-BR")}] ${label} - dados do ClickUp sincronizados.`
    );
  } catch (error) {
    console.error(
      `[${new Date().toLocaleString("pt-BR")}] ${label} - falha na sincronizacao automatica.`
    );
    console.error(error instanceof Error ? error.message : error);
  }
}

async function handleBackgroundRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = runExport();
  }

  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function serveStaticAsset(pathname, response) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requestPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const assetPath = join(distDir, safePath);

  if (existsSync(assetPath)) {
    return streamFile(assetPath, response);
  }

  const indexPath = join(distDir, "index.html");

  if (!existsSync(indexPath)) {
    return sendJson(response, 503, {
      error: "Build nao encontrado. Execute `npm run build` antes de iniciar o servidor."
    });
  }

  return streamFile(indexPath, response);
}

function streamFile(filePath, response) {
  const contentType = MIME_TYPES[extname(filePath)] || "application/octet-stream";

  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });

  createReadStream(filePath).pipe(response);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function getAutoRefreshEnabled() {
  const rawValue = process.env.CLICKUP_AUTO_REFRESH_ON_SERVER?.trim().toLowerCase();

  if (!rawValue) {
    return true;
  }

  return rawValue !== "false" && rawValue !== "0" && rawValue !== "off";
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
