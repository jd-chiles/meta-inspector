import assert from "node:assert/strict";

const taskPattern = /^TASK-\d{3}$/;
const requirementPattern = /^REQ-\d{3}$/;
const checkPattern = /^[a-z][a-z0-9-]*$/;
const taskFields = new Set([
  "id", "title", "description", "profile", "difficulty", "rationale",
  "requirements", "dependencies", "files", "acceptance", "risk", "checkIDs",
  "bugFix", "parent",
]);
const requiredTaskFields = [
  "id", "title", "description", "profile", "difficulty", "rationale",
  "requirements", "dependencies", "files", "acceptance", "risk", "checkIDs",
];
const allowedProfiles = new Set([
  "autopilot", "planning", "review", "explorer", "researcher", "requirements",
  "architect", "spec-reviewer", "plan-consultant", "plan-reviewer", "implementer",
  "frontend", "backend", "tests", "security-reviewer", "code-reviewer", "qa",
  "documentation", "gate-reviewer",
]);
const reviewerProfiles = new Set([
  "review", "spec-reviewer", "plan-reviewer", "code-reviewer",
  "security-reviewer", "gate-reviewer",
]);
const expectedActiveIDs = Array.from({ length: 11 }, (_, index) => `TASK-${103 + index}`);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertStringArray(value, label, { nonempty = true, pattern } = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  if (nonempty) assert(value.length > 0, `${label} must not be empty`);
  for (const item of value) {
    assert(typeof item === "string" && item.trim(), `${label} entries must be nonempty strings`);
    if (pattern) assert(pattern.test(item), `${label} has invalid entry ${item}`);
  }
}

function normalizeOwnedPath(file) {
  return file.endsWith("/") ? file.slice(0, -1) : file;
}

function assertSafeOwnedPaths(files, id) {
  assertStringArray(files, `${id}.files`, { nonempty: false });
  for (const file of files) {
    const normalized = normalizeOwnedPath(file);
    const segments = normalized.split("/");
    assert(!file.startsWith("/") && !file.includes("\\") &&
      segments.every((segment) => segment && segment !== ".." && segment !== "."),
      `${id} has unsafe ownership path ${file}`);
  }
}

function validateTaskRecords(tasks) {
  assert(Array.isArray(tasks) && tasks.length > 0, "Task list is empty");
  const byID = new Map();

  for (const task of tasks) {
    assert(isRecord(task), "Each task must be an object");
    for (const key of Object.keys(task)) assert(taskFields.has(key), `Unknown task field ${key}`);
    for (const key of requiredTaskFields) assert(Object.hasOwn(task, key), `${task.id ?? "Task"} missing ${key}`);
    assert(typeof task.id === "string" && taskPattern.test(task.id), "Invalid task ID");
    assert(!byID.has(task.id), `Duplicate task ID ${task.id}`);
    byID.set(task.id, task);
    assert(typeof task.title === "string" && task.title.trim().length >= 3, `${task.id} needs title`);
    assert(typeof task.description === "string" && task.description.trim().length >= 10, `${task.id} needs description`);
    assert(typeof task.rationale === "string" && task.rationale.trim().length >= 10, `${task.id} needs rationale`);
    assert(typeof task.risk === "string" && task.risk.trim(), `${task.id} needs risk`);
    if (Object.hasOwn(task, "bugFix")) {
      assert(typeof task.bugFix === "boolean", `${task.id}.bugFix must be a boolean`);
    }
    if (Object.hasOwn(task, "parent")) {
      assert(typeof task.parent === "string" && taskPattern.test(task.parent),
        `${task.id}.parent must be a canonical task ID`);
    }
    assert(allowedProfiles.has(task.profile), `${task.id} profile invalid`);
    assert(["low", "medium", "high"].includes(task.difficulty), `${task.id} difficulty invalid`);
    assertStringArray(task.requirements, `${task.id}.requirements`, { pattern: requirementPattern });
    assertStringArray(task.dependencies, `${task.id}.dependencies`, { nonempty: false, pattern: taskPattern });
    assertSafeOwnedPaths(task.files, task.id);
    assertStringArray(task.acceptance, `${task.id}.acceptance`);
    assertStringArray(task.checkIDs, `${task.id}.checkIDs`, { pattern: checkPattern });
  }

  return byID;
}

export function parseActiveTaskIDs(rawManifest) {
  let value;
  try {
    value = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(`Active task manifest is invalid JSON: ${error.message}`);
  }
  assert(Array.isArray(value) && value.length > 0, "Active task manifest must be a nonempty JSON array");
  const seen = new Set();
  for (const id of value) {
    assert(typeof id === "string" && taskPattern.test(id), `Active task ID is not canonical: ${String(id)}`);
    assert(!seen.has(id), `Duplicate active task ID ${id}`);
    seen.add(id);
  }
  return value;
}

