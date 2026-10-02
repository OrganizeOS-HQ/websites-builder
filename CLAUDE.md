# websites-builder: Claude Code context

OrganizeOS's fork of Webstudio: the element-based builder behind the OrganizeOS Website product (`builder.organizeos.org`). Load this first every session.

| For                                                                                                         | Load                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| What the fork changes, its AGPL posture, its environment, and the OrganizeOS loop (provision, SSO, publish) | [`docs/ORGANIZEOS-FORK.md`](docs/ORGANIZEOS-FORK.md)                                                            |
| The platform side, and the contract between the two                                                         | `docs/features/website-builder.md` in [`OrganizeOS-HQ/OrganizeOS`](https://github.com/OrganizeOS-HQ/OrganizeOS) |
| Specs and plans for builder work                                                                            | `docs/superpowers/specs/` and `docs/superpowers/plans/` in the OrganizeOS repo                                  |

Work that touches both sides needs both repositories; attach the other one with the `add_repo` tool.

## Planning

- Specs and plans for builder work live in the OrganizeOS repo, beside the platform half they almost always touch.
- **Every spec and plan gets a Fable review before implementation starts:** dispatch the `spec-reviewer` subagent ([`.claude/agents/spec-reviewer.md`](.claude/agents/spec-reviewer.md): Fable, medium effort, read-only). This holds for a plan written in a session here as much as for one written in the OrganizeOS repo, and for the design of any change to auth, SSO, provisioning, publishing or asset serving that has no spec. Apply its findings or record in the spec or plan why not; a finding that contradicts an owner decision goes to the owner. Implementation subagents stay on Opus or Sonnet.

## Keep the overlay small

OrganizeOS changes stay in the files `docs/ORGANIZEOS-FORK.md` section 7 lists, so upstream merges stay tractable, and the published-site runtime packages stay byte-identical to upstream (section 1).
