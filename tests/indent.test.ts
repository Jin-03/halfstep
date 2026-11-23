import { beforeEach, describe, expect, it } from 'vitest';
import { db, type StepRow } from '../src/db/schema';
import { createGoal, deleteStep, indentStep, outdentStep, setDone, updateStep } from '../src/db/ops';

beforeEach(async () => {
  await Promise.all([db.goals.clear(), db.steps.clear()]);
});

const rowsOf = (goalId: string) => db.steps.where('goalId').equals(goalId).toArray();
const get = async (goalId: string, title: string): Promise<StepRow> => (await rowsOf(goalId)).find((r) => r.title === title)!;
const kids = async (goalId: string, parentId: string | null) =>
  (await rowsOf(goalId)).filter((r) => r.parentId === parentId).sort((a, b) => a.order - b.order).map((r) => r.title);

const sample = () => createGoal({ title: 'g', steps: [{ title: 'A' }, { title: 'B', minutes: 5 }, { title: 'C', children: [{ title: 'C1' }, { title: 'C2' }] }, { title: 'D' }] });

describe('들여쓰기', () => {
  it('바로 위 형제의 마지막 자식이 된다', async () => {
    const id = await sample();
    expect(await indentStep((await get(id, 'D')).id)).toBe(true);
    expect(await kids(id, null)).toEqual(['A', 'B', 'C']);
    expect(await kids(id, (await get(id, 'C')).id)).toEqual(['C1', 'C2', 'D']);
  });

  it('첫 형제는 들여쓸 수 없다', async () => {
    const id = await sample();
    expect(await indentStep((await get(id, 'A')).id)).toBe(false);
    expect(await indentStep((await get(id, 'C1')).id)).toBe(false);
  });

  it('완료된 리프 아래로 들어가면 그 리프의 doneAt → null (불변식 2)', async () => {
    const id = await sample();
    await setDone((await get(id, 'A')).id, true);
    await indentStep((await get(id, 'B')).id);
    expect((await get(id, 'A')).doneAt).toBeNull();
    expect((await get(id, 'B')).minutes).toBe(5);
  });

  it('접혀 있던 새 부모는 펼쳐진다', async () => {
    const id = await sample();
    await updateStep((await get(id, 'C')).id, { collapsed: true });
    await indentStep((await get(id, 'D')).id);
    expect((await get(id, 'C')).collapsed).toBeUndefined();
  });
});

describe('내어쓰기', () => {
  it('부모 바로 다음 자리로 올라간다', async () => {
    const id = await sample();
    expect(await outdentStep((await get(id, 'C1')).id)).toBe(true);
    expect(await kids(id, null)).toEqual(['A', 'B', 'C', 'C1', 'D']);
    expect(await kids(id, (await get(id, 'C')).id)).toEqual(['C2']);
  });

  it('마지막 형제 뒤로 올라갈 때도 순서가 맞다', async () => {
    const id = await sample();
    const d = await get(id, 'D');
    await deleteStep(d.id);
    await outdentStep((await get(id, 'C2')).id);
    expect(await kids(id, null)).toEqual(['A', 'B', 'C', 'C2']);
  });

  it('최상위는 내어쓸 수 없다', async () => {
    const id = await sample();
    expect(await outdentStep((await get(id, 'A')).id)).toBe(false);
  });

  it('부모가 마지막 자식을 잃으면 리프로 돌아가고 doneAt = null (불변식 3)', async () => {
    const id = await sample();
    const c = await get(id, 'C');
    await outdentStep((await get(id, 'C1')).id);
    await setDone((await get(id, 'C2')).id, true);
    await outdentStep((await get(id, 'C2')).id);
    expect((await get(id, 'C')).doneAt).toBeNull();
    expect(await kids(id, c.id)).toEqual([]);
    expect(await kids(id, null)).toEqual(['A', 'B', 'C', 'C2', 'C1', 'D']);
  });

  it('들여쓰기 후 내어쓰기하면 원래 순서로 돌아온다', async () => {
    const id = await sample();
    const b = await get(id, 'B');
    await indentStep(b.id);
    await outdentStep(b.id);
    expect(await kids(id, null)).toEqual(['A', 'B', 'C', 'D']);
  });
});
