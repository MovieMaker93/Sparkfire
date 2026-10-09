# Security policy

## Reporting a vulnerability

Please report security problems privately, not in public issues: use **Security → Report a
vulnerability** on this repository (GitHub private vulnerability reporting). Include what you found, how to
reproduce it, and what an attacker could do with it. You should get a first reply within a week.

Problems that also affect upstream SparklingKit belong with
[stevibe/SparklingKit](https://github.com/stevibe/SparklingKit) as well.

## Scope and assumptions

SparklingKit assumes a trusted user on a trusted network: it has no built-in authentication and must not
be exposed to the internet without an authenticated proxy or VPN in front of it (see the README). Reports
are most useful for:

- reading or writing files outside the data folder (path traversal);
- running script from uploaded or attached files in the browser;
- leaking endpoint credentials or other settings;
- vulnerable dependencies in the app image or the model-service images.

## How the code is checked

Every pull request and push to `main` runs CodeQL, `npm audit` on production dependencies, dependency
review, a secret scan, Trivy (dependencies and Docker configuration) and hadolint. The scans also run weekly,
and Dependabot opens update pull requests for npm, pip, Docker images and GitHub Actions.
