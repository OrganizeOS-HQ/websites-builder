# OrganizeOS fork of Webstudio

This is OrganizeOS's fork of [Webstudio](https://github.com/webstudio-is/webstudio), used as the **element-based, Webflow-class site builder** behind OrganizeOS "Websites 2.0". It runs as a separate service, branded as OrganizeOS, against the OrganizeOS Supabase, and member organizations build data-bound public sites with it.

This document is the fork's source of truth for: the **AGPL §13 license posture**, what we changed vs. upstream, and how data-binding + deploy config are wired. Keep OrganizeOS-specific changes minimal and isolated so upstream merges stay tractable.

## 1. License posture (AGPL-3.0 §13) — POSTURE A

Webstudio core is **AGPL-3.0-or-later**. Serving a _modified_ builder to org admins over the network triggers **§13**: those users must be offered the source of our modifications.

**Our posture (A): accept the copyleft and keep this fork public.**

- This fork repository is **public**. It must be public **before any non-employee org admin uses the builder**.
- The builder UI carries a persistent **source-offer link** in its chrome, pointing at the deployed commit of this public fork (added with the branding changes).
- We do **not** treat the builder as "internal only" — that is a false safe-harbor; §13 attaches the moment an external admin uses the modified builder.
- Generated **sites** do not trigger any builder-source obligation. The published-site runtime packages (`@webstudio-is/react-sdk`, `sdk`, `sdk-components-react`, `image`, `wsauth`) are kept **byte-identical to upstream** (CI guard) so §13 only ever covers their already-public source. OrganizeOS-specific generation logic lives in the CLI templates / route templates, whose Corresponding Source is offered from the published site under §13.
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

Provisioning (a later phase) short-circuits `getProjectPlanFeatures` for org-owned workspaces to this `organizeos` plan.

## 4. Deploy environment (see `apps/builder/.env`)

- `DATABASE_URL` / `DIRECT_URL` — OrganizeOS Supabase Postgres.
- `POSTGREST_URL` / `POSTGREST_API_KEY` — OrganizeOS Supabase PostgREST (the builder's data layer).
- `AUTH_SECRET` — builder session secret.
- `PLANS` — the JSON above (enables data-binding + the admin-lockout fix).
- Asset storage (S3/R2-compatible) — `S3_*` / `ASSET_CDN_URL`.
- `NODE_OPTIONS=--conditions=webstudio` — resolves workspace packages to their AGPL source.
- Node 22 (repo `engines`; Node 24 works with a benign warning). pnpm 9.14.4 (via `corepack pnpm`).

OrganizeOS integration (all optional; each feature ships dark until its variable is set):

- `ORGANIZEOS_PROVISION_TOKEN` — shared secret for `POST /internal/provision` (server-to-server).
- `ORGANIZEOS_SSO_PUBLIC_KEY` — ES256 public key (PEM) that verifies OrganizeOS SSO tokens; registers the `organizeos` dashboard strategy.
- `ORGANIZEOS_PUBLISH_REPO` + `ORGANIZEOS_PUBLISH_GITHUB_TOKEN` — Publish dispatches `publish-site.yml` in that repo instead of Webstudio's cloud publisher.
- `ORGANIZEOS_APP_URL` — the OrganizeOS app the builder hands users back to (login page, the builder menu's "Back to OrganizeOS", the org's Website area). Defaults to `https://app.organizeos.org`.
- `PUBLISHER_HOST` — **set this to the platform base domain (`organizeos.org`)**. An org's site is served at `<subdomain>.<PUBLISHER_HOST>`; with the org subdomain mirrored into `Project.domain` (§5) every address the builder shows is the real one. Upstream's default is `wstd.work`.
- `TRPC_SERVER_API_TOKEN` — the builder's service token. The publish executor uses it to sync the build **and** to report the outcome to `POST /internal/publish-status` (§5).

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

Changes confined to: env/config, the proprietary-package removal (this doc §2), auth/SSO + provisioning files (`services/auth-strategy/organizeos*`, `routes/internal.*`, `shared/db/provision.server.ts`, `shared/db/organizeos-*.server.ts`), the publish seam (`services/organizeos-publisher.server.ts`, `shared/db/publish-status.server.ts`, `publish-site.yml`), branding (`shared/branding.ts`, `shared/organizeos-logo.tsx`), the OrganizeOS-only chrome behind `$organizeosSite` (`features/publish/organizeos-publish*.ts*`, small branches in `menu.tsx`, `topbar.tsx`, `publish.tsx`), and the forced CLI route-template patches for the reverse-proxy host/auth/cache. Avoid deep edits to shared component `.tsx`; isolate OrganizeOS code so `upstream main` can be merged with minimal conflict.
