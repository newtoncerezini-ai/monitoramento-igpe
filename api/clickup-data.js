import { exportClickupSpace, readSavedClickupData } from "../lib/clickup-export.mjs";

export default async function handler(_request, response) {
  try {
    const cachedData = readSavedClickupData();

    if (cachedData) {
      response.status(200).json(cachedData);
      return;
    }

    const exportData = await exportClickupSpace({ persist: false });
    response.status(200).json(exportData);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Falha ao carregar os dados do ClickUp."
    });
  }
}
