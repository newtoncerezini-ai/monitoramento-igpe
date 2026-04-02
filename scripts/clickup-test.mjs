import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadDotEnv();

const token = process.env.CLICKUP_TOKEN;

if (!token) {
  console.error(
    "CLICKUP_TOKEN nao encontrado. Crie um arquivo .env com CLICKUP_TOKEN=pk_..."
  );
  process.exit(1);
}

const response = await fetch("https://api.clickup.com/api/v2/team", {
  headers: {
    Authorization: token,
    "Content-Type": "application/json"
  }
});

if (!response.ok) {
  const errorText = await response.text();
  console.error(`Erro ao consultar ClickUp (${response.status}): ${errorText}`);
  process.exit(1);
}

const data = await response.json();
const teams = Array.isArray(data.teams) ? data.teams : [];

if (teams.length === 0) {
  console.log("Conexao realizada, mas nenhum workspace foi retornado.");
  process.exit(0);
}

console.log("Conexao com ClickUp OK. Workspaces encontrados:");

for (const team of teams) {
  console.log(`- ${team.name} (id: ${team.id})`);
}

console.log("");
console.log("Spaces encontrados:");

for (const team of teams) {
  const spacesResponse = await fetch(
    `https://api.clickup.com/api/v2/team/${team.id}/space?archived=false`,
    {
      headers: {
        Authorization: token,
        "Content-Type": "application/json"
      }
    }
  );

  if (!spacesResponse.ok) {
    const errorText = await spacesResponse.text();
    console.error(
      `Erro ao consultar spaces do workspace ${team.name} (${team.id}) (${spacesResponse.status}): ${errorText}`
    );
    continue;
  }

  const spacesData = await spacesResponse.json();
  const spaces = Array.isArray(spacesData.spaces) ? spacesData.spaces : [];

  if (spaces.length === 0) {
    console.log(`- ${team.name}: nenhum space retornado`);
    continue;
  }

  for (const space of spaces) {
    console.log(`- ${team.name} > ${space.name} (id: ${space.id})`);
  }
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
