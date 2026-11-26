import { Disposable } from './events';

export interface ExecutedCommand {
    readonly command: string;
    readonly args: readonly unknown[];
}

const handlers = new Map<string, (...args: unknown[]) => unknown>();
let executed: ExecutedCommand[] = [];

export const commands = {
    registerCommand: (command: string, callback: (...args: unknown[]) => unknown): Disposable => {
        if (handlers.has(command)) {
            throw new Error(`command '${command}' already exists`);
        }
        handlers.set(command, callback);
        return new Disposable(() => {
            if (handlers.get(command) === callback) {
                handlers.delete(command);
            }
        });
    },
    executeCommand: (command: string, ...args: unknown[]): Promise<unknown> => {
        executed.push({ command, args });
        const handler = handlers.get(command);
        return handler === undefined ? Promise.resolve(undefined) : Promise.resolve().then(() => handler(...args));
    },
};

export function registeredCommands(): string[] {
    return [...handlers.keys()].sort();
}

export function flushExecutedCommands(): ExecutedCommand[] {
    return executed.splice(0);
}

export function resetCommands(): void {
    handlers.clear();
    executed = [];
}
