import { ROLLUP_BUILD_FORMAT } from '../../../core/adapters/rollup';

import type { RollupBuildInput, RollupChunkInput, RollupModuleInput } from '../../../core/adapters/rollup';

export const BASE_DIR = '/work/app';

export const OUT_DIR = '/work/app/dist';

export interface RollupChunkSpec extends Partial<Omit<RollupChunkInput, 'fileName' | 'modules'>> {
    readonly modules?: Readonly<Record<string, number>>;
}

export function at(path: string): string {
    return `${BASE_DIR}/${path}`;
}

export function rollupModule(id: string, spec: Partial<Omit<RollupModuleInput, 'id'>> = {}): RollupModuleInput {
    return { id, isEntry: false, importedIds: [], dynamicallyImportedIds: [], ...spec };
}

export function rollupChunk(fileName: string, spec: RollupChunkSpec = {}): RollupChunkInput {
    const { modules = {}, ...rest } = spec;
    const rendered = Object.entries(modules).map(([id, renderedLength]) => ({ id, renderedLength }));
    return {
        fileName,
        bytes: rendered.reduce((sum, module) => sum + module.renderedLength, 0),
        isEntry: false,
        isDynamicEntry: false,
        facadeModuleId: null,
        imports: [],
        dynamicImports: [],
        ...rest,
        modules: rendered,
    };
}

export function rollupBuild(spec: Partial<Omit<RollupBuildInput, 'format'>>): RollupBuildInput {
    return {
        format: ROLLUP_BUILD_FORMAT,
        baseDir: BASE_DIR,
        outDir: OUT_DIR,
        chunks: [],
        assets: [],
        modules: [],
        ...spec,
    };
}
