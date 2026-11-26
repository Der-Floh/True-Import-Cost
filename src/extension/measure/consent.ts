import * as vscode from 'vscode';

export type ConsentKind = 'build' | 'bundler';

export interface ConsentRequest {
    readonly kind: ConsentKind;
    readonly command: string;
    readonly cwd: vscode.Uri;
    readonly message: string;
    readonly detail: string;
}

const ALLOWED_KEY = 'trueImportCost.measure.allowed';

const RUN_ONCE = 'Run Once';

const ALWAYS = 'Always Allow in This Workspace';

const MANAGE_TRUST = 'Manage Workspace Trust';

function allowanceOf(request: ConsentRequest): string {
    return [request.kind, request.cwd.toString(), request.command].join('\u0001');
}

export async function confirmRun(state: vscode.Memento, request: ConsentRequest): Promise<boolean> {
    if (!vscode.workspace.isTrusted) {
        const answer = await vscode.window.showInformationMessage(
            'True Import Cost runs build tools only in a trusted workspace, and this one is in Restricted Mode.',
            MANAGE_TRUST,
        );
        if (answer === MANAGE_TRUST) {
            await vscode.commands.executeCommand('workbench.trust.manage');
        }
        return false;
    }
    const allowed = state.get<readonly string[]>(ALLOWED_KEY, []);
    const allowance = allowanceOf(request);
    if (allowed.includes(allowance)) {
        return true;
    }
    const answer = await vscode.window.showWarningMessage(request.message, { modal: true, detail: request.detail }, RUN_ONCE, ALWAYS);
    if (answer === ALWAYS) {
        await state.update(ALLOWED_KEY, [...allowed, allowance]);
    }
    return answer === RUN_ONCE || answer === ALWAYS;
}

export async function forgetConsent(state: vscode.Memento): Promise<void> {
    await state.update(ALLOWED_KEY, undefined);
}
