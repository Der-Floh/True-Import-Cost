import Mocha from 'mocha';

const TEST_TIMEOUT_MS = 30_000;

const mocha = new Mocha({ ui: 'tdd', timeout: TEST_TIMEOUT_MS, color: true });
mocha.suite.emit('pre-require', globalThis, '', mocha);

export function run(): Promise<void> {
    return new Promise((resolve, reject) => {
        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} integration test(s) failed.`));
                    return;
                }
                resolve();
            });
        } catch (error: unknown) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
