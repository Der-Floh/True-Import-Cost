# Security Policy

True Import Cost reads build metadata and source code. It is designed so that opening an untrusted repository with it installed is safe.

## What the extension does and does not do

- **No network access.** The extension makes no HTTP requests of any kind: no registry lookups, no update checks, no telemetry, no analytics.
- **Nothing is executed.** It never runs a build, a script, a bundler, a configuration file or any other workspace code. It does not install packages and needs no access to `.npmrc` or authentication tokens.
- **Read-only.** Analysis reads files and writes none. The only writes are the settings change **Import Build Metadata** makes when you ask it to.
- **No native code.** The VSIX contains two JavaScript bundles and no executables.
- **Workspace Trust.** In Restricted Mode the workspace's own `trueImportCost.targets` and `trueImportCost.maxMetadataSizeMB` are ignored, so an untrusted workspace cannot point the extension at files outside it or raise the size limit.

## How metadata is handled

Build metadata is untrusted input:

- Files larger than `trueImportCost.maxMetadataSizeMB` (64 MB by default) are rejected before they are read.
- Contents are parsed as JSON only, read into maps rather than plain objects, and validated against a strict schema with limits on the number of modules, imports, chunks and the length of every string.
- References between modules, imports and outputs are checked for consistency before the module graph is built. Graph traversals visit each module once, so cycles terminate.
- Text taken from metadata, such as package names and paths, is escaped before it appears in a hover. Hover command links are trusted for the extension's own *Explain Why Included* command only.
- A file that fails any of these checks is rejected with a message in the log; the last valid snapshot stays in use.

## The bundler plugins

`@true-import-cost/esbuild` and `@true-import-cost/vite` run inside your build. They have no runtime dependencies, make no network requests, and write only the snapshot file (atomically) and a `.gitignore` in a `.true-import-cost` folder they create.

## Supply chain

- The source is MIT licensed and public; releases are built by public GitHub Actions workflows from tagged commits.
- Dependencies are pinned through `package-lock.json`, updated through Dependabot, and audited with `npm audit`. Install scripts are opt-in through `allowScripts`.
- Each GitHub release carries the VSIX it published, with a build provenance attestation; npm packages are published with provenance through trusted publishing.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/Der-Floh/True-Import-Cost/security/advisories/new) rather than a public issue. Include the version, the steps to reproduce, and if possible a metadata file or source that triggers the problem. You will get an answer within a week.
