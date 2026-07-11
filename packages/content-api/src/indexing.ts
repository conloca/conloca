export { ContentIndex } from './content-index';
export type { ParseHeaderResult } from './header-parser';
export { parseContentHeader } from './header-parser';
// The canonical VXJSON serializer/parser for readers inside the effectful
// indexing world. Pure writers (the SaaS Branch DO's commit-plan core) use
// the dedicated `./vxjson-serialize` subpath instead — this chunk evaluates
// crypto/xxhash at import time, which spec 14 §A90 bans inside cores.
export { VXJSON } from './vxjson';
