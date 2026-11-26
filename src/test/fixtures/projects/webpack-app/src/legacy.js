import { neverCalled } from 'shaken-lib';

const { hello } = require('cjs-lib');

export function legacy() {
    return hello('legacy');
}
