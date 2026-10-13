// Uniform acorn surface for SSR builds: some toolchain consumers
// default-import acorn (which its ESM build does not provide), others use
// named imports — this shim serves both. Resolved with a static import, never
// a Node require built from `import.meta.url` — that value is undefined
// inside a Workers bundle, and building one at module scope throws before the
// bundle can serve anything. The
// integration's alias plugin skips this file as an importer, so the specifier
// below reaches the real package instead of recursing into the shim.
import * as acornModule from 'acorn';

// Bundler CJS interop can surface the namespace under `default`.
const acorn = acornModule.Parser ? acornModule : acornModule.default;

export const Node = acorn.Node;
export const Parser = acorn.Parser;
export const Position = acorn.Position;
export const SourceLocation = acorn.SourceLocation;
export const TokContext = acorn.TokContext;
export const Token = acorn.Token;
export const TokenType = acorn.TokenType;
export const defaultOptions = acorn.defaultOptions;
export const getLineInfo = acorn.getLineInfo;
export const isIdentifierChar = acorn.isIdentifierChar;
export const isIdentifierStart = acorn.isIdentifierStart;
export const isNewLine = acorn.isNewLine;
export const keywordTypes = acorn.keywordTypes;
export const lineBreak = acorn.lineBreak;
export const lineBreakG = acorn.lineBreakG;
export const nonASCIIwhitespace = acorn.nonASCIIwhitespace;
export const parse = acorn.parse;
export const parseExpressionAt = acorn.parseExpressionAt;
export const tokContexts = acorn.tokContexts;
export const tokTypes = acorn.tokTypes;
export const tokenizer = acorn.tokenizer;
export const version = acorn.version;

export default acorn;
