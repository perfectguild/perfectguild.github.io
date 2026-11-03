// Adapted from U+ Reborn; see THIRD-PARTY-NOTICES.md.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { parseFragment } from "parse5";
import { excludedDirectories, localReference, statIfPresent, unlinkedPath } from "./paths.mjs";

const require = createRequire(import.meta.url);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const configPath = join(repositoryRoot, ".markdownlint-cli2.jsonc");
const markdown = new MarkdownIt({ html: true });

export function collectMarkdown(root, { privateDocs = false } = {}) {
  const files = [];
  function visit(prefix, recursive, includeAgents = false) {
    const directory = unlinkedPath(root, prefix, { privateDocs });
    if (!directory || !statIfPresent(directory)?.isDirectory()) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = entry.name;
      const lower = name.toLowerCase();
      if (name.startsWith(".") || !includeAgents && lower === "agents.md" || entry.isSymbolicLink()) continue;
      const local = prefix ? `${prefix}/${name}` : name;
      if (entry.isFile() && lower.endsWith(".md")) files.push(local);
      else if (recursive && entry.isDirectory() && !excludedDirectories.has(lower)) visit(local, true, includeAgents);
    }
  }
  if (privateDocs) {
    visit(".local", true, true);
  } else {
    visit("", false);
    visit("docs", true);
    visit(".github", false);
    visit(".github/ISSUE_TEMPLATE", true);
    const notice = "tools/THIRD-PARTY-NOTICES.md";
    if (unlinkedPath(root, notice) && statIfPresent(join(root, notice))?.isFile()) files.push(notice);
  }
  return files.sort();
}

function executable(packageName, command) {
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    manifestPath = join(dirname(require.resolve(packageName)), "package.json");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[command];
  if (!bin) throw new Error(`${packageName} does not declare executable ${command}`);
  return resolve(dirname(manifestPath), bin);
}

export function mermaidInput(text) {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n").map(() => "");
  // Real Markdown tokens preserve list/blockquote semantics and exclude examples
  // inside other code fences. Blank lines retain original diagnostic positions.
  for (const token of markdown.parse(normalized, {})) {
    if (token.type !== "fence" || token.info.trim().split(/\s+/)[0] !== "mermaid") continue;
    const body = token.content.replace(/\n$/, "");
    const bodyLines = body ? body.split("\n") : [];
    const start = token.map[0];
    lines[start] = `${token.markup}mermaid`;
    for (let index = 0; index < bodyLines.length; index++) lines[start + 1 + index] = bodyLines[index];
    // Leave unclosed fences unclosed; the explicit Markdown rule reports them.
    if (token.map[1] - start === bodyLines.length + 2) lines[start + bodyLines.length + 1] = token.markup;
  }
  return lines.join("\n");
}

function htmlLinks(text) {
  const links = [];
  function visit(node) {
    for (const attribute of node.attrs ?? []) {
      if (["href", "src", "poster"].includes(attribute.name)) links.push(attribute.value);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parseFragment(text));
  return links;
}

export function checkMarkdownLinks(root, files, { privateDocs = false } = {}) {
  const errors = [];
  for (const file of files) {
    function check(value) {
      try {
        const path = localReference(value);
        if (!path) return;
        const candidate = path.startsWith("/") ? path.slice(1) : join(dirname(file), path);
        if (!unlinkedPath(root, candidate, { privateDocs })) throw new Error("missing, private or linked target");
      } catch (error) {
        errors.push(`${file}: ${value}: ${error.message}`);
      }
    }
    function visit(tokens) {
      for (const token of tokens) {
        if (token.type === "link_open") check(token.attrGet("href"));
        if (token.type === "image") check(token.attrGet("src"));
        if (["html_inline", "html_block"].includes(token.type)) for (const value of htmlLinks(token.content)) check(value);
        if (token.children) visit(token.children);
      }
    }
    visit(markdown.parse(readFileSync(join(root, file), "utf8"), {}));
  }
  return errors;
}

// A failure in preparation or execution must not hide the other diagnostics.
export function runChecks(checks, cwd) {
  let failed = false;
  for (const { name, prepare } of checks) {
    console.log(`\n[${name}]`);
    try {
      const { args, input, source } = prepare();
      const result = spawnSync(process.execPath, args, {
        cwd, input, stdio: input === undefined ? "inherit" : "pipe", encoding: "utf8", shell: false,
      });
      if (input !== undefined) {
        process.stdout.write((result.stdout ?? "").replaceAll("<stdin>", source));
        process.stderr.write((result.stderr ?? "").replaceAll("<stdin>", source));
      }
      if (result.error) throw result.error;
      if (result.status !== 0) {
        failed = true;
        console.error(`${name} failed (${result.signal ? `signal ${result.signal}` : `exit ${result.status}`}).`);
      } else console.log(`${name} passed.`);
    } catch (error) {
      failed = true;
      console.error(`${name} could not run: ${error.message}`);
    }
  }
  return failed ? 1 : 0;
}

export function checkDocumentation(root = repositoryRoot, options = {}) {
  const files = collectMarkdown(root, options);
  const label = options.privateDocs ? "Private" : "Public";
  if (files.length === 0) {
    console.error(`No ${label.toLowerCase()} Markdown files found.`);
    return 1;
  }
  console.log(`${label} Markdown (${files.length}):\n${files.join("\n")}`);
  const linkErrors = checkMarkdownLinks(root, files, options);
  for (const error of linkErrors) console.error(error);
  const status = runChecks([
    {
      name: "Markdown",
      prepare: () => ({ args: [
        executable("markdownlint-cli2", "markdownlint-cli2"), "--config", configPath, "--no-globs", "--",
        ...files.map((file) => `:./${file}`),
      ] }),
    },
    ...files.map((file) => ({
      name: `Mermaid: ${file}`,
      prepare: () => ({
        args: [executable("@mermaid-lint/cli", "mermaid-lint"), "--strict", "-"],
        input: mermaidInput(readFileSync(join(root, file), "utf8")), source: file,
      }),
    })),
  ], root);
  return linkErrors.length ? 1 : status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== "--private") || args.length > 1) throw new Error("Usage: node tools/check-docs.mjs [--private]");
    process.exitCode = checkDocumentation(repositoryRoot, { privateDocs: args.includes("--private") });
  } catch (error) {
    console.error(`Documentation check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
