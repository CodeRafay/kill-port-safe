# Security

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/CodeRafay/kill-port-safe/security/advisories/new), not in public issues. You'll get a reply within 7 days.

## Supported versions

Only the latest release gets fixes.

## Verifying a release

Every version is built and published by GitHub Actions with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can check which commit it came from:

```sh
npm audit signatures
```

kill-port-safe has no dependencies and no install scripts, and never runs commands through a shell.
