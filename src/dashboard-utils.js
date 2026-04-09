const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_AFTER_DAYS = 7;

export const NAV_ITEMS = [
  { id: "executive", label: "Visao executiva" },
  { id: "tracked", label: "Acompanhadas" },
  { id: "risks", label: "Riscos e atencao" },
  { id: "workload", label: "Carga por responsavel" },
  { id: "timeline", label: "Linha do tempo" },
  { id: "quality", label: "Qualidade do cadastro" },
  { id: "goals", label: "Metas e resultados" },
  { id: "updates", label: "Atualizacoes recentes" }
];

export function buildDashboardModel(data) {
  const trackingConfig = {
    tag: data?.trackingConfig?.tag || "acompanhada",
    requiredCustomFields: Array.isArray(data?.trackingConfig?.requiredCustomFields)
      ? data.trackingConfig.requiredCustomFields
      : [],
    staleAfterDays: Number(data?.trackingConfig?.staleAfterDays) || DEFAULT_STALE_AFTER_DAYS
  };

  const allTasks = flattenAllTasks(data);
  const childrenByParent = buildChildrenByParent(allTasks);
  const previousSnapshot = Array.isArray(data?.history) ? data.history.at(-2) || null : null;
  const trackedProjects = getTrackedProjects(data, childrenByParent);
  const previousMap = buildPreviousMap(previousSnapshot);
  const projectMap = new Map(trackedProjects.map((project) => [project.id, project]));

  return {
    trackingConfig,
    allTasks,
    trackedProjects,
    projectMap,
    executive: buildExecutiveSummary(trackedProjects),
    risks: buildRiskModel(trackedProjects, trackingConfig),
    workload: buildWorkloadModel(trackedProjects),
    timeline: buildTimelineModel(trackedProjects),
    quality: buildQualityModel(trackedProjects, trackingConfig),
    goals: buildGoalsModel(data?.goals, trackedProjects),
    updates: buildUpdatesModel(trackedProjects, previousMap, previousSnapshot),
    previousSnapshotAt: previousSnapshot?.exportedAt ?? null,
    syncIssues: Array.isArray(data?.syncIssues) ? data.syncIssues : []
  };
}

export function getTrackedProjects(data, childrenByParent = buildChildrenByParent(flattenAllTasks(data))) {
  const sourceTasks =
    Array.isArray(data?.trackedTasks) && data.trackedTasks.length > 0
      ? data.trackedTasks
      : flattenAllTasks(data).filter((task) =>
          (task.tags || []).some((tag) => normalize(tag.name) === normalize(data?.trackingConfig?.tag || "acompanhada"))
        );

  return sourceTasks
    .map((task) => normalizeProject(task, childrenByParent))
    .sort((a, b) => {
      if (a.isClosed !== b.isClosed) {
        return Number(a.isClosed) - Number(b.isClosed);
      }

      if (a.dueTimestamp === null) {
        return 1;
      }

      if (b.dueTimestamp === null) {
        return -1;
      }

      return a.dueTimestamp - b.dueTimestamp;
    });
}

export function flattenAllTasks(data) {
  const folderlessLists = Array.isArray(data?.folderlessLists) ? data.folderlessLists : [];
  const folders = Array.isArray(data?.folders) ? data.folders : [];
  const lists = [...folderlessLists, ...folders.flatMap((folder) => folder.lists || [])];

  return lists.flatMap((list) =>
    (list.tasks || []).map((task) => ({
      ...task,
      workspace: task.workspace || list.workspace || null,
      space: task.space || list.space || null,
      folder: task.folder || list.folder || null,
      list: task.list || { id: list.id, name: list.name }
    }))
  );
}

