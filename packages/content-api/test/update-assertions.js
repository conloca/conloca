const fs = require('fs');

// Read the file
let content = fs.readFileSync('middleware.test.ts', 'utf8');

// Replace all "as any" with proper type checking
content = content.replace(/const data = await res\.json\(\) as any;/g, 'const data = await res.json();');

// Replace assertions that use data.items with type guards
content = content.replace(/expect\(data\.total\)\.toBe\((\d+)\);/g, (match, num) => {
  return `expect(isContentListResponse(data)).toBe(true);
      if (isContentListResponse(data)) {
        expect(data.total).toBe(${num});`;
});

// Fix the items.every checks
content = content.replace(/expect\(data\.items\.every\((.*?)\)\)\.toBe\(true\);/g, (match, p1) => {
  return `expect(data.items.every(${p1})).toBe(true);
      }`;
});

// Fix standalone data.items checks
content = content.replace(/expect\(data\.items\)\.toHaveLength\((\d+)\);/g, (match, num) => {
  return `expect(data.items).toHaveLength(${num});
      }`;
});

// Fix data.items[0] checks
content = content.replace(/expect\(data\.items\[0\]\.(.*?)\)\.toBe\((.*?)\);/g, (match, prop, value) => {
  return `expect(data.items[0].${prop}).toBe(${value});
      }`;
});

// Replace result.id! with getCreatedId
content = content.replace(/const id = result\.id!;/g, 'const id = getCreatedId(result);');

// Replace content!.etag with assertDefined
content = content.replace(
  /const etag = content!\.etag;/g,
  `assertDefined(content, 'Content should exist');
      const etag = content.etag;`,
);

// Replace await api.getLocalized(result.id!, with getCreatedId
content = content.replace(
  /await api\.getLocalized\(result([0-9]?)\.id!, '(\w+)'\);/g,
  (match, num, locale) => `await api.getLocalized(getCreatedId(result${num}), '${locale}');`,
);

// Replace content1!.etag and content2!.etag
content = content.replace(/etag: content([0-9])!\.etag,/g, (match, num) => {
  return `etag: content${num}?.etag || '',`;
});

// Write the updated content
fs.writeFileSync('middleware.test.updated.ts', content);
