export { ContentIndex } from './content-index.js';
export type { ParseHeaderResult } from './header-parser.js';
export { parseContentHeader } from './header-parser.js';
// The canonical VXJSON serializer/parser for readers inside the effectful
// indexing world. Pure writers that must stay free of node/WASM imports use
// the dedicated `./vxjson-serialize` subpath instead — this chunk evaluates
// crypto/xxhash at import time.
export { VXJSON } from './vxjson.js';
