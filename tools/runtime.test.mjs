import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkRuntime } from "./check-runtime.mjs";

const motionModule = new WebAssembly.Module(readFileSync(new URL("../app/motion.wasm", import.meta.url)));
const phase = { original: 0, waiting: 1, candidates: 2, reveal: 3, card: 4, retreat: 5, manual: 6 };
function engine(count = 44) {
  const wasm = new WebAssembly.Instance(motionModule, { env: { abort() { throw new Error("WASM aborted"); } } }).exports;
  const pointer = wasm.init(count);
  const states = new Float32Array(wasm.memory.buffer, pointer, count * 3);
  return { wasm, states };
}
function near(actual, expected, tolerance = 0.000002) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test("automatic presentation finishes its thread, holds the card for thirty seconds, then retreats", () => {
  const { wasm } = engine();
  wasm.setAutomatic(1);
  wasm.advance(12.5, 0);
  assert.equal(wasm.getPhase(), phase.reveal);
  assert.equal(wasm.getCardIndex(), -1);
  assert.ok(wasm.getThreadProgress() > 0 && wasm.getThreadProgress() < 1);
  wasm.advance(1.15, 0);
  assert.equal(wasm.getPhase(), phase.card);
  assert.equal(wasm.getCardProgress(), 1);
  near(wasm.getRemainingSeconds(), 30);
  wasm.advance(29.9, 0);
  assert.equal(wasm.getPhase(), phase.card);
  near(wasm.getRemainingSeconds(), 0.1);
  wasm.advance(0.2, 0);
  assert.equal(wasm.getPhase(), phase.retreat);
  assert.equal(wasm.getCardIndex(), -1);
});

test("manual takeover of the visible automatic card does not replay its reveal or consume another nickname", () => {
  const { wasm } = engine();
  wasm.setAutomatic(1);
  wasm.advance(13.65, 0);
  const selected = wasm.getSelectedIndex();
  wasm.setManual(selected);
  assert.equal(wasm.getPhase(), phase.manual);
  assert.equal(wasm.getCardIndex(), selected);
  assert.equal(wasm.getThreadProgress(), 1);
  assert.equal(wasm.getCardProgress(), 1);
  wasm.advance(60, 0);
  assert.equal(wasm.getCardIndex(), selected);
  wasm.dismiss();
  wasm.advance(12.2, 0);
  assert.equal(wasm.getSelectedIndex(), (selected + 1) % 44);
});

test("large elapsed deltas preserve the same queue and transforms as incremental advancement", () => {
  const bulk = engine();
  const incremental = engine();
  bulk.wasm.setAutomatic(1);
  incremental.wasm.setAutomatic(1);
  bulk.wasm.advance(177.375, 0);
  for (let index = 0; index < 1419; index++) incremental.wasm.advance(0.125, 0);
  bulk.wasm.advance(12.2, 0);
  incremental.wasm.advance(12.2, 0);
  assert.equal(bulk.wasm.getPhase(), incremental.wasm.getPhase());
  assert.equal(bulk.wasm.getSelectedIndex(), 4);
  assert.equal(bulk.wasm.getSelectedIndex(), incremental.wasm.getSelectedIndex());
  near(bulk.wasm.getRemainingSeconds(), incremental.wasm.getRemainingSeconds());
  bulk.states.forEach((value, index) => near(value, incremental.states[index]));
});

test("reduced motion finishes a manual reveal and disables drift without losing selection", () => {
  const { wasm, states } = engine();
  wasm.setPeakScale(2, 3.3);
  wasm.setManual(2);
  wasm.advance(0.2, 0);
  assert.ok(wasm.getThreadProgress() < 1);
  wasm.setReducedMotion(1);
  assert.equal(wasm.getCardIndex(), 2);
  assert.equal(wasm.getCardProgress(), 1);
  near(states[7], 3.3);
  const frozen = Array.from(states);
  wasm.advance(20, 0);
  assert.deepEqual(Array.from(states), frozen);
  assert.equal(wasm.getCardOffsetX(), 0);
  assert.equal(wasm.getCardOffsetY(), 0);
  assert.equal(wasm.getCardAngle(), 0);
  wasm.setManual(3);
  assert.equal(wasm.getCardIndex(), 3);
  assert.equal(wasm.getCardProgress(), 1);
});

