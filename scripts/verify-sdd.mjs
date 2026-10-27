import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const feature = "docs/sdd/features/habitability-walkthrough-mvp";
const names = ["00-request", "01-requirements", "02-design", "03-plan",
  "04-verification", "05-change-log", "06-release", "07-retrospective"];
const docs = Object.fromEntries(await Promise.all(names.map(async (name) =>
  [name, await readFile(feature + "/" + name + ".md", "utf8")])));
for (const [name, content] of Object.entries(docs)) {
  assert(content.trim(), name + " is empty");
  assert(!content.includes("<!-- agentic-sdd:fill -->"), name + " contains plugin scaffold marker");
}
const reqMatches = [...docs["01-requirements"].matchAll(/^## (REQ-\d{3})\b/gm)].map((m) => m[1]);
const reqs = new Set(reqMatches);
assert(reqs.size > 0 && reqs.size === reqMatches.length, "Requirements must have unique canonical headings");
const tasks = JSON.parse(await readFile(feature + "/tasks.json", "utf8"));
const config = JSON.parse(await readFile(".sdd/config.json", "utf8"));
assert(Array.isArray(tasks) && tasks.length > 0, "Task list is empty");
const taskIDs = new Set(tasks.map((task) => task.id));
assert.equal(taskIDs.size, tasks.length, "Duplicate task IDs");
const allowedProfiles = new Set(["autopilot", "planning", "review", "explorer", "researcher",
  "requirements", "architect", "spec-reviewer", "plan-consultant", "plan-reviewer",
  "implementer", "frontend", "backend", "tests", "security-reviewer", "code-reviewer",
  "qa", "documentation", "gate-reviewer"]);
const fields = new Set(["id", "title", "description", "profile", "difficulty", "rationale",
  "requirements", "dependencies", "files", "acceptance", "risk", "checkIDs", "bugFix", "parent"]);
const covered = new Set();
const visited = new Set(), active = new Set();
const visit = (id) => {
  assert(!active.has(id), "Dependency cycle at " + id);
  if (visited.has(id)) return;
  active.add(id);
  for (const dep of tasks.find((t) => t.id === id).dependencies) {
    assert(taskIDs.has(dep), "Unknown dependency " + dep);
    visit(dep);
  }
  active.delete(id); visited.add(id);
};
for (const task of tasks) {
  for (const key of Object.keys(task)) assert(fields.has(key), "Unknown task field " + key);
  assert(/^TASK-\d{3}$/.test(task.id), "Invalid task ID");
  assert(typeof task.title === "string" && task.title.length >= 3, task.id + " needs title");
  assert(typeof task.description === "string" && task.description.length >= 10, task.id + " needs description");
  assert(typeof task.rationale === "string" && task.rationale.length >= 10, task.id + " needs rationale");
  assert(allowedProfiles.has(task.profile), task.id + " profile invalid");
  assert(["low", "medium", "high"].includes(task.difficulty), task.id + " difficulty invalid");
  assert(Array.isArray(task.files) && task.files.length, task.id + " needs ownership");
  assert(task.files.every((p) => typeof p === "string" && p && !p.startsWith("/") &&
    !p.includes("\\") && !p.split("/").includes("..")), task.id + " unsafe ownership");
  assert(task.requirements.length && task.acceptance.length && task.checkIDs.length, task.id + " lacks acceptance/check mapping");
  for (const req of task.requirements) { assert(reqs.has(req), "Unknown requirement " + req); covered.add(req); }
  for (const check of task.checkIDs) assert(config.checks[check], "Unknown check " + check);
  assert(new RegExp("^- \\[ \\] " + task.id + "\\b", "m").test(docs["03-plan"]) ||
    new RegExp("^- \\[x\\] " + task.id + "\\b", "m").test(docs["03-plan"]), task.id + " missing plan checkbox");
  visit(task.id);
}
const checkCoverage = new Set();
for (const [name, check] of Object.entries(config.checks)) {
  assert(typeof check.command === "string" && check.command.trim(), name + " needs command");
  assert(Number.isInteger(check.timeoutMs) && check.timeoutMs >= 100, name + " invalid timeout");
  assert(typeof check.browser === "boolean", name + " needs browser flag");
  for (const req of check.requirements) { assert(reqs.has(req), "Unknown check requirement " + req); checkCoverage.add(req); }
}
for (const req of reqs) {
  assert(covered.has(req) && checkCoverage.has(req), req + " lacks task/check coverage");
  assert(docs["03-plan"].includes(req) && docs["04-verification"].includes(req), req + " lacks document mapping");
}
// Shared file ownership is safe only when tasks are serialized by dependency.
const dependsOn = (task, id, seen = new Set()) => {
  if (seen.has(task.id)) return false;
  seen.add(task.id);
  return task.dependencies.includes(id) || task.dependencies.some((dep) =>
    dependsOn(tasks.find((t) => t.id === dep), id, seen));
};
const overlap = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
for (let i = 0; i < tasks.length; i++) for (let j = i + 1; j < tasks.length; j++) {
  if (tasks[i].files.some((a) => tasks[j].files.some((b) => overlap(a, b)))) {
    assert(dependsOn(tasks[i], tasks[j].id) || dependsOn(tasks[j], tasks[i].id),
      "Unserialized shared ownership: " + tasks[i].id + " / " + tasks[j].id);
  }
}
for (const path of ["AGENTS.md", ".github/workflows/ci.yml", "docs/REVIEW_AND_CI.md",
  "docs/OPENCODE_HANDOFF.md"]) await access(path);
console.log("SDD structure passed: " + reqs.size + " requirements, " + tasks.length +
  " acyclic tasks, " + Object.keys(config.checks).length + " named checks. Application behavior is not verified by this check.");
