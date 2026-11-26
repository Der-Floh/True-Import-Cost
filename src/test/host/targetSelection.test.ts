import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TargetSelection } from '../../extension/services/targetSelection';
import { createExtensionContext } from '../__mocks__/vscode';

import type { LoadedTarget } from '../../extension/services/metadataLoader';
import type * as vscode from 'vscode';

const NODE = { key: 'file:///w/.true-import-cost/node.json' } as LoadedTarget;
const WEB = { key: 'file:///w/.true-import-cost/web.json' } as LoadedTarget;

let memento: vscode.Memento;
let selection: TargetSelection;

beforeEach(() => {
    memento = createExtensionContext().workspaceState;
    selection = new TargetSelection(memento);
});

afterEach(() => {
    selection.dispose();
});

describe('TargetSelection', () => {
    it('picks the first candidate while nothing is selected, and nothing from no candidates', () => {
        expect(selection.pick([NODE, WEB])).toBe(NODE);
        expect(selection.pick([])).toBeUndefined();
    });

    it('picks the selected target when it is a candidate, and the first candidate otherwise', async () => {
        await selection.select(WEB.key);

        expect(selection.pick([NODE, WEB])).toBe(WEB);
        expect(selection.pick([NODE])).toBe(NODE);
    });

    it('keeps the selection in the workspace state, and forgets it when set back to automatic', async () => {
        await selection.select(WEB.key);
        expect(memento.get('trueImportCost.selectedTarget')).toBe(WEB.key);
        expect(new TargetSelection(memento).selectedKey).toBe(WEB.key);

        await selection.select(undefined);

        expect(memento.keys()).toEqual([]);
        expect(selection.selectedKey).toBeUndefined();
    });

    it('ignores a stored selection that is not a key', async () => {
        await memento.update('trueImportCost.selectedTarget', 42);

        expect(selection.selectedKey).toBeUndefined();
        expect(selection.pick([NODE, WEB])).toBe(NODE);
    });

    it('tells its listeners each time the selection changes', async () => {
        let changes = 0;
        selection.onDidChange(() => {
            changes++;
        });

        await selection.select(WEB.key);
        await selection.select(undefined);

        expect(changes).toBe(2);
    });
});
