import { access, appendFile, readFile } from "node:fs/promises";

const exists = async (path) => access(path).then(() => true, () => false);
const hasManifest = await exists("package.json");
const hasSource = (await Promise.all(["src", "app", "pages"].map(exists))).some(Boolean);

if (!hasManifest && hasSource) {
  throw new Error("Application source exists without package.json; CI cannot skip application verification.");
}
if (!hasManifest) {
  console.log("Documentation stage: application has not been scaffolded. This is not application readiness.");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "enabled=false\n");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    "Documentation validation only. Application is not scaffolded; application acceptance and live Meta verification are pending.\n");
} else {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const required = ["lint", "typecheck", "test:unit", "test:e2e", "test:live", "build"];
  const missing = required.filter((name) => typeof manifest.scripts?.[name] !== "string" || !manifest.scripts[name].trim());
  if (missing.length) throw new Error("Missing required application check scripts: " + missing.join(", "));
  if (!(await exists("package-lock.json"))) throw new Error("A committed package-lock.json is required for npm ci.");
  console.log("Application checks required: lint, typecheck, unit, build and browser. Live Meta smoke is a separate credentialed check.");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "enabled=true\n");
}
