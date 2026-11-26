import * as z from 'zod/mini';

import { snapshotSchema } from './validate';

export const SNAPSHOT_JSON_SCHEMA_ID = 'https://raw.githubusercontent.com/Der-Floh/True-Import-Cost/main/packages/snapshot/build-snapshot.schema.json';

const DESCRIPTION = 'The modules, chunks, assets and imports of one build target, as docs/snapshot-schema.md describes them. '
    + 'This schema checks the shape and the limits of a snapshot. parseSnapshot in @true-import-cost/snapshot also checks that ids are unique, '
    + 'and that every module and output an import, a contribution or a chunk names exists.';

export function snapshotJsonSchema(): Record<string, unknown> {
    const { $schema, ...schema } = z.toJSONSchema(snapshotSchema, { target: 'draft-2020-12', io: 'input' });
    return { $schema, $id: SNAPSHOT_JSON_SCHEMA_ID, title: 'True Import Cost build snapshot', description: DESCRIPTION, ...schema };
}
