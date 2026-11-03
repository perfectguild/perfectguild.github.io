// Adapted in part from U+ Reborn; see THIRD-PARTY-NOTICES.md.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { lint } from "markdownlint-cli2/markdownlint/promise";
import closedFences from "./closed-fences.cjs";
import { checkMarkdownLinks, collectMarkdown, mermaidInput, runChecks } from "./check-docs.mjs";

const runnerUrl = new URL("./check-docs.mjs", import.meta.url).href;
const validDiagram = "```mermaid\nflowchart LR\n    A --> B\n```\n";
const malformedDiagram = "```mermaid\nflowchart LR\n    A -->\n```\n";

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "stranniki docs [fixture] "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

function check(root) {
  const originals = new Map(collectMarkdown(root).map((file) => [file, readFileSync(join(root, file))]));
  const result = spawnSync(process.execPath, [
    "--input-type=module", "-e",
    `import { checkDocumentation } from ${JSON.stringify(runnerUrl)}; process.exitCode = checkDocumentation(process.argv[1]);`, root,
  ], { cwd: root, encoding: "utf8", shell: false });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  for (const [file, original] of originals) assert.deepEqual(readFileSync(join(root, file)), original);
  return { status: result.status, output: result.stdout + result.stderr };
}

test("public discovery excludes private records and generated directories", (t) => {
  const root = fixture(t, {
    "README.md": "", "CHANGELOG.md": "", "AGENTS.md": "private", ".hidden.md": "private",
    "docs/guide [1].md": "", "docs/AGENTS.md": "private", "docs/raw/capture.md": "private",
    "docs/artifacts/report.md": "private", "docs/node_modules/README.md": "private",
    ".github/PULL_REQUEST_TEMPLATE.md": "", ".github/ISSUE_TEMPLATE/issue.md": "",
    ".github/private/plan.md": "private", ".local/AGENTS.md": "private", "raw/data.md": "private",
    "tools/THIRD-PARTY-NOTICES.md": "", "tools/unselected.md": "private",
  });
  assert.deepEqual(collectMarkdown(root), [
    ".github/ISSUE_TEMPLATE/issue.md", ".github/PULL_REQUEST_TEMPLATE.md", "CHANGELOG.md",
    "README.md", "docs/guide [1].md", "tools/THIRD-PARTY-NOTICES.md",
  ]);
  assert.deepEqual(collectMarkdown(root, { privateDocs: true }), [".local/AGENTS.md"]);
});

test("private discovery includes AGENTS but excludes ignored artifacts and junctions", (t) => {
  const root = fixture(t, {
    "README.md": "# Public\n", ".local/AGENTS.md": "# Private\n\n[Public](../README.md)\n",
    ".local/docs/guide.md": "", ".local/tmp/work.md": "", ".local/artifacts/report.md": "",
    ".local/raw/capture.md": "", ".local/secrets/password.md": "",
  });
  symlinkSync(root, join(root, ".local", "loop"), process.platform === "win32" ? "junction" : "dir");
  const files = collectMarkdown(root, { privateDocs: true });
  assert.deepEqual(files, [".local/AGENTS.md", ".local/docs/guide.md"]);
  assert.deepEqual(checkMarkdownLinks(root, files, { privateDocs: true }), []);
});

test("discovery does not follow directory links, including linked source roots", (t) => {
  const root = fixture(t, { "README.md": "", "docs/public.md": "", ".local/private.md": "" });
  const kind = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(join(root, ".local"), join(root, "docs", "private-link"), kind);
  symlinkSync(root, join(root, "docs", "loop"), kind);
  mkdirSync(join(root, ".github"));
  symlinkSync(join(root, ".local"), join(root, ".github", "ISSUE_TEMPLATE"), kind);
  assert.deepEqual(collectMarkdown(root), ["README.md", "docs/public.md"]);
  const linked = fixture(t, { "README.md": "", ".local/private.md": "" });
  symlinkSync(join(linked, ".local"), join(linked, "docs"), kind);
  assert.deepEqual(collectMarkdown(linked), ["README.md"]);
});

test("discovery and link checks reject file symlinks", (t) => {
  const root = fixture(t, { "README.md": "[Linked](docs/linked.md)\n", ".local/private.md": "private" });
  mkdirSync(join(root, "docs"));
  try {
    symlinkSync(join(root, ".local", "private.md"), join(root, "docs", "linked.md"), "file");
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
    t.skip("Windows file symlinks need Developer Mode or symbolic-link privilege; junctions remain covered.");
    return;
  }
  assert.deepEqual(collectMarkdown(root), ["README.md"]);
  assert.equal(checkMarkdownLinks(root, ["README.md"]).length, 1);
});

