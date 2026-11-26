import * as vscode from 'vscode';

export class Logger {
    private static channel: vscode.LogOutputChannel | undefined;

    public static initialize(context: vscode.ExtensionContext, name: string): void {
        Logger.channel = vscode.window.createOutputChannel(name, { log: true });
        context.subscriptions.push(Logger.channel);
    }

    public static show(): void {
        Logger.channel?.show(true);
    }

    public static trace(message: string, ...args: unknown[]): void {
        Logger.channel?.trace(message, ...args);
    }

    public static debug(message: string, ...args: unknown[]): void {
        Logger.channel?.debug(message, ...args);
    }

    public static info(message: string, ...args: unknown[]): void {
        Logger.channel?.info(message, ...args);
    }

    public static warn(message: string, ...args: unknown[]): void {
        Logger.channel?.warn(message, ...args);
    }

    public static error(message: string, ...args: unknown[]): void {
        Logger.channel?.error(message, ...args);
    }
}
