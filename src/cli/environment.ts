export interface FileInfo {
    readonly isFile: boolean;
    readonly size: number;
    readonly modifiedAt: number;
}

export interface FileAccess {
    info(file: string): Promise<FileInfo | undefined>;
    read(file: string): Promise<Uint8Array>;
}

export interface CliEnvironment {
    readonly cwd: string;
    readonly version: string;
    readonly files: FileAccess;
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
}

export const ExitCode = {
    ok: 0,
    budgetExceeded: 1,
    error: 2,
} as const;

export class CliError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'CliError';
    }
}

export class UsageError extends CliError {
    public constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