function normalizeProject(task, childrenByParent) {
  const dueTimestamp = toNumber(task.dueDate);
  const startTimestamp = toNumber(task.startDate);
  const updatedTimestamp = toNumber(task.dateUpdated);
  const recentActivityTimestamp = toNumber(task.recentActivityAt) || updatedTimestamp;
  const owners = Array.isArray(task.assignees) ? task.assignees : [];
  const ownerNames = owners.map((owner) => owner.username).filter(Boolean);
  const daysToDue =
    dueTimestamp === null ? null : Math.ceil((dueTimestamp - Date.now()) / DAY_IN_MS);
  const isClosed = Boolean(task.dateClosed) || isClosedStatus(task.status?.type);
  const subtasks = childrenByParent.get(task.id) || [];
  const customFields = Array.isArray(task.customFields) ? task.customFields : [];
  const comments = Array.isArray(task.comments) ? task.comments : [];
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  const dependencies = Array.isArray(task.dependencies) ? task.dependencies : [];

  return {
    id: task.id,
    name: task.name,
    url: task.url,
    description: task.textContent || task.description || "",
    workspaceName: task.workspace?.name || "Workspace",
    spaceName: task.space?.name || "Space",
    folderName: task.folder?.name || "Sem folder",
    listName: task.list?.name || "Lista",
    areaLabel: getAreaLabel(task),
    dueTimestamp,
    startTimestamp,
    updatedTimestamp,
    recentActivityTimestamp,
    dueLabel: dueTimestamp ? formatDate(dueTimestamp) : "Sem prazo",
    updatedLabel: updatedTimestamp ? formatDateTime(updatedTimestamp) : "Sem atualizacao",
    recentActivityLabel: recentActivityTimestamp
      ? formatDateTime(recentActivityTimestamp)
      : "Sem atividade",
    timelineLabel: getTimelineLabel(daysToDue),
    ownerLabel: ownerNames.length > 0 ? ownerNames.join(", ") : "Sem responsavel",
    owners,
    uniqueOwnerNames: ownerNames,
    status: {
      label: task.status?.status || "Sem status",
      color: task.status?.color || "#385696",
      type: task.status?.type || "unknown"
    },
    priority: task.priority?.priority || "Sem prioridade",
    priorityColor: task.priority?.color || "#64748b",
    tags: Array.isArray(task.tags) ? task.tags : [],
    tagsLabel: (task.tags || []).map((tag) => tag.name).join(", ") || "Sem tags",
    health: getHealth(daysToDue, isClosed),
    daysToDue,
    isClosed,
    customFields,
    customFieldCount: customFields.filter((field) => hasValue(field.valueLabel)).length,
    comments,
    commentCount: Number(task.commentCount) || comments.length,
    attachments,
    attachmentCount: attachments.length,
    dependencies,
    dependencyCount: dependencies.length,
    linkedTaskCount: Array.isArray(task.linkedTasks) ? task.linkedTasks.length : 0,
    subtasks,
    subtasksCount: subtasks.length,
    checklistCount: Array.isArray(task.checklists) ? task.checklists.length : 0,
    timeEstimate: toNumber(task.timeEstimate),
    timeSpent: toNumber(task.timeSpent),
    points: task.points ?? null
  };
}

function buildExecutiveSummary(projects) {
  const openProjects = projects.filter((project) => !project.isClosed);
  const overdue = openProjects.filter((project) => project.daysToDue !== null && project.daysToDue < 0);
  const next7 = openProjects.filter((project) => project.daysToDue !== null && project.daysToDue >= 0 && project.daysToDue <= 7);
  const next15 = openProjects.filter((project) => project.daysToDue !== null && project.daysToDue >= 0 && project.daysToDue <= 15);
  const next30 = openProjects.filter((project) => project.daysToDue !== null && project.daysToDue >= 0 && project.daysToDue <= 30);
  const byStatus = summarizeBy(projects, (project) => project.status.label);
  const byArea = summarizeBy(projects, (project) => project.areaLabel);
  const byWorkspace = summarizeBy(projects, (project) => project.workspaceName);

  return {
    total: projects.length,
    openCount: openProjects.length,
    closedCount: projects.length - openProjects.length,
    overdueCount: overdue.length,
    next7Count: next7.length,
    next15Count: next15.length,
    next30Count: next30.length,
    withoutOwnerCount: projects.filter((project) => project.uniqueOwnerNames.length === 0).length,
    withoutDueDateCount: projects.filter((project) => project.dueTimestamp === null).length,
    byStatus,
    byArea,
    byWorkspace,
    spotlight: [
      { label: "Atrasados", value: overdue.length, projects: overdue },
      { label: "Entrega em 7 dias", value: next7.length, projects: next7 },
      { label: "Entrega em 15 dias", value: next15.length, projects: next15 },
      { label: "Entrega em 30 dias", value: next30.length, projects: next30 }
    ]
  };
}

function buildRiskModel(projects, trackingConfig) {
  const now = Date.now();
  const staleThresholdMs = trackingConfig.staleAfterDays * DAY_IN_MS;
  const stale = projects.filter(
    (project) =>
      !project.isClosed &&
      project.updatedTimestamp !== null &&
      now - project.updatedTimestamp > staleThresholdMs
  );

  return {
    overdue: projects.filter((project) => !project.isClosed && project.daysToDue !== null && project.daysToDue < 0),
    stale,
    withoutOwner: projects.filter((project) => !project.isClosed && project.uniqueOwnerNames.length === 0),
    withoutDueDate: projects.filter((project) => !project.isClosed && project.dueTimestamp === null),
    blocked: projects.filter((project) => !project.isClosed && project.dependencyCount > 0),
    critical: projects.filter(
      (project) =>
        !project.isClosed &&
        (project.daysToDue !== null && project.daysToDue < 0 ||
          project.uniqueOwnerNames.length === 0 ||
          project.dueTimestamp === null ||
          project.dependencyCount > 0)
    )
  };
}