test("invalid time deltas cannot poison animation, and sustained animation keeps its shared memory view valid", () => {
  const { wasm, states } = engine();
  wasm.setAutomatic(1);
  wasm.advance(2.5, 0);
  const remaining = wasm.getRemainingSeconds();
  const before = Array.from(states);
  for (const delta of [NaN, Infinity, -1]) wasm.advance(delta, 0);
  assert.equal(wasm.getRemainingSeconds(), remaining);
  assert.deepEqual(Array.from(states), before);
  const memory = wasm.memory.buffer;
  for (let index = 0; index < 10000; index++) wasm.advance(0.016, 0);
  assert.equal(wasm.memory.buffer, memory);
  assert.equal(states.buffer, memory);
  assert.ok(states.every(Number.isFinite));
  wasm.reset();
  assert.equal(wasm.getPhase(), phase.original);
  assert.equal(wasm.getCardIndex(), -1);
  for (let index = 0; index < states.length; index += 3) {
    assert.equal(states[index], 0);
    assert.equal(states[index + 1], 1);
    near(states[index + 2], 0);
  }
});

function runtimeFixture(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "stranniki runtime [fixture] "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scene = {
    imageWidth: 100, imageHeight: 60,
    nicknames: [{ id: "a", label: "А" }, { id: "b", label: "Б" }],
    occurrences: ["a", "b"].map((id, index) => ({ id, nicknameId: id,
      bounds: { x: index * 30, y: 10, width: 20, height: 12 },
      maskUrl: "/assets/mask.png", repairUrl: "/assets/repair.png",
      contacts: { above: { x: 2.5, y: 1.5 }, below: { x: 2.5, y: 10.5 } },
    })),
  };
  const data = {
    "app/nicknames.json": scene,
    "app/sample-source.json": { sampleNames: ["А", "Б"], guildUrl: "https://example.invalid/guild" },
    "app/armory-snapshot.json": {
      characters: [{ id: "a", characterName: "А" }, { id: "b", characterName: "Б" }],
      characterGroups: [{ id: "group-a", nicknameIds: ["a", "b"], members: [{ characterId: "a", role: "main" }, { characterId: "b", role: "alt" }] }],
    },
    "app/forum-media.json": { defaultImage: { url: "/assets/avatar.png" }, profiles: [{ nicknameId: "a", images: [{ url: "/assets/avatar.png" }] }] },
    "app/screenshots.json": { images: [{ id: "memory-a", url: "/assets/memory.jpg", previewUrl: "/assets/preview.webp", width: 800, height: 600 }] },
  };
  const files = {
    ...Object.fromEntries(Object.entries(data).map(([path, value]) => [path, JSON.stringify(value)])),
    "app/main.mjs": 'import "./part.mjs"; const note = \'fetch("/raw/notes.json")\';',
    "app/part.mjs": "export const active = true;",
    ...Object.fromEntries(["mask.png", "repair.png", "avatar.png", "memory.jpg", "preview.webp"].map(name => [`assets/${name}`, Buffer.from([1])])),
    ...extra,
  };
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return { root, scene };
}

test("runtime validation follows executable module references, not example strings, and blocks private assets", (t) => {
  const valid = runtimeFixture(t);
  assert.deepEqual(checkRuntime(valid.root), []);
  const invalid = runtimeFixture(t, {
    "app/main.mjs": 'import "./missing.mjs"; fetch("/raw/private.json");',
    "raw/private.json": '{"secret":true}',
  });
  const errors = checkRuntime(invalid.root);
  assert.ok(errors.some(error => error.includes("./missing.mjs")), errors.join("\n"));
  assert.ok(errors.some(error => error.includes("/raw/private.json")), errors.join("\n"));
});

test("runtime validation rejects image contacts outside their local bounds and duplicate gallery identities", (t) => {
  const { root, scene } = runtimeFixture(t);
  scene.occurrences[0].contacts.above.x = scene.occurrences[0].bounds.width;
  writeFileSync(join(root, "app/nicknames.json"), JSON.stringify(scene));
  writeFileSync(join(root, "app/forum-media.json"), JSON.stringify({ defaultImage: { url: "/assets/avatar.png" }, profiles: [{ nicknameId: "a", images: [{ url: "/assets/avatar.png" }, { url: "/assets/avatar.png" }] }] }));
  const errors = checkRuntime(root);
  assert.ok(errors.some(error => error.includes("Occurrence a") && error.includes("above")), errors.join("\n"));
  assert.ok(errors.some(error => error.includes("Forum profile a") && error.includes("/assets/avatar.png")), errors.join("\n"));
});

