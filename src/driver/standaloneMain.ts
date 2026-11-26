import { readFileSync, writeFileSync } from 'node:fs';

import { measureStandalone } from './standalone';
import { parseStandaloneJob, STANDALONE_ENV } from '../core/standaloneProtocol';

async function main(): Promise<void> {
    const jobFile = process.env[STANDALONE_ENV];
    const job = jobFile === undefined ? undefined : parseStandaloneJob(JSON.parse(readFileSync(jobFile, 'utf8')));
    if (!job) {
        process.exitCode = 2;
        return;
    }
    writeFileSync(job.resultFile, JSON.stringify(await measureStandalone(job)));
}

void main();
