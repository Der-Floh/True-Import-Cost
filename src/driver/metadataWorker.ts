import { parentPort } from 'node:worker_threads';

import { buffersOf } from '../core/graph/precomputed';
import { answerWorkerRequest } from '../core/metadataFile';

import type { MetadataWorkerRequest } from '../core/metadataFile';

const port = parentPort;

port?.on('message', (message: MetadataWorkerRequest) => {
    void answerWorkerRequest(message).then(response => port.postMessage(response, response.ok ? buffersOf(response.precomputed) : []));
});
