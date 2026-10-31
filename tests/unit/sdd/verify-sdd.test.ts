import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseActiveTaskIDs, validateSddArtifacts } from "../../../scripts/sdd-validation.mjs";

const feature = "docs/sdd/features/habitability-walkthrough-mvp";
const docNames = ["00-request", "01-requirements", "02-design", "03-plan",
  "04-verification", "05-change-log", "06-release", "07-retrospective"];
const docs = Object.fromEntries(docNames.map((name) =>
  [name, readFileSync(`${feature}/${name}.md`, "utf8")]));
const requirements = [...docs["01-requirements"].matchAll(/^## (REQ-\d{3})\b/gm)].map((match) => match[1]);
const tasks = JSON.parse(readFileSync(`${feature}/tasks.json`, "utf8"));
const config = JSON.parse(readFileSync(".sdd/config.json", "utf8"));
const activeTaskIDs = parseActiveTaskIDs(readFileSync(`${feature}/active-tasks.json`, "utf8"));

function artifacts(overrides: Record<string, unknown> = {}) {
  return {
    docs: structuredClone(docs),
    requirements: [...requirements],
    tasks: structuredClone(tasks),
    config: structuredClone(config),
    activeTaskIDs: [...activeTaskIDs],
    ...overrides,
  } as Parameters<typeof validateSddArtifacts>[0];
}

describe("SDD active task validation", () => {
  it("validates current active graph while keeping historical records outside it", () => {
    expect(validateSddArtifacts(artifacts())).toEqual({
      requirementCount: 15,
      taskCount: 11,
      checkCount: 7,
    });
  });

  it("rejects malformed, empty, duplicate, and noncanonical manifests", () => {
    expect(() => parseActiveTaskIDs("{" )).toThrow(/invalid JSON/i);
    expect(() => parseActiveTaskIDs("[]")).toThrow(/nonempty/i);
    expect(() => parseActiveTaskIDs('["TASK-103","TASK-103"]')).toThrow(/Duplicate active task/);
    expect(() => parseActiveTaskIDs('["TASK-103x"]')).toThrow(/not canonical/i);
  });

  it("requires the complete current active set and rejects unknown entries", () => {
    expect(() => validateSddArtifacts(artifacts({ activeTaskIDs: activeTaskIDs.slice(1) })))
      .toThrow(/exactly TASK-103 through TASK-113/);
    expect(() => validateSddArtifacts(artifacts({ activeTaskIDs: [...activeTaskIDs.slice(0, -1), "TASK-999"] })))
      .toThrow(/Unknown active task ID/);
  });

  it("schema-validates history without applying active dependency membership to it", () => {
    const changedTasks = structuredClone(tasks);
    changedTasks.find((task: { id: string }) => task.id === "TASK-069").dependencies = ["TASK-999"];
    expect(() => validateSddArtifacts(artifacts({ tasks: changedTasks }))).not.toThrow();
    changedTasks[0].unexpectedHistoricalField = true;
    expect(() => validateSddArtifacts(artifacts({ tasks: changedTasks }))).toThrow(/Unknown task field/);
  });

  it("rejects duplicate IDs and malformed historical task fields", () => {
    const duplicateTasks = structuredClone(tasks);
    duplicateTasks.push(structuredClone(duplicateTasks[0]));
    expect(() => validateSddArtifacts(artifacts({ tasks: duplicateTasks }))).toThrow(/Duplicate task ID TASK-069/);

    const malformedTasks = structuredClone(tasks);
    const historicalTask = malformedTasks.find((task: { id: string }) => task.id === "TASK-069");
    historicalTask.bugFix = "false";
    expect(() => validateSddArtifacts(artifacts({ tasks: malformedTasks }))).toThrow(/bugFix must be a boolean/);

    historicalTask.bugFix = false;
    historicalTask.parent = "TASK-070";
    expect(() => validateSddArtifacts(artifacts({ tasks: malformedTasks }))).not.toThrow();

    historicalTask.parent = {};
    expect(() => validateSddArtifacts(artifacts({ tasks: malformedTasks })))
      .toThrow(/parent must be a canonical task ID/);
  });

  it("rejects active dependencies into history even when the historical ID exists", () => {
    const changedTasks = structuredClone(tasks);
    changedTasks.find((task: { id: string }) => task.id === "TASK-103").dependencies = ["TASK-069"];
    expect(() => validateSddArtifacts(artifacts({ tasks: changedTasks })))
      .toThrow(/dependency outside active manifest/);
  });

  it("rejects active cycles, missing checkboxes, uncovered requirements, and unserialized ownership", () => {
    const cyclicTasks = structuredClone(tasks);
    cyclicTasks.find((task: { id: string }) => task.id === "TASK-103").dependencies = ["TASK-104"];
    cyclicTasks.find((task: { id: string }) => task.id === "TASK-104").dependencies = ["TASK-103"];
    expect(() => validateSddArtifacts(artifacts({ tasks: cyclicTasks }))).toThrow(/Dependency cycle/);

    const missingCheckboxDocs = structuredClone(docs);
    missingCheckboxDocs["03-plan"] = missingCheckboxDocs["03-plan"].replace(/^- \[ \] TASK-103.*$/m, "");
    expect(() => validateSddArtifacts(artifacts({ docs: missingCheckboxDocs }))).toThrow(/TASK-103 must have exactly one plan checkbox/);

    const uncoveredTasks = structuredClone(tasks);
    for (const task of uncoveredTasks) {
      task.requirements = task.requirements.filter((id: string) => id !== "REQ-001");
    }
    expect(() => validateSddArtifacts(artifacts({ tasks: uncoveredTasks }))).toThrow(/REQ-001 lacks active task coverage/);

    const overlappingTasks = structuredClone(tasks);
    overlappingTasks.find((task: { id: string }) => task.id === "TASK-103").files = ["src/domain/move-in-ready.ts"];
    expect(() => validateSddArtifacts(artifacts({ tasks: overlappingTasks }))).toThrow(/Unserialized shared ownership/);

    const directoryOwnershipTasks = structuredClone(tasks);
    directoryOwnershipTasks.find((task: { id: string }) => task.id === "TASK-103").files = ["src/domain/"];
    expect(() => validateSddArtifacts(artifacts({ tasks: directoryOwnershipTasks })))
      .toThrow(/Unserialized shared ownership/);

    const malformedPathTasks = structuredClone(tasks);
    malformedPathTasks.find((task: { id: string }) => task.id === "TASK-103").files = ["src//domain/file.ts"];
    expect(() => validateSddArtifacts(artifacts({ tasks: malformedPathTasks })))
      .toThrow(/unsafe ownership path/);
  });
});
