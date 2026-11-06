import { readdirSync } from "node:fs";
import { extname } from "node:path";
import { excludedDirectories, statIfPresent, unlinkedPath } from "./paths.mjs";

export const rootFiles = Object.freeze([
  "index.html", "favicon.ico", "robots.txt", "CNAME", "yandex_c0b7a37a9f0baeb0.html",
  "LICENSE-mdi.txt", "LICENSE-assemblyscript.txt",
]);
const assetExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".svg", ".ico"]);
const runtimeExtensions = new Set([".mjs", ".css", ".json", ".wasm"]);

export function collectPublicFiles(root) {
  const files = [];
  for (const file of rootFiles) {
    const path = unlinkedPath(root, file);
    if (path && statIfPresent(path)?.isFile()) files.push(file);
  }
  function visit(prefix, extensions) {
    const directory = unlinkedPath(root, prefix);
    if (!directory || !statIfPresent(directory)?.isDirectory()) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || excludedDirectories.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const local = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(local, extensions);
      else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) files.push(local);
    }
  }
  visit("images", assetExtensions);
  visit("assets", assetExtensions);
  visit("app", runtimeExtensions);
  return files.sort();
}

export function requestFile(target) {
  // Inspect the original request, not URL.pathname: URL normalizes dot segments.
  if (!target.startsWith("/") || target.startsWith("//")) throw new Error("Expected an origin-form path");
  const pathname = decodeURIComponent(target.split(/[?#]/, 1)[0]);
  if (/[\\\u0000-\u001f\u007f:]/.test(pathname)) throw new Error("Invalid path characters");
  if (pathname.split("/").some((part) => part === "." || part === "..")) throw new Error("Traversal path");
  return pathname === "/" ? "index.html" : pathname.slice(1);
}
