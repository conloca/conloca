/**
 * MDX compilation types
 */

export interface MDXCompileResult {
  code: string;
  metadata: Record<string, any>;
}

export interface MDXCompiler {
  compile: (content: string) => Promise<MDXCompileResult>;
  compileFile: (filePath: string) => Promise<MDXCompileResult>;
}
