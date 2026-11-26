import { identified } from './support';
import { fixture, inPackage } from '../core/support/snapshot';

import type { BuildIdentity } from './support';
import type { SnapshotFixture } from '../core/support/snapshot';

export const VITE: BuildIdentity = {
    target: 'webview',
    bundler: { name: 'vite', version: '8.3.8', engine: 'rolldown 1.2.19' },
    mode: 'production',
};

function withSharedModules(build: SnapshotFixture, index: string, chart: string): SnapshotFixture {
    return build
        .module('src/chart.ts', 3000, { chunk: chart })
        .module('node_modules/vue/index.js', 2000, { ...inPackage('vue', '3.5.0'), chunk: index })
        .module('node_modules/dup/index.js', 300, { ...inPackage('dup', '1.0.0'), chunk: index })
        .module('node_modules/wrap/node_modules/dup/index.js', 200, { ...inPackage('dup', '2.0.0', 'node_modules/wrap/node_modules/dup'), chunk: index })
        .imports('src/main.ts', 'src/chart.ts', { kind: 'dynamic' })
        .chunk({ id: chart, bytes: 3100, dynamicEntry: true, entryModule: 'src/chart.ts' })
        .asset({ id: 'assets/logo-AbCdEfGh.svg', kind: 'image', bytes: 1500 });
}

export function baselineBuild(identity: BuildIdentity = VITE): string {
    const build = fixture()
        .module('src/main.ts', 1200, { entry: true, chunk: 'assets/index-AB12cd34.js' })
        .module('node_modules/lodash-es/debounce.js', 900, { ...inPackage('lodash-es', '4.17.20'), chunk: 'assets/index-AB12cd34.js' })
        .module('node_modules/moment/moment.js', 5000, { ...inPackage('moment', '2.29.0'), chunk: 'assets/index-AB12cd34.js' })
        .chunk({ id: 'assets/index-AB12cd34.js', bytes: 9800, entry: true, entryModule: 'src/main.ts', dynamicImports: ['assets/chart-Qq9ZxY10.js'] });
    return identified(withSharedModules(build, 'assets/index-AB12cd34.js', 'assets/chart-Qq9ZxY10.js').snapshot(), identity);
}

export function currentBuild(identity: BuildIdentity = VITE): string {
    const build = fixture()
        .module('src/main.ts', 1300, { entry: true, chunk: 'assets/index-ZZ99yy88.js' })
        .module('node_modules/lodash-es/debounce.js', 950, { ...inPackage('lodash-es', '4.17.21'), chunk: 'assets/index-ZZ99yy88.js' })
        .module('node_modules/dayjs/dayjs.js', 700, { ...inPackage('dayjs', '1.11.0'), chunk: 'assets/index-ZZ99yy88.js' })
        .chunk({ id: 'assets/index-ZZ99yy88.js', bytes: 5600, entry: true, entryModule: 'src/main.ts', dynamicImports: ['assets/chart-Rr0ZxY11.js'], css: ['assets/index-Bb7Kk2Lm.css'] })
        .chunk({ id: 'assets/index-Bb7Kk2Lm.css', bytes: 400 });
    return identified(withSharedModules(build, 'assets/index-ZZ99yy88.js', 'assets/chart-Rr0ZxY11.js').snapshot(), identity);
}

export function estimatedBuild(): string {
    const snapshot = fixture()
        .module('src/main.ts', 1000, { entry: true, precision: 'proportional-estimate' })
        .module('node_modules/vue/index.js', 2000, { ...inPackage('vue', '3.5.0'), precision: 'sourcemap-estimate' })
        .snapshot();
    return identified(snapshot, VITE);
}