test("roster-linked groups may omit a main but cannot silently mix inferred main and alt roles", (t) => {
  const { root } = runtimeFixture(t);
  const path = join(root, "app/armory-snapshot.json");
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  const group = snapshot.characterGroups[0];
  group.evidenceKind = "in-game-roster-note";
  group.evidence = [{ characterId: "b", note: "ака А" }];
  for (const member of group.members) member.role = "related";
  writeFileSync(path, JSON.stringify(snapshot));
  assert.deepEqual(checkRuntime(root), []);
  group.members[1].role = "alt";
  writeFileSync(path, JSON.stringify(snapshot));
  assert.ok(checkRuntime(root).some(error => error.includes("without an inferred main")));
  group.members[1].role = "related";
  delete group.evidence;
  writeFileSync(path, JSON.stringify(snapshot));
  assert.ok(checkRuntime(root).some(error => error.includes("missing roster-note evidence")));
});

test("rank inference requires one non-twink, corroborated ranks and existing character links without overriding a confirmed main", (t) => {
  const { root } = runtimeFixture(t);
  const path = join(root, "app/armory-snapshot.json");
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  snapshot.observedOn = "2026-11-07";
  snapshot.rosterSource = { id: "screenshots", imageCount: 3 };
  snapshot.characters.push({ id: "c", characterName: "В" });
  snapshot.characters.forEach((character, index) => {
    character.guildRank = { index: index === 0 ? 1 : 5 };
    character.rosterObservation = {
      sourceId: "screenshots", image: index + 1,
      rankKey: index === 0 ? "card.rankOfficer" : "card.rankTwink",
    };
  });
  const group = snapshot.characterGroups[0];
  group.evidenceKind = "in-game-roster-note";
  group.members.push({ characterId: "c", role: "alt" });
  group.evidence = [
    { characterId: "b", sourceId: "screenshots", image: 2, note: "ака А" },
    { characterId: "c", sourceId: "screenshots", image: 3, note: "ака А" },
  ];
  group.roleInference = {
    kind: "single-non-twink", assessedOn: "2026-11-08",
    armoryObservedOn: "2026-11-07", rosterSourceId: "screenshots",
  };
  writeFileSync(path, JSON.stringify(snapshot));
  assert.deepEqual(checkRuntime(root), []);

  for (const [reason, change] of [
    ["unmarked inference", data => { delete data.characterGroups[0].roleInference; }],
    ["two non-twinks", data => {
      data.characters[1].guildRank.index = 6;
      data.characters[1].rosterObservation.rankKey = "card.rankRecruit";
    }],
    ["no non-twink", data => {
      data.characters[0].guildRank.index = 5;
      data.characters[0].rosterObservation.rankKey = "card.rankTwink";
    }],
    ["unknown rank", data => { delete data.characters[1].guildRank; }],
    ["conflicting sources", data => { data.characters[1].rosterObservation.rankKey = "card.rankRecruit"; }],
    ["untraceable rank", data => { data.characters[1].rosterObservation.sourceId = "another-source"; }],
    ["missing character link", data => { data.characterGroups[0].evidence.pop(); }],
    ["owner-confirmed main", data => { data.characterGroups[0].evidenceKind = "owner-confirmed"; }],
    ["stale assessment", data => { data.observedOn = "2026-11-09"; }],
  ]) {
    const invalid = structuredClone(snapshot);
    change(invalid);
    writeFileSync(path, JSON.stringify(invalid));
    assert.ok(checkRuntime(root).some(error => error.includes("Group group-a:") && error.includes("rank inference")), reason);
  }
});

test("collage aliases require a real target and traceable note rather than a similar character name", (t) => {
  const { root } = runtimeFixture(t);
  const scenePath = join(root, "app/nicknames.json");
  const snapshotPath = join(root, "app/armory-snapshot.json");
  const scene = JSON.parse(readFileSync(scenePath, "utf8"));
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  snapshot.rosterSource = { id: "screenshots", imageCount: 10 };
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  scene.nicknames[0].characterId = "b";
  writeFileSync(scenePath, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("explicit roster-note evidence")));
  scene.nicknames[0].evidence = { sourceId: "screenshots", image: 5, note: "А" };
  writeFileSync(scenePath, JSON.stringify(scene));
  assert.deepEqual(checkRuntime(root), []);
  scene.nicknames[0].characterId = "missing";
  writeFileSync(scenePath, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("known character")));
  scene.nicknames[0].characterId = "b";
  scene.nicknames[0].evidence.image = 11;
  writeFileSync(scenePath, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("roster-note evidence")));
  scene.nicknames[0].evidence.image = 5;
  writeFileSync(scenePath, JSON.stringify(scene));
  delete snapshot.rosterSource;
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  assert.ok(checkRuntime(root).some(error => error.includes("roster-note evidence")));
  snapshot.rosterSource = { id: "screenshots", imageCount: 10 };
  snapshot.characters.push({ id: "c", characterName: "В" });
  snapshot.characterGroups[0].nicknameIds = ["a"];
  snapshot.characterGroups[0].members[1].characterId = "c";
  writeFileSync(snapshotPath, JSON.stringify(snapshot));
  assert.ok(checkRuntime(root).some(error => error.includes("bound character missing")));
});

