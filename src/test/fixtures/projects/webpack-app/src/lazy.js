import { chart } from 'lazy-lib';

export function stop() {
    globalThis.console.log(`the lazily loaded module ran with ${chart()}`);
}
