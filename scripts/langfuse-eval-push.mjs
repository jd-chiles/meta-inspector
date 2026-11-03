#!/usr/bin/env node
/**
 * Push the walkthrough eval benchmark to a Langfuse dataset (Sprint 5 REQ-O2).
 * Owner-run only: requires Langfuse keys and the staged clip hashes, and is
 * never part of CI or any gate.
 *
 * Usage:
 *   node scripts/langfuse-eval-push.mjs --dry-run \
 *     --kitchen-sha256 <64-hex> --bathroom-sha256 <64-hex>
 *   LANGFUSE_SECRET_KEY=... LANGFUSE_PUBLIC_KEY=... \
 *     node scripts/langfuse-eval-push.mjs \
 *     --kitchen-sha256 <64-hex> --bathroom-sha256 <64-hex>
 *
 * Items carry references (room, clip SHA-256, task, expected behavior) —
 * never media bytes or resident-identifying content.
 */
import { Langfuse } from "langfuse";

import {
  EVAL_DATASET_NAME,
  seedEvalCases,
} from "../src/server/observability/eval-cases.ts";

function argValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1];
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const kitchen = argValue(argv, "--kitchen-sha256") ?? "";
  const bathroom = argValue(argv, "--bathroom-sha256") ?? "";
  let items;
  try {
    items = seedEvalCases({ kitchen, bathroom });
  } catch (error) {
    console.error(`Refusing to run: ${error instanceof Error ? error.message : error}`);
    console.error("Pass the real staged clip hashes via --kitchen-sha256 / --bathroom-sha256; they are never invented.");
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    console.log(`Dataset: ${EVAL_DATASET_NAME} (${items.length} items, dry run — nothing sent)`);
    for (const item of items) console.log(`- ${item.id} [${item.dimension}] room=${item.input.roomId}`);
    return;
  }
  const secretKey = (process.env.LANGFUSE_SECRET_KEY ?? "").trim();
  const publicKey = (process.env.LANGFUSE_PUBLIC_KEY ?? "").trim();
  if (!secretKey || !publicKey) {
    console.error("Refusing to run: set LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY (server-side only, never commit them).");
    process.exitCode = 1;
    return;
  }
  const baseUrl = (process.env.LANGFUSE_BASEURL ?? "").trim() || undefined;
  const client = new Langfuse({ secretKey, publicKey, ...(baseUrl ? { baseUrl } : {}) });
  try {
    await client.createDataset(EVAL_DATASET_NAME, {
      description: "Meta Inspect walkthrough accuracy benchmark (staged clips, 5 dimensions).",
    });
  } catch (error) {
    console.log(`Dataset create skipped (may already exist): ${error instanceof Error ? error.message : error}`);
  }
  for (const item of items) {
    await client.createDatasetItem({
      datasetName: EVAL_DATASET_NAME,
      id: item.id,
      input: { ...item.input, dimension: item.dimension },
      expectedOutput: item.expectedOutput,
    });
    console.log(`Pushed ${item.id} [${item.dimension}]`);
  }
  await client.flushAsync();
  console.log(`Done: ${items.length} items in dataset ${EVAL_DATASET_NAME}.`);
}

await main();
