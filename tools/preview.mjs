import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicFiles, requestFile } from "./public-files.mjs";
import { unlinkedPath } from "./paths.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".txt", "text/plain; charset=utf-8"],
  [".ico", "image/x-icon"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".png", "image/png"], [".gif", "image/gif"], [".webp", "image/webp"],
  [".avif", "image/avif"], [".svg", "image/svg+xml"],
]);

export function createPreviewServer(root = repositoryRoot) {
  const files = new Set(collectPublicFiles(root));
  if (!files.has("index.html")) throw new Error("Public index.html is missing or linked");
  return createServer(async (request, response) => {
    function reply(status, text, headers = {}) {
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
      response.end(request.method === "HEAD" ? undefined : text);
    }
    if (!["GET", "HEAD"].includes(request.method)) return reply(405, "Method not allowed\n", { Allow: "GET, HEAD" });
    let file;
    try {
      file = requestFile(request.url);
    } catch {
      return reply(400, "Invalid path\n");
    }
    if (!files.has(file)) return reply(404, "Not found\n");
    try {
      const path = unlinkedPath(root, file);
      if (!path) return reply(404, "Not found\n");
      const info = await stat(path);
      if (!info.isFile()) return reply(404, "Not found\n");
      const headers = {
        "Content-Type": mime.get(extname(file).toLowerCase()) ?? "text/plain; charset=utf-8",
        "Content-Length": info.size,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (request.method === "HEAD") {
        response.writeHead(200, headers);
        return response.end();
      }
      const stream = createReadStream(path);
      stream.on("error", () => {
        if (response.headersSent) response.destroy();
        else reply(500, "Unable to read public file\n");
      });
      stream.on("open", () => {
        response.writeHead(200, headers);
        stream.pipe(response);
      });
      response.on("close", () => stream.destroy());
    } catch (error) {
      reply(["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 500, "Unable to read public file\n");
    }
  });
}

export function previewPort(args, environment = process.env) {
  let value = environment.PORT ?? "4173";
  if (args.length) {
    if (args.length === 2 && args[0] === "--port") value = args[1];
    else if (args.length === 1 && args[0].startsWith("--port=")) value = args[0].slice(7);
    else throw new Error("Usage: npm run dev -- [--port PORT]");
  }
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error("Port must be an integer from 1 to 65535");
  return Number(value);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = previewPort(process.argv.slice(2));
    const server = createPreviewServer();
    server.on("error", (error) => {
      console.error(`Preview failed: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port}/`));
  } catch (error) {
    console.error(`Preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}
