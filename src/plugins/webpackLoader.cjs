'use strict';

const EDITORS = Symbol.for('true-import-cost.webpack-edits');

module.exports = function trueImportCostEdits(source) {
    const { key } = this.getOptions();
    const edit = globalThis[EDITORS]?.get(key);
    if (typeof edit !== 'function') {
        throw new Error('True Import Cost cannot take the import out of this file: its loader runs outside the build process that planned the measurement.');
    }
    return edit(this.resourcePath, source);
};
