> Copied unchanged from `client/tests/fixtures/site-components/` in OrganizeOS-HQ/OrganizeOS (commit e924b6de): change both copies together.

# Site component contract fixtures

The request and response bodies of the endpoints the Website builder's
OrganizeOS blocks call, and of the `/v1` reads they bind to. Spec:
`docs/superpowers/specs/2026-10-01-website-builder-platform-components-design.md`
(section 6); plan:
`docs/superpowers/plans/2026-10-02-website-builder-signup-form.md`.

These files are the bytes both repositories build to. The platform's route tests
replay them and `client/tests/lib/public/site/site-components-contract.test.ts`
pins their shapes. The builder fork copies them, unchanged, into
`packages/sdk-components-organizeos/src/__fixtures__/` and tests the blocks
against them. Change both copies in the same change, and remember that a
published site keeps calling the endpoint it was built against: a change here is
additive, or it ships under a new endpoint version.

- `signups/request-*.json`: bodies of `POST /api/public/site/v1/signups`. A
  checkbox field is sent as the string `"true"` when checked and `""` when not,
  as the Website Lite form sends it.
- `signups/response-*.json`: `{ "status", "body" }` for each outcome and error.
- `forms.json`: the body of `GET /v1/forms`.
