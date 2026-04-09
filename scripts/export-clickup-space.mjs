import { exportClickupSpace } from "../lib/clickup-export-next.mjs";

exportClickupSpace().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
