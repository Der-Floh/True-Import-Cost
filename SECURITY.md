# Security Policy

True Import Cost reads build metadata and source code. It is designed so that opening an untrusted repository with it installed is safe: it runs nothing from a workspace unless you ask it to measure, and never in Restricted Mode.

## What the extension does and does not do

- **No network access.** The extension makes no HTTP requests of any kind: no registry lookups, no update checks, no telemetry, no analytics.
- **Nothing is executed unless you ask.** Showing costs — hints, hovers, diagnostics, views and the dashboard — never runs a build, a script, a bundler, a configuration file or any other workspace code. It does not install packages and needs no access to `.npmrc` or authentication tokens.
- **Measuring runs code, on request.** Two commands run workspace code when you invoke them: **Measure Import by Building Without It** runs a build command twice, and **Measure Standalone Size of the Imported Package** loads esbuild or Rolldown from the project's `node_modules` in a process of its own. Both:
    - work only in a trusted workspace;
    - show the exact command and folder and ask before they run, once or for the workspace; a changed command asks again, and **Forget Measured Import Costs** withdraws every permission;
    - are stopped after `trueImportCost.measure.timeoutSeconds`, or when you cancel, together with the processes they started.
- **What a measured build can do.** The build command runs with your permissions, exactly as when you build yourself: its configuration, its plugins and anything else the command does still run. The True Import Cost plugin turns off writing the build output, applies its edit to the source in memory only, and writes its reports to a temporary folder in VS Code's storage, which is deleted afterwards. Use `trueImportCost.measure.command` to run the bundler alone if your build script does more.
- **Read-only workspace.** Analysis reads files and writes none to the workspace. Baselines, the size history and measurements are written to VS Code's own storage for the extension, outside the workspace; the only write to the workspace is the settings change **Import Build Metadata** makes when you ask it to.
- **No native code.** The VSIX contains JavaScript bundles, a page template, styles and icons, and no executables.
- **Workspace Trust.** In Restricted Mode the workspace's own `trueImportCost.targets`, `trueImportCost.maxMetadataSizeMB` and `trueImportCost.measure.command` are ignored, so an untrusted workspace cannot point the extension at files outside it, raise the size limit or choose a command, and both measuring commands refuse to run.

## How metadata is handled

Build metadata is untrusted input:

- Files larger than `trueImportCost.maxMetadataSizeMB` (64 MB by default) are rejected before they are read.
- Contents are parsed as JSON only, read into maps rather than plain objects, and validated against a strict schema with limits on the number of modules, imports, chunks and the length of every string.
- References between modules, imports and outputs are checked for consistency before the module graph is built. Graph traversals visit each module once, so cycles terminate.
- To trace a named import through a barrel, the extension reads the barrel files along the import's re-exports that the metadata lists: JavaScript and TypeScript files up to 2 MB, parsed as text and never run. A file it cannot read or parse leaves the import's cost at the module level.
- Text taken from metadata, such as package names and paths, is escaped before it appears in a hover. Hover command links are trusted for the extension's own *Explain Why Included* command only.
- The dashboard is a webview whose content security policy allows only its own script, by nonce, and its own styles. It renders metadata as text, never as HTML, and every message it sends is checked against the message contract before the extension acts on it.
- Stored baselines, and the snapshots a measured build writes, are validated like any other metadata; stored measurements are checked field by field when they are read back.
- A file that fails any of these checks is rejected with a message in the log; the last valid snapshot stays in use.

## The bundler plugins

The plugins run inside your build. They have no runtime dependencies, make no network requests, and write only the snapshot file (atomically) and a `.gitignore` in a `.true-import-cost` folder they create.

In measurement mode, which only the `TRUE_IMPORT_COST_MEASURE` environment variable turns on, a plugin reads the request file the variable names. It refuses a request it cannot validate. It applies the edits the request lists to the source in memory, but only where the text still matches what the request expects. It keeps the build from writing its output, stopping the build rather than writing if another plugin turns writing back on. It writes its snapshot and an edit report to the folder the request names, instead of `.true-import-cost`.

## The CLI

`@true-import-cost/cli` has no runtime dependencies, makes no network requests, runs nothing and writes no files: its report goes to standard output. It reads the files named on its command line and the `package.json` of bundled packages for their versions. Metadata goes through the same size limit (`--max-size`, 64 MB by default), validation and consistency checks as in the extension. Text taken from metadata is printed with control and invisible formatting characters escaped, so it cannot start a line of its own in a CI log, where it could pass for a workflow command.

## Supply chain

- The source is MIT licensed and public; releases are built by public GitHub Actions workflows from tagged commits.
- Dependencies are pinned through `package-lock.json`, updated through Dependabot, and audited with `npm audit`. Install scripts are opt-in through `allowScripts`.
- Each GitHub release carries the VSIX it published, with a build provenance attestation; npm packages are published with provenance through trusted publishing.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/Der-Floh/True-Import-Cost/security/advisories/new) rather than a public issue. Include the version, the steps to reproduce, and if possible a metadata file or source that triggers the problem. You will get an answer within a week.
