# @true-import-cost/cli

A command-line tool for CI pipelines that reports what your production build contains, from the metadata your bundler writes: its sizes, its largest and duplicate packages, what changed since another build, and whether it stays within its size budgets.

It reads the same metadata as the [True Import Cost](https://github.com/Der-Floh/True-Import-Cost) VS Code extension and measures with the same engine, so its numbers match the ones in the editor. It has no runtime dependencies, makes no network requests and never runs your build.

## Install

```bash
npm install --save-dev @true-import-cost/cli
npx true-import-cost --help
```

It needs Node.js 18 or later. `npx @true-import-cost/cli <command>` runs it without adding it to the project.

## What it reads

- A **snapshot** written by [`@true-import-cost/vite`](../vite/README.md) or [`@true-import-cost/esbuild`](../esbuild/README.md): the best input, since it records the bundler's version, the build mode and the version of every bundled package
- A plain **esbuild metafile** (`esbuild --metafile=...`)
- Any other build metadata the extension reads

Package versions the file does not record are read from the packages' `package.json`, relative to the directory the build ran in: the snapshot's `root`, or for a metafile the first folder, from the file's own folder upwards, in which the paths it lists exist, and otherwise the current directory. A metafile from another checkout, such as one kept from an earlier CI run, is therefore given the versions installed now; compare snapshots when version changes matter.

A metadata or budgets file larger than `--max-size` (64 MB by default) is rejected unread. Metadata is then validated and checked for consistency exactly as the extension does.

## Commands

### `true-import-cost summary <metadata>`

The sizes of the build, its largest packages with their versions, and the packages it bundles more than once.

```console
$ npx true-import-cost summary .true-import-cost/webview.json --top 3
Bundle summary of webview: vite 8.3.8 (rolldown 1.2.19), production build

Sizes
  Total          10.6 kB
  JavaScript      8.7 kB
  CSS              400 B
  Other assets    1.5 kB
  Initial load      6 kB
  Lazily loaded   3.1 kB

Largest packages: 3 of 4
   Size  Lazy  Package
   2 kB   0 B  vue 3.5.0
  950 B   0 B  lodash-es 4.17.21
  700 B   0 B  dayjs 1.11.0

Duplicate packages: 1
   Size  Package
  300 B  dup 1.0.0 in node_modules/dup
  200 B  dup 2.0.0 in node_modules/wrap/node_modules/dup
```

*Total* is JavaScript, CSS and other assets such as images and fonts; source maps do not count. The *initial load* is the entry chunks, the chunks they import statically and their CSS; everything else is *lazily loaded*. Package sizes add up what the build kept of each module of the package; *Lazy* is the part of that in lazily loaded chunks.

### `true-import-cost compare <baseline> <current>`

What changed between two builds of a target: the sizes, the packages that were added, removed or changed in size or version, the chunks, and the modules that changed most. A chunk is matched by its entry module, or else by its file name without the content hash, so a new hash alone is no change. The markdown format is meant for pull request comments:

```console
$ npx true-import-cost compare main/webview.json .true-import-cost/webview.json --format markdown --top 2
```

```markdown
### Bundle size of `webview`: -3.8 kB (-26.4%)

|  | Baseline | Current | Change |
| --- | ---: | ---: | ---: |
| Total | 14.4 kB | 10.6 kB | -3.8 kB (-26.4%) |
| JavaScript | 12.9 kB | 8.7 kB | -4.2 kB (-32.6%) |
| CSS | 0 B | 400 B | +400 B |
| Other assets | 1.5 kB | 1.5 kB | 0 B |
| Initial load | 9.8 kB | 6 kB | -3.8 kB (-38.8%) |
| Lazily loaded | 3.1 kB | 3.1 kB | 0 B |

#### Packages: 1 added, 1 removed, 1 changed, 2 unchanged

| Package | Baseline | Current | Change |
| --- | ---: | ---: | ---: |
| `moment` `2.29.0` (removed) | 5 kB | 0 B | -5 kB |
| `dayjs` `1.11.0` (added) | 0 B | 700 B | +700 B |

... and 1 more

<details>
<summary>Chunks: 2 changed</summary>
...
</details>
```

### `true-import-cost check <metadata> --budgets <file>`

Checks the build against its size budgets, prints every result, and exits with `1` when a budget is exceeded.

```console
$ npx true-import-cost check .true-import-cost/webview.json --budgets .vscode/settings.json
Size budgets of webview: vite 8.3.8 (rolldown 1.2.19), production build

  Status       Size   Limit       Margin  Budget
  exceeded  10.6 kB   10 kB   600 B over  Total output
  ok           6 kB  600 kB  594 kB left  Initial load
  ok         8.7 kB    1 MB  991 kB left  JavaScript
  ok          400 B   500 B   100 B left  CSS
  exceeded     2 kB  1.5 kB   500 B over  Package vue
  ok          950 B    1 kB    50 B left  Package lodash-es
  ok            0 B     0 B  not bundled  Package moment

2 of 7 budgets exceeded.
```

The budgets are the same object as the extension's `trueImportCost.budgets` setting, keyed by build target, or `*` for every target; a target's own budget wins field by field. Sizes are bytes or text such as `30 kB`, `1.5 MB` or `500 KiB`, and `0` forbids a package:

```json
{
    "webview": { "total": "10 kB", "initial": "600 kB", "css": 500, "packages": { "vue": "1.5 kB", "lodash*": "1 kB", "moment": 0 } },
    "*": { "javascript": "1 MB" }
}
```

`--budgets` takes a JSON file with that object, or a VS Code `settings.json`, comments and trailing commas included, from which it reads `trueImportCost.budgets`, so the editor and CI share one definition. A field it does not know or a size it cannot read is an error rather than a budget silently skipped.

The budgets that apply are those of the build's target, which is the snapshot's `target` or a metafile's file name without `.json`, or of the target named with `--target`. `check` evaluates `total`, `initial`, `javascript`, `css` and `packages`; a package budget whose package is not in the build is met, and listed as `not bundled`. The `import` limit applies to single imports, which only the editor sees, so `check` leaves it to the extension. When no budget applies to the target, or the one that applies sets no limit `check` can evaluate, it exits with `2`.

## Options

| Option | Commands | Default | Meaning |
| --- | --- | --- | --- |
| `--format` | all | `text` | `text` for logs, `markdown` for pull request comments and job summaries, `json` for other tools |
| `--top` | `summary`, `compare` | `10` | Rows in each list: packages, chunks and modules. The counts above each list still include every row |
| `--budgets` | `check` | | The budgets file: JSON, or a VS Code `settings.json` |
| `--target` | `check` | the build's target | The build target whose budgets apply |
| `--max-size` | all | `64` | Largest file that is read, in megabytes (MiB), up to 1024 |
| `--help`, `-h` | | | Print the usage |
| `--version`, `-v` | | | Print the version |

Options go before or after the files, as `--top 5` or `--top=5`; `--` ends the options.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Done; for `check`, every budget is met |
| `1` | `check` found a budget exceeded |
| `2` | A usage error, a file that cannot be read or is not valid, or budgets that cannot be applied. The reason is one line on standard error, such as `true-import-cost: dist/meta.json: the file does not exist` |

## Output

The report goes to standard output and nothing else does; errors go to standard error. The same files give the same output byte for byte: there are no timestamps, colours or terminal control sequences. Everything the tool writes itself is ASCII. Names taken from the metadata are printed as they are, except that control and invisible formatting characters are escaped as `\uXXXX`, so metadata cannot start a line of its own in a CI log. Sizes use the extension's units, with 1 kB = 1000 bytes, and `~` marks a size estimated from what the bundler reported rather than reported by it, as for the modules of a Vite build.

## JSON reports

With `--format json`, each command writes one JSON object, indented by two spaces. Its `format` names the report and `schemaVersion` is `1`; a change that renames or removes a field raises the version, while new fields may be added within it. Sizes are whole bytes. Every report describes the builds it read with a **build** object:

| Field | Meaning |
| --- | --- |
| `target` | Name of the build target |
| `bundler` | `{ "name", "version"?, "engine"? }`, such as `{ "name": "vite", "version": "8.3.8", "engine": "rolldown 1.2.19" }` |
| `mode` | `production` or `development`, when the metadata says |
| `estimated` | Whether module sizes, and so package and module sizes, are estimates |

### `summary`: `"format": "true-import-cost/summary"`

| Field | Meaning |
| --- | --- |
| `build` | The build |
| `totals` | `{ "total", "javascript", "css", "assets", "initial", "lazy" }` |
| `packageCount` | How many packages the build contains |
| `packages[]` | The largest packages, at most `--top`: `name`, `versions` (sorted), `bytes`, `lazyBytes`, `modules` (with bytes in the build) and `duplicate` |
| `duplicates[]` | Every package bundled more than once: `name`, `bytes`, and `instances[]` of `version`?, `root` (its install folder) and `bytes` |

### `compare`: `"format": "true-import-cost/comparison"`

| Field | Meaning |
| --- | --- |
| `baseline`, `current` | The two builds |
| `totals` | For each of `total`, `javascript`, `css`, `assets`, `initial` and `lazy`: `{ "before", "after", "delta" }` |
| `packages` | Counts `added`, `removed`, `changed` and `unchanged`, and `changes[]`, largest change first, at most `--top`: `name`, `status` (`added`, `removed` or `changed`), `before`, `after`, `delta`, `versionsBefore`, `versionsAfter` |
| `chunks` | The count `changed`, and `changes[]`, at most `--top`: `before`? and `after`? (the chunk's file in each build; one is missing for an added or removed chunk), `bytesBefore`, `bytesAfter`, `delta` |
| `modules` | The count `changed`, and `changes[]`, at most `--top`: `id`, `label` (its path, or package and path within the package), `before`, `after`, `delta` |

### `check`: `"format": "true-import-cost/budget-check"`

| Field | Meaning |
| --- | --- |
| `build` | The build |
| `target` | The target whose budgets were applied |
| `passed` | Whether every budget is met; the exit code is `0` when it is and `1` when it is not |
| `exceeded` | How many budgets are exceeded |
| `results[]` | Every budget checked: `kind` (`total`, `initial`, `javascript`, `css` or `package`), `label` (a package name, or the pattern of a package budget that matched nothing), `limit`, `actual` and `exceeded` |

## GitHub Actions

The workflow below builds with a True Import Cost plugin, keeps the snapshot of every build of `main` as an artifact, compares each pull request with the last build of `main` in the job summary and in a comment, and fails when a budget is exceeded. Name the file `.github/workflows/bundle-size.yml`, or change `--workflow` to match.

```yaml
name: Bundle size

on:
  push:
    branches: [main]
  pull_request:

jobs:
  bundle-size:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read          # find and download the artifact of main
      pull-requests: write   # comment on the pull request
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci

      # @true-import-cost/vite writes .true-import-cost/webview.json
      - run: npm run build

      - name: Keep the snapshot of main
        if: github.ref == 'refs/heads/main'
        uses: actions/upload-artifact@v4
        with:
          name: bundle-snapshot
          path: .true-import-cost/webview.json
          include-hidden-files: true   # .true-import-cost starts with a dot

      - name: Find the last build of main
        id: main
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          run_id=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow bundle-size.yml --branch main --event push \
            --status success --limit 1 --json databaseId --jq '.[0].databaseId // empty')
          echo "run-id=$run_id" >> "$GITHUB_OUTPUT"

      - uses: actions/download-artifact@v4
        if: steps.main.outputs.run-id != ''
        with:
          name: bundle-snapshot
          path: main
          run-id: ${{ steps.main.outputs.run-id }}
          github-token: ${{ github.token }}

      - name: Compare with main
        if: steps.main.outputs.run-id != ''
        run: |
          npx true-import-cost compare main/webview.json .true-import-cost/webview.json --format markdown > bundle-size.md
          cat bundle-size.md >> "$GITHUB_STEP_SUMMARY"

      - name: Comment on the pull request
        if: steps.main.outputs.run-id != '' && github.event.pull_request.head.repo.full_name == github.repository
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: gh pr comment "$PR" --body-file bundle-size.md --edit-last || gh pr comment "$PR" --body-file bundle-size.md

      - name: Check the size budgets
        run: npx true-import-cost check .true-import-cost/webview.json --budgets .vscode/settings.json
```

The comparison runs before the budgets are checked, so a pull request over budget still gets its comment. Pull requests from forks get a read-only token, so they skip the comment and keep the job summary. A plain esbuild metafile works the same way, but records no package versions: see [What it reads](#what-it-reads).

## License

MIT
