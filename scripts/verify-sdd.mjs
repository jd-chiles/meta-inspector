import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { parseActiveTaskIDs, validateSddArtifacts } from "./sdd-validation.mjs";

const feature = "docs/sdd/features/habitability-walkthrough-mvp";
const names = ["00-request", "01-requirements", "02-design", "03-plan",
  "04-verification", "05-change-log", "06-release", "07-retrospective"];
const docs = Object.fromEntries(await Promise.all(names.map(async (name) =>
  [name, await readFile(`${feature}/${name}.md`, "utf8")])));

for (const [name, content] of Object.entries(docs)) {
  assert(content.trim(), `${name} is empty`);
  assert(!content.includes("<!-- agentic-sdd:fill -->"), `${name} contains plugin scaffold marker`);
}

const requirementMatches = [...docs["01-requirements"].matchAll(/^## (REQ-\d{3})\b/gm)].map((match) => match[1]);
const tasks = JSON.parse(await readFile(`${feature}/tasks.json`, "utf8"));
const config = JSON.parse(await readFile(".sdd/config.json", "utf8"));
const activeTaskIDs = parseActiveTaskIDs(await readFile(`${feature}/active-tasks.json`, "utf8"));
const summary = validateSddArtifacts({
  docs,
  requirements: requirementMatches,
  tasks,
  config,
  activeTaskIDs,
});

for (const path of ["AGENTS.md", ".github/workflows/ci.yml", "docs/REVIEW_AND_CI.md",
  "docs/OPENCODE_HANDOFF.md"]) await access(path);

console.log(`SDD structure passed: ${summary.requirementCount} requirements, ${summary.taskCount} active acyclic tasks, ` +
  `${summary.checkCount} named checks. Historical task records were schema-validated but excluded from active coverage/graph checks. ` +
  "Application behavior is not verified by this check.");
