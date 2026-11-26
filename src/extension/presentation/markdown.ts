const MAX_CODE_LENGTH = 240;

export function code(text: string): string {
    const cleaned = text.replace(/[`\r\n]+/g, ' ').trim();
    const shortened = cleaned.length > MAX_CODE_LENGTH ? `${cleaned.slice(0, MAX_CODE_LENGTH)}…` : cleaned;
    return `\`${shortened === '' ? ' ' : shortened}\``;
}

export function escapeMarkdown(text: string): string {
    return text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]()#+\-.!|<>~&]/g, '\\$&');
}

export function commandLink(label: string, command: string, args: unknown): string {
    return `[${escapeMarkdown(label)}](command:${command}?${encodeURIComponent(JSON.stringify([args]))})`;
}
