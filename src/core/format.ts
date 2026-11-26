const UNITS = ['kB', 'MB', 'GB'] as const;

function trimZeros(value: string): string {
    return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 1000) {
        return `${Math.max(0, Math.round(Number.isFinite(bytes) ? bytes : 0))} B`;
    }
    let value = bytes;
    let unit = 0;
    value /= 1000;
    while (value >= 999.5 && unit < UNITS.length - 1) {
        value /= 1000;
        unit++;
    }
    const decimals = unit === 0
        ? (value < 100 ? 1 : 0)
        : (value < 10 ? 2 : value < 100 ? 1 : 0);
    return `${trimZeros(value.toFixed(decimals))} ${UNITS[unit]}`;
}

export function formatAge(milliseconds: number): string {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 45) {
        return 'just now';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
        return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }
    const days = Math.round(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
}
