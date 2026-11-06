import { readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HtmlValidate } from "html-validate";
import { parse } from "parse5";
import { parse as parseCss, walk } from "css-tree";
import { collectPublicFiles, rootFiles } from "./public-files.mjs";
import { localReference } from "./paths.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const validatorConfig = JSON.parse(readFileSync(new URL("../.htmlvalidate.json", import.meta.url), "utf8"));

function srcsetUrls(value) {
  // The HTML srcset algorithm collects URLs up to whitespace, not commas inside
  // data URLs; descriptors end at the next comma outside parentheses.
  const urls = [];
  let rest = value;
  while (rest.length) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) break;
    const match = /^\S+/.exec(rest);
    const url = match[0];
    urls.push(url.replace(/,+$/, ""));
    rest = rest.slice(url.length);
    if (url.endsWith(",")) continue;
    let depth = 0;
    let index = 0;
    for (; index < rest.length; index++) {
      if (rest[index] === "(") depth++;
      else if (rest[index] === ")") depth--;
      else if (rest[index] === "," && depth === 0) break;
    }
    rest = rest.slice(index + 1);
  }
  return urls;
}

export async function checkSite(root = repositoryRoot) {
  const errors = [];
  const publicFiles = new Set(collectPublicFiles(root));
  for (const required of rootFiles) {
    if (!publicFiles.has(required)) errors.push(`${required}: required public file is missing or linked`);
  }
  // The provider-issued Yandex verification file is served verbatim, not linted
  // as a maintained complete document.
  if (!publicFiles.has("index.html")) return errors;
  const file = "index.html";
  const text = readFileSync(join(root, file), "utf8");
  const validator = new HtmlValidate(validatorConfig);
  const report = await validator.validateString(text, join(root, file));
  for (const result of report.results) {
    for (const message of result.messages) {
      errors.push(`${file}:${message.line}:${message.column}: ${message.message} (${message.ruleId})`);
    }
  }
  const tree = parse(text);
  const ids = new Set();
  function visit(node, action) {
    action(node);
    for (const child of node.childNodes ?? []) visit(child, action);
    if (node.content) visit(node.content, action);
  }
  visit(tree, (node) => {
    for (const attribute of node.attrs ?? []) {
      if (attribute.name === "id" || node.tagName === "a" && attribute.name === "name") ids.add(attribute.value);
    }
  });
  function check(value, from = file) {
    try {
      const path = localReference(value);
      if (path === undefined) return;
      const target = path ? posix.normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(from), path)) : from;
      const normalized = target === "." ? "index.html" : target.endsWith("/") ? `${target}index.html` : target;
      if (!publicFiles.has(normalized)) throw new Error("target is missing or outside public files");
      if (normalized === file && value.includes("#")) {
        const fragment = decodeURIComponent(value.slice(value.indexOf("#") + 1));
        if (fragment && !ids.has(fragment)) throw new Error("fragment has no matching id");
      }
    } catch (error) {
      errors.push(`${from}: ${value}: ${error.message}`);
    }
  }
  function css(text, context, from = file) {
    try {
      const ast = parseCss(text, {
        context,
        onParseError: (error) => { throw error; },
      });
      walk(ast, (node) => {
        if (node.type === "Url") check(node.value, from);
        if (node.type === "Atrule" && node.name.toLowerCase() === "import" && node.prelude) {
          const first = node.prelude.children.first;
          if (first?.type === "String") check(first.value, from);
        }
      });
    } catch (error) {
      errors.push(`${from}: malformed CSS: ${error.message}`);
    }
  }
  visit(tree, (node) => {
    for (const attribute of node.attrs ?? []) {
      if (["src", "poster", "data"].includes(attribute.name) && !attribute.value.trim()) {
        errors.push(`${file}: ${attribute.name} must not be an empty asset reference`);
      }
      if (["href", "src", "poster", "data", "action", "formaction"].includes(attribute.name)) check(attribute.value);
      if (attribute.name === "srcset") for (const url of srcsetUrls(attribute.value)) check(url);
      if (attribute.name === "style") css(attribute.value, "declarationList");
    }
    if (node.tagName === "style") css((node.childNodes ?? []).map((child) => child.value ?? "").join(""), "stylesheet");
    if (node.tagName === "base") errors.push(`${file}: base elements are unsupported; keep links rooted in the static page`);
  });
  for (const asset of publicFiles) {
    if (asset.endsWith(".css")) css(readFileSync(join(root, asset), "utf8"), "stylesheet", asset);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const errors = await checkSite();
    for (const error of errors) console.error(error);
    if (errors.length) process.exitCode = 1;
    else console.log("Site HTML and local links passed.");
  } catch (error) {
    console.error(`Site check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