function buildWorkloadModel(projects) {
  const owners = new Map();

  for (const project of projects.filter((item) => !item.isClosed)) {
    const ownerNames = project.uniqueOwnerNames.length > 0 ? project.uniqueOwnerNames : ["Sem responsavel"];

    for (const ownerName of ownerNames) {
      if (!owners.has(ownerName)) {
        owners.set(ownerName, {
          owner: ownerName,
          count: 0,
          overdueCount: 0,
          next7Count: 0,
          highPressureCount: 0,
          estimateHours: 0,
          spentHours: 0,
          projects: []
        });
      }

      const item = owners.get(ownerName);
      item.count += 1;
      item.estimateHours += (project.timeEstimate || 0) / 3600000;
      item.spentHours += (project.timeSpent || 0) / 3600000;
      if (project.daysToDue !== null && project.daysToDue < 0) {
        item.overdueCount += 1;
      }
      if (project.daysToDue !== null && project.daysToDue >= 0 && project.daysToDue <= 7) {
        item.next7Count += 1;
      }
      if (project.daysToDue !== null && project.daysToDue <= 7) {
        item.highPressureCount += 1;
      }
      item.projects.push(project);
    }
  }

  return [...owners.values()]
    .sort((a, b) => b.highPressureCount - a.highPressureCount || b.count - a.count)
    .map((owner) => ({
      ...owner,
      estimateLabel: formatHours(owner.estimateHours),
      spentLabel: formatHours(owner.spentHours)
    }));
}

function buildTimelineModel(projects) {
  const groups = new Map();

  for (const project of projects) {
    const key = project.dueTimestamp
      ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
          new Date(project.dueTimestamp)
        )
      : "Sem prazo definido";

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(project);
  }

  return [...groups.entries()].map(([label, items]) => ({
    label,
    count: items.length,
    items: items.sort((a, b) => (a.dueTimestamp || Number.MAX_SAFE_INTEGER) - (b.dueTimestamp || Number.MAX_SAFE_INTEGER))
  }));
}

function buildQualityModel(projects, trackingConfig) {
  const requiredFields = trackingConfig.requiredCustomFields.map((field) => normalize(field));

  const items = projects.map((project) => {
    const issueLabels = [];
    const normalizedFieldNames = project.customFields
      .filter((field) => hasValue(field.valueLabel))
      .map((field) => normalize(field.name));

    if (!hasValue(project.description)) {
      issueLabels.push("Sem descricao");
    }
    if (project.uniqueOwnerNames.length === 0) {
      issueLabels.push("Sem responsavel");
    }
    if (project.dueTimestamp === null) {
      issueLabels.push("Sem prazo");
    }
    if (!project.timeEstimate) {
      issueLabels.push("Sem estimativa");
    }
    if (project.customFieldCount === 0) {
      issueLabels.push("Sem custom fields preenchidos");
    }
    if (project.commentCount === 0) {
      issueLabels.push("Sem comentarios sincronizados");
    }

    const missingRequired = requiredFields.filter((field) => !normalizedFieldNames.includes(field));
    if (missingRequired.length > 0) {
      issueLabels.push(`Campos obrigatorios ausentes: ${missingRequired.join(", ")}`);
    }

    return {
      project,
      issueLabels,
      issueCount: issueLabels.length
    };
  });

  return {
    totalIssues: items.reduce((total, item) => total + item.issueCount, 0),
    items: items.sort((a, b) => b.issueCount - a.issueCount || a.project.name.localeCompare(b.project.name, "pt-BR")),
    categorySummary: summarizeFlatLabels(items.flatMap((item) => item.issueLabels))
  };
}

function buildGoalsModel(goalsInput, projects) {
  const goals = Array.isArray(goalsInput) ? goalsInput : [];

  return goals
    .map((goal) => ({
      ...goal,
      percentLabel: goal.percentComplete === null ? "Sem progresso" : `${Math.round(goal.percentComplete)}%`,
      relatedProjects: projects
        .filter((project) => project.workspaceName === goal.workspace?.name)
        .slice(0, 4)
    }))
    .sort((a, b) => (b.percentComplete ?? -1) - (a.percentComplete ?? -1));
}

