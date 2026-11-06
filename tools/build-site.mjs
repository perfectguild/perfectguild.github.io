import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { locale, t } from "../app/i18n.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.length === 3 && process.argv[2] === "--check";
if (process.argv.length > 2 && !check) throw new Error("Usage: node tools/build-site.mjs [--check]");

const escapeText = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = value => escapeText(value).replaceAll('"', "&quot;");
const source = readFileSync(join(root, "src/index.html"), "utf8");
// Parse noscript content as markup as well: its fallback must be localized before JS runs.
const tree = parse(source, { sourceCodeLocationInfo: true, scriptingEnabled: false });
const replacements = [];
const attributeKeys = [
  ["data-i18n-aria-label", "aria-label"], ["data-i18n-title", "title"], ["data-i18n-alt", "alt"],
];
function visit(node) {
  const attrs = new Map((node.attrs ?? []).map(attribute => [attribute.name, attribute.value]));
  const location = node.sourceCodeLocation;
  if (location?.startTag) {
    const message = attrs.get("data-i18n");
    if (message) {
      if (!location.endTag) throw new Error(`Localized ${node.tagName} needs a closing tag`);
      replacements.push([location.startTag.endOffset, location.endTag.startOffset, escapeText(t(message))]);
    }
    const values = attributeKeys.filter(([key]) => attrs.has(key)).map(([key, attribute]) => [attribute, t(attrs.get(key))]);
    if (node.tagName === "html") values.push(["lang", locale]);
    const asset = node.tagName === "script" ? attrs.get("src")
      : node.tagName === "link" && attrs.get("rel") === "stylesheet" ? attrs.get("href") : null;
    if (asset) {
      if (!asset.startsWith("/app/")) throw new Error(`Expected a public application asset: ${asset}`);
      const digest = createHash("sha384").update(readFileSync(join(root, asset.slice(1)))).digest("base64");
      values.push(["integrity", `sha384-${digest}`]);
    }
    for (const [attribute, value] of values) {
      const existing = location.attrs?.[attribute];
      const text = `${attribute}="${escapeAttribute(value)}"`;
      replacements.push(existing
        ? [existing.startOffset, existing.endOffset, text]
        : [location.startTag.endOffset - 1, location.startTag.endOffset - 1, ` ${text}`]);
    }
  }
  for (const child of node.childNodes ?? []) visit(child);
  if (node.content) visit(node.content);
}
visit(tree);
let html = source;
for (const [start, end, replacement] of replacements.sort((a, b) => b[0] - a[0])) {
  html = html.slice(0, start) + replacement + html.slice(end);
}

const temporary = mkdtempSync(join(tmpdir(), "stranniki-build-"));
try {
  const wasmPath = join(temporary, "motion.wasm");
  execFileSync(process.execPath, [
    join(root, "node_modules/assemblyscript/bin/asc.js"), "src/motion.ts", "--outFile", wasmPath,
    "--runtime", "stub", "--optimize", "--noAssert",
  ], { cwd: root, stdio: "inherit" });
  const outputs = new Map([["index.html", Buffer.from(html)], ["app/motion.wasm", readFileSync(wasmPath)]]);
  for (const [file, bytes] of outputs) {
    if (check) {
      if (!readFileSync(join(root, file)).equals(bytes)) throw new Error(`${file} is stale; run npm run build and commit the generated files`);
    } else {
      writeFileSync(join(root, file), bytes);
    }
  }
  console.log(check ? "Committed HTML and WASM match their public sources." : "Built localized index.html and app/motion.wasm.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
