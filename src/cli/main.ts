import { nodeEnvironment } from './nodeEnvironment';
import { run } from './run';

declare const CLI_VERSION: string;

void run(process.argv.slice(2), nodeEnvironment(CLI_VERSION)).then((code) => {
    process.exitCode = code;
});
