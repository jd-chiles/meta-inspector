import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ignoredDirectories = new Set([".git", ".next", ".private-project-notes", "coverage", "node_modules"]);

export function extractLocalMarkdownLinks(content) {
  return [...content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].split(/[\s#]/, 1)[0])
    .filter((href) => href && !/^(https?:|mailto:|data:)/i.test(href));
}

export async function validateMarkdownTree(root = ".") {
  const markdownFiles = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) markdownFiles.push(file);
    }
  }

  await collect(root);
  assert(markdownFiles.length > 0, "No Markdown documentation found");
  for (const file of markdownFiles) {
    const content = await readFile(file, "utf8");
    assert(content.trim(), `${file} must not be empty`);
    for (const href of extractLocalMarkdownLinks(content)) {
      const target = path.resolve(path.dirname(file), decodeURIComponent(href));
      try {
        await access(target);
      } catch {
        assert.fail(`${file} links to missing local path: ${href}`);
      }
    }
  }
  return markdownFiles.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const count = await validateMarkdownTree();
  console.log(`Public documentation check passed: ${count} Markdown files and local links.`);
}
