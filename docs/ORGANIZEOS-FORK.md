# OrganizeOS fork of Webstudio

This is OrganizeOS's fork of [Webstudio](https://github.com/webstudio-is/webstudio), used as the **element-based, Webflow-class site builder** behind OrganizeOS "Websites 2.0". It runs as a separate service, branded as OrganizeOS, against the OrganizeOS Supabase, and member organizations build data-bound public sites with it.

This document is the fork's source of truth for: the **AGPL §13 license posture**, what we changed vs. upstream, and how data-binding + deploy config are wired. Keep OrganizeOS-specific changes minimal and isolated so upstream merges stay tractable.

## 1. License posture (AGPL-3.0 §13) — POSTURE A

Webstudio core is **AGPL-3.0-or-later**. Serving a _modified_ builder to org admins over the network triggers **§13**: those users must be offered the source of our modifications.

**Our posture (A): accept the copyleft and keep this fork public.**

- This fork repository is **public**. It must be public **before any non-employee org admin uses the builder**.
- The builder UI carries a persistent **source-offer link** in its chrome, pointing at the deployed commit of this public fork (added with the branding changes).
- We do **not** treat the builder as "internal only" — that is a false safe-harbor; §13 attaches the moment an external admin uses the modified builder.
- Generated **sites** do not trigger any builder-source obligation. The published-site runtime packages (`@webstudio-is/react-sdk`, `sdk`, `sdk-components-react`, `sdk-components-react-radix`, `sdk-components-react-router`, `sdk-components-react-remix`, `image`, `wsauth`: every package the CLI templates install) are kept **byte-identical to upstream** so §13 only ever covers their already-public source. OrganizeOS-specific generation logic lives in the CLI templates / route templates, whose Corresponding Source is offered from the published site under §13. Generated sites also carry the fork's own OrganizeOS blocks, `@organizeos/site-components` (§9): the CLI copies that package's build into each site as app source, never as an installed package, so the same source offer covers it (OrganizeOS spec section 4.1). That package and the templates are where OrganizeOS site code goes; the runtime packages above stay byte-identical whatever a site carries.
  - The practical consequence: a generated site installs those packages **from npm, at upstream's published version**, not from this fork. The CLI pins them at build time to `PUBLISHED_RUNTIME_VERSION` (`packages/cli/src/runtime-version.ts`), replacing the monorepo placeholder `0.0.0-webstudio-version` that upstream's publish step would otherwise have stamped. That constant must be the upstream release matching this fork's base commit (the first release after it, latest patch) and **must be bumped in the same change as any upstream merge** — a stale value fails only on the next publish, in Vercel's build log.
  - **CI guard:** `pnpm check:runtime-upstream` (`scripts/check-runtime-upstream.sh`, run in `checks` and in the CI workflow) fails the build if any file in those eight packages differs between `HEAD` and the upstream commit this fork is based on, which `scripts/upstream-base.txt` records. Bump that file to the merged upstream commit in the same change as `PUBLISHED_RUNTIME_VERSION`; a stale base reports upstream's own changes as fork changes. The check needs the base in history, so CI checks out with `fetch-depth: 0` and an upstream merge lands as a merge commit, never squashed.
- If we ever need to keep builder modifications **closed**, the only compliant path is a **commercial/dual license** from Webstudio, Inc. (posture B) — out of scope unless pursued.

## 2. Proprietary code removed (mandatory)

The upstream `@webstudio-is/sdk-components-animation` package is **EULA-proprietary** (not AGPL) and was a hard dependency of the builder, the CLI, and every published-site template. It has been **physically removed** from this fork:

- Dependency stripped from all `package.json` files (builder, CLI, CLI templates, fixtures).
- Imports + registrations removed from `apps/builder/app/canvas/canvas.tsx`, `apps/builder/app/shared/sync/patch/patch-auth.server.ts`, and `packages/cli/src/framework-{react-router,remix,vike-ssg}.ts`.
- The `packages/sdk-components-animation` directory and the `.gitmodules` pointer to the proprietary repo are deleted.

This removes the Webstudio "Animate" components from the palette — acceptable; they are not in OrganizeOS's requirements.

