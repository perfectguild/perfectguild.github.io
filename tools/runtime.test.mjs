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
  wasm.advance(12.5);
  assert.equal(wasm.getPhase(), phase.reveal);
  assert.equal(wasm.getCardIndex(), -1);
  assert.ok(wasm.getThreadProgress() > 0 && wasm.getThreadProgress() < 1);
  wasm.advance(1.15);
  assert.equal(wasm.getPhase(), phase.card);
  assert.equal(wasm.getCardProgress(), 1);
  near(wasm.getRemainingSeconds(), 30);
  wasm.advance(29.9);
  assert.equal(wasm.getPhase(), phase.card);
  near(wasm.getRemainingSeconds(), 0.1);
  wasm.advance(0.2);
  assert.equal(wasm.getPhase(), phase.retreat);
  assert.equal(wasm.getCardIndex(), -1);
});

test("manual takeover of the visible automatic card does not replay its reveal or consume another nickname", () => {
  const { wasm } = engine();
  wasm.setAutomatic(1);
  wasm.advance(13.65);
  const selected = wasm.getSelectedIndex();
  wasm.setManual(selected);
  assert.equal(wasm.getPhase(), phase.manual);
  assert.equal(wasm.getCardIndex(), selected);
  assert.equal(wasm.getThreadProgress(), 1);
  assert.equal(wasm.getCardProgress(), 1);
  wasm.advance(60);
  assert.equal(wasm.getCardIndex(), selected);
  wasm.dismiss();
  wasm.advance(12.2);
  assert.equal(wasm.getSelectedIndex(), (selected + 1) % 44);
});

test("large elapsed deltas preserve the same queue and transforms as incremental advancement", () => {
  const bulk = engine();
  const incremental = engine();
  bulk.wasm.setAutomatic(1);
  incremental.wasm.setAutomatic(1);
  bulk.wasm.advance(177.375);
  for (let index = 0; index < 1419; index++) incremental.wasm.advance(0.125);
  bulk.wasm.advance(12.2);
  incremental.wasm.advance(12.2);
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
  wasm.advance(0.2);
  assert.ok(wasm.getThreadProgress() < 1);
  wasm.setReducedMotion(1);
  assert.equal(wasm.getCardIndex(), 2);
  assert.equal(wasm.getCardProgress(), 1);
  near(states[7], 3.3);
  const frozen = Array.from(states);
  wasm.advance(20);
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
  wasm.advance(2.5);
  const remaining = wasm.getRemainingSeconds();
  const before = Array.from(states);
  for (const delta of [NaN, Infinity, -1]) wasm.advance(delta);
  assert.equal(wasm.getRemainingSeconds(), remaining);
  assert.deepEqual(Array.from(states), before);
  const memory = wasm.memory.buffer;
  for (let index = 0; index < 10000; index++) wasm.advance(0.016);
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
    "app/forum-media.json": { profiles: [{ nicknameId: "a", images: [{ url: "/assets/avatar.png" }] }] },
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
  writeFileSync(join(root, "app/forum-media.json"), JSON.stringify({ profiles: [{ nicknameId: "a", images: [{ url: "/assets/avatar.png" }, { url: "/assets/avatar.png" }] }] }));
  const errors = checkRuntime(root);
  assert.ok(errors.some(error => error.includes("Occurrence a") && error.includes("above")), errors.join("\n"));
  assert.ok(errors.some(error => error.includes("Forum profile a") && error.includes("/assets/avatar.png")), errors.join("\n"));
});
