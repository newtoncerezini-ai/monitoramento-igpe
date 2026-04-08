import { exportClickupSpace } from "../lib/clickup-export.mjs";

export default async function handler(_request, response) {
  try {
    const exportData = await exportClickupSpace({ persist: false });

    response.status(200).json({
      message: "Dados do ClickUp atualizados com sucesso.",
      exportedAt: exportData.exportedAt,
      data: exportData
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Falha ao atualizar o ClickUp."
    });
  }
}