**CI guard:** `pnpm check:no-proprietary` (`scripts/check-no-proprietary.sh`, run in `checks` and in the CI workflow) fails the build if the package name reappears in `apps/`/`packages/` or if the proprietary EULA license banner appears anywhere we ship. Do not bypass it. (A publish-time guard that greps the generated site output is added in the hosting phase.)

## 3. Data-binding — enabled via env, no code patch

OrganizeOS's whole value is **live data-bound elements** (events/donations/contacts via Resources). Webstudio already supports this; it is gated on a plan's `allowDynamicData` / `allowAuth` features (see `packages/plans/src/plan-features.ts`, both default `false`; `apps/builder/.../publish/restricted-features.ts` gates the Resource-variable feature on them).

This is enabled **purely via the `PLANS` env var** (a JSON array of plan configs parsed by `parsePlansEnv`, `process.env.PLANS`) — **no proprietary code, no patch to any shared `.tsx`**. OrganizeOS runs an internal `organizeos` plan:

```jsonc
// PLANS env (JSON, single line in the real env). maxWorkspaces > 1 is REQUIRED:
// org-owned workspaces use a synthetic service-user owner and human admins are
// non-owner members; hasProjectPermit locks out every non-owner member when the
// owner plan has maxWorkspaces <= 1 (a silent total admin lockout).
[
  {
    "name": "organizeos",
    "features": {
      "canDownloadAssets": true,
      "canRestoreBackups": true,
      "allowAdditionalPermissions": true,
      "allowDynamicData": true,
      "allowAuth": true,
      "allowContentMode": true,
      "allowStagingPublish": true,
      "maxContactEmailsPerProject": 1000000,
      "maxDomainsAllowedPerUser": 1000000,
      "maxDailyPublishesPerUser": 1000000,
      "maxWorkspaces": 1000000,
      "maxProjectsAllowedPerUser": 1000000,
      "maxAssetsPerProject": 1000000,
      "seatsIncluded": 1000000,
      "maxSeatsPerWorkspace": 1000000,
    },
  },
]
```

Provisioning gives the org's synthetic owner a real plan row (`syncOrgOwnerPlan`: a `Product` plus a `TransactionLog` satisfying the `UserProduct` view), named after this `organizeos` entry, with `Product.meta` carrying only the per-org entitlement delta. Nothing short-circuits `getProjectPlanFeatures` — the plan resolves through the same path as any other user's, which is the point: every independent derivation of plan state in the builder is fed from one place. The SSO token's `entitlements` claim re-syncs it on every entry, so a wrong value heals at the org's next login rather than needing a re-provision.

## 4. Deploy environment (see `apps/builder/.env`)

