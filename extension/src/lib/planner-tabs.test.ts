import { describe, it, expect } from 'vitest';
import { pickPlannerTab, plannerTabsOnly } from './planner-tabs.js';

const tab = (id: number | undefined, url: string | undefined) => ({ id, url }) as chrome.tabs.Tab;

describe('planner tab selection', () => {
  const shared = tab(1, 'https://tritonplan.cn/s/Ab3dE9xQ2k');
  const planner = tab(2, 'https://tritonplan.cn/');

  it('drops shared-plan tabs', () => {
    expect(plannerTabsOnly([shared, planner])).toEqual([planner]);
    expect(plannerTabsOnly([shared])).toEqual([]);
  });

  it('picks the planner tab when both are open', () => {
    expect(pickPlannerTab([shared, planner])).toBe(planner);
  });

  it('picks nothing when only a shared-plan tab is open', () => {
    expect(pickPlannerTab([shared])).toBeUndefined();
  });

  it('skips tabs without an id', () => {
    expect(pickPlannerTab([tab(undefined, 'https://tritonplan.cn/'), planner])).toBe(planner);
  });
});
