# Application deployment and upgrades

Sparkfire is installed from a clone of this repository. The workspace is one Docker Compose application,
the app and Redis; the AI services are the model stack's own containers and are never bundled into the
application image. On a DGX Spark, `scripts/start-dgx-spark.sh` runs the workspace and the reference model
stack together (see [DGX Spark](dgx-spark.md)).

## Install the workspace

```bash
git clone https://github.com/MovieMaker93/Sparkfire.git
cd Sparkfire
./scripts/start-sparkfire.sh --model-host dgx-spark.local   # models on another machine
./scripts/start-sparkfire.sh --configure-later              # or say where the stack runs in the browser
```

The script builds the app image, starts Redis and the app, and waits until `/api/health` answers. The
services always run Sparkfire's fixed models: every start points them at the stack, wherever it runs, and
keeps the rest of `data/config/settings.json`. Without the script, `cp .env.example .env`, set the stack's
addresses or leave them empty for setup in the browser, and run `docker compose up -d --build`; for chat web
search, set `SEARXNG_SECRET` in `.env` to a long random string (`openssl rand -hex 32`) and add
`-f compose.yaml -f compose.search.yaml`. The start scripts run Compose as the project `sparkfire`, and a plain
`docker compose up` takes its project name from the folder, which matches for a clone named `Sparkfire`. In a
folder with another name, add `--project-name sparkfire`; otherwise the two would each get their own Redis
volume and clash on port 54321.

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
./scripts/start-dgx-spark.sh --accept-model-licenses [--video-backend none if you installed with it]
# or, for the workspace only:
./scripts/start-sparkfire.sh --model-host <spark-host>   # or --configure-later, as you installed it
```

The start scripts rebuild what changed and recreate the containers; `data/` and the Redis volume are left
alone. The services follow the stack on every start; the other saved settings are kept. To stay on a release, check out its tag
(`git checkout v0.1.0`) before running the script.

Persisted schema changes are additive and are not undone by checking out an older tag, so back up `data/`
before a major-version upgrade.

### Installs from before the rename

Point an existing checkout at this repository (`git remote set-url origin
https://github.com/MovieMaker93/Sparkfire.git && git pull`) and run the start script again. The compose
project, containers and images are now named `sparkfire`: the script removes the containers of the earlier
project, so they cannot keep running beside the new ones, and reuses the downloaded models. The earlier
Redis volume held only the job queue; the app queues unfinished jobs again from `data/`. Only `SPARKFIRE_*`
variables in `.env` are read.

## Backups

`data/` is the durable record: settings, jobs, files, chats and workflows. Redis holds only queue state.

```bash
docker compose --project-name sparkfire stop app
tar -czf sparkfire-data-backup.tar.gz data
docker compose --project-name sparkfire start app
```

To restore, stop the app, replace `./data` with the backup, and start the same or a newer Sparkfire version.

## Releases

`.github/workflows/fork-release.yml` runs release-please on `main`. It keeps a release pull request with the
next version and `CHANGELOG.md`; merging it tags the release, publishes the app image and attaches a
`sparkfire-dgx-stack-<version>.tar.gz` bundle with everything `start-dgx-spark.sh` needs, plus its SHA-256
sums.
