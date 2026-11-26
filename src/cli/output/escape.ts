const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

const INVISIBLE_IN_JSON = /[\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu;

function escapeCodeUnits(text: string): string {
    let escaped = '';
    for (let index = 0; index < text.length; index++) {
        escaped += `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`;
    }
    return escaped;
}

export function printable(text: string): string {
    return text.replace(INVISIBLE, escapeCodeUnits);
}

export function jsonText(value: unknown): string {
    return `${JSON.stringify(value, null, 2).replace(INVISIBLE_IN_JSON, escapeCodeUnits)}\n`;
}

export function code(text: string): string {
    const safe = printable(text);
    const longestRun = (safe.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);
    const fence = '`'.repeat(longestRun + 1);
    const padded = safe.startsWith('`') || safe.endsWith('`') ? ` ${safe} ` : safe;
    return `${fence}${padded}${fence}`;
}

export function tableCell(markdown: string): string {
    return markdown.replace(/\|/g, '\\|');
}
