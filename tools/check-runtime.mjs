import { readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { collectPublicFiles } from "./public-files.mjs";
import { localReference } from "./paths.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function walk(node, visitor) {
  if (!node || typeof node.type !== "string") return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visitor);
    else if (value && typeof value === "object") walk(value, visitor);
  }
}

export function checkRuntime(root = repositoryRoot) {
  const errors = [];
  const publicFiles = new Set(collectPublicFiles(root));
  function reference(file, value) {
    try {
      if (typeof value !== "string" || !value.trim()) throw new Error("missing asset URL");
      const path = localReference(value);
      if (path === undefined) throw new Error("runtime assets must be local");
      const target = posix.normalize(path.startsWith("/") ? path.slice(1) : posix.join(posix.dirname(file), path));
      if (!publicFiles.has(target)) throw new Error("asset is missing or outside the public payload");
    } catch (error) {
      errors.push(`${file}: ${String(value)}: ${error.message}`);
    }
  }
  function sourceLink(file, value) {
    if (value == null) return;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("expected an HTTPS source link without credentials");
    } catch (error) { errors.push(`${file}: unsafe source URL: ${error.message}`); }
  }
  for (const file of publicFiles) {
    if (!file.startsWith("app/") || !file.endsWith(".mjs")) continue;
    try {
      const ast = parse(readFileSync(join(root, file), "utf8"), { ecmaVersion: "latest", sourceType: "module" });
      walk(ast, node => {
        if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type) && node.source?.type === "Literal") {
          reference(file, node.source.value);
        }
        if (node.type === "NewExpression" && node.callee.name === "URL" && node.arguments[0]?.type === "Literal") reference(file, node.arguments[0].value);
        if (node.type === "CallExpression" && ["readJSON", "decodeImage", "fetch"].includes(node.callee.name) && node.arguments[0]?.type === "Literal") reference(file, node.arguments[0].value);
      });
    } catch (error) { errors.push(`${file}: invalid module: ${error.message}`); }
  }
  function json(file) {
    try {
      if (!publicFiles.has(file)) throw new Error("missing public data file");
      return JSON.parse(readFileSync(join(root, file), "utf8"));
    } catch (error) { errors.push(`${file}: ${error.message}`); return null; }
  }
  function unique(rows, key, context) {
    const seen = new Set();
    for (const row of rows) {
      if (typeof row[key] !== "string" || !row[key] || seen.has(row[key])) errors.push(`${context}: missing or duplicate ${key}: ${String(row[key])}`);
      seen.add(row[key]);
    }
    return seen;
  }
  const scene = json("app/nicknames.json");
  const source = json("app/sample-source.json");
  const snapshot = json("app/armory-snapshot.json");
  const forum = json("app/forum-media.json");
  const screenshots = json("app/screenshots.json");
  if (!scene || !source || !snapshot || !forum || !screenshots) return errors;
  try {
    const nicknameIds = unique(scene.nicknames, "id", "Nicknames");
    unique(scene.occurrences, "id", "Occurrences");
    const occurrenceCounts = new Map(scene.nicknames.map(row => [row.id, 0]));
    for (const occurrence of scene.occurrences) {
      if (!nicknameIds.has(occurrence.nicknameId)) errors.push(`Occurrence ${occurrence.id}: unknown nickname`);
      else occurrenceCounts.set(occurrence.nicknameId, occurrenceCounts.get(occurrence.nicknameId) + 1);
      const bounds = occurrence.bounds;
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 || bounds.x + bounds.width > scene.imageWidth || bounds.y + bounds.height > scene.imageHeight) errors.push(`Occurrence ${occurrence.id}: bounds leave the artwork`);
      reference("app/nicknames.json", occurrence.maskUrl);
      reference("app/nicknames.json", occurrence.repairUrl);
      for (const side of ["above", "below"]) {
        const point = occurrence.contacts?.[side];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) errors.push(`Occurrence ${occurrence.id}: invalid ${side} contact`);
      }
    }
    for (const [id, count] of occurrenceCounts) if (count < 1 || count > 2) errors.push(`Nickname ${id}: expected one or two occurrences`);
    if (source.sampleNames.length !== scene.nicknames.length || scene.nicknames.some((row, index) => row.label !== source.sampleNames[index])) errors.push("Scene names do not match the dated source projection");
    sourceLink("app/sample-source.json", source.guildUrl);
    const characterIds = unique(snapshot.characters, "id", "Characters");
    const names = new Map(snapshot.characters.map(row => [row.id, row.characterName]));
    for (const nickname of scene.nicknames) {
      if (nickname.characterId) {
        const evidence = nickname.evidence;
        if (!characterIds.has(nickname.characterId) || typeof evidence?.note !== "string" || !evidence.note.trim()
          || !snapshot.rosterSource?.id || evidence.sourceId !== snapshot.rosterSource.id
          || !Number.isInteger(snapshot.rosterSource.imageCount)
          || !Number.isInteger(evidence.image) || evidence.image < 1
          || evidence.image > snapshot.rosterSource?.imageCount) {
          errors.push(`Nickname ${nickname.id}: alias needs a known character and explicit roster-note evidence`);
        }
      } else if (names.get(nickname.id) !== nickname.label) errors.push(`Nickname ${nickname.id}: character name mismatch`);
    }
    for (const character of snapshot.characters) sourceLink("app/armory-snapshot.json", character.profileUrl);
    sourceLink("app/armory-snapshot.json", snapshot.sourceUrl);
    unique(snapshot.characterGroups, "id", "Character groups");
    const groupedNicknames = new Set();
    const groupedCharacters = new Set();
    const nicknameCharacters = new Map(scene.nicknames.map(row => [row.id, row.characterId || row.id]));
    for (const group of snapshot.characterGroups) {
      const knownMain = group.members[0]?.role === "main";
      if (group.members.length < 2 || group.members.some((member, index) =>
        member.role !== (knownMain ? index === 0 ? "main" : "alt" : "related"))) {
        errors.push(`Group ${group.id}: expected a main followed by alts, or related characters without an inferred main`);
      }
      if (!knownMain && group.evidenceKind !== "in-game-roster-note") errors.push(`Group ${group.id}: related characters need roster-note evidence`);
      if (!knownMain && !group.evidence?.length) errors.push(`Group ${group.id}: missing roster-note evidence`);
      for (const id of group.nicknameIds) {
        if (!nicknameIds.has(id) || groupedNicknames.has(id)) errors.push(`Group ${group.id}: unknown or multiply grouped nickname ${id}`);
        if (!group.members.some(member => member.characterId === nicknameCharacters.get(id))) errors.push(`Group ${group.id}: bound character missing for nickname ${id}`);
        groupedNicknames.add(id);
      }
      for (const member of group.members) {
        if (!characterIds.has(member.characterId) || groupedCharacters.has(member.characterId)) errors.push(`Group ${group.id}: unknown or multiply grouped character ${member.characterId}`);
        groupedCharacters.add(member.characterId);
      }
    }
    unique(forum.profiles, "nicknameId", "Forum profiles");
    for (const profile of forum.profiles) {
      if (!nicknameIds.has(profile.nicknameId)) errors.push(`Forum profile ${profile.nicknameId}: unknown nickname`);
      unique(profile.images, "url", `Forum profile ${profile.nicknameId}`);
      if (!profile.images.length && !profile.archiveProfileUrl && !profile.evidenceUrl) errors.push(`Forum profile ${profile.nicknameId}: empty gallery without an evidence source`);
      for (const image of profile.images) {
        reference("app/forum-media.json", image.url);
        if (image.stillUrl) reference("app/forum-media.json", image.stillUrl);
        if (Object.hasOwn(image, "sourcePath")) errors.push(`Forum profile ${profile.nicknameId}: private sourcePath must not be published`);
      }
      sourceLink("app/forum-media.json", profile.archiveProfileUrl);
      sourceLink("app/forum-media.json", profile.evidenceUrl);
    }
    unique(screenshots.images, "id", "Memories");
    for (const image of screenshots.images) {
      reference("app/screenshots.json", image.url);
      reference("app/screenshots.json", image.previewUrl);
      if (!Number.isInteger(image.width) || image.width <= 0 || !Number.isInteger(image.height) || image.height <= 0) errors.push(`Memory ${image.id}: invalid source dimensions`);
    }
  } catch (error) { errors.push(`Invalid runtime data shape: ${error.message}`); }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkRuntime();
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log("Runtime modules, selected media, character groups and data boundaries passed.");
}
