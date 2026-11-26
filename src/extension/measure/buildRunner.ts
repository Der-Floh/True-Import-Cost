import { spawn } from 'node:child_process';

import type { ChildProcess } from 'node:child_process';

export interface BuildRun {
    readonly command: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
    readonly onOutput?: (line: string) => void;
}

export type BuildOutcome =
    | { readonly status: 'succeeded' }
    | { readonly status: 'failed'; readonly detail: string }
    | { readonly status: 'timed-out' }
    | { readonly status: 'cancelled' };

export type BuildRunner = (run: BuildRun) => Promise<BuildOutcome>;

const KILL_GRACE_MS = 3_000;

function killTree(child: ChildProcess): void {
    const pid = child.pid;
    if (pid === undefined || child.exitCode !== null) {
        return;
    }
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
        return;
    }
    const signalGroup = (signal: NodeJS.Signals): void => {
        try {
            process.kill(-pid, signal);
        } catch {
            child.kill(signal);
        }
    };
    signalGroup('SIGTERM');
    setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            signalGroup('SIGKILL');
        }
    }, KILL_GRACE_MS).unref();
}

function forwardLines(stream: NodeJS.ReadableStream | null, onLine: ((line: string) => void) | undefined): void {
    if (!stream || !onLine) {
        stream?.resume();
        return;
    }
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop() ?? '';
        lines.forEach(onLine);
    });
    stream.on('end', () => {
        if (pending !== '') {
            onLine(pending);
        }
    });
}

export const runBuild: BuildRunner = run => new Promise((resolve) => {
    let ending: BuildOutcome | undefined;
    const child = spawn(run.command, {
        cwd: run.cwd,
        env: { ...process.env, ...run.env },
        shell: true,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stop = (outcome: BuildOutcome): void => {
        ending ??= outcome;
        killTree(child);
    };
    const timer = setTimeout(() => stop({ status: 'timed-out' }), run.timeoutMs);
    const onAbort = (): void => stop({ status: 'cancelled' });
    run.signal?.addEventListener('abort', onAbort, { once: true });
    if (run.signal?.aborted === true) {
        onAbort();
    }
    forwardLines(child.stdout, run.onOutput);
    forwardLines(child.stderr, run.onOutput);

    const finish = (outcome: BuildOutcome): void => {
        clearTimeout(timer);
        run.signal?.removeEventListener('abort', onAbort);
        resolve(ending ?? outcome);
    };
    child.on('error', error => finish({ status: 'failed', detail: error.message }));
    child.on('close', (code, signal) => {
        finish(code === 0 ? { status: 'succeeded' } : { status: 'failed', detail: code === null ? `stopped by ${signal ?? 'a signal'}` : `exit code ${code}` });
    });
});