- `DATABASE_URL` / `DIRECT_URL` — OrganizeOS Supabase Postgres.
- `POSTGREST_URL` / `POSTGREST_API_KEY` — OrganizeOS Supabase PostgREST (the builder's data layer).
- `AUTH_SECRET` — builder session secret.
- `PLANS` — the JSON above (enables data-binding + the admin-lockout fix).
- Asset storage — `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`. **Required on Vercel**; see "Asset storage" below.
- `NODE_OPTIONS=--conditions=webstudio` — resolves workspace packages to their AGPL source.
- Node 22 (repo `engines`; Node 24 works with a benign warning). pnpm 9.14.4 (via `corepack pnpm`).

OrganizeOS integration (all optional; each feature ships dark until its variable is set):

- `ORGANIZEOS_PROVISION_TOKEN` — shared secret for `POST /internal/provision` (server-to-server).
- `ORGANIZEOS_SSO_PUBLIC_KEY` — ES256 public key (PEM) that verifies OrganizeOS SSO tokens; registers the `organizeos` dashboard strategy.
- `ORGANIZEOS_PUBLISH_REPO` + `ORGANIZEOS_PUBLISH_GITHUB_TOKEN` — Publish dispatches `publish-site.yml` in that repo instead of Webstudio's cloud publisher.
- `ORGANIZEOS_APP_URL` — the OrganizeOS app the builder hands users back to (login page, the builder menu's "Back to OrganizeOS", the org's Website area). Defaults to `https://app.organizeos.org`.
- `PUBLISHER_HOST` — the platform base domain an org's site is served from (`<subdomain>.<PUBLISHER_HOST>`); with the org subdomain mirrored into `Project.domain` (§5) every address the builder shows is the real one. **Defaults to `organizeos.org` in code**, so an unset env is correct rather than dangerous; upstream defaulted it to its own staging domain, which is what made a missing value advertise a Webstudio address. Set it only to point a deployment somewhere else.
- `TRPC_SERVER_API_TOKEN` — the builder's service token. The publish executor uses it to sync the build **and** to report the outcome to `POST /internal/publish-status` (§5).

### Deploying the builder itself

`vercel.json` sets `git.deploymentEnabled` to `true`. Upstream ships it as
`false`, which tells Vercel to skip **every** branch: Webstudio deploys its own
way, so for them the setting is correct and invisible. For this fork it meant
merging to `main` changed nothing — production kept serving whatever commit was
last deployed by hand, and four merged PRs went live nowhere. Keep this `true`
on upstream merges; it is a one-line conflict that silently reverts to "nothing
deploys" if taken from upstream.

This also enables preview deployments for pushes to other branches. To keep
production auto-deploys without previews, the map form is
`{ "main": true, "**": false }` — note `**`, because minimatch's `*` does not
cross the `/` in a branch name like `claude/thing`.

### Asset storage

Without the five `S3_*` variables the builder writes uploads under
`public/cgi/asset` in its own function bundle, which is read-only on Vercel, so
every image, font and video upload fails. That fallback is for local
development only.

Use any S3-compatible bucket, kept **private**:

- Cloudflare R2 (upstream's own choice; OrganizeOS Drive uses it too):
  `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
  `S3_REGION=auto`, and an API token with Object Read & Write on this one
  bucket only.
- Supabase Storage in the OrganizeOS production project: the bucket has to
  arrive as a migration in the OrganizeOS repo (its `CLAUDE.md` forbids
  dashboard or MCP schema changes to production; every bucket there came in
  that way). Supabase S3 keys reach every bucket in the project. The builder
  already holds that project's service-role key, so they add nothing it lacks.
- `S3_ENDPOINT` may carry a path. Supabase Storage's S3 endpoint is
  `https://<project-ref>.supabase.co/storage/v1/s3`; upstream resolved
  `/<bucket>/<key>` against the endpoint, which dropped that path.
- Leave `S3_ACL` unset. Nothing reads the bucket anonymously, and some providers
  do not support ACLs. (`apps/builder/.env` still shows
  `public-read` from upstream.)
- Leave `RESIZE_ORIGIN` unset unless an image-resizing service is in front. The
  builder then serves originals.
- `MAX_UPLOAD_SIZE` defaults to 4.5 (MB), which is Vercel's limit on a
  function's request body. Raising it on Vercel does not raise that limit.

Upstream reads files back through an edge proxy that answers `/cgi/image`,
`/cgi/asset` and `/cgi/video` before the builder sees them. This fork has no
such proxy, so those routes fetch the object with a signed GET
(`packages/asset-uploader/src/clients/s3/read.ts`, `AssetClient.readFile`) and
stream it back, passing range requests through so video can seek. The publish
CLI downloads every asset through the same routes. Without the read path a
site with an uploaded image cannot publish either.

`packages/asset-uploader` is not in the byte-identical set (§1). The fork
changes it in three ways: the endpoint's path is kept, `host` is signed as the
AWS SDKs do, and the S3 client can read files back.

**These routes answer on the builder's own origin.** Each response they build
(everything but the `RESIZE_ORIGIN` pass-through) carries
`Content-Security-Policy: sandbox` (PDFs excepted) and
`X-Content-Type-Options: nosniff`, so an uploaded `.html` or `.svg` cannot
run script with an admin's session. The branch for absolute URLs (the canvas
loads an Image or Video whose `src` is a URL through these routes) fetches only
http(s) and returns content headers only
(`apps/builder/app/shared/asset-response.server.ts`). Upstream returns
`fetch(name)` verbatim, since its proxy answers first. Here that served any
remote page, `Set-Cookie` included, as a page of the builder. Keep the helper
on upstream merges. `shared/cgi-routes.server.test.ts` fails if a route goes
back to returning the remote response.

## 5. The OrganizeOS loop: SSO → build → Publish → back

How an org admin's session is wired end to end, and which side owns each step. The OrganizeOS repo is `OrganizeOS-HQ/OrganizeOS` (`client/lib/websites2/*`, `client/lib/actions/websites/*`, `client/app/api/websites2/*`, `client/app/api/internal/websites2/*`).

1. **Provision** (OrganizeOS → builder, `POST /internal/provision`, `ORGANIZEOS_PROVISION_TOKEN`). Creates the org's synthetic owner, workspace, project, plan (from `entitlements`) and data presets. The body also carries the org's platform `subdomain`; it becomes `Project.domain` (`shared/db/organizeos-site.server.ts`). Idempotent, so it doubles as a re-sync: a re-provision restores a workspace and project that an offboard soft-deleted, follows an org rename, seats the admins in `adminEmails` and retires every other active member (an empty list retires nobody, so a failed admin lookup on the OrganizeOS side can never evict everyone). Without `readToken`/`apiBaseUrl` the presets are left untouched, which is what a membership re-sync wants.
2. **Enter** (OrganizeOS → browser → builder, `POST /auth/organizeos`). OrganizeOS mints a 60s single-use ES256 token for an active admin and auto-POSTs it; the builder verifies it, seats that admin in the org's workspace (the signed token is the authority: OrganizeOS only signs for a currently active owner/admin, so an admin added after provisioning gets in on their first entry), refreshes the org's plan from the `entitlements` claim and its project domain from the `subdomain` claim (a rename converges on the next entry), and lands the admin directly in the org's project (`resolveSsoLandingUrl`). Nothing about the fork dashboard is part of the flow.
3. **Build.** The builder loader recognises an org project by its owner (`User.provider = organizeos-service`) and passes an `organizeosSite` (`siteUrl`, `manageUrl`, `platformUrl`) to the client. For such a project the chrome is OrganizeOS-shaped: the menu's first item is "Back to OrganizeOS" (the org's Website area) instead of Dashboard; Share, Export and Clone are not offered (membership, publishing and the single project all live in OrganizeOS).

   **The fork dashboard is not a surface OrganizeOS uses.** SSO deep-links past it, but it was still reachable by URL, by a stale `returnTo` cookie, or by signing in again — and it is upstream's personal-account surface, so it opens on the admin's empty personal workspace and lists the org's own site under "Shared with me". Worse, it offers actions that break the derived identity provisioning depends on: New project and Duplicate create projects OrganizeOS cannot see or publish, Transfer moves the org's site out of the service-owned workspace, and Leave drops the admin's own access.

   Two defences, both in this fork. `resolveOrganizeosDashboardExit` (`shared/db/organizeos-site.server.ts`) redirects an org admin from the dashboard to their org's Website area, identifying them from data — a non-owner member of a service-owned workspace who owns no projects of their own. A user who does own projects here keeps the dashboard, because it is the only way to reach them; `DEV_LOGIN=true` is exempt, because local development seeds real orgs with real admin emails; the check fails open, and never redirects to the builder's own origin. And provisioning re-asserts the org project's owner and workspace on every re-sync, so a transfer that did happen is healed on the next entry rather than orphaning the site.

   The AGPL §13 source offer is rendered in the builder menu as well as the dashboard footer, so it stays reachable for an admin who never sees the dashboard. Do not remove the menu copy.

