import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { definePageSchema } from './page-schema-define.js';

// True only when T is exactly `any`. A plain `T extends X ? A : B` conditional
// can't tell `any` apart from a real match — `any extends X` resolves to the
// union `A | B` — so a check built only on `extends` would go fake-green if
// inference ever silently decayed to `any` instead of a concrete type.
type IsAny<T> = 0 extends 1 & T ? true : false;

describe('definePageSchema typing', () => {
  test('preserves the concrete schema type through the descriptor', () => {
    const descriptor = definePageSchema({
      schema: z.object({ author: z.string().optional(), tags: z.array(z.string()).optional() }),
    });
    type Meta = z.infer<typeof descriptor.schema>;

    // Guard against a silent decay to `any` for both fields (see IsAny above).
    const authorNotAny: IsAny<Meta['author']> = false;
    const tagsNotAny: IsAny<Meta['tags']> = false;

    // Round-trip a real value through the inferred type and read each field
    // back out into its expected concrete type. Before the fix,
    // definePageSchema widened the schema to z.ZodObject<z.ZodRawShape>, so
    // both fields typed as `unknown` here — and `unknown` is not assignable
    // to `string | undefined` / `string[] | undefined`, so these two lines
    // would fail to typecheck. `tags` exercises array inference, a different
    // path than the scalar `author` field.
    const meta: Meta = { author: 'jane', tags: ['a', 'b'] };
    const author: string | undefined = meta.author;
    const tags: string[] | undefined = meta.tags;

    // These assertions can never fail at runtime by construction — they
    // exist so `noUnusedLocals` doesn't reject the consts above. Deleting
    // them as "dead code" would silently break `typecheck-tests`, not
    // `test`, since the type errors they guard against only surface there.
    expect(authorNotAny).toBe(false);
    expect(tagsNotAny).toBe(false);
    expect(author).toBe('jane');
    expect(tags).toEqual(['a', 'b']);
    expect(descriptor.schema.shape.author).toBeDefined();
  });
});
