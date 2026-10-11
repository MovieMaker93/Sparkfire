# Application deployment and upgrades

Sparkfire is installed from a clone of this repository. The workspace is one Docker Compose application,
the app and Redis; AI services are configured after the web panel starts and are never bundled into the
application image. On a DGX Spark, `scripts/start-dgx-spark.sh` runs the workspace and the reference model
stack together (see [DGX Spark](dgx-spark.md)).

## Install the workspace

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
./scripts/start-sparkfire.sh --model-host dgx-spark.local   # models on another machine
./scripts/start-sparkfire.sh --configure-later              # or set endpoints in the browser
```

The script builds the app image, starts Redis and the app, and waits until `/api/health` answers. An
existing `data/config/settings.json` is kept as it is. Without the script, `cp .env.example .env`, edit the
endpoints and run `docker compose up -d --build`.

Each release also publishes a multi-platform image (`linux/amd64`, `linux/arm64`) with an SBOM and
provenance, `ghcr.io/moviemaker93/sparkfire:<version>`, for people who keep their own Compose file.

## Network exposure

Port 54321 is published on all host interfaces so phones and other devices on the trusted network can open
`http://SERVER-IP:54321`. Sparkfire has no authentication: put it behind a VPN or an authenticated reverse
proxy and never expose port 54321 to the public internet. Change the host port with `SPARKFIRE_PORT` in
`.env`.

## Upgrade

```bash
git pull
./scripts/start-dgx-spark.sh --accept-model-licenses [the options you installed with]
# or, for the workspace only:
./scripts/start-sparkfire.sh
```

The start scripts rebuild what changed and recreate the containers; `data/` and the Redis volume are left
alone, and saved settings win over environment variables. To stay on a release, check out its tag
(`git checkout v0.1.0`) before running the script.

Persisted schema changes are additive and are not undone by checking out an older tag, so back up `data/`
before a major-version upgrade.

### Coming from SparklingKit

Point an existing checkout at this repository (`git remote set-url origin
https://github.com/MovieMaker93/Sparkfire.git && git pull`) and run the start script again. The compose
project, container and image names keep their `sparklingkit` prefix, so the Redis volume, model downloads
and running containers are reused; `SPARKLINGKIT_*` variables in `.env` still work. Video is opt-in in
Sparkfire: add `--video-backend fasth3` if you used it.

## Backups

`data/` is the durable record: settings, jobs, files, chats and workflows. Redis holds only queue state.

```bash
docker compose --project-name sparklingkit stop app
tar -czf sparkfire-data-backup.tar.gz data
docker compose --project-name sparklingkit start app
```

To restore, stop the app, replace `./data` with the backup, and start the same or a newer Sparkfire version.

## Releases

`.github/workflows/fork-release.yml` runs release-please on `main`. It keeps a release pull request with the
next version and `CHANGELOG.md`; merging it tags the release, publishes the app image and attaches a
`sparkfire-dgx-stack-<version>.tar.gz` bundle with everything `start-dgx-spark.sh` needs, plus its SHA-256
sums.
