## T-2026-10-21-release-image — Publish the image to GHCR on a release tag

- Created: 2026-10-21
- Owner: claude
- Status: in-progress
- Blockers: —
- Spec: maintainer request, 2026-10-21 — the NAS pulls a public
  `ghcr.io/kkucherenkov/todoer` image instead of building from a checkout
  (tuxedo 417)
- Plan: none; the steps below are the whole change

### Goal

The NAS has no git and no buildx, so building the image from a checkout
there means copying the source over by hand for every update. CI already
builds the image and proves it, but throws it away. A release tag should
publish the proven image, so the NAS stack only names a version and pulls.

### Scenarios

1. **Given** a commit on `main`, **When** the tag `v0.1.0` is pushed,
   **Then** `ghcr.io/kkucherenkov/todoer` gains `0.1.0`, `0.1`, `0` and
   `latest`, all one image.
2. **Given** an image whose walking skeleton fails, **When** the tag is
   pushed, **Then** nothing is pushed.
3. **Given** a manual run of the workflow, **When** it finishes, **Then**
   the image was built and proved and nothing was pushed.

### Requirements

- **FR-001** A `vMAJOR.MINOR.PATCH` tag MUST publish the image under four
  tags: `X.Y.Z`, `X.Y`, `X`, `latest`, with `APP_VERSION` set to `X.Y.Z`.
- **FR-002** The image MUST pass the same proofs as the `Image` job (walking
  skeleton, SPA under the CSP) before anything is pushed.
- **FR-003** `workflow_dispatch` MUST run every step except login and push.
- **FR-004** The image MUST carry `org.opencontainers.image.source` so GHCR
  links the package to the repository.

### Edge cases

- A tag that is not `vX.Y.Z` (e.g. `v1.0`) → the workflow fails before
  building (FR-001)

### Definition of Done

- **SC-001** After the first tag, `docker pull ghcr.io/kkucherenkov/todoer:<version>`
  works without logging in, once the maintainer has made the package public.
- [ ] every FR has a test that failed before the code made it pass —
      not applicable: a workflow; proved by a `workflow_dispatch` run and the
      first tag
- [ ] gates: `PR title (conventional commit)`, `Shell tests`,
      `Workspace tests`, `Lint`
- [ ] no document still asserts the behaviour this task replaced
- [ ] dnote changelog line

### Steps

- [x] T001 [FR-001, FR-004] The compose `app` service names its image;
  the Dockerfile labels its source — `docker/compose.yml`, `Dockerfile`
- [x] T002 [FR-001, FR-002, FR-003] Release workflow —
  `.github/workflows/release.yml`
- [x] T003 README: running a released image on the NAS — `README.md`
- **Checkpoint:** a `workflow_dispatch` run on `main` is green.
