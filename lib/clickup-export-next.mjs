import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_TRACKING_TAG = "acompanhada";
const DEFAULT_STALE_AFTER_DAYS = 7;
const HISTORY_LIMIT = 120;

export async function exportClickupSpace(options = {}) {
  const { persist = true } = options;

  loadDotEnv();

  const token = process.env.CLICKUP_TOKEN;
  const outputPath = resolve(process.cwd(), "data", "clickup-space.json");
  const trackingConfig = getTrackingConfig();

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
  const normalizedGoals = [];
  const trackedTaskMap = new Map();
  const syncIssues = [];

  for (const team of teams) {
    const spacesPayload = await fetchJson(`/team/${team.id}/space?archived=false`, token);
    const spaces = Array.isArray(spacesPayload.spaces) ? spacesPayload.spaces : [];
    const normalizedSpaces = [];

    for (const space of spaces) {
      const normalizedSpace = await hydrateSpace(space, team, token, trackingConfig, syncIssues);

      normalizedSpaces.push({
        id: normalizedSpace.id,
        name: normalizedSpace.name,
        private: normalizedSpace.private
      });

      normalizedFolders.push(...normalizedSpace.folders);
      normalizedFolderlessLists.push(...normalizedSpace.folderlessLists);

      for (const task of normalizedSpace.trackedTasks) {
        trackedTaskMap.set(task.id, task);
      }
    }

    const workspaceGoals = await fetchWorkspaceGoals(team, token, syncIssues);
    normalizedGoals.push(...workspaceGoals);

    normalizedWorkspaces.push({
      id: team.id,
      name: team.name,
      spaces: normalizedSpaces
    });
  }

  const trackedTasks = [...trackedTaskMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR")
  );
  const historyEntry = buildHistoryEntry(trackedTasks);
  const history = mergeHistoryEntries(readSavedClickupHistory(), historyEntry);

  const exportData = {
    exportedAt: new Date().toISOString(),
    space: {
      id: "all",
      name: "Todos os workspaces",
      private: false
    },
    trackingConfig,
    workspaces: normalizedWorkspaces,
    folders: normalizedFolders,
    folderlessLists: normalizedFolderlessLists,
    trackedTasks,
    goals: normalizedGoals,
    history,
    syncIssues
  };

  if (persist) {
    mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(exportData, null, 2)}\n`, "utf8");
    writeFileSync(
      resolve(process.cwd(), "data", "clickup-history.json"),
      `${JSON.stringify(history, null, 2)}\n`,
      "utf8"
    );
  }

  const allLists = [
    ...normalizedFolderlessLists,
    ...normalizedFolders.flatMap((folder) => folder.lists)
  ];
  const allTasks = allLists.flatMap((list) => list.tasks);

  console.log(`ClickUp exportado com sucesso${persist ? ` para ${outputPath}` : ""}`);
  console.log(`- Workspaces: ${normalizedWorkspaces.length}`);
  console.log(
    `- Spaces: ${normalizedWorkspaces.reduce((total, workspace) => total + workspace.spaces.length, 0)}`
  );
  console.log(`- Folders: ${normalizedFolders.length}`);
  console.log(`- Lists sem folder: ${normalizedFolderlessLists.length}`);
  console.log(`- Total de lists: ${allLists.length}`);
  console.log(`- Total de tarefas: ${allTasks.length}`);
  console.log(`- Tarefas com tag '${trackingConfig.tag}': ${trackedTasks.length}`);
  console.log(`- Goals sincronizados: ${normalizedGoals.length}`);
  console.log(`- Avisos de sincronizacao: ${syncIssues.length}`);

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

export function readSavedClickupHistory() {
  const historyPath = resolve(process.cwd(), "data", "clickup-history.json");

  if (!existsSync(historyPath)) {
    return [];
  }

  const contents = readFileSync(historyPath, "utf8");
  const parsed = JSON.parse(contents);

  return Array.isArray(parsed) ? parsed : [];
}

async function hydrateSpace(space, team, token, trackingConfig, syncIssues) {
  const foldersPayload = await fetchJson(`/space/${space.id}/folder?archived=false`, token);
  const listsPayload = await fetchJson(`/space/${space.id}/list?archived=false`, token);

  const folders = Array.isArray(foldersPayload.folders) ? foldersPayload.folders : [];
  const folderlessLists = Array.isArray(listsPayload.lists) ? listsPayload.lists : [];

  const normalizedSpaceFolders = [];
  const trackedTasks = [];

  for (const folder of folders) {
    const folderListsPayload = await fetchJson(`/folder/${folder.id}/list?archived=false`, token);
    const folderLists = Array.isArray(folderListsPayload.lists) ? folderListsPayload.lists : [];
    const hydratedLists = await hydrateLists(
      folderLists,
      { team, space, folder },
      token,
      trackingConfig,
      syncIssues
    );

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
      lists: hydratedLists.lists
    });

    trackedTasks.push(...hydratedLists.trackedTasks);
  }

  const hydratedFolderlessLists = await hydrateLists(
    folderlessLists,
    { team, space, folder: null },
    token,
    trackingConfig,
    syncIssues
  );

  trackedTasks.push(...hydratedFolderlessLists.trackedTasks);

  return {
    id: space.id,
    name: space.name,
    private: space.private ?? false,
    folders: normalizedSpaceFolders,
    folderlessLists: hydratedFolderlessLists.lists,
    trackedTasks
  };
}

async function hydrateLists(lists, context, token, trackingConfig, syncIssues) {
  const normalizedLists = [];
  const trackedTasks = [];

  for (const list of lists) {
    const tasks = await fetchAllTasksForList(list.id, token);
    const normalizedTasks = [];

    for (const task of tasks) {
      const normalizedTask = normalizeTask(task, context, trackingConfig);

      if (normalizedTask.isTracked) {
        const enrichedTask = await enrichTrackedTask(normalizedTask, token, syncIssues);
        normalizedTasks.push(enrichedTask);
        trackedTasks.push(enrichedTask);
      } else {
        normalizedTasks.push(normalizedTask);
      }
    }

    normalizedLists.push({
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
      taskCount: normalizedTasks.length,
      tasks: normalizedTasks
    });
  }

  return {
    lists: normalizedLists,
    trackedTasks
  };
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

async function enrichTrackedTask(task, token, syncIssues) {
  const [detailResult, commentsResult] = await Promise.allSettled([
    fetchJson(`/task/${task.id}`, token),
    fetchJson(`/task/${task.id}/comment`, token)
  ]);

  let enrichedTask = task;

  if (detailResult.status === "fulfilled") {
    enrichedTask = mergeTaskData(enrichedTask, detailResult.value);
  } else {
    syncIssues.push({
      scope: "task-detail",
      taskId: task.id,
      taskName: task.name,
      message: detailResult.reason instanceof Error ? detailResult.reason.message : "Falha"
    });
  }

  if (commentsResult.status === "fulfilled") {
    enrichedTask = {
      ...enrichedTask,
      comments: normalizeComments(commentsResult.value?.comments),
      commentCount: Array.isArray(commentsResult.value?.comments)
        ? commentsResult.value.comments.length
        : enrichedTask.commentCount
    };
  } else {
    syncIssues.push({
      scope: "task-comments",
      taskId: task.id,
      taskName: task.name,
      message: commentsResult.reason instanceof Error ? commentsResult.reason.message : "Falha"
    });
  }

  return finalizeTask(enrichedTask);
}

async function fetchWorkspaceGoals(team, token, syncIssues) {
  try {
    const payload = await fetchJson(`/team/${team.id}/goal`, token);
    const goals = Array.isArray(payload.goals) ? payload.goals : [];
    const normalizedGoals = [];

    for (const goal of goals) {
      try {
        const details = await fetchJson(`/goal/${goal.id}`, token);
        normalizedGoals.push(normalizeGoal(details.goal ?? details, team));
      } catch (error) {
        syncIssues.push({
          scope: "goal-detail",
          workspaceId: team.id,
          workspaceName: team.name,
          goalId: goal.id,
          message: error instanceof Error ? error.message : "Falha ao carregar goal."
        });
        normalizedGoals.push(normalizeGoal(goal, team));
      }
    }

    return normalizedGoals;
  } catch (error) {
    syncIssues.push({
      scope: "goals",
      workspaceId: team.id,
      workspaceName: team.name,
      message: error instanceof Error ? error.message : "Falha ao carregar goals."
    });
    return [];
  }
}

function normalizeTask(task, context, trackingConfig) {
  const baseTask = {
    id: task.id,
    name: task.name,
    description: task.description ?? "",
    textContent: extractTextContent(task.description),
    url: task.url ?? "",
    dateCreated: task.date_created ?? null,
    dateUpdated: task.date_updated ?? null,
    startDate: task.start_date ?? null,
    dueDate: task.due_date ?? null,
    dateDone: task.date_done ?? null,
    dateClosed: task.date_closed ?? null,
    archived: task.archived ?? false,
    parent: task.parent ?? null,
    priority: normalizePriority(task.priority),
    status: normalizeStatus(task.status),
    tags: normalizeTags(task.tags),
    assignees: normalizeUsers(task.assignees),
    watchers: normalizeUsers(task.watchers),
    creator: normalizeUser(task.creator),
    timeEstimate: task.time_estimate ?? null,
    timeSpent: task.time_spent ?? null,
    points: task.points ?? null,
    customFields: normalizeCustomFields(task.custom_fields),
    dependencies: normalizeDependencies(task.dependencies),
    linkedTasks: normalizeLinkedTasks(task.linked_tasks),
    attachments: normalizeAttachments(task.attachments),
    checklists: normalizeChecklists(task.checklists),
    comments: [],
    commentCount: 0,
    list: task.list
      ? {
          id: task.list.id,
          name: task.list.name
        }
      : {
          id: null,
          name: ""
        },
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
      : null
  };

  return finalizeTask({
    ...baseTask,
    isTracked: hasTrackingTag(baseTask.tags, trackingConfig.tag)
  });
}

function mergeTaskData(task, detailTask) {
  return {
    ...task,
    description: detailTask.description ?? task.description,
    textContent: extractTextContent(detailTask.description ?? task.description),
    url: detailTask.url ?? task.url,
    dateUpdated: detailTask.date_updated ?? task.dateUpdated,
    startDate: detailTask.start_date ?? task.startDate,
    dueDate: detailTask.due_date ?? task.dueDate,
    dateDone: detailTask.date_done ?? task.dateDone,
    dateClosed: detailTask.date_closed ?? task.dateClosed,
    archived: detailTask.archived ?? task.archived,
    priority: normalizePriority(detailTask.priority) ?? task.priority,
    status: normalizeStatus(detailTask.status) ?? task.status,
    tags: detailTask.tags ? normalizeTags(detailTask.tags) : task.tags,
    assignees: detailTask.assignees ? normalizeUsers(detailTask.assignees) : task.assignees,
    watchers: detailTask.watchers ? normalizeUsers(detailTask.watchers) : task.watchers,
    creator: normalizeUser(detailTask.creator) ?? task.creator,
    timeEstimate: detailTask.time_estimate ?? task.timeEstimate,
    timeSpent: detailTask.time_spent ?? task.timeSpent,
    points: detailTask.points ?? task.points,
    customFields: detailTask.custom_fields
      ? normalizeCustomFields(detailTask.custom_fields)
      : task.customFields,
    dependencies: detailTask.dependencies
      ? normalizeDependencies(detailTask.dependencies)
      : task.dependencies,
    linkedTasks: detailTask.linked_tasks
      ? normalizeLinkedTasks(detailTask.linked_tasks)
      : task.linkedTasks,
    attachments: detailTask.attachments
      ? normalizeAttachments(detailTask.attachments)
      : task.attachments,
    checklists: detailTask.checklists
      ? normalizeChecklists(detailTask.checklists)
      : task.checklists
  };
}

function finalizeTask(task) {
  const commentDates = task.comments
    .map((comment) => toNumber(comment.date))
    .filter((value) => value !== null);
  const lastCommentAt =
    commentDates.length > 0 ? String(Math.max(...commentDates)) : null;

  return {
    ...task,
    lastCommentAt,
    recentActivityAt: String(
      Math.max(
        toNumber(task.dateUpdated) ?? 0,
        toNumber(task.dateClosed) ?? 0,
        toNumber(lastCommentAt) ?? 0
      )
    )
  };
}

function normalizeStatus(status) {
  if (!status) {
    return null;
  }

  return {
    status: status.status,
    color: status.color,
    type: status.type
  };
}

function normalizePriority(priority) {
  if (!priority) {
    return null;
  }

  return {
    id: priority.id ?? null,
    priority: priority.priority ?? "",
    color: priority.color ?? null
  };
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags.map((tag) => ({
        name: tag.name,
        tagFg: tag.tag_fg,
        tagBg: tag.tag_bg
      }))
    : [];
}

function normalizeUsers(users) {
  return Array.isArray(users) ? users.map(normalizeUser).filter(Boolean) : [];
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id ?? null,
    username: user.username ?? user.email ?? "Sem nome",
    email: user.email ?? null,
    initials: user.initials ?? null,
    color: user.color ?? null
  };
}

function normalizeCustomFields(fields) {
  return Array.isArray(fields)
    ? fields.map((field) => ({
        id: field.id ?? null,
        name: field.name ?? "Campo",
        type: field.type ?? null,
        required: Boolean(field.required),
        value: field.value ?? null,
        valueLabel: stringifyCustomFieldValue(field),
        typeConfig: field.type_config ?? null
      }))
    : [];
}

function normalizeDependencies(dependencies) {
  return Array.isArray(dependencies)
    ? dependencies.map((dependency) => ({
        taskId: dependency.task_id ?? dependency.taskId ?? null,
        dependsOn: dependency.depends_on ?? dependency.dependsOn ?? null,
        type: dependency.type ?? null,
        chainId: dependency.chain_id ?? null
      }))
    : [];
}

function normalizeLinkedTasks(linkedTasks) {
  return Array.isArray(linkedTasks)
    ? linkedTasks.map((linkedTask) => ({
        taskId: linkedTask.task_id ?? linkedTask.taskId ?? null,
        linkId: linkedTask.link_id ?? linkedTask.linkId ?? null
      }))
    : [];
}

function normalizeAttachments(attachments) {
  return Array.isArray(attachments)
    ? attachments.map((attachment) => ({
        id: attachment.id ?? null,
        title: attachment.title ?? attachment.filename ?? "Anexo",
        url: attachment.url ?? attachment.attachment_url ?? "",
        mimeType: attachment.mime_type ?? null,
        date: attachment.date ?? attachment.date_created ?? null
      }))
    : [];
}

function normalizeChecklists(checklists) {
  return Array.isArray(checklists)
    ? checklists.map((checklist) => ({
        id: checklist.id ?? null,
        name: checklist.name ?? "Checklist",
        items: Array.isArray(checklist.items)
          ? checklist.items.map((item) => ({
              id: item.id ?? null,
              name: item.name ?? "Item",
              resolved: Boolean(item.resolved)
            }))
          : []
      }))
    : [];
}

function normalizeComments(comments) {
  return Array.isArray(comments)
    ? comments.map((comment) => ({
        id: comment.id ?? null,
        text: comment.comment_text ?? comment.comment ?? "",
        textPreview: extractTextContent(comment.comment_text ?? comment.comment ?? ""),
        date: comment.date ?? comment.date_created ?? null,
        user: normalizeUser(comment.user ?? comment.assignee ?? comment.creator),
        resolved: Boolean(comment.resolved)
      }))
    : [];
}

function normalizeGoal(goal, team) {
  const owners = normalizeUsers(goal.owners ?? goal.owner ?? []);
  const targets = Array.isArray(goal.key_results)
    ? goal.key_results.map(normalizeGoalTarget)
    : Array.isArray(goal.targets)
      ? goal.targets.map(normalizeGoalTarget)
      : [];

  return {
    id: goal.id ?? null,
    name: goal.name ?? "Goal",
    description: goal.description ?? "",
    workspace: {
      id: team.id,
      name: team.name
    },
    dueDate: goal.due_date ?? goal.dueDate ?? null,
    color: goal.color ?? null,
    percentComplete: normalizePercentComplete(goal.percent_completed ?? goal.progress),
    prettyId: goal.pretty_id ?? null,
    owners,
    targets
  };
}

function normalizeGoalTarget(target) {
  return {
    id: target.id ?? null,
    name: target.name ?? "Target",
    type: target.type ?? null,
    current: target.current ?? target.current_value ?? null,
    target: target.target ?? target.goal ?? null,
    percentComplete: normalizePercentComplete(target.percent_completed ?? target.progress)
  };
}

function buildHistoryEntry(trackedTasks) {
  return {
    exportedAt: new Date().toISOString(),
    trackedProjects: trackedTasks.map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status?.status ?? "Sem status",
      dueDate: task.dueDate ?? null,
      ownerNames: task.assignees.map((assignee) => assignee.username),
      updatedAt: task.dateUpdated ?? null,
      commentCount: task.commentCount ?? 0
    }))
  };
}

function mergeHistoryEntries(existingHistory, currentEntry) {
  const sanitized = Array.isArray(existingHistory) ? existingHistory : [];
  const withoutDuplicates = sanitized.filter(
    (entry) => entry?.exportedAt && entry.exportedAt !== currentEntry.exportedAt
  );

  return [...withoutDuplicates, currentEntry].slice(-HISTORY_LIMIT);
}

function getTrackingConfig() {
  return {
    tag: process.env.CLICKUP_TRACKING_TAG?.trim() || DEFAULT_TRACKING_TAG,
    requiredCustomFields: parseCsv(process.env.CLICKUP_REQUIRED_CUSTOM_FIELDS),
    staleAfterDays: getPositiveNumber(
      process.env.CLICKUP_STALE_AFTER_DAYS,
      DEFAULT_STALE_AFTER_DAYS
    )
  };
}

function hasTrackingTag(tags, trackingTag) {
  return tags.some((tag) => normalize(tag.name) === normalize(trackingTag));
}

function stringifyCustomFieldValue(field) {
  const value = field.value;

  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyCustomFieldOption(field, item)).join(", ");
  }

  if (typeof value === "object") {
    if ("name" in value && value.name) {
      return String(value.name);
    }

    if ("label" in value && value.label) {
      return String(value.label);
    }

    return JSON.stringify(value);
  }

  return stringifyCustomFieldOption(field, value);
}

function stringifyCustomFieldOption(field, value) {
  const options = Array.isArray(field.type_config?.options) ? field.type_config.options : [];
  const matchedOption = options.find(
    (option) => option.id === value || option.orderindex === value || option.name === value
  );

  if (matchedOption) {
    return matchedOption.name ?? String(value);
  }

  if (field.type === "date") {
    const numericValue = toNumber(value);
    return numericValue === null ? String(value) : new Date(numericValue).toISOString();
  }

  return String(value);
}

function normalizePercentComplete(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return numeric > 1 ? numeric : numeric * 100;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPositiveNumber(rawValue, fallback) {
  const parsed = Number(String(rawValue ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function extractTextContent(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
