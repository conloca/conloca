import { describe, expect, it } from 'bun:test';
import { cfPlanEdit, recordedCfPlan, sharedQuotaRoutes } from '../src/lib/connect/cf-plan.js';

describe('recordedCfPlan', () => {
  it('reads conloca.cfPlan from package.json', () => {
    expect(recordedCfPlan('{"conloca":{"cfPlan":"paid"}}')).toBe('paid');
    expect(recordedCfPlan('{"conloca":{"cfPlan":"free"}}')).toBe('free');
  });

  it('reads nothing from a missing, malformed or unknown answer', () => {
    for (const text of [null, '', 'not json', '[]', '{"conloca":"paid"}', '{"conloca":{"cfPlan":"pro"}}']) {
      expect(recordedCfPlan(text)).toBeUndefined();
    }
  });
});

describe('cfPlanEdit', () => {
  it('records the plan with a minimal edit, keeping the file’s own layout byte for byte', () => {
    const before =
      '{\n\t"name": "site",\n\t"scripts": { "build": "astro build" },\n\t"devDependencies": { "wrangler": "^4.141.0" }\n}\n';
    const edit = cfPlanEdit('/site/package.json', before, 'free');
    expect(edit?.after).toBe(
      '{\n\t"name": "site",\n\t"scripts": { "build": "astro build" },\n\t"devDependencies": { "wrangler": "^4.141.0" },\n\t"conloca": {\n\t\t"cfPlan": "free"\n\t}\n}\n',
    );
  });

  it('adds the plan to an existing conloca object and replaces a recorded one in place', () => {
    const before = '{\n  "name": "site",\n  "conloca": { "other": 1, "cfPlan": "paid" }\n}\n';
    expect(cfPlanEdit('/site/package.json', before, 'free')?.after).toBe(
      '{\n  "name": "site",\n  "conloca": { "other": 1, "cfPlan": "free" }\n}\n',
    );
  });

  it('changes nothing when the plan is recorded already', () => {
    expect(cfPlanEdit('/site/package.json', '{"conloca":{"cfPlan":"paid"}}', 'paid')).toBeNull();
  });
});

describe('sharedQuotaRoutes', () => {
  it('lists the on-demand routes a build reports, not the preview route and not the image endpoint drafts use', () => {
    expect(
      sharedQuotaRoutes(['/_conloca/preview', '/_conloca/preview/*', '/_image', '/api/*'], '/_conloca/preview'),
    ).toEqual(['/api/*']);
    expect(sharedQuotaRoutes(null, '/_conloca/preview')).toEqual([]);
  });
});