4. **Publish** (`features/publish/organizeos-publish.tsx`). The dialog shows the site's real address with copy/open, points at OrganizeOS for domains and settings, and has one Publish button. `domain.publish` creates the production build and the OrganizeOS publisher (`services/organizeos-publisher.server.ts`) dispatches `publish-site.yml` with the build and organization ids. A dispatch that never leaves the builder marks the build FAILED at once; a static-export build is refused (it must never be deployed as the live site).
5. **Execute** (`.github/workflows/publish-site.yml`). Syncs the build with the CLI, builds it, deploys to the `organizeos-sites` Vercel project, POSTs the deployment URL to OrganizeOS's publish callback (which flips the org's ledger pointer, making the site live through the reverse proxy), then reports `PUBLISHED` to the builder's `POST /internal/publish-status`; any failure reports `FAILED`. Without that report the builder's status would read "pending" forever: upstream's cloud publisher used to flip `Build.publishStatus` directly.
6. **Status.** The dialog polls the project while a build is pending and treats a build as failed only after the executor's 25 minute timeout (`organizeos-publish-status.ts`; upstream assumes 3 minutes). On success it says the site is live and that the proxy can take up to a minute to pick the new deployment up (its target cache).

Backward compatibility: every new claim and body field (`subdomain`, the status report) is optional on the builder side, so either repo can deploy first. A project provisioned before OrganizeOS sent a subdomain keeps its `org-<id>` placeholder domain (the dialog then omits the site URL) until the next SSO entry or re-provision.

