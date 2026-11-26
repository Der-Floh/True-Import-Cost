export interface Command {
    readonly title: string;
    readonly command: string;
    readonly arguments?: readonly unknown[];
}

export class MarkdownString {
    public value: string;
    public isTrusted: boolean | { readonly enabledCommands: readonly string[] } | undefined;
    public supportThemeIcons: boolean;

    public constructor(value = '', supportThemeIcons = false) {
        this.value = value;
        this.supportThemeIcons = supportThemeIcons;
    }
}

export class ThemeIcon {
    public readonly id: string;

    public constructor(id: string) {
        this.id = id;
    }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;

export class TreeItem {
    public label: string;
    public collapsibleState: number;
    public description: string | boolean | undefined;
    public tooltip: string | MarkdownString | undefined;
    public iconPath: ThemeIcon | undefined;
    public contextValue: string | undefined;
    public command: Command | undefined;

    public constructor(label: string, collapsibleState: number = TreeItemCollapsibleState.None) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}
