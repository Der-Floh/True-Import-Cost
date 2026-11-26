import { afterEach, beforeEach, vi } from 'vitest';

import { DISPLAY_NAME } from '../../extension/constants';
import { Logger } from '../../extension/services/logger';
import { createExtensionContext, resetMocks } from '../__mocks__/vscode';

beforeEach(() => {
    Logger.initialize(createExtensionContext(), DISPLAY_NAME);
});

afterEach(() => {
    resetMocks();
    vi.useRealTimers();
});