function validateCheckConfig(config, requirementIDs) {
  assert(isRecord(config?.checks) && Object.keys(config.checks).length > 0, "SDD check configuration is empty");
  const checkCoverage = new Set();
  for (const [name, check] of Object.entries(config.checks)) {
    assert(isRecord(check), `${name} check must be an object`);
    assert(typeof check.command === "string" && check.command.trim(), `${name} needs command`);
    assert(Number.isInteger(check.timeoutMs) && check.timeoutMs >= 100, `${name} invalid timeout`);
    assert(typeof check.browser === "boolean", `${name} needs browser flag`);
    assertStringArray(check.requirements, `${name}.requirements`, { pattern: requirementPattern });
    for (const requirement of check.requirements) {
      assert(requirementIDs.has(requirement), `Unknown check requirement ${requirement}`);
      checkCoverage.add(requirement);
    }
  }
  return checkCoverage;
}

export function validateSddArtifacts({ docs, requirements, tasks, config, activeTaskIDs }) {
  assert(Array.isArray(requirements) && requirements.length > 0, "Requirements are empty");
  const requirementIDs = new Set(requirements);
  assert(requirementIDs.size === requirements.length, "Requirements must have unique canonical headings");
  for (const id of requirementIDs) assert(typeof id === "string" && requirementPattern.test(id), `Invalid requirement ID ${id}`);

  const taskByID = validateTaskRecords(tasks);
  assert(Array.isArray(activeTaskIDs) && activeTaskIDs.length > 0, "Active task manifest must be a nonempty array");
  const activeSet = new Set(activeTaskIDs);
  assert(activeSet.size === activeTaskIDs.length, "Duplicate active task IDs");
  for (const id of activeTaskIDs) {
    assert(typeof id === "string" && taskPattern.test(id), `Active task ID is not canonical: ${String(id)}`);
    assert(taskByID.has(id), `Unknown active task ID ${id}`);
  }
  assert(activeSet.size === expectedActiveIDs.length && expectedActiveIDs.every((id) => activeSet.has(id)),
    "Active manifest must contain exactly TASK-103 through TASK-113");

  const activeTasks = activeTaskIDs.map((id) => taskByID.get(id));
  const covered = new Set();
  const visited = new Set();
  const visiting = new Set();

  for (const task of activeTasks) {
    assert(task.requirements.length > 0 && task.acceptance.length > 0 && task.checkIDs.length > 0,
      `${task.id} lacks active requirement/acceptance/check mapping`);
    assert(task.files.length > 0 || reviewerProfiles.has(task.profile), `${task.id} needs ownership`);
    for (const requirement of task.requirements) {
      assert(requirementIDs.has(requirement), `Unknown requirement ${requirement}`);
      covered.add(requirement);
    }
    for (const checkID of task.checkIDs) assert(config?.checks?.[checkID], `Unknown check ${checkID}`);
    for (const dependency of task.dependencies) {
      assert(activeSet.has(dependency), `${task.id} has dependency outside active manifest: ${dependency}`);
      assert(taskByID.has(dependency), `${task.id} has unknown dependency ${dependency}`);
    }
    const checkbox = new RegExp(`^- \\[([ xX])\\] ${task.id}(?=\\s|—|-|$)`, "gm");
    const matches = [...docs["03-plan"].matchAll(checkbox)];
    assert.equal(matches.length, 1, `${task.id} must have exactly one plan checkbox`);
  }

  const visit = (id) => {
    assert(!visiting.has(id), `Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of taskByID.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of activeTasks) visit(task.id);

  const checkCoverage = validateCheckConfig(config, requirementIDs);
  for (const requirement of requirementIDs) {
    assert(covered.has(requirement), `${requirement} lacks active task coverage`);
    assert(checkCoverage.has(requirement), `${requirement} lacks check coverage`);
    assert(docs["03-plan"].includes(requirement) && docs["04-verification"].includes(requirement),
      `${requirement} lacks plan/verification mapping`);
  }

  const dependsOn = (taskID, targetID, seen = new Set()) => {
    if (seen.has(taskID)) return false;
    seen.add(taskID);
    const task = taskByID.get(taskID);
    return task.dependencies.includes(targetID) || task.dependencies.some((dependency) =>
      dependsOn(dependency, targetID, seen));
  };
  const overlaps = (left, right) => {
    const normalizedLeft = normalizeOwnedPath(left);
    const normalizedRight = normalizeOwnedPath(right);
    return normalizedLeft === normalizedRight ||
      normalizedLeft.startsWith(`${normalizedRight}/`) ||
      normalizedRight.startsWith(`${normalizedLeft}/`);
  };
  for (let left = 0; left < activeTasks.length; left++) {
    for (let right = left + 1; right < activeTasks.length; right++) {
      const first = activeTasks[left];
      const second = activeTasks[right];
      if (first.files.some((file) => second.files.some((other) => overlaps(file, other)))) {
        assert(dependsOn(first.id, second.id) || dependsOn(second.id, first.id),
          `Unserialized shared ownership: ${first.id} / ${second.id}`);
      }
    }
  }

  return { requirementCount: requirementIDs.size, taskCount: activeTasks.length, checkCount: Object.keys(config.checks).length };
}
