import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { HalfStepDB } from '../src/db/schema';

it('DB 버전 1 → 2: 기존 목표·단계·설정이 그대로 남고 템플릿 테이블이 생긴다', async () => {
  const name = 'upgrade-test';
  // 4단계까지의 앱이 만든 버전 1 DB
  const v1 = new Dexie(name);
  v1.version(1).stores({ goals: 'id, createdAt', steps: 'id, goalId, doneAt', settings: 'key' });
  await v1.table('goals').add({ id: 'g1', title: '옛 목표', createdAt: 1, updatedAt: 1 });
  await v1.table('steps').bulkAdd([
    { id: 's1', goalId: 'g1', parentId: null, order: 1000, title: '옛 단계', doneAt: 5, source: 'manual', createdAt: 1 },
  ]);
  await v1.table('settings').put({ key: 'enginePref', value: 'rules' });
  v1.close();

  const v2 = new HalfStepDB(name);
  await v2.open();
  expect(v2.verno).toBe(3);
  expect(await v2.goals.get('g1')).toMatchObject({ title: '옛 목표' });
  expect(await v2.steps.where('doneAt').above(0).count()).toBe(1);
  expect(await v2.settings.get('enginePref')).toMatchObject({ value: 'rules' });
  expect(await v2.templates.count()).toBe(0);
  v2.close();
});

it('DB 버전 2 → 3: source "ai-chrome" 등이 source "ai" + engine으로 나뉜다', async () => {
  const name = 'upgrade-test-v3';
  const old = new Dexie(name);
  old.version(1).stores({ goals: 'id, createdAt', steps: 'id, goalId, doneAt', settings: 'key' });
  old.version(2).stores({ templates: 'id, updatedAt' });
  const row = (id: string, source: string) => ({ id, goalId: 'g', parentId: null, order: 1000, title: id, doneAt: null, source, createdAt: 1 });
  await old.table('steps').bulkAdd([row('a', 'ai-chrome'), row('b', 'ai-native'), row('c', 'rules'), row('d', 'ai-이상한값')]);
  old.close();

  const db = new HalfStepDB(name);
  const byId = Object.fromEntries((await db.steps.toArray()).map((s) => [s.id, s]));
  expect(byId.a).toMatchObject({ source: 'ai', engine: 'chrome' });
  expect(byId.b).toMatchObject({ source: 'ai', engine: 'native' });
  expect(byId.c.source).toBe('rules');
  expect(byId.c.engine).toBeUndefined();
  expect(byId.d.source).toBe('ai');
  expect(byId.d.engine).toBeUndefined();
  db.close();
});
