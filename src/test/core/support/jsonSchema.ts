import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020';

import type { ValidateFunction } from 'ajv/dist/2020';

export const SNAPSHOT_JSON_SCHEMA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/snapshot/build-snapshot.schema.json');

let validate: ValidateFunction | undefined;

export function jsonSchemaErrors(value: unknown): string[] {
    validate ??= new Ajv2020({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(SNAPSHOT_JSON_SCHEMA_FILE, 'utf8')) as object);
    return validate(value) ? [] : (validate.errors ?? []).map(error => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
}
