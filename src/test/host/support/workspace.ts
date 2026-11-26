import { openDocument, setVirtualFile } from '../../__mocks__/vscode';

import type { DocumentOptions, FakeTextDocument, VirtualFileOptions } from '../../__mocks__/vscode';

export function writeJson(path: string, value: unknown, options?: VirtualFileOptions): void {
    setVirtualFile(path, JSON.stringify(value), options);
}

export function writePackageJson(directory: string, version: string): void {
    writeJson(`${directory}/package.json`, { name: directory.slice(directory.lastIndexOf('node_modules/') + 'node_modules/'.length), version });
}

export function writeSource(path: string, text: string, options?: VirtualFileOptions & DocumentOptions): FakeTextDocument {
    setVirtualFile(path, text, options);
    return openDocument(path, text, options);
}

export function lines(...text: string[]): string {
    return `${text.join('\n')}\n`;
}
