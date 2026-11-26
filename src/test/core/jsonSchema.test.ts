import { describe, expect, it } from 'vitest';

import { SNAPSHOT_JSON_SCHEMA_FILE } from './support/jsonSchema';
import { SNAPSHOT_JSON_SCHEMA_ID, snapshotJsonSchema } from '../../core/schema/jsonSchema';

describe('snapshotJsonSchema', () => {
    it('is what packages/snapshot/build-snapshot.schema.json holds; vitest --update rewrites the file after a change to the zod schema', async () => {
        await expect(`${JSON.stringify(snapshotJsonSchema(), null, 4)}\n`).toMatchFileSnapshot(SNAPSHOT_JSON_SCHEMA_FILE);
    });

    it('is a draft 2020-12 schema with the URL of the committed file as its id', () => {
        expect(snapshotJsonSchema()).toMatchObject({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: 'https://raw.githubusercontent.com/Der-Floh/True-Import-Cost/main/packages/snapshot/build-snapshot.schema.json',
            title: 'True Import Cost build snapshot',
            type: 'object',
        });
        expect(SNAPSHOT_JSON_SCHEMA_ID.endsWith('/main/packages/snapshot/build-snapshot.schema.json')).toBe(true);
    });

    it('pins the format and the schema version', () => {
        expect(snapshotJsonSchema()).toMatchObject({
            properties: {
                format: { const: 'true-import-cost/build-snapshot' },
                schemaVersion: { const: 1 },
            },
        });
    });
});