Working on the integration needs both repositories. In a Claude Code session, attach the second repo with the `add_repo` tool (the session's GitHub scope then covers both); the builder-side change comes first, the OrganizeOS-side change second, and neither breaks the other in between.

## 6. Browser support

No blocking browser gate. Upstream interrupted Firefox and Safari with a full-screen "supports Chromium-based browsers... we plan to support Firefox and Safari" overlay. It is removed: it is an upstream roadmap OrganizeOS has not made, and it is not true of this code — every Chromium-only API in the builder is feature-detected with a working fallback, and the repo carries deliberate Firefox and Safari support work. The one real gap it was covering (CSS Typed OM is Chromium-only, so the style panel converted a keyword value to a unit using `0`) is fixed at the point of failure in `canvas/selected-instance-effects.ts`. There is still no automated Firefox or Safari coverage — the Playwright harness launches Chromium only.

## 7. OrganizeOS overlay (keep minimal for upstream merges)

Changes confined to: env/config, the proprietary-package removal (this doc §2), auth/SSO + provisioning files (`services/auth-strategy/organizeos*`, `routes/internal.*`, `shared/db/provision.server.ts`, `shared/db/organizeos-*.server.ts`, and the data presets `shared/db/resource-presets.server.ts` and `shared/db/signup-form-preset.server.tsx`, whose ids `shared/organizeos-preset-ids.ts` derives for the server and the browser alike), the publish seam (`services/organizeos-publisher.server.ts`, `shared/db/publish-status.server.ts`, `publish-site.yml`), asset serving (`shared/asset-response.server.ts`, the three `routes/cgi.*` loaders, `asset-uploader`'s S3 client), branding (`shared/branding.ts`, `shared/organizeos-logo.tsx`), the OrganizeOS-only chrome behind `$organizeosSite` (`features/publish/organizeos-publish*.ts*`, small branches in `menu.tsx`, `topbar.tsx`, `publish.tsx`), the OrganizeOS blocks (§9: the `packages/sdk-components-organizeos` package, `@organizeos/site-components`, a `workspace:*` dependency in `apps/builder/package.json` and `packages/cli/package.json`, and so in `pnpm-lock.yaml`, registered by one `registerComponentLibrary` call in `canvas/canvas.tsx`; their panel, `features/organizeos-panel/*`, with its tab in `sidebar-left/sidebar-left.tsx` and `sidebar-left/types.ts` and one branch in the canvas's drop handler, `canvas/shared/use-drag-drop.ts`, so a dropped block is bound to the project's data like a clicked one; their record picker, `settings-panel/controls/organizeos-record.tsx`, behind one branch in `settings-panel/controls/combined.tsx`; and the CLI's copy of their build into every published site, `packages/cli/src/organizeos-components.ts`, called from short hooks in `prebuild.ts` and `framework-react-router.ts`, with cases in `prebuild.test.ts`), the guards' wiring (the `check:*` scripts and `checks` in the root `package.json`, and `.github/workflows/main.yml`, both of which also build the blocks' package before the tests), and the forced CLI route-template patches for the reverse-proxy host/auth/cache. Avoid deep edits to shared component `.tsx`; isolate OrganizeOS code so `upstream main` can be merged with minimal conflict.

