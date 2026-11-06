import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkSite } from "./check-site.mjs";
import { createPreviewServer, previewPort } from "./preview.mjs";
import { collectPublicFiles, requestFile } from "./public-files.mjs";

const page = (body, css = "") => `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Fixture</title><style>${css}</style></head><body>${body}</body></html>\n`;
const image = Buffer.from([0xff, 0xd8, 0x00, 0x80, 0xfe, 0xff, 0xd9]);

function fixture(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "stranniki site [fixture] "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries({
    "index.html": page('<img src="images/logo.jpg" alt="Fixture">'),
    "favicon.ico": Buffer.from([0, 0, 1, 0]), "robots.txt": "User-agent: *\n", "CNAME": "example.invalid\n",
    "yandex_c0b7a37a9f0baeb0.html": "<html><body>Provider verification</body></html>",
    "LICENSE-mdi.txt": "Icon license fixture\n",
    "LICENSE-assemblyscript.txt": "Compiled runtime license fixture\n",
    "images/logo.jpg": image,
    ...files,
  })) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

function get(server, path, method = "GET") {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: "127.0.0.1", port: server.address().port, path, method }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) }));
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

async function serverFor(t, root) {
  const server = createPreviewServer(root);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return server;
}

test("public files exclude tooling, private paths and inappropriate asset types", (t) => {
  const root = fixture(t, {
    "README.md": "public documentation", "tools/tool.mjs": "tool", ".local/private.jpg": image,
    "raw/capture.jpg": image, "secrets/key.jpg": image, "node_modules/payload.jpg": image,
    "images/raw/capture.jpg": image, "images/.hidden.jpg": image, "images/note.md": "private",
    "images/payload.html": "not an image", "images/nested/second.png": image,
    "assets/private.md": "not an image", "assets/nested/allowed.webp": image,
    "app/main.mjs": "export const active = true;", "app/private.ts": "source",
    "app/raw/capture.json": "private", "app/.hidden.json": "private",
  });
  const files = collectPublicFiles(root);
  assert.ok(files.includes("images/nested/second.png"));
  assert.ok(files.includes("assets/nested/allowed.webp"));
  assert.ok(files.includes("app/main.mjs"));
  assert.ok(files.every((file) => !/README|tools|\.local|raw|secrets|node_modules|hidden|note|payload|private/.test(file)));
});

test("directory links cannot import private images or create recursion", (t) => {
  const root = fixture(t, { ".local/private.jpg": image });
  const kind = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(join(root, ".local"), join(root, "images", "private-link"), kind);
  symlinkSync(root, join(root, "images", "loop"), kind);
  assert.ok(!collectPublicFiles(root).some((file) => /private|loop/.test(file)));
  const linkedRoot = mkdtempSync(join(tmpdir(), "stranniki linked assets "));
  t.after(() => rmSync(linkedRoot, { recursive: true, force: true }));
  symlinkSync(join(root, "images"), join(linkedRoot, "images"), kind);
  assert.deepEqual(collectPublicFiles(linkedRoot), []);
});

test("file symlinks cannot expose private content", async (t) => {
  const root = fixture(t, { ".local/private.jpg": image });
  try {
    symlinkSync(join(root, ".local", "private.jpg"), join(root, "images", "linked.jpg"), "file");
  } catch (error) {
    if (process.platform !== "win32" || !["EPERM", "EACCES"].includes(error.code)) throw error;
    t.skip("Windows file symlinks need Developer Mode or symbolic-link privilege; junctions remain covered.");
    return;
  }
  const server = await serverFor(t, root);
  assert.equal((await get(server, "/images/linked.jpg")).status, 404);
});

test("site checker accepts public assets and provider verification without full-document linting", async (t) => {
  assert.deepEqual(await checkSite(fixture(t)), []);
});

test("site checker rejects missing or malformed local references and ignores remote URLs", async (t) => {
  const root = fixture(t, {
    "index.html": page('<a href="https://unreachable.invalid/private">Remote</a><img src="images/missing.jpg" alt="Missing"><img src="images/bad%ZZ.jpg" alt="Malformed"><img src="" alt="Empty"><a href=".local/private.jpg">Private</a>'),
    ".local/private.jpg": image,
  });
  const errors = await checkSite(root);
  assert.ok(errors.some((error) => error.includes("images/missing.jpg")), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes("images/bad%ZZ.jpg")), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes(".local/private.jpg")), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes("empty asset reference")), errors.join("\n"));
  assert.ok(!errors.some((error) => error.includes("unreachable.invalid")), errors.join("\n"));
});

