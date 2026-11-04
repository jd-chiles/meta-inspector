import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractLocalMarkdownLinks, validateMarkdownTree } from "../../../scripts/verify-docs.mjs";

describe("public documentation validation", () => {
  it("extracts local links while leaving external URLs to their sources", () => {
    expect(extractLocalMarkdownLinks("[Guide](docs/guide.md) [web](https://example.com) ![image](../screen.png#capture)"))
      .toEqual(["docs/guide.md", "../screen.png"]);
  });

  it("validates the published Markdown tree and its local links", async () => {
    await expect(validateMarkdownTree()).resolves.toBeGreaterThanOrEqual(1);
  });

  it("rejects a broken local link", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "walkthrough-docs-"));
    try {
      await writeFile(path.join(root, "README.md"), "[Missing](missing.md)\n");
      await expect(validateMarkdownTree(root)).rejects.toThrow(/links to missing local path/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