test("historical forum cards may cite an archive source without inventing a gallery", (t) => {
  const { root } = runtimeFixture(t);
  const path = join(root, "app/forum-media.json");
  const forum = JSON.parse(readFileSync(path, "utf8"));
  forum.profiles[0].images = [];
  forum.profiles[0].evidenceUrl = "https://example.invalid/forum-capture";
  writeFileSync(path, JSON.stringify(forum));
  assert.deepEqual(checkRuntime(root), []);
  delete forum.profiles[0].evidenceUrl;
  writeFileSync(path, JSON.stringify(forum));
  assert.ok(checkRuntime(root).some(error => error.includes("empty gallery without an evidence source")));
});

test("catalogue-only names require an explicit placement and cannot acquire invented glyph occurrences", (t) => {
  const { root, scene } = runtimeFixture(t);
  const path = join(root, "app/nicknames.json");
  const occurrence = scene.occurrences.pop();
  writeFileSync(path, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("Nickname b")));
  scene.nicknames[1].placement = "catalog-only";
  writeFileSync(path, JSON.stringify(scene));
  assert.deepEqual(checkRuntime(root), []);
  scene.occurrences.push(occurrence);
  writeFileSync(path, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("Nickname b")));
});

test("historical self-reports retain related characters without silently appointing the applicant as main", (t) => {
  const { root } = runtimeFixture(t);
  const path = join(root, "app/armory-snapshot.json");
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  const group = snapshot.characterGroups[0];
  group.evidenceKind = "archive-self-report";
  group.evidenceUrl = "https://example.invalid/archived-application";
  group.capturedOn = "2010-04-24";
  for (const member of group.members) member.role = "related";
  writeFileSync(path, JSON.stringify(snapshot));
  assert.deepEqual(checkRuntime(root), []);
  for (const mutate of [
    () => { group.members[0].role = "main"; group.members[1].role = "alt"; },
    () => { group.capturedOn = "2010-02-30"; },
    () => { delete group.evidenceUrl; },
  ]) {
    group.members.forEach(member => { member.role = "related"; });
    group.capturedOn = "2010-04-24";
    group.evidenceUrl = "https://example.invalid/archived-application";
    mutate();
    writeFileSync(path, JSON.stringify(snapshot));
    assert.ok(checkRuntime(root).some(error => error.includes("archived self-report")));
  }
});

test("owner-confirmed character aliases need a real target and a dated confirmation, not a fabricated roster note", (t) => {
  const { root, scene } = runtimeFixture(t);
  const path = join(root, "app/nicknames.json");
  const alias = scene.nicknames[0];
  alias.label = "Историческое имя";
  alias.characterId = "a";
  alias.evidence = { kind: "owner-confirmed-character", confirmedOn: "2026-11-09", note: "Same character, confirmed by owner" };
  writeFileSync(path, JSON.stringify(scene));
  writeFileSync(join(root, "app/sample-source.json"), JSON.stringify({ sampleNames: scene.nicknames.map(row => row.label), guildUrl: "https://example.invalid/guild" }));
  assert.deepEqual(checkRuntime(root), []);
  delete alias.evidence.confirmedOn;
  writeFileSync(path, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("Nickname a")));
  alias.evidence.confirmedOn = "2026-11-09";
  alias.characterId = "missing";
  writeFileSync(path, JSON.stringify(scene));
  assert.ok(checkRuntime(root).some(error => error.includes("Nickname a")));
});

test("threadless catalogue inspection advances scenery without selecting or pulsing a glyph", () => {
  const { wasm, states } = engine();
  wasm.setAutomatic(0);
  wasm.dismiss();
  wasm.advance(1, 1);
  near(wasm.getEffectTime(), 1);
  assert.equal(wasm.getSelectedIndex(), -1);
  assert.equal(wasm.getCardIndex(), -1);
  assert.equal(wasm.getThreadProgress(), 0);
  for (let index = 0; index < states.length; index += 3) {
    assert.equal(states[index], 0);
    assert.equal(states[index + 1], 1);
    near(states[index + 2], 0);
  }
  wasm.advance(1, 0);
  near(wasm.getEffectTime(), 1);
  wasm.setReducedMotion(1);
  wasm.advance(1, 1);
  near(wasm.getEffectTime(), 1);
});