## 8. Published-site route template patches

`packages/cli/templates/react-router/app/route-templates/html.tsx` is a forced
patch (see §5): it is the published site's entry, so the reverse-proxy host,
auth and cache behaviour have to be right there rather than in a package we
keep byte-identical.

**Page authentication runs on every host.** Upstream skipped
`authenticateRequest` whenever the request host equalled `projectDomain` or was
a subdomain of it, because `projectDomain` was the Webstudio staging label and
staging carried its own separate credentials. In this fork `Project.domain` is
the org's platform subdomain (§5), so `acme` matched `acme.organizeos.org` —
the site's primary public host — and a page the org had password-protected was
readable by anyone there, while the same page stayed protected on a custom
domain. There is no staging host here, so the skip protected nothing and was
removed. Unprotected sites are unaffected: `authenticateRequest` returns early
when no auth route matches the path.

Do not reinstate a host-based skip when merging upstream.

**Published images are served as originals.** The `imageLoader` in
`packages/cli/templates/react-router-vercel/app/constants.mjs` (and its copy in
`fixtures/react-router-vercel`) returns `src` unchanged. Upstream builds
`/_vercel/image?url=&w=&q=` URLs, which the sites deployment's own optimizer
would answer. Here a site is served on the org's host through the OrganizeOS
proxy, and Vercel answers `/_vercel/image` on that host with the OrganizeOS
app's optimizer instead. Its allowed widths and qualities are not the
builder's, and it cannot fetch this deployment's `/assets/*`, so every
optimized URL failed with `INVALID_IMAGE_OPTIMIZE_REQUEST`. Real image
optimization is a later item to design with the OrganizeOS side. Keep the
patch on upstream merges.

## 9. OrganizeOS components

Blocks for OrganizeOS's platform features: a block is a root and parts that a
designer places and styles like any element, while what it does (validation,
opt-in, tags) stays on the platform, in services Website Lite shares. Phase 1
ships the Signup Form. Design and plan are in the OrganizeOS repo
(`docs/superpowers/specs/2026-10-01-website-builder-platform-components-design.md`,
`docs/superpowers/plans/2026-10-02-website-builder-signup-form.md`); its
`docs/features/website-builder-components.md` covers both halves.

**The package**, `packages/sdk-components-organizeos`, npm name
`@organizeos/site-components`:

- `private`, never published to npm, AGPL-3.0-or-later like the rest of the
  fork (its own `LICENSE`). Shaped like `sdk-components-react-radix`:
  components, metas, templates and an empty hooks list, the `webstudio` export
  condition to `src/`, `lib/` otherwise, built with
  `vite.sdk-components.config.ts`.
- **Signup Form** is the root: it renders the `<form>`, finds its form by its
  `record` prop in its `data` prop (with no `record`, the org defaults: email
  required; first name, last name and phone optional), and on a published page
  posts what its parts collect. Its parts are **Submit Button** and **Field**,
  which names a form field and wires its **Field Label**, **Field Input** and
  **Field Message** together. `src/form/` holds what later families share: part
  registration, the submit helper, the canvas check.
- Every meta is `category: "hidden"`, so the Components panel never lists the
  blocks. The **Signup Form template** binds the root's `state` to a
  `formState` variable, shows its state boxes with `ws:show`, styles the parts
  through the tokens "OS Field", "OS Input", "OS Button" and "OS Message", and
  leaves `data` unbound for the panel.
- The canvas and the preview never post. On the canvas a root draws a warning
  on itself for a missing part (an email Field, a Submit Button, a Field for a
  required form field), a Field naming a field its form lacks, a form inside
  another form, and a picked form that is unavailable.
- **Registered** by one `registerComponentLibrary` call in `canvas/canvas.tsx`
  under the namespace `@organizeos/site-components`, so the components are
  `@organizeos/site-components:SignupForm` and so on. Every build that uses a
  block records that name in `Instance.component`: the namespace can never
  change.

