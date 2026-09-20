import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const generatedTargets = [
  "dist",
  "release",
  "coverage",
  "playwright-report",
  "test-results",
  "ebook/build",
  "ebook/output",
  "ebook/assets/cover.png",
  ".DS_Store",
  "ebook/.DS_Store",
];

for (const target of generatedTargets) {
  await rm(resolve(root, target), { force: true, recursive: true });
}

console.log(`Removed ${generatedTargets.length} allowlisted generated targets.`);
