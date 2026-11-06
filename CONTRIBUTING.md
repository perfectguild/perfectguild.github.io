# Development and verification

## Requirements and installation

Use Node.js 22.22.0 or newer in the 22.x line, or Node.js 24.8.0 or newer, with npm.
CI uses the latest Node.js 22 patch on Windows and Linux. `package-lock.json`
pins development dependencies; none of them are loaded by the published page.

From the repository root:

```sh
npm ci --ignore-scripts
```

The public checkout is sufficient. Private instructions, historical inputs,
and credentials are not prerequisites for development or CI.

## Build

```sh
npm run build
```

This local build generates the committed `index.html` from `src/index.html`
and the Russian message catalog, adds integrity hashes for the entry module
and stylesheets, and compiles `src/motion.ts` to `app/motion.wasm`.
AssemblyScript is pinned; no global compiler is required.
Commit the generated HTML and WASM with their source changes.
GitHub Pages does not run npm or compile them during publication.

Edit `src/index.html`, not its generated root copy. Rebuild after changing
the template, catalog, entry module, stylesheets, or motion source.
The other `app/` modules and selected `assets/` files are served directly.

## Preview

```sh
npm run dev
```

Open `http://127.0.0.1:4173/`. To use another port:

```sh
npm run dev -- --port 4180
```

The preview binds to loopback and serves website files only. It does not expose
research inputs, secrets, private notes, repository metadata, or development
tools. An unknown URL is a missing resource, not a fallback to the home page.
Stop it with Ctrl+C.

The preview takes its public-file inventory at startup. Restart it after adding
or removing asset files; ordinary edits to existing files need only a reload.

## Verification

```sh
npm run check
```

The combined check runs these independently usable commands:

| Command | Coverage |
| --- | --- |
| `npm run test:build` | Rebuilds to temporary storage and rejects stale committed HTML, integrity hashes, or WASM |
| `npm run test:site` | Maintained HTML, external/inline CSS, and local website references |
| `npm run test:runtime` | Browser-module imports, selected media references, scene bounds, character groups, and data boundaries |
| `npm run test:docs` | Public Markdown, local documentation links, and Mermaid syntax |
| `npm run test:tooling` | Native WASM timing/state regressions and Node.js checks for validators, preview MIME types, and private-file exclusion |

External websites and historical archive availability are not network
prerequisites for these checks. The provider-issued Yandex verification page is
preserved as an opaque publication file, not rewritten to satisfy the site's
maintained-document lint rules.

For a website change, also run the preview and inspect the affected page in a
browser. Check the actual changed behavior; a passing linter is not visual proof.
For tooling changes, exercise the relevant command, including its failure path
where applicable. Permanent tests should cover behavior and boundaries, not
source wording or implementation trivia.

## CI and dependency updates

The `CI` workflow runs on pushes, pull requests, and manual dispatch:

- Reproducible build, site, runtime-data, documentation, and regression checks on Windows and Linux.
- Workflow validation with checksum-pinned actionlint.
- Redacted secret scanning of the public checkout with checksum-pinned Gitleaks.

GitHub Actions use commit-SHA pins and read-only permissions. Dependabot checks
npm and GitHub Actions dependencies weekly, grouping minor/patch updates.
Updates are not automatically merged. Validator archive versions/checksums in CI
are maintained explicitly; Dependabot does not update embedded download commands.

This setup does not require issues, pull requests, a Project, review bots, or
branch protection. In particular, these CI results **do not gate** the existing
GitHub Pages deployment from `main`. See [publication details](docs/deployment.md).

## Repository boundaries

- Keep reusable tools and their dependencies public and reproducible.
- Keep `raw/`, `secrets/`, `.local/`, and local agent instruction links out of the
  public history. Do not force-add them or make them submodules.
- Keep the existing root website files and custom domain unless a later task
  explicitly changes publication. `_config.yml` excludes tooling and documentation
  from the existing Pages build.
- Use LF for text; binary artwork is not subject to newline conversion.
- Write maintained technical documentation and commit messages in English.
  Preserve guild names, nicknames, and historical quotations in their original
  language.
- Historical inputs are evidence, not an automatically approved source of new
  public content or a second active checkout.

See [runtime architecture](docs/architecture.md) before changing motion,
image masks, character identity mappings, or the screenshot viewer.

Instructions for a private workspace are local to its owner. Public contributors
must not need private documents to understand or reproduce a public change.
