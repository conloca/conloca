/** Markdown files imported `with { type: 'text' }` — Bun inlines them as strings at build time. */
declare module '*.md' {
  const content: string;
  export default content;
}
