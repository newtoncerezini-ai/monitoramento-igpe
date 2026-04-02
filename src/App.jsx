import clickupData from "../data/clickup-space.json";
import igpeLogo from "./assets/igpe-logo.png";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const TODAY = new Date();

const trackedProjects = getTrackedProjects(clickupData);
const summary = buildSummary(trackedProjects);

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-brand">
            <img className="hero-logo" src={igpeLogo} alt="Logo do IGPE" />
            <div className="hero-brand-copy">
              <span className="eyebrow">Monitoramento IGPE</span>
              <span className="hero-tag">Instituto de Gestão de Pernambuco</span>
            </div>
          </div>

          <h1>Painel de projetos acompanhados</h1>
          <p>
            Uma leitura rápida do que está em acompanhamento no ClickUp, com foco
            em volume, prazos e responsáveis.
          </p>
        </div>

        <div className="hero-meta">
          <MetaCard label="Projetos acompanhados" value={summary.total} />
          <MetaCard
            label="Última atualização"
            value={formatDateTime(clickupData.exportedAt)}
          />
          <MetaCard label="Escopo monitorado" value={getSourceLabel(clickupData)} />
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          label="Em andamento"
          value={summary.openCount}
          hint="Projetos ainda não concluídos"
          tone="blue"
        />
        <StatCard
          label="Prazo próximo"
          value={summary.dueSoonCount}
          hint="Vencem nos próximos 30 dias"
          tone="cyan"
        />
        <StatCard
          label="Horizonte longo"
          value={summary.longHorizonCount}
          hint="Prazo acima de 30 dias"
          tone="violet"
        />
        <StatCard
          label="Sem responsável"
          value={summary.withoutOwnerCount}
          hint="Itens sem pessoa atribuída"
          tone="slate"
        />
      </section>

      <section className="content-grid">
        <div className="panel panel-accent">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Distribuição</span>
              <h2>Como está a carteira</h2>
            </div>
          </div>

          <div className="distribution-list">
            {summary.statusDistribution.map((item) => (
              <div className="distribution-row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </div>
                <div className="distribution-value">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Leitura rápida</span>
              <h2>Resumo executivo</h2>
            </div>
          </div>

          <ul className="insight-list">
            <li>
              {summary.openCount} projetos acompanhados estão em andamento neste
              momento.
            </li>
            <li>
              {summary.dueSoonCount === 0
                ? "Nenhum projeto acompanhado vence nos próximos 30 dias."
                : `${summary.dueSoonCount} projeto${summary.dueSoonCount > 1 ? "s" : ""} pedem atenção por prazo mais próximo.`}
            </li>
            <li>
              {summary.uniqueOwnersCount} pessoa
              {summary.uniqueOwnersCount > 1 ? "s aparecem" : " aparece"} como
              responsável nas frentes acompanhadas.
            </li>
            <li>{summary.statusHeadline}</li>
          </ul>
        </div>
      </section>

      <section className="panel projects-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">Projetos</span>
            <h2>Visão geral dos acompanhados</h2>
          </div>
        </div>

        <div className="project-grid">
          {trackedProjects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-topline">
                <span
                  className="status-pill"
                  style={{ "--pill-color": project.status.color || "#2563eb" }}
                >
                  {project.status.label}
                </span>
                <span className={`health-pill health-${project.health.tone}`}>
                  {project.health.label}
                </span>
              </div>

              <h3>{project.name}</h3>
              <p className="project-list-name">{project.listName}</p>

              <dl className="project-meta">
                <div>
                  <dt>Responsável</dt>
                  <dd>{project.ownerLabel}</dd>
                </div>
                <div>
                  <dt>Prazo</dt>
                  <dd>{project.dueLabel}</dd>
                </div>
                <div>
                  <dt>Janela</dt>
                  <dd>{project.timelineLabel}</dd>
                </div>
                <div>
                  <dt>Tags</dt>
                  <dd>{project.tagsLabel}</dd>
                </div>
              </dl>

              <a
                className="project-link"
                href={project.url}
                target="_blank"
                rel="noreferrer"
              >
                Abrir no ClickUp
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function getTrackedProjects(data) {
  const lists = [
    ...(data.folderlessLists || []),
    ...(data.folders || []).flatMap((folder) => folder.lists || [])
  ];

  return lists
    .flatMap((list) =>
      (list.tasks || [])
        .filter((task) =>
          (task.tags || []).some((tag) => normalize(tag.name) === "acompanhada")
        )
        .map((task) => normalizeProject(task, list))
    )
    .sort((a, b) => {
      if (a.dueTimestamp === null) {
        return 1;
      }

      if (b.dueTimestamp === null) {
        return -1;
      }

      return a.dueTimestamp - b.dueTimestamp;
    });
}

function normalizeProject(task, list) {
  const dueTimestamp = task.dueDate ? Number(task.dueDate) : null;
  const ownerNames = (task.assignees || []).map((assignee) => assignee.username);
  const daysToDue =
    dueTimestamp === null ? null : Math.ceil((dueTimestamp - TODAY.getTime()) / DAY_IN_MS);
  const isClosed = Boolean(task.dateClosed) || isClosedStatus(task.status?.type);

  return {
    id: task.id,
    name: task.name,
    url: task.url,
    listName: task.list?.name || list.name,
    dueTimestamp,
    dueLabel: dueTimestamp ? formatDate(dueTimestamp) : "Sem prazo definido",
    timelineLabel: getTimelineLabel(daysToDue),
    ownerLabel: ownerNames.length > 0 ? ownerNames.join(", ") : "Sem responsável",
    tagsLabel: (task.tags || []).map((tag) => tag.name).join(", "),
    status: {
      label: task.status?.status || "Sem status",
      color: task.status?.color || "#64748b",
      type: task.status?.type || "unknown"
    },
    health: getHealth(daysToDue, isClosed),
    daysToDue,
    isClosed,
    owners: ownerNames
  };
}

function buildSummary(projects) {
  const openProjects = projects.filter((project) => !project.isClosed);
  const dueSoonCount = openProjects.filter(
    (project) => project.daysToDue !== null && project.daysToDue >= 0 && project.daysToDue <= 30
  ).length;
  const longHorizonCount = openProjects.filter(
    (project) => project.daysToDue !== null && project.daysToDue > 30
  ).length;
  const withoutOwnerCount = projects.filter((project) => project.owners.length === 0).length;
  const uniqueOwnersCount = new Set(projects.flatMap((project) => project.owners)).size;

  const healthMap = {
    Atrasado: {
      value: openProjects.filter((project) => project.health.label === "Atrasado").length,
      description: "Prazo já vencido"
    },
    "Prazo próximo": {
      value: openProjects.filter((project) => project.health.label === "Prazo próximo").length,
      description: "Até 30 dias para entrega"
    },
    "Em janela confortável": {
      value: openProjects.filter(
        (project) => project.health.label === "Em janela confortável"
      ).length,
      description: "Mais de 30 dias até o prazo"
    },
    "Sem prazo": {
      value: openProjects.filter((project) => project.health.label === "Sem prazo").length,
      description: "Sem data final cadastrada"
    }
  };

  return {
    total: projects.length,
    openCount: openProjects.length,
    dueSoonCount,
    longHorizonCount,
    withoutOwnerCount,
    uniqueOwnersCount,
    statusDistribution: Object.entries(healthMap)
      .map(([label, item]) => ({
        label,
        value: item.value,
        description: item.description
      }))
      .filter((item) => item.value > 0),
    statusHeadline: buildStatusHeadline(openProjects)
  };
}

function buildStatusHeadline(projects) {
  const grouped = projects.reduce((accumulator, project) => {
    const key = project.status.label;
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    return "Nenhum projeto acompanhado encontrado no momento.";
  }

  if (entries.length === 1) {
    return `Todos os projetos acompanhados estão em "${entries[0][0]}".`;
  }

  return `O status mais frequente é "${entries[0][0]}", com ${entries[0][1]} projeto(s).`;
}

function getHealth(daysToDue, isClosed) {
  if (isClosed) {
    return { label: "Concluído", tone: "violet" };
  }

  if (daysToDue === null) {
    return { label: "Sem prazo", tone: "slate" };
  }

  if (daysToDue < 0) {
    return { label: "Atrasado", tone: "red" };
  }

  if (daysToDue <= 30) {
    return { label: "Prazo próximo", tone: "cyan" };
  }

  return { label: "Em janela confortável", tone: "blue" };
}

function getTimelineLabel(daysToDue) {
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

function normalize(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function getSourceLabel(data) {
  if (Array.isArray(data.workspaces) && data.workspaces.length > 0) {
    return `${data.workspaces.length} workspace(s)`;
  }

  return data.space?.name || "ClickUp";
}

function MetaCard({ label, value }) {
  return (
    <div className="meta-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatCard({ label, value, hint, tone }) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}
