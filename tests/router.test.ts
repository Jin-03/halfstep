import { describe, expect, it } from 'vitest';
import { parseRoute, routeToHash, type Route } from '../src/router';

describe('주소', () => {
  const cases: [string, Route][] = [
    ['', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/goals', { name: 'goals' }],
    ['#/goal/abc-1', { name: 'goal', id: 'abc-1' }],
    ['#/new', { name: 'new' }],
    ['#/archive', { name: 'archive' }],
    ['#/settings/ai', { name: 'ai' }],
    ['#/settings/templates', { name: 'templates' }],
    ['#/settings/templates/new?from=exam', { name: 'template', id: 'new', from: 'exam' }],
    ['#/settings/templates/t1', { name: 'template', id: 't1' }],
  ];
  it.each(cases)('%s', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
    if (hash.length > 2) expect(routeToHash(route)).toBe(hash);
  });

  it('모르는 주소는 홈, 빠진 id는 목록', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'home' });
    expect(parseRoute('#/goal/')).toEqual({ name: 'goals' });
  });
});
