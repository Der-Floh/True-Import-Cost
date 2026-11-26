// Order matters: './mocha' installs the tdd globals the suites need while they are evaluated.
import './mocha';
import './extension.test';

export { run } from './mocha';
