import cjs from 'cjs-lib';
import { format, parse } from 'big-library';

import { shared } from './shared.js';

export function describeCommand(name) {
    return `${format(parse(name))} ${shared()} ${cjs.hello(name)}`;
}
