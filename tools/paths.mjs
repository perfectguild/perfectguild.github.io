import { lstatSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const excludedDirectories = new Set([
  "artifacts", "backups", "build", "captures", "coverage", "decompiled", "deps", "dist", "env",
  "generated", "node_modules", "raw", "secrets", "site", "tmp", "vendor", "venv",
]);

export function statIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return undefined;
    throw error;
  }
}

// Check every path component: checking only the leaf misses directory junctions.
export function unlinkedPath(root, candidate, { privateDocs = false } = {}) {
  const path = resolve(root, candidate);
  const local = relative(resolve(root), path);
  if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) return undefined;
  let current = resolve(root);
  if (statIfPresent(current)?.isSymbolicLink()) return undefined;
  for (const part of local.split(sep).filter(Boolean)) {
    const lower = part.toLowerCase();
    if (lower === ".git" || lower === ".local" && !privateDocs || excludedDirectories.has(lower)) return undefined;
    current = resolve(current, part);
    const stat = statIfPresent(current);
    if (!stat || stat.isSymbolicLink()) return undefined;
  }
  return path;
}

// External URLs are intentionally never fetched. Only local paths are decoded.
export function localReference(value) {
  const text = value.trim();
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(text)) return undefined;
  const pathname = text.split(/[?#]/, 1)[0];
  const decoded = decodeURIComponent(pathname);
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) throw new Error("Invalid local URL characters");
  return decoded;
}
