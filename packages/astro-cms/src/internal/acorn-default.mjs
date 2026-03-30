import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const acorn = require('acorn');

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
