/** Fault injection runs in its own process so the module mock cannot leak into other reader tests. */
import { mock } from 'bun:test';

mock.module('../../src/puck-manifest/read-config.js', () => ({
  componentsEndpointBody() {
    if (process.argv[2] === 'string') throw 'fixture reader failure';
    throw new Error('fixture reader failure');
  },
}));
const { createComponentsEndpoint } = await import('../../src/puck-manifest/components-endpoint.js');
const warnings: unknown[][] = [];
console.warn = (...args) => {
  warnings.push(args);
};
let nextCalls = 0;
const response = {
  statusCode: 0,
  body: '',
  headers: new Map<string, string>(),
  setHeader(key: string, value: string) {
    this.headers.set(key, value);
  },
  end(body: string) {
    this.body = body;
  },
};
createComponentsEndpoint({ configPath: 'not-used-by-fault-injection' })({} as never, response as never, () => {
  nextCalls++;
});
console.log(
  JSON.stringify({
    status: response.statusCode,
    body: JSON.parse(response.body),
    headers: Object.fromEntries(response.headers),
    warnings,
    nextCalls,
  }),
);
