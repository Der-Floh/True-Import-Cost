export const USAGE = `Usage: true-import-cost <command> [options]

Reports what a production build contains, from the metadata its bundler wrote:
a True Import Cost snapshot, an esbuild metafile, or any other build metadata
the True Import Cost extension reads.

Commands:
  summary <metadata>              Sizes, the largest packages and duplicates
  compare <baseline> <current>    What changed between two builds: sizes,
                                  packages, chunks and modules
  check <metadata> --budgets <file>
                                  Checks the build against size budgets

Options:
  --format text|markdown|json     Output format (default: text)
  --top <n>                       summary, compare: rows in each list
                                  (default: 10)
  --budgets <file>                check: a JSON file with the budgets, or a
                                  VS Code settings.json with
                                  "trueImportCost.budgets"
  --target <id>                   check: the build target whose budgets apply
                                  (default: the build's own target)
  --max-size <MB>                 Largest file that is read (default: 64)
  -h, --help                      Show this help
  -v, --version                   Show the version

Exit codes:
  0  done; for check, every budget is met
  1  check: a budget is exceeded
  2  a usage error, or a file that cannot be read or is not valid
`;