test("Markdown links use parser semantics, not code examples or network crawling", (t) => {
  const root = fixture(t, {
    "README.md": [
      "[Guide](docs/a%20space.md#section)", "![Image][logo]", "", "[logo]: images/logo.png",
      "", "[Network](https://does-not-exist.invalid/private)", "`[Example](missing.md)`",
      "", "````text", "[Example](missing.md)", "```mermaid", "not a diagram", "```", "````",
      "", "<a href=\"docs/a%20space.md\">HTML link</a>", "",
    ].join("\n"),
    "docs/a space.md": "# Section\n", "images/logo.png": "binary",
  });
  assert.deepEqual(checkMarkdownLinks(root, ["README.md"]), []);
  assert.doesNotMatch(mermaidInput(readFileSync(join(root, "README.md"), "utf8")), /not a diagram/);
  writeFileSync(join(root, "README.md"), "[Missing](missing.md)\n[Bad](broken%ZZ.md)\n[Private](.local/record.md)\n[Outside](../outside.md)\n");
  assert.equal(checkMarkdownLinks(root, ["README.md"]).length, 4);
});

test("empty selection fails without default CLI discovery", (t) => {
  const result = check(fixture(t, { ".local/private.md": "# Private\n" }));
  assert.equal(result.status, 1);
  assert.match(result.output, /No public Markdown files found/);
  assert.doesNotMatch(result.output, /\[Markdown\]|\[Mermaid:/);
});

for (const eol of ["\n", "\r\n"]) {
  test(`canonical check parses nested Mermaid, filenames and ${JSON.stringify(eol)} without rewriting`, (t) => {
    const root = fixture(t, {
      "README.md": (`# Readme\n\n${validDiagram}`).replaceAll("\n", eol),
      "docs/deep space/guide [1].md": "# Nested\n\n- Example:\n\n  > ```mermaid\n  > flowchart LR\n  >     A --> B\n  > ```\n".replaceAll("\n", eol),
      ".local/private.md": malformedDiagram,
    });
    const result = check(root);
    assert.equal(result.status, 0, result.output);
    assert.doesNotMatch(result.output, /<stdin>|private\.md/);
  });
}

test("Markdown and Mermaid failures both retain source diagnostics", (t) => {
  const root = fixture(t, {
    "docs/nested [diagram].md": "# Nested\n\n### Skipped heading\n\n- Example:\n\n  > ```mermaid\n  > flowchart LR\n  >     A -->\n  > ```\n",
  });
  const result = check(root);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /MD001/);
  assert.match(result.output, /docs\/nested \[diagram\]\.md:\d+:\d+:.*parse error/);
  assert.doesNotMatch(result.output, /<stdin>/);
});

test("strict Mermaid warnings fail the canonical check", (t) => {
  const result = check(fixture(t, { "README.md": "# Readme\n\n```mermaid\nflowchart LR\n    A --> B\n    A --> B\n```\n" }));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /no-duplicate-edges/);
});

test("unclosed ordinary fences fail even without diagrams", (t) => {
  const result = check(fixture(t, { "README.md": "# Readme\n\n> ```text\n> missing close\n" }));
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /closed-fences/);
});

test("closed-fence rule respects containers, marker types, lengths and line endings", async () => {
  const closed = [
    "```text\nbody\n```", "~~~text\nbody\n~~~~\n", "````text\n```\n````\n",
    "- Item\n\n  > ```text\n  > body\n  > ```\n", "    ```text\n    indented code\n",
  ];
  const unclosed = [
    "```text\nbody\n", "```text\nbody\n~~~\n", "````text\nbody\n```\n",
    "```text\nbody\n``` trailing text\n", "> ```text\n> body\n\n```\n",
    "- Item\n\n  > ```text\n  > body\n\n  ```\n",
  ];
  for (const [cases, expectedClosed] of [[closed, true], [unclosed, false]]) {
    for (const text of cases) {
      for (const eol of ["\n", "\r\n"]) {
        const results = await lint({
          strings: { fixture: text.replaceAll("\n", eol) },
          config: { default: false, "closed-fences": true }, customRules: [closedFences],
        });
        assert.equal(results.fixture.length === 0, expectedClosed, JSON.stringify(text));
      }
    }
  }
});

test("process and preparation errors never prevent later diagnostics", (t) => {
  const root = fixture(t);
  for (const codes of [[0, 0], [2, 0], [0, 3], [2, 3]]) {
    const names = codes.map((code, index) => `${codes.join("-")}-${index}.txt`);
    assert.equal(runChecks(codes.map((code, index) => ({
      name: `Process ${index}`,
      prepare: () => ({ args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(names[index])}, 'ran'); process.exit(${code});`] }),
    })), root), codes.some(Boolean) ? 1 : 0);
    for (const name of names) assert.equal(readFileSync(join(root, name), "utf8"), "ran");
  }
  assert.equal(runChecks([
    { name: "Missing dependency", prepare: () => { throw new Error("missing executable"); } },
    { name: "Following check", prepare: () => ({ args: ["-e", "require('node:fs').writeFileSync('continued.txt', 'ran')"] }) },
  ], root), 1);
  assert.equal(readFileSync(join(root, "continued.txt"), "utf8"), "ran");
});
