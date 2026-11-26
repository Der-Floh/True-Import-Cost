import type { EsbuildImportRecord, EsbuildMetafile } from '../../../core/adapters/esbuild';

export interface LargeBuild {
    readonly metafile: EsbuildMetafile;
    readonly entry: string;
    readonly deepFile: string;
}

const IMPORTS_PER_MODULE = 4;

const LAZY_CHUNKS = 50;

const FIRST_PARTY_SHARE = 0.2;

export function largeBuild(moduleCount: number): LargeBuild {
    const packageCount = Math.max(10, Math.round(moduleCount / 40));
    const firstParty = Math.round(moduleCount * FIRST_PARTY_SHARE);
    const pathOf = (index: number): string => (index < firstParty
        ? `src/feature${index % 300}/file${index}.ts`
        : `node_modules/pkg-${index % packageCount}/lib/module-${index}.js`);
    const specifierOf = (index: number): string => (index < firstParty ? `./file${index}` : `pkg-${index % packageCount}`);

    const inputs: Record<string, { bytes: number; imports: EsbuildImportRecord[] }> = {};
    const outputs: Record<string, { bytes: number; inputs: Record<string, { bytesInOutput: number }>; imports: EsbuildImportRecord[]; entryPoint?: string }> = {};
    const main = 'dist/main.js';
    outputs[main] = { bytes: 0, inputs: {}, imports: [], entryPoint: pathOf(0) };
    for (let chunk = 0; chunk < LAZY_CHUNKS; chunk++) {
        outputs[`dist/chunk-${chunk}.js`] = { bytes: 0, inputs: {}, imports: [], entryPoint: pathOf(chunk + 1) };
        outputs[main].imports.push({ path: `dist/chunk-${chunk}.js`, kind: 'dynamic-import' });
    }

    for (let index = 0; index < moduleCount; index++) {
        const imports: EsbuildImportRecord[] = [];
        for (let edge = 1; edge <= IMPORTS_PER_MODULE; edge++) {
            const target = (index * 7 + edge * 131) % moduleCount;
            if (target !== index) {
                const lazy = index > LAZY_CHUNKS && edge === IMPORTS_PER_MODULE && index % 97 === 0;
                imports.push({ path: pathOf(target), kind: lazy ? 'dynamic-import' : 'import-statement', original: specifierOf(target) });
            }
        }
        if (index === 0) {
            for (let chunk = 1; chunk <= LAZY_CHUNKS; chunk++) {
                imports.push({ path: pathOf(chunk), kind: 'dynamic-import', original: `./lazy${chunk}` });
            }
        }
        inputs[pathOf(index)] = { bytes: 2_000 + (index % 500), imports };
        const output = outputs[index > 0 && index <= LAZY_CHUNKS ? `dist/chunk-${index - 1}.js` : main];
        if (output) {
            const bytes = 300 + (index % 700);
            output.inputs[pathOf(index)] = { bytesInOutput: bytes };
            output.bytes += bytes;
        }
    }
    return { metafile: { inputs, outputs }, entry: pathOf(0), deepFile: pathOf(Math.round(moduleCount * 0.1)) };
}
