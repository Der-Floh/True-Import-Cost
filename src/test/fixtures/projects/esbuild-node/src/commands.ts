import cjs from 'cjs-lib';
import { format, parse } from 'big-library';

import { shared } from './shared';

export function describeCommand(name: string): string {
    return `${format(parse(name))} ${shared()} ${cjs.hello(name)}`;
}