function buildUpdatesModel(projects, previousMap, previousSnapshot) {
  const updates = [];

  for (const project of projects) {
    const previous = previousMap.get(project.id);

    if (!previous) {
      updates.push({
        projectId: project.id,
        kind: "novo",
        timestamp: project.updatedTimestamp || project.dueTimestamp || Date.now(),
        label: "Projeto entrou no monitoramento",
        detail: `${project.name} passou a aparecer como projeto acompanhado.`
      });
      continue;
    }

    if (previous.status !== project.status.label) {
      updates.push({
        projectId: project.id,
        kind: "status",
        timestamp: project.updatedTimestamp || Date.now(),
        label: "Mudanca de status",
        detail: `${project.name}: ${previous.status} -> ${project.status.label}`
      });
    }

    if ((previous.dueDate || null) !== (project.dueTimestamp ? String(project.dueTimestamp) : null)) {
      updates.push({
        projectId: project.id,
        kind: "prazo",
        timestamp: project.updatedTimestamp || project.dueTimestamp || Date.now(),
        label: "Prazo alterado",
        detail: `${project.name}: ${previous.dueDate ? formatDate(Number(previous.dueDate)) : "Sem prazo"} -> ${project.dueLabel}`
      });
    }

    const previousOwners = (previous.ownerNames || []).join(", ");
    const currentOwners = project.uniqueOwnerNames.join(", ");
    if (previousOwners !== currentOwners) {
      updates.push({
        projectId: project.id,
        kind: "responsavel",
        timestamp: project.updatedTimestamp || Date.now(),
        label: "Responsavel atualizado",
        detail: `${project.name}: ${previousOwners || "Sem responsavel"} -> ${currentOwners || "Sem responsavel"}`
      });
    }

    if ((previous.commentCount || 0) < project.commentCount) {
      updates.push({
        projectId: project.id,
        kind: "comentario",
        timestamp: project.recentActivityTimestamp || Date.now(),
        label: "Novos comentarios",
        detail: `${project.name} recebeu ${project.commentCount - (previous.commentCount || 0)} novo(s) comentario(s).`
      });
    }
  }

  return {
    previousSnapshotAt: previousSnapshot?.exportedAt ?? null,
    items: updates.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20)
  };
}

function buildPreviousMap(previousSnapshot) {
  if (!previousSnapshot || !Array.isArray(previousSnapshot.trackedProjects)) {
    return new Map();
  }

  return new Map(previousSnapshot.trackedProjects.map((project) => [project.id, project]));
}

function buildChildrenByParent(tasks) {
  const map = new Map();

  for (const task of tasks) {
    if (!task.parent) {
      continue;
    }

    if (!map.has(task.parent)) {
      map.set(task.parent, []);
    }

    map.get(task.parent).push({
      id: task.id,
      name: task.name,
      status: task.status?.status || "Sem status",
      url: task.url || ""
    });
  }

  return map;
}

function summarizeBy(items, getKey) {
  const groups = new Map();

  for (const item of items) {
    const key = getKey(item) || "Sem classificacao";
    groups.set(key, (groups.get(key) || 0) + 1);
  }

  return [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));
}

function summarizeFlatLabels(labels) {
  return summarizeBy(labels.map((label) => ({ label })), (item) => item.label);
}

function getAreaLabel(task) {
  const customFields = Array.isArray(task.customFields) ? task.customFields : [];
  const field = customFields.find((item) =>
    ["area", "orgao", "programa", "unidade", "eixo", "secretaria"].includes(normalize(item.name))
  );

  return field?.valueLabel || task.space?.name || task.list?.name || "Sem area";
}

export function getHealth(daysToDue, isClosed) {
  if (isClosed) {
    return { label: "Concluido", tone: "violet" };
  }
  if (daysToDue === null) {
    return { label: "Sem prazo", tone: "slate" };
  }
  if (daysToDue < 0) {
    return { label: "Atrasado", tone: "red" };
  }
  if (daysToDue <= 7) {
    return { label: "Ponto de atencao", tone: "amber" };
  }
  if (daysToDue <= 30) {
    return { label: "Prazo proximo", tone: "cyan" };
  }
  return { label: "Em janela confortavel", tone: "blue" };
}

export function getTimelineLabel(daysToDue) {
  if (daysToDue === null) {
    return "Sem data final";
  }
  if (daysToDue < 0) {
    return `${Math.abs(daysToDue)} dia(s) de atraso`;
  }
  if (daysToDue === 0) {
    return "Vence hoje";
  }
  return `${daysToDue} dia(s) restantes`;
}

function isClosedStatus(type) {
  return type === "closed" || type === "done";
}

function hasValue(value) {
  return String(value ?? "").trim().length > 0;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function formatHours(value) {
  if (!value) {
    return "0h";
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}
