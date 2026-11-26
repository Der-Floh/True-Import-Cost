import theme, { capitalize, debounce, kebab } from 'kit';
import { alpha } from 'cjs-kit';
import { Button, Input } from './components';
import { openSettings } from './settings';

const save = debounce(() => openSettings(), 100);

export function render(): string {
    save();
    return [capitalize(theme.name), Button(), Input(), alpha()].join(' ');
}
