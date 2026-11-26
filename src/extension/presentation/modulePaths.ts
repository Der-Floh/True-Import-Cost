import { relativePath } from '../../core/paths';

import type { ModuleRecord } from '../../core/schema/snapshot';

export function displayModulePath(module: ModuleRecord): string {
    if (module.packageName !== undefined && module.packageRoot !== undefined) {
        return `${module.packageName}/${relativePath(module.packageRoot, module.path)}`;
    }
    return module.virtual === true ? module.id.replace(/^\0/, '') : module.path;
}
