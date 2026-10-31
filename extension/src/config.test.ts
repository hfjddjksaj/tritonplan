import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PLANNER_URL, PLANNER_MATCH } from './config.js';

interface ContentScript {
  matches: string[];
  js: string[];
}
const manifest = JSON.parse(
  readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'),
) as { permissions: string[]; host_permissions: string[]; content_scripts: ContentScript[] };

describe('planner origin', () => {
  it('planner points at tritonplan.cn', () => {
    expect(PLANNER_URL).toBe('https://tritonplan.cn/');
    expect(PLANNER_MATCH).toBe('https://tritonplan.cn/*');
  });

  it('manifest grants exactly TSS + the planner, and the bridge runs only on the planner', () => {
    expect(manifest.host_permissions).toEqual(['https://tss.ucsd.edu/*', PLANNER_MATCH]);
    expect(manifest.permissions).toEqual(['storage', 'tabs']);
    // The only other site: RMP's consent-cookie repair, one script on www, nothing else there.
    const elsewhere = manifest.content_scripts.filter((c) => !c.matches.every((m) => m === 'https://tss.ucsd.edu/*' || m === PLANNER_MATCH));
    expect(elsewhere).toEqual([
      { matches: ['https://www.ratemyprofessors.com/*'], js: ['content/rmp-consent.js'], run_at: 'document_start', world: 'MAIN' },
    ]);
    const bridge = manifest.content_scripts.find((c) => c.js.includes('content/planner-bridge.js'));
    expect(bridge?.matches).toEqual([PLANNER_MATCH]);
    expect(JSON.stringify(manifest)).not.toContain('github.io');
  });
});
