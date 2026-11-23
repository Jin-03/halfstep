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
  expect(v2.verno).toBe(2);
  expect(await v2.goals.get('g1')).toMatchObject({ title: '옛 목표' });
  expect(await v2.steps.where('doneAt').above(0).count()).toBe(1);
  expect(await v2.settings.get('enginePref')).toMatchObject({ value: 'rules' });
  expect(await v2.templates.count()).toBe(0);
  v2.close();
});
