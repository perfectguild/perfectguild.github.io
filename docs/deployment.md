# Publication architecture

The «Странники» guild chronicle is a static GitHub Pages site behind Cloudflare. Its interactive browser runtime does not require an application server or live Armory API. Hosting, DNS, proxying, TLS, and redirects retain the existing architecture.

## Request and publication paths

```mermaid
flowchart LR
    Repository["main: repository root"] -->|built-in publication| Pages["GitHub Pages origin"]
    Apex["perfectguild.com"] -->|Cloudflare: 301| Canonical["www.perfectguild.com"]
    Canonical -->|Cloudflare proxy| Pages
```

Pages publishes this public repository's branch `main`, folder `/`, using the branch-based (`legacy`) build type. The custom domain is `www.perfectguild.com`, matching the root [CNAME](../CNAME). Keep the existing root HTML, image, favicon, robots file, and verification page in place.

Branch publication still appears as an Actions run: GitHub runs its built-in `pages-build-deployment` workflow even when Pages is configured to deploy from a branch. This is not a custom npm deployment workflow. GitHub documents both [branch publishing and the built-in workflow behavior](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Repository checks are not a deployment gate

The added Node/npm CI checks are separate from the existing Pages deployment. They do not upload a Pages artifact, switch the publishing source, or gate direct publication from `main`. A push to the publishing branch can publish independently of those checks. See [CONTRIBUTING](../CONTRIBUTING.md) for the local command contract; a successful local check is not proof of a hosted deployment.

The branch build retains Jekyll processing. [_config.yml](../_config.yml) excludes repository-only files from the published output: `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `docs`, `tools`, `src`, `package.json`, `package-lock.json`, `node_modules`, `raw`, and `secrets`. The root web files, `app/`, `assets/`, `images/`, and third-party license notices form the website payload. Do not introduce `.nojekyll` or move the publishing source as a tooling shortcut.

GitHub documents [Jekyll's default exclusions and the `exclude` setting](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll). Output exclusions are not a privacy boundary: files committed to this public repository remain public even when Jekyll omits them. Raw material, secrets, private notes, and local instruction symlinks must stay out of public Git history. Public installation and checks require none of those local files.

## Reproducible publication inputs

`npm run build` generates the root HTML and compiled motion module from public
sources. Both outputs are committed because branch-based Pages runs Jekyll,
not the npm build. The HTML includes SHA-384 integrity hashes for its local
entry module and stylesheets; changing those files requires rebuilding HTML.
The remaining browser modules and selected media are ordinary static files.
See [runtime architecture](architecture.md) and [development commands](../CONTRIBUTING.md).

The public checkout contains everything needed to build, check, and preview
the site. Raw collections, private prototype history, credentials, and image
extraction tools are not release inputs. The historical JPEG and fullscreen
screenshots retain their original bytes except for the documented local,
lossless JPEG-coefficient correction to Шэф.

## Release procedure

1. Install pinned tools with `npm ci --ignore-scripts`, run `npm run build`,
   then `npm run check`.
2. Exercise the actual preview on desktop and mobile: nickname/card selection,
   fullscreen memories and carousel, keyboard focus, reduced motion, and
   failure fallback. Check the public payload separately from the raw collection.
3. Review the exact staged paths. Exclude `raw/`, `secrets/`, `.local/`,
   agent links, temporary captures, and `node_modules/`.
4. Commit source, generated outputs, selected media, documentation, and license
   notices together. Push the authorized commit to `main` without force.
5. Inspect both the `CI` run and GitHub's `pages-build-deployment` run for that
   commit. Check the Pages build/deployment commit, not just a green unrelated run.
6. Open `https://www.perfectguild.com/` in a browser. Confirm the new runtime
   initializes, its assets have appropriate MIME types, and a full-size memory
   opens. Check the apex redirect separately. A successful local preview is not
   evidence that Cloudflare is serving the new deployment.
7. Publish a versioned GitHub Release on the verified commit with English notes.
   The release tag records a deployment; creating a tag alone does not deploy Pages.

The first interactive release uses `v1.0.0`. Subsequent releases should keep
immutable version tags. To roll back, revert the release commit on `main`,
including generated HTML/WASM and any asset changes, and re-check both hosted
workflows and the live site. Do not force-rewrite the publishing branch or
retarget an existing release tag.

## Observed live behavior — 2026-11-03

Read-only repository/API and HTTPS/DNS observations established:

| Observation | Result |
| --- | --- |
| Repository and branch | Public repository, default branch `main` |
| Pages configuration | `build_type: legacy`, source `main` at `/`, `cname: www.perfectguild.com`, status `built` |
| Active workflow before the new CI changes | GitHub's dynamic `pages/pages-build-deployment` |
| `https://perfectguild.com` | `301`, `Location: https://www.perfectguild.com/`, `Server: cloudflare` |
| `https://www.perfectguild.com` | `200`, `Server: cloudflare`, and an `x-github-request-id` response header |
| Google DNS-over-HTTPS NS answer | `quentin.ns.cloudflare.com`, `uma.ns.cloudflare.com`; response `AD: true` |

The Pages API also returned `https_enforced: false` and `https_certificate: null`. Those fields are not evidence that visitors are HTTP-only: the probes above used working HTTPS at the Cloudflare edge. They do not independently prove the current edge-to-origin TLS settings, origin certificate state, or a complete Cloudflare configuration. The DNS response's authenticated-data flag is a resolver observation, not a fresh Cloudflare settings export.

These are historical observations, not proof that a later release has deployed. Each release requires its own hosted workflow and live-site verification.

## Documented configuration — 2026-08-20 snapshot

The following is the previously documented infrastructure configuration, not a fresh Cloudflare API audit. The 2026-11-03 responses are consistent with this architecture but do not re-confirm every setting.

| Component | Documented setting |
| --- | --- |
| Apex DNS | Proxied CNAME `perfectguild.com` -> `perfectguild.github.io` |
| Canonical-host DNS | Proxied CNAME `www.perfectguild.com` -> `perfectguild.github.io` |
| DNSSEC | Active |
| Zone SSL mode | Full (strict), `ssl=strict` |
| Minimum TLS | `min_tls_version=1.2` |
| HTTP-to-HTTPS behavior | `always_use_https=on` |
| TLS 1.3 | `tls_1_3=off` |
| Encrypted Client Hello | Zone setting `ech=on`, but effective ECH was absent in the documented HTTPS-record/TLS observations |
| Origin port changes | No origin port rewrite documented |

For [proxied DNS records](https://developers.cloudflare.com/dns/proxy-status/), clients resolve Cloudflare edge addresses rather than necessarily seeing the CNAME target directly; proxied CNAMEs are flattened by default. Cloudflare handles the visitor-facing connection, then proxies to the origin. [Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) means encrypted origin traffic with origin certificate validation; this explains the historical configuration, not a newly measured origin connection.

### Apex redirect

The documented enabled Cloudflare dynamic redirect matches `(http.host eq "perfectguild.com")`, returns `301`, and computes its target with:

```text
concat("https://www.perfectguild.com", http.request.uri)
```

Its `preserve_query_string` setting is `false` because [`http.request.uri`](https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/http.request.uri/) already contains both path and query. The target expression therefore preserves both, for example `/docs?x=1&y=2` becomes `https://www.perfectguild.com/docs?x=1&y=2`. The source snapshot recorded that example as tested at the edge; only the root redirect was probed on 2026-11-03. Cloudflare documents [dynamic targets and the separate query-preservation option](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/).

## Operating boundaries

- Treat the branch source, root files, `CNAME`, and Cloudflare configuration as the existing publication contract. Local tooling work does not authorize changing them or pushing changes.
- For diagnosis, inspect the Pages source/build status and workflow history separately from CI results. Read-only HTTPS response headers help distinguish the apex redirect, canonical-host response, and edge versus origin symptoms.
- Re-establish current DNS, redirect, TLS, and certificate facts before any separately authorized infrastructure change. Historical settings are not current-state guarantees or a runbook to apply automatically.
- Keep credential-bearing outputs, account/zone identifiers, and unrelated infrastructure out of public reports. Never put secrets into source control or rely on Jekyll exclusions to protect them.
