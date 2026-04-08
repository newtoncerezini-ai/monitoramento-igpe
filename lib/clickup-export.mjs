import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function exportClickupSpace(options = {}) {
  const { persist = true } = options;

  loadDotEnv();

  const token = process.env.CLICKUP_TOKEN;
  const outputPath = resolve(process.cwd(), "data", "clickup-space.json");

  if (!token) {
    throw new Error(
      "CLICKUP_TOKEN nao encontrado. Crie um arquivo .env com CLICKUP_TOKEN=pk_..."
    );
  }

  const teamsPayload = await fetchJson("/team", token);
  const teams = Array.isArray(teamsPayload.teams) ? teamsPayload.teams : [];

  const normalizedFolders = [];
  const normalizedFolderlessLists = [];
  const normalizedWorkspaces = [];

  for (const team of teams) {
    const spacesPayload = await fetchJson(`/team/${team.id}/space?archived=false`, token);
    const spaces = Array.isArray(spacesPayload.spaces) ? spacesPayload.spaces : [];
    const normalizedSpaces = [];

    for (const space of spaces) {
      const normalizedSpace = await hydrateSpace(space, team, token);

      normalizedSpaces.push({
        id: normalizedSpace.id,
        name: normalizedSpace.name,
        private: normalizedSpace.private
      });

      normalizedFolders.push(...normalizedSpace.folders);
      normalizedFolderlessLists.push(...normalizedSpace.folderlessLists);
    }

    normalizedWorkspaces.push({
      id: team.id,
      name: team.name,
      spaces: normalizedSpaces
    });
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    space: {
      id: "all",
      name: "Todos os workspaces",
      private: false
    },
    workspaces: normalizedWorkspaces,
    folders: normalizedFolders,
    folderlessLists: normalizedFolderlessLists
  };

  if (persist) {
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(exportData, null, 2)}\n`, "utf8");
  }

  const allLists = [
    ...normalizedFolderlessLists,
    ...normalizedFolders.flatMap((folder) => folder.lists)
  ];
  const allTasks = allLists.flatMap((list) => list.tasks);
  const acompanhadaTasks = allTasks.filter((task) =>
    task.tags.some((tag) => normalize(tag.name) === "acompanhada")
  );

  console.log(`ClickUp exportado com sucesso${persist ? ` para ${outputPath}` : ""}`);
  console.log(`- Workspaces: ${normalizedWorkspaces.length}`);
  console.log(
    `- Spaces: ${normalizedWorkspaces.reduce((total, workspace) => total + workspace.spaces.length, 0)}`
  );
  console.log(`- Folders: ${normalizedFolders.length}`);
  console.log(`- Lists sem folder: ${normalizedFolderlessLists.length}`);
  console.log(`- Total de lists: ${allLists.length}`);
  console.log(`- Total de tarefas: ${allTasks.length}`);
  console.log(`- Tarefas com tag 'acompanhada': ${acompanhadaTasks.length}`);

  return exportData;
}

export function readSavedClickupData() {
  const outputPath = resolve(process.cwd(), "data", "clickup-space.json");

  if (!existsSync(outputPath)) {
    return null;
  }

  const contents = readFileSync(outputPath, "utf8");
  return JSON.parse(contents);
}

async function hydrateSpace(space, team, token) {
  const foldersPayload = await fetchJson(`/space/${space.id}/folder?archived=false`, token);
  const listsPayload = await fetchJson(`/space/${space.id}/list?archived=false`, token);

  const folders = Array.isArray(foldersPayload.folders) ? foldersPayload.folders : [];
  const folderlessLists = Array.isArray(listsPayload.lists) ? listsPayload.lists : [];

  const normalizedSpaceFolders = [];

  for (const folder of folders) {
    const folderListsPayload = await fetchJson(`/folder/${folder.id}/list?archived=false`, token);
    const folderLists = Array.isArray(folderListsPayload.lists)
      ? folderListsPayload.lists
      : [];

    normalizedSpaceFolders.push({
      id: folder.id,
      name: folder.name,
      workspace: {
        id: team.id,
        name: team.name
      },
      space: {
        id: space.id,
        name: space.name
      },
      lists: await hydrateLists(folderLists, { team, space, folder }, token)
    });
  }

  return {
    id: space.id,
    name: space.name,
    private: space.private ?? false,
    folders: normalizedSpaceFolders,
    folderlessLists: await hydrateLists(folderlessLists, { team, space, folder: null }, token)
  };
}

async function hydrateLists(lists, context, token) {
  const result = [];

  for (const list of lists) {
    const tasks = await fetchAllTasksForList(list.id, token);

    result.push({
      id: list.id,
      name: list.name,
      status: list.status ?? null,
      workspace: {
        id: context.team.id,
        name: context.team.name
      },
      space: {
        id: context.space.id,
        name: context.space.name
      },
      folder: context.folder
        ? {
            id: context.folder.id,
            name: context.folder.name
          }
        : null,
      taskCount: tasks.length,
      tasks: tasks.map(normalizeTask)
    });
  }

  return result;
}

async function fetchAllTasksForList(listId, token) {
  const tasks = [];
  let page = 0;

  while (true) {
    const tasksPayload = await fetchJson(
      `/list/${listId}/task?archived=false&include_closed=true&subtasks=true&page=${page}`,
      token
    );
    const pageTasks = Array.isArray(tasksPayload.tasks) ? tasksPayload.tasks : [];

    tasks.push(...pageTasks);

    if (pageTasks.length === 0) {
      break;
    }

    page += 1;
  }

  return tasks;
}

function normalizeTask(task) {
  return {
    id: task.id,
    name: task.name,
    description: task.description ?? "",
    url: task.url ?? "",
    dateCreated: task.date_created ?? null,
    startDate: task.start_date ?? null,
    dueDate: task.due_date ?? null,
    dateClosed: task.date_closed ?? null,
    priority: task.priority
      ? {
          id: task.priority.id,
          priority: task.priority.priority,
          color: task.priority.color
        }
      : null,
    status: task.status
      ? {
          status: task.status.status,
          color: task.status.color,
          type: task.status.type
        }
      : null,
    tags: Array.isArray(task.tags)
      ? task.tags.map((tag) => ({
          name: tag.name,
          tagFg: tag.tag_fg,
          tagBg: tag.tag_bg
        }))
      : [],
    assignees: Array.isArray(task.assignees)
      ? task.assignees.map((assignee) => ({
          id: assignee.id,
          username: assignee.username,
          email: assignee.email ?? null,
          initials: assignee.initials ?? null,
          color: assignee.color ?? null
        }))
      : [],
    timeEstimate: task.time_estimate ?? null,
    points: task.points ?? null,
    archived: task.archived ?? false,
    parent: task.parent ?? null,
    list: task.list
      ? {
          id: task.list.id,
          name: task.list.name
        }
      : null
  };
}

async function fetchJson(path, token) {
  const response = await fetch(`https://api.clickup.com/api/v2${path}`, {
    headers: {
      Authorization: token,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao consultar ${path} (${response.status}): ${errorText}`);
  }

  return response.json();
}

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
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
