# Contributing to Sparkfire

Thanks for helping. Sparkfire is a local AI workspace for one NVIDIA DGX Spark: a Node.js app (Express API,
React client, BullMQ worker on Redis) in front of a fixed stack of model services. Bug reports, fixes, tests,
documentation and features are all welcome.

This file is the short version for people. [AGENTS.md](AGENTS.md) is the full map of the code, the rules and
how the system works; read it before a larger change.

## Before you start

- **Security problems** go through private vulnerability reporting, not public issues: see
  [SECURITY.md](SECURITY.md).
- **Bugs:** open an issue with what you did, what you expected, what happened, and the job, chat or log
  lines that show it. Leave out personal files, host names and addresses.
- **Larger changes:** open an issue first, so we agree on the approach before you spend time on it.
- **The models are fixed.** Sparkfire runs one model per service, chosen and measured to share the
  Spark's 121 GiB (Saluki 27B, PaddleOCR-VL-1.6, Parakeet, Hy-MT2, Qwen-Image-2.1-Turbo, FastH3, YuE2,
  with SearXNG). Pull requests that let users pick models, endpoints or keys will not be merged. Proposing
  a different model is welcome, with its memory measured next to the rest of the stack on a Spark
  (see [docs/validation.md](docs/validation.md)).

## Set up

You need Node.js 22 or newer, npm, Docker (for Redis), `ffmpeg` and `poppler-utils`.

```bash
npm install
docker run -d --name sk-redis -p 6379:6379 redis:8-alpine   # once
node scripts/seed-dev-data.mjs                              # optional sample jobs, media and a chat
SPARKFIRE_DEPLOYMENT_MODE=split OCR_BASE_URL=http://127.0.0.1:8332/v1 npm run dev
```

The API runs on port 54321 and the Vite client on 5173 with hot reload. Without a Spark, the two variables
point the app at a stack that is not there, so it skips setup and shows the services as offline; the UI
and everything that does not call a model still work. Add `WORKER_ENABLED=false` to keep seeded jobs as
they are while you work on the UI.

To run the real stack, use a DGX Spark and `./scripts/start-dgx-spark.sh --accept-model-licenses`
([docs/dgx-spark.md](docs/dgx-spark.md)).

## Check your change

These are the checks CI runs; run them before you push.

```bash
npm run typecheck
npm test                                   # or: npx vitest run path/to/file.test.ts
npm run build
shellcheck --severity=error scripts/*.sh   # when you touched a script
```

The Python services have unit tests that need no GPU or model weights. Run them for any service you changed
(`services/dgx-models/*`, `services/dgx-status`, `scripts/media`):

```bash
python3 -m venv .venv && .venv/bin/pip install fastapi uvicorn python-multipart httpx
cd services/dgx-models/video && ../../../.venv/bin/python -m unittest
```

Pull requests also run CodeQL, `npm audit`, dependency review, a secret scan, Trivy and hadolint. When a
check fails, fix the cause rather than loosening the check.

## Make the change

The rules that matter most, with the details in [AGENTS.md](AGENTS.md#coding-conventions):

- **TypeScript is strict.** Server imports use the `.js` suffix; client imports do not. Shared types go in
  `src/shared/contracts.ts`, and which module accepts which artifact is decided only in
  `src/shared/module-router.ts`.
- **Validate at the edge.** Parse every request body and query with zod in `src/server/index.ts`.
- **Files are the storage.** Write through the store helpers, build paths only with the safe path helpers,
  change a job only through `updateJob`, keep artifact lineage, and keep schema changes additive: never
  rewrite a user's folders silently.
- **Tests sit next to the code** (`*.test.ts`, vitest; `unittest` for Python). New behaviour needs a test.
- **Styles** use the `--sk-*` colour and `--sk-radius-*` tokens and the existing component classes. Check
  every UI change in the dark and light themes at 1440 and 375 px wide, with no horizontal scroll.
- **Comments say why**, and the code matches what is around it. Line endings are LF.
- **Pin everything:** model downloads at exact Hugging Face revisions, container images at exact tags or
  digests, third-party GitHub Actions at commit SHAs.
- **Never commit** `data/`, `.env` files, credentials, model weights or personal details such as email
  addresses, host names or home paths. Machine-specific notes go in a `*.local.md` file, which git ignores.

Update the docs with the change: [docs/fork.md](docs/fork.md) for what Sparkfire changes, the
[README](README.md) for anything a user installs or sees, and [docs/validation.md](docs/validation.md) for
measured results. When a change alters what the README clips show, `scripts/media/` records them again
(see its README).

### Working on a shared Spark

The Spark is often shared. Before starting or stopping anything there, check what runs (`docker ps`,
`free -g`, `nvidia-smi`), leave other people's containers alone, and ask before stopping a service you
did not start. Do not start extra models, large builds or big downloads while the stack is loading.

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`, in
the imperative and lower case, with a body that explains why. One logical change per commit.

- **Types:** `feat`, `fix`, `perf`, `security`, `deps`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`,
  `revert`.
- **Scopes** are optional, for example `chat`, `ocr`, `image`, `dgx`, `ui`.
- **A breaking change** adds `!` after the type and a `BREAKING CHANGE:` footer.

Pull requests are squash-merged, so **the PR title becomes the commit on `main`**; a check makes sure it is
a Conventional Commit. In the description, say what changed, why, and how you tested it, and list anything
not yet verified, such as a change that still has to run on a Spark.

Do not bump the version or edit `CHANGELOG.md`: release-please keeps both from the commit history and tags
each release.

### Before you ask for review

- [ ] `npm run typecheck`, `npm test` and `npm run build` pass, and the Python tests of any service you
      touched.
- [ ] New behaviour has tests; UI changes were checked in both themes at both widths.
- [ ] Docs are updated: `docs/fork.md`, the README, `docs/validation.md` as needed.
- [ ] No personal or machine-specific details in tracked files.
- [ ] The PR title and commits follow Conventional Commits and say why.

## License

Sparkfire is licensed under the [Apache License 2.0](LICENSE). Unless you say otherwise, what you contribute
is licensed under the same terms (section 5 of the license). Sparkfire is a derivative of
[SparklingKit](https://github.com/stevibe/SparklingKit) by Steven Lei; keep its [NOTICE](NOTICE) and the
credit lines in the README.
