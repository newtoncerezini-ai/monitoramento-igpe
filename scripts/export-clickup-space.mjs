import { exportClickupSpace } from "../lib/clickup-export.mjs";

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  exportClickupSpace().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
