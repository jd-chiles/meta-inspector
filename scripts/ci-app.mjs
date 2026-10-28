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
  // Required scripts must run real checks: no zero-test passes, no swallowed
  // errors, and no echo-only placeholders. This keeps CI honest (REQ-012).
  const problems = [];
  for (const name of required) {
    const script = manifest.scripts[name];
    if (script.includes("passWithNoTests")) problems.push(name + ": must not use passWithNoTests");
    if (["|| true", "||true", "|| exit 0", "||exit 0", "|| :"].some((p) => script.includes(p))) {
      problems.push(name + ": must not swallow errors");
    }
    if (/^\s*echo\b/.test(script)) problems.push(name + ": must run a real check, not echo");
  }
  if (problems.length) {
    throw new Error("Required scripts must run real checks without swallowed errors:\n" + problems.join("\n"));
  }
  if (!(await exists("package-lock.json"))) throw new Error("A committed package-lock.json is required for npm ci.");
  // Node 22 is pinned by the CI workflow (setup-node "22"). Warn — do not fail —
  // if the manifest declares an engines range that omits it, so older fixtures
  // without an engines field keep passing.
  const nodeRange = manifest.engines?.node;
  if (typeof nodeRange === "string" && !nodeRange.includes("22")) {
    console.warn("Warning: package.json engines.node (" + nodeRange + ") does not mention Node 22.");
  }
  // Secret boundary: client configuration must not carry API secrets. Only env
  // names (never values) belong in .env.example; Meta keys stay server-only.
  if (/NEXT_PUBLIC_[A-Z0-9_]*(KEY|SECRET|TOKEN)/.test(JSON.stringify(manifest))) {
    throw new Error("package.json must not configure NEXT_PUBLIC_* API secrets; keep Meta keys server-only.");
  }
  console.log("Application checks required: lint, typecheck, unit, build and browser. Live Meta smoke is a separate credentialed check.");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "enabled=true\n");
}