**The panel**, `apps/builder/app/builder/features/organizeos-panel/`:

- A left-sidebar tab after Components, with the OrganizeOS mark, hidden in
  content mode and disabled on text pages, as Components is. It lists the
  namespace's templates in sections (Phase 1: Signups) with the Components
  panel's cards and drag.
- Signups ends with a link to the org's Embeds hub,
  `<platform URL>/<subdomain>/pages/embeds`, where the org makes its forms (the
  Website area's URL while the builder does not know the subdomain; the
  platform home for a project no org owns). The builder depends on that
  platform route; the OrganizeOS side lists it under "Contract with the fork".
- **Insert completion**, `insert-organizeos-block.ts`. A clicked block and a
  dropped one both go through it: the canvas's drop handler
  (`canvas/shared/use-drag-drop.ts`) has one marked branch for the namespace.

  1. Find the Events preset by its deterministic id, never by name. If it is
     missing or has no non-blank `Authorization` header, refuse with a toast
     ("this site's link to your organization's data was removed or changed.
     Contact OrganizeOS support to restore it.") and write nothing. The same
     refusal applies when Forms must be created and the Events URL is not the
     `"<API base>/events"` literal provisioning writes.
  2. Find or create the Forms preset by the ids provisioning gives it, in
     provisioning's shape: a Resource and a resource DataSource named
     "OrganizeOS Forms", the DataSource scoped at `:root`, the Events URL with
     `/forms` for `/events`, and the Events `Authorization` header. A Forms
     binding found with no scope gets `:root`; nothing else about an existing
     preset is rewritten.
  3. Bind the root's `data` by id to the preset's `.data`, the `{ data: [...] }`
     body of `GET /v1/forms`, so no variable that shares a name with the preset
     captures it at insert (copies are another matter: see the known limits).
  4. Insert with `insertWebstudioFragmentAt`.

  Step 2 and the insert are separate transactions, so when step 2 adds the
  preset they are two undo steps: one undo removes the block and keeps the
  preset, which a later re-provision rewrites in place. The preset also stays
  when its blocks are deleted, and a site that has it pays for it on every
  page view (see the rollout gate below). The target is resolved first, so a
  block with no place to go adds no preset.

- **Preset ids**: `apps/builder/app/shared/organizeos-preset-ids.ts`, one
  WebCrypto `uuidV5` that the server and the browser share, pinned by tests to
  the ids the replaced `node:crypto` code produced. Provisioning and the panel
  derive the same ids, so a re-provision rewrites the panel's preset instead of
  adding a second.
- **Forms in provisioning** (`shared/db/resource-presets.server.ts`): Events,
  Fundraisers and Stats are seeded on every provision, unscoped; Forms only
  when present. A provision rewrites both Forms records whole (scope, URL and
  token) in a build that has its binding or its resource, and never adds it to
  one that has neither: the panel creates it on the first Signup Form insert,
  because a `:root` resource costs every page view a call. That mode is
  temporary for Forms if the spec's starter signup page (decision 8) is
  adopted.

**The record picker**, `settings-panel/controls/organizeos-record.tsx`, behind
one marked branch in `settings-panel/controls/combined.tsx`, before the text
control. The Signup Form's `record` is a select:

- "None (org defaults)" first (an empty `record`), then the forms the block
  takes, as "name (Newsletter)" or "name (Contact)": newsletter
  (`contact-signup`) and contact (`contact-form`) forms, never membership
  forms.
- It reads the selected root's computed `data`, which the builder's resources
  loader already fetches for a `:root` preset, and makes no request of its own.
- A value it cannot find stays listed as "Unavailable form". With no forms data
  (loading, unbound, or the loader's error body) a hint says to reload the
  builder, then to contact support.
- It keeps the upstream select's binding support. A `record` prop on any other
  component keeps the text control.

**Shipping in published sites**, `packages/cli/src/organizeos-components.ts`:

- A site never installs the package. Prebuild clears `app/__organizeos__/`
  with `app/__generated__/` and `app/routes/`, then copies the built
  `components.js` and every module it reaches through relative imports (static,
  re-exported and literal dynamic, parsed with acorn) into
  `app/__organizeos__/`. That closure never reaches `metas.js` or
  `templates.js`.
- The react-router framework maps each component of the namespace to
  `../__organizeos__/components.js:<Name>`, a path from `app/__generated__/`,
  where page modules are written, and adds the metas. Remix and vike-ssg are
  not mapped: the publish workflow builds with the react-router templates, and
  the publisher refuses static exports.
- The copy may import only packages the react-router site template already
  depends on (today `react`, `react/jsx-runtime` and
  `@webstudio-is/react-sdk/runtime`), which resolve to the site's own pinned
  copies; `organizeos-components.test.ts` fails on any other.
- The CLI finds the build through
  `import.meta.resolve("@organizeos/site-components/components")`, and a
  missing build fails prebuild with the command that makes it. CI and
  `pnpm checks` build the package before the tests; the publish workflow
  builds every package before it runs the CLI.
- A published site freezes the component code: a fix reaches an org's
  visitors when the org republishes.
- CI note: `packages/cli/src/asset-files.test.ts` ("removes temporary files
  when asset download fails") is an upstream test that fails about one run in
  five, from a race between its temp-file cleanup and the write stream
  opening. It predates this package and is left to upstream; rerun the job.

**The platform contract the blocks rely on:**

- `POST /api/public/site/v1/signups`, same origin from the published page
  (every org host reserves `/api` for OrganizeOS): JSON only, no CORS, the org
  taken from the request's host, never the body. The body is
  `{ form_id?, fields, page_path, website }` (`website` is the honeypot); the
  answer is `{ outcome }` (`subscribed`, `confirm_email` or `received`) or
  `{ error, field? }`. The block maps an outcome it does not know to Success
  and any error to Error, so a frozen build survives new answers.
- `GET /v1/forms`, through the Forms preset, server-side with the project's
  read token.
- The Embeds hub route the panel links to.
- Both sides build to the contract fixtures in OrganizeOS's
  `client/tests/fixtures/site-components/`, which the package copies into
  `src/__fixtures__/` for its tests. To keep them in step, change the
  OrganizeOS copy first, copy the files over unchanged, update the source
  commit in the note at the top of the copy's `README.md`, and check that
  `diff -r` between the two folders shows that note alone. A change is
  additive or ships under a new endpoint version: a published site keeps
  calling what it was built against.

**Deploy order** for this feature: OrganizeOS first, then the builder. That
reverses the usual order (§5, and the OrganizeOS contract table: the builder
first, so a new optional field is accepted before it is sent). Here the
platform half adds new endpoints that nothing calls until the builder half
ships, while a block inserted before they exist can neither load its forms nor
submit.

**Known limits** (OrganizeOS spec, section 12, items 15 to 18, with the
options):

- **Rollout gate.** The Forms preset is `:root`, so every page view of a site
  that has it makes one uncached `GET /v1/forms` call. The "/v1 edge cache"
  that `html.tsx`'s `no-store` relies on does not exist: Vercel's CDN never
  caches a request with an `Authorization` header. The ceiling is the
  platform's `public_read` limit, 120 a minute per org and site egress IP, and
  on a 429 a block with a form picked shows Unavailable. The block is not
  offered beyond the pilot org until the `/v1` cache or a token-keyed loader
  limit lands.
- The data presets never loaded before Forms was scoped: provisioning wrote
  them unscoped, and the builder and the CLI load only a page's or `:root`
  data sources. Events, Fundraisers and Stats are still unscoped, pending an
  owner decision.
- Copies rebind by name. Upstream re-resolves expressions by variable name when
  a block is duplicated, copied, pasted or moved, and when an admin saves a
  variable in an enclosing scope (`rebindTreeVariablesMutable`), so a variable
  named exactly "OrganizeOS Forms" in a block's scope can take over its `data`.
  Insert binds by id; the re-resolution is upstream behavior, left alone.
- No self-serve "Reconnect data": once the builder is enabled, nothing re-seeds
  a project's presets, so a refused insert needs support to re-provision.
