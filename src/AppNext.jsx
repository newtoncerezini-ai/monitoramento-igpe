import { useEffect, useState } from "react";
import clickupData from "./empty-dashboard-data.js";
import igpeLogo from "./assets/igpe-logo.png";
import {
  NAV_ITEMS,
  buildDashboardModel,
  formatDate,
  formatDateTime,
  formatHours
} from "./dashboard-utils.js";

export default function AppNext() {
  const [dashboardData, setDashboardData] = useState(clickupData);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeView, setActiveView] = useState("executive");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    void initializeDashboard();
  }, []);

  async function initializeDashboard() {
    setIsLoading(true);
    setStatusMessage("Sincronizando o painel com o ClickUp...");
    setErrorMessage("");

    try {
      const payload = await refreshClickupData();

      if (payload.data) {
        setDashboardData(payload.data);
      } else {
        await loadData();
      }

      setStatusMessage("Painel sincronizado com os dados mais recentes do ClickUp.");
    } catch (error) {
      const fallbackLoaded = await loadData({ silentError: true });
      const baseMessage =
        error instanceof Error ? error.message : "Falha ao atualizar o ClickUp na abertura.";

      setErrorMessage(
        fallbackLoaded
          ? `${baseMessage} Exibindo a ultima exportacao disponivel no painel.`
          : baseMessage
      );

      if (fallbackLoaded) {
        setStatusMessage("Exibindo a ultima exportacao disponivel.");
      } else {
        setStatusMessage("");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function loadData({ silentError = false } = {}) {
    try {
      const response = await fetch(`/api/clickup-data?ts=${Date.now()}`, {
        cache: "no-store"
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Nao foi possivel carregar os dados do ClickUp.");
      }

      setDashboardData(payload);
      return true;
    } catch (error) {
      if (!silentError) {
        throw error;
      }

      return false;
    }
  }

  async function refreshClickupData() {
    const response = await fetch("/api/clickup-refresh", {
      method: "POST"
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Nao foi possivel atualizar os dados do ClickUp.");
    }

    return payload;
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const payload = await refreshClickupData();

      if (payload.data) {
        setDashboardData(payload.data);
      } else {
        await loadData();
      }

      setStatusMessage(payload.message || "Dados atualizados com sucesso.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Falha ao atualizar o ClickUp.");
    } finally {
      setIsRefreshing(false);
    }
  }

  const model = buildDashboardModel(dashboardData);
  const selectedProject = selectedProjectId ? model.projectMap.get(selectedProjectId) : null;
  const filteredProjects = model.trackedProjects.filter((project) => {
    const haystack = [
      project.name,
      project.ownerLabel,
      project.areaLabel,
      project.status.label,
      project.listName
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(searchTerm.trim().toLowerCase());
  });

  const navItems = selectedProject
    ? [...NAV_ITEMS, { id: "detail", label: "Detalhe do projeto" }]
    : NAV_ITEMS;

  return (
    <main className="dashboard-shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-brand">
            <img className="hero-logo" src={igpeLogo} alt="Logo do IGPE" />
            <div>
              <span className="eyebrow">Monitoramento IGPE</span>
              <h1>Central de acompanhamento de projetos</h1>
            </div>
          </div>

          <p className="hero-lead">
            Um cockpit unico para acompanhar a carteira com tag
            {" "}
            <strong>{model.trackingConfig.tag}</strong>
            , riscos, carga, qualidade, metas e mudancas recentes.
          </p>

          <div className="hero-actions">
            <button
              className="primary-button"
              type="button"
              onClick={handleRefresh}
              disabled={isLoading || isRefreshing}
            >
              {isRefreshing ? "Atualizando..." : "Atualizar agora"}
            </button>
            <span className="hero-status">
              {statusMessage ||
                (isLoading
                  ? "Carregando dados do ClickUp..."
                  : "Use as telas abaixo para navegar pelo portifolio acompanhado.")}
            </span>
          </div>

          {errorMessage ? <p className="feedback feedback-error">{errorMessage}</p> : null}
        </div>

        <div className="hero-grid">
          <HeroMetric label="Projetos acompanhados" value={model.executive.total} />
          <HeroMetric label="Atrasados" value={model.executive.overdueCount} tone="red" />
          <HeroMetric label="Entregas em 7 dias" value={model.executive.next7Count} tone="amber" />
          <HeroMetric
            label="Ultima exportacao"
            value={dashboardData?.exportedAt ? formatDateTime(dashboardData.exportedAt) : "Pendente"}
            tone="slate"
          />
        </div>
      </section>

      <nav className="top-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === activeView ? "nav-chip active" : "nav-chip"}
            onClick={() => setActiveView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className="summary-grid">
        <SummaryCard label="Abertos" value={model.executive.openCount} hint="Projetos em andamento" />
        <SummaryCard label="Fechados" value={model.executive.closedCount} hint="Projetos concluidos" />
        <SummaryCard label="Sem responsavel" value={model.executive.withoutOwnerCount} hint="Pedem saneamento" />
        <SummaryCard label="Sem prazo" value={model.executive.withoutDueDateCount} hint="Risco de acompanhamento" />
      </section>

      {activeView === "executive" ? <ExecutiveView model={model} onOpenProject={openProject} /> : null}
      {activeView === "tracked" ? (
        <TrackedView
          projects={filteredProjects}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          onOpenProject={openProject}
          trackingTag={model.trackingConfig.tag}
        />
      ) : null}
      {activeView === "risks" ? <RisksView model={model} onOpenProject={openProject} /> : null}
      {activeView === "workload" ? <WorkloadView model={model} onOpenProject={openProject} /> : null}
      {activeView === "timeline" ? <TimelineView model={model} onOpenProject={openProject} /> : null}
      {activeView === "quality" ? <QualityView model={model} onOpenProject={openProject} /> : null}
      {activeView === "goals" ? <GoalsView model={model} onOpenProject={openProject} /> : null}
      {activeView === "updates" ? <UpdatesView model={model} onOpenProject={openProject} /> : null}
      {activeView === "detail" && selectedProject ? (
        <DetailView
          project={selectedProject}
          model={model}
          onBack={() => setActiveView("tracked")}
        />
      ) : null}

      {model.syncIssues.length > 0 ? (
        <Panel
          kicker="Observabilidade"
          title="Avisos da ultima sincronizacao"
          aside={`${model.syncIssues.length} aviso(s)`}
        >
          <div className="list-stack">
            {model.syncIssues.slice(0, 6).map((issue, index) => (
              <div className="list-row" key={`${issue.scope}-${issue.taskId || issue.goalId || index}`}>
                <div>
                  <strong>{issue.scope}</strong>
                  <span>{issue.message}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </main>
  );

  function openProject(projectId) {
    setSelectedProjectId(projectId);
    setActiveView("detail");
  }
}

function ExecutiveView({ model, onOpenProject }) {
  return (
    <div className="view-stack">
      <div className="grid-two">
        <Panel kicker="Portfolio" title="Semaforo executivo">
          <div className="spotlight-grid">
            {model.executive.spotlight.map((item) => (
              <div className="spotlight-card" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </Panel>

        <Panel kicker="Distribuicao" title="Carteira por status">
          <BarList items={model.executive.byStatus.slice(0, 8)} />
        </Panel>
      </div>

      <div className="grid-two">
        <Panel kicker="Area" title="Projetos por area ou orgao">
          <BarList items={model.executive.byArea.slice(0, 8)} />
        </Panel>

        <Panel kicker="Workspace" title="Projetos por workspace">
          <BarList items={model.executive.byWorkspace.slice(0, 8)} />
        </Panel>
      </div>

      <Panel kicker="Atencao" title="Projetos que merecem leitura rapida">
        <ProjectRows projects={model.risks.critical.slice(0, 8)} onOpenProject={onOpenProject} />
      </Panel>
    </div>
  );
}

function TrackedView({ projects, searchTerm, onSearchTermChange, onOpenProject, trackingTag }) {
  return (
    <div className="view-stack">
      <Panel
        kicker="Acompanhadas"
        title={`Tela dedicada da tag ${trackingTag}`}
        aside={`${projects.length} projeto(s)`}
      >
        <div className="toolbar">
          <input
            className="search-input"
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Buscar por nome, area, responsavel ou status"
          />
        </div>
        <ProjectGrid projects={projects} onOpenProject={onOpenProject} />
      </Panel>
    </div>
  );
}

function RisksView({ model, onOpenProject }) {
  return (
    <div className="view-stack">
      <div className="grid-two">
        <Panel kicker="Risco" title="Atrasados" aside={`${model.risks.overdue.length}`}>
          <ProjectRows projects={model.risks.overdue} onOpenProject={onOpenProject} />
        </Panel>
        <Panel kicker="Risco" title="Sem atualizacao recente" aside={`${model.risks.stale.length}`}>
          <ProjectRows projects={model.risks.stale} onOpenProject={onOpenProject} />
        </Panel>
      </div>
      <div className="grid-two">
        <Panel kicker="Risco" title="Sem responsavel" aside={`${model.risks.withoutOwner.length}`}>
          <ProjectRows projects={model.risks.withoutOwner} onOpenProject={onOpenProject} />
        </Panel>
        <Panel kicker="Risco" title="Dependencias ativas" aside={`${model.risks.blocked.length}`}>
          <ProjectRows projects={model.risks.blocked} onOpenProject={onOpenProject} />
        </Panel>
      </div>
    </div>
  );
}

function WorkloadView({ model, onOpenProject }) {
  return (
    <Panel kicker="Capacidade" title="Carga por responsavel">
      <div className="owner-grid">
        {model.workload.map((owner) => (
          <article className="owner-card" key={owner.owner}>
            <div className="owner-head">
              <strong>{owner.owner}</strong>
              <span>{owner.count} projeto(s)</span>
            </div>
            <dl className="mini-stats">
              <div><dt>Atrasados</dt><dd>{owner.overdueCount}</dd></div>
              <div><dt>Em 7 dias</dt><dd>{owner.next7Count}</dd></div>
              <div><dt>Estimado</dt><dd>{owner.estimateLabel}</dd></div>
              <div><dt>Gasto</dt><dd>{owner.spentLabel}</dd></div>
            </dl>
            <ProjectRows projects={owner.projects.slice(0, 4)} onOpenProject={onOpenProject} compact />
          </article>
        ))}
      </div>
    </Panel>
  );
}

function TimelineView({ model, onOpenProject }) {
  return (
    <Panel kicker="Planejamento" title="Linha do tempo mensal">
      <div className="timeline-stack">
        {model.timeline.map((group) => (
          <section className="timeline-group" key={group.label}>
            <div className="timeline-head">
              <strong>{group.label}</strong>
              <span>{group.count} projeto(s)</span>
            </div>
            <ProjectRows projects={group.items} onOpenProject={onOpenProject} compact />
          </section>
        ))}
      </div>
    </Panel>
  );
}

function QualityView({ model, onOpenProject }) {
  return (
    <div className="view-stack">
      <div className="grid-two">
        <Panel kicker="Saneamento" title="Categorias de problema">
          <BarList items={model.quality.categorySummary} />
        </Panel>
        <Panel kicker="Saneamento" title="Carga total de pendencias" aside={`${model.quality.totalIssues} apontamento(s)`}>
          <div className="quality-callout">
            Corrigir cadastro aumenta a confiabilidade das telas de risco, prazo, workload e metas.
          </div>
        </Panel>
      </div>

      <Panel kicker="Cadastro" title="Projetos que mais precisam de ajuste">
        <div className="quality-list">
          {model.quality.items.map((item) => (
            <button className="quality-item" type="button" key={item.project.id} onClick={() => onOpenProject(item.project.id)}>
              <strong>{item.project.name}</strong>
              <span>{item.issueLabels.join(" | ") || "Sem pendencias"}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function GoalsView({ model, onOpenProject }) {
  return (
    <Panel kicker="Resultados" title="Metas e resultados conectados ao portfolio">
      {model.goals.length > 0 ? (
        <div className="goal-grid">
          {model.goals.map((goal) => (
            <article className="goal-card" key={goal.id || goal.name}>
              <div className="goal-head">
                <strong>{goal.name}</strong>
                <span>{goal.percentLabel}</span>
              </div>
              <p>{goal.description || "Goal sincronizado a partir do ClickUp."}</p>
              <div className="goal-meta">
                <span>{goal.workspace?.name || "Workspace"}</span>
                <span>{goal.dueDate ? formatDate(goal.dueDate) : "Sem prazo"}</span>
              </div>
              <div className="goal-progress"><div style={{ width: `${goal.percentComplete || 0}%` }} /></div>
              <ProjectRows projects={goal.relatedProjects} onOpenProject={onOpenProject} compact />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState message="Nenhuma goal foi retornada pelo ClickUp para os workspaces monitorados." />
      )}
    </Panel>
  );
}

function UpdatesView({ model, onOpenProject }) {
  return (
    <Panel kicker="Movimento" title="Atualizacoes recentes do portfolio">
      {model.updates.items.length > 0 ? (
        <div className="feed-list">
          {model.updates.items.map((item, index) => (
            <button className="feed-item" type="button" key={`${item.projectId}-${item.kind}-${index}`} onClick={() => onOpenProject(item.projectId)}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              <small>{formatDateTime(item.timestamp)}</small>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          message={
            model.updates.previousSnapshotAt
              ? "Nao houve diferencas relevantes entre a exportacao atual e a anterior."
              : "Assim que houver pelo menos duas exportacoes, esta tela mostra as mudancas."
          }
        />
      )}
    </Panel>
  );
}

function DetailView({ project, model, onBack }) {
  const qualityItems = Array.isArray(model?.quality?.items) ? model.quality.items : [];
  const updateItems = Array.isArray(model?.updates?.items) ? model.updates.items : [];
  const qualityItem = qualityItems.find((item) => item.project.id === project.id);
  const relatedUpdates = updateItems.filter((item) => item.projectId === project.id);
  const comments = Array.isArray(project?.comments) ? project.comments : [];
  const dependencies = Array.isArray(project?.dependencies) ? project.dependencies : [];
  const subtasks = Array.isArray(project?.subtasks) ? project.subtasks : [];
  const attachments = Array.isArray(project?.attachments) ? project.attachments : [];
  const issueLabels = Array.isArray(qualityItem?.issueLabels) ? qualityItem.issueLabels : [];

  return (
    <div className="view-stack">
      <Panel kicker="Projeto" title={project.name} aside={project.status.label}>
        <div className="detail-head">
          <div className="detail-summary">
            <span className={`status-badge tone-${project.health.tone}`}>{project.health.label}</span>
            <p>{project.description || "Sem descricao cadastrada no ClickUp."}</p>
            <dl className="detail-meta">
              <div><dt>Workspace</dt><dd>{project.workspaceName}</dd></div>
              <div><dt>Area</dt><dd>{project.areaLabel}</dd></div>
              <div><dt>Responsavel</dt><dd>{project.ownerLabel}</dd></div>
              <div><dt>Prazo</dt><dd>{project.dueLabel}</dd></div>
              <div><dt>Ultima atividade</dt><dd>{project.recentActivityLabel}</dd></div>
              <div><dt>Estimativa</dt><dd>{formatHours((project.timeEstimate || 0) / 3600000)}</dd></div>
            </dl>
          </div>
          <div className="detail-actions">
            <button className="secondary-button" type="button" onClick={onBack}>Voltar para acompanhadas</button>
            <a className="primary-link" href={project.url} target="_blank" rel="noreferrer">Abrir no ClickUp</a>
          </div>
        </div>
      </Panel>

      <div className="grid-two">
        <Panel kicker="Historico" title="Mudancas recentes">
          {relatedUpdates.length > 0 ? (
            <div className="feed-list">
              {relatedUpdates.map((item, index) => (
                <div className="feed-item static" key={`${item.kind}-${index}`}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Sem diferencas relevantes registradas entre os snapshots recentes." />
          )}
        </Panel>

        <Panel kicker="Cadastro" title="Qualidade e estrutura">
          <div className="list-stack">
            <div className="list-row"><div><strong>Subtarefas</strong><span>{project.subtasksCount}</span></div></div>
            <div className="list-row"><div><strong>Dependencias</strong><span>{project.dependencyCount}</span></div></div>
            <div className="list-row"><div><strong>Comentarios</strong><span>{project.commentCount}</span></div></div>
            <div className="list-row"><div><strong>Anexos</strong><span>{project.attachmentCount}</span></div></div>
            <div className="list-row"><div><strong>Custom fields preenchidos</strong><span>{project.customFieldCount}</span></div></div>
            <div className="list-row"><div><strong>Pendencias</strong><span>{issueLabels.join(" | ") || "Nenhuma pendencia de cadastro."}</span></div></div>
          </div>
        </Panel>
      </div>

      <div className="grid-two">
        <Panel kicker="Comentarios" title="Comentarios recentes">
          {comments.length > 0 ? (
            <div className="feed-list">
              {comments.slice(0, 6).map((comment) => (
                <div className="feed-item static" key={comment.id || comment.date}>
                  <strong>{comment.user?.username || "Pessoa nao identificada"}</strong>
                  <span>{comment.textPreview || "Comentario sem texto."}</span>
                  <small>{safeFormatDateTime(comment.date)}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="Nenhum comentario foi sincronizado para este projeto." />
          )}
        </Panel>

        <Panel kicker="Estrutura" title="Dependencias, subtarefas e anexos">
          <div className="list-stack">
            {dependencies.map((dependency, index) => (
              <div className="list-row" key={`${dependency.taskId}-${index}`}>
                <div><strong>Dependencia</strong><span>{dependency.dependsOn || dependency.taskId || "Vinculo sem detalhe"}</span></div>
              </div>
            ))}
            {subtasks.map((task) => (
              <div className="list-row" key={task.id}>
                <div><strong>Subtarefa</strong><span>{task.name} · {task.status}</span></div>
              </div>
            ))}
            {attachments.map((attachment) => (
              <a className="list-row link-row" key={attachment.id || attachment.url} href={attachment.url} target="_blank" rel="noreferrer">
                <div><strong>Anexo</strong><span>{attachment.title}</span></div>
              </a>
            ))}
            {dependencies.length === 0 && subtasks.length === 0 && attachments.length === 0 ? (
              <EmptyState message="Nao ha dependencias, subtarefas ou anexos sincronizados." />
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ProjectGrid({ projects, onOpenProject }) {
  if (projects.length === 0) {
    return <EmptyState message="Nenhum projeto encontrado para este filtro." />;
  }

  return (
    <div className="project-grid">
      {projects.map((project) => (
        <button className="project-card" type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
          <div className="project-card-top">
            <span className="status-tag">{project.status.label}</span>
            <span className={`status-badge tone-${project.health.tone}`}>{project.health.label}</span>
          </div>
          <strong>{project.name}</strong>
          <span>{project.areaLabel}</span>
          <dl className="mini-stats">
            <div><dt>Responsavel</dt><dd>{project.ownerLabel}</dd></div>
            <div><dt>Prazo</dt><dd>{project.dueLabel}</dd></div>
            <div><dt>Timeline</dt><dd>{project.timelineLabel}</dd></div>
            <div><dt>Comentarios</dt><dd>{project.commentCount}</dd></div>
          </dl>
        </button>
      ))}
    </div>
  );
}

function ProjectRows({ projects, onOpenProject, compact = false }) {
  if (!projects || projects.length === 0) {
    return <EmptyState message="Nenhum projeto nesta visao." />;
  }

  return (
    <div className="list-stack">
      {projects.map((project) => (
        <button className={compact ? "list-row compact-button" : "list-row"} type="button" key={project.id} onClick={() => onOpenProject(project.id)}>
          <div>
            <strong>{project.name}</strong>
            <span>{project.areaLabel} · {project.ownerLabel} · {project.dueLabel}</span>
          </div>
          <span className={`status-badge tone-${project.health.tone}`}>{project.health.label}</span>
        </button>
      ))}
    </div>
  );
}

function BarList({ items }) {
  if (!items || items.length === 0) {
    return <EmptyState message="Sem dados suficientes para compor esta distribuicao." />;
  }

  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="bar-list">
      {items.map((item) => (
        <div className="bar-row" key={item.label}>
          <div className="bar-copy">
            <strong>{item.label}</strong>
            <span>{item.value}</span>
          </div>
          <div className="bar-track">
            <div style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Panel({ kicker, title, aside, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h2>{title}</h2>
        </div>
        {aside ? <span className="panel-aside">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

function HeroMetric({ label, value, tone = "blue" }) {
  return (
    <article className={`hero-metric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SummaryCard({ label, value, hint }) {
  return (
    <article className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}

function EmptyState({ message }) {
  return <div className="empty-state">{message}</div>;
}

function safeFormatDateTime(value) {
  if (!value) {
    return "Sem data";
  }

  try {
    return formatDateTime(value);
  } catch {
    return "Sem data";
  }
}