test("site checker uses real CSS URLs, srcset assets and document fragment targets", async (t) => {
  const root = fixture(t, {
    "index.html": page('<div id="target" style="background-image: url(images/logo.jpg)"></div><a href="#target">Existing</a><a href="#absent">Missing</a><img src="images/logo.jpg" srcset="images/logo.jpg 1x, images/missing.jpg 2x" alt="Fixture">',
      '/* url(images/example-only.jpg) */ body { background: url("images/missing-background.jpg"); }'),
  });
  const errors = await checkSite(root);
  assert.ok(errors.some((error) => error.includes("images/missing.jpg")), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes("images/missing-background.jpg")), errors.join("\n"));
  assert.ok(errors.some((error) => error.includes("#absent")), errors.join("\n"));
  assert.ok(!errors.some((error) => error.includes("example-only") || error.includes("#target")), errors.join("\n"));
});

test("external stylesheet URLs resolve relative to their public stylesheet", async (t) => {
  const root = fixture(t, {
    "app/styles.css": 'body { background: url("../images/logo.jpg"); mask-image: url("../assets/missing.png"); }',
  });
  const errors = await checkSite(root);
  assert.ok(errors.some(error => error.includes("app/styles.css") && error.includes("../assets/missing.png")), errors.join("\n"));
  assert.ok(!errors.some(error => error.includes("../images/logo.jpg")), errors.join("\n"));
});

test("standards validation reports malformed maintained markup", async (t) => {
  const errors = await checkSite(fixture(t, { "index.html": page('<img src="images/logo.jpg" alt="A" alt="B">') }));
  assert.ok(errors.some((error) => error.includes("no-dup-attr")), errors.join("\n"));
});

test("preview serves byte-exact binary images with MIME, GET and HEAD", async (t) => {
  const server = await serverFor(t, fixture(t));
  assert.equal(server.address().address, "127.0.0.1");
  const result = await get(server, "/images/logo.jpg?cache=1");
  assert.equal(result.status, 200);
  assert.equal(result.headers["content-type"], "image/jpeg");
  assert.deepEqual(result.body, image);
  const head = await get(server, "/images/logo.jpg", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers["content-length"]), image.length);
  assert.equal(head.body.length, 0);
  assert.equal((await get(server, "/")).status, 200);
  assert.equal((await get(server, "/yandex_c0b7a37a9f0baeb0.html")).status, 200);
  const post = await get(server, "/", "POST");
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
});

test("preview serves browser modules and stream-instantiable WebAssembly without exposing sources", async (t) => {
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 103, 101, 116, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11]);
  const root = fixture(t, {
    "app/main.mjs": "export const active = true;", "app/styles.css": "body { color: white; }",
    "app/data.json": '{"active":true}', "app/motion.wasm": wasm,
    "src/motion.ts": "private build input", "app/raw/export.json": "private data",
  });
  const server = await serverFor(t, root);
  for (const [file, type] of [["main.mjs", "text/javascript"], ["styles.css", "text/css"], ["data.json", "application/json"]]) {
    const response = await get(server, `/app/${file}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers["content-type"].startsWith(type));
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  }
  const { instance } = await WebAssembly.instantiateStreaming(fetch(`http://127.0.0.1:${server.address().port}/app/motion.wasm`));
  assert.equal(instance.exports.get(), 42);
  assert.equal((await get(server, "/src/motion.ts")).status, 404);
  assert.equal((await get(server, "/app/raw/export.json")).status, 404);
});

test("preview rejects traversal and never falls back or exposes non-public files", async (t) => {
  const root = fixture(t, {
    "README.md": "docs", "tools/check.mjs": "tool", ".local/AGENTS.md": "private", ".git/config": "private",
    "raw/capture.jpg": image, "secrets/key": "private", "node_modules/package.json": "private",
  });
  const server = await serverFor(t, root);
  for (const path of ["/README.md", "/tools/check.mjs", "/.local/AGENTS.md", "/.git/config", "/raw/capture.jpg", "/secrets/key", "/node_modules/package.json", "/unknown", "/images/", "/images/.hidden.jpg"]) {
    assert.equal((await get(server, path)).status, 404, path);
  }
  for (const path of ["/../index.html", "/images/../index.html", "/%2e%2e/index.html", "/images/%2e%2e/index.html", "/images%5clogo.jpg", "/bad%ZZ", "//index.html", "/%00index.html"]) {
    assert.equal((await get(server, path)).status, 400, path);
  }
});

test("URL decoding keeps escaped names but rejects traversal before normalization", () => {
  assert.equal(requestFile("/images/a%20space.jpg?x=1"), "images/a space.jpg");
  assert.throws(() => requestFile("/images/../index.html"));
  assert.throws(() => requestFile("http://example.invalid/index.html"));
});

test("preview startup rejects missing pages and invalid port options", (t) => {
  const root = mkdtempSync(join(tmpdir(), "stranniki empty preview "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => createPreviewServer(root), /index\.html/);
  assert.equal(previewPort(["--port", "4291"], { PORT: "4292" }), 4291);
  assert.equal(previewPort(["--port=4293"], {}), 4293);
  assert.equal(previewPort([], { PORT: "4294" }), 4294);
  for (const value of ["0", "65536", "-1", "1.5", "abc", ""]) assert.throws(() => previewPort(["--port", value], {}));
  assert.throws(() => previewPort(["--host", "0.0.0.0"], {}));
});
