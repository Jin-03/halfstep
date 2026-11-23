import { beforeEach, describe, expect, it } from 'vitest';
import { db, type StepRow } from '../src/db/schema';
import { addSteps, createGoal, deleteGoal, deleteStep, setDone, updateStep } from '../src/db/ops';
import { UNDO_LIMIT, UndoStack } from '../src/model/undo';

beforeEach(async () => {
  await Promise.all([db.goals.clear(), db.steps.clear()]);
});

const rowsOf = (goalId: string) => db.steps.where('goalId').equals(goalId).toArray();
const get = async (goalId: string, title: string): Promise<StepRow> => (await rowsOf(goalId)).find((r) => r.title === title)!;
const kids = async (goalId: string, parentId: string | null) =>
  (await rowsOf(goalId)).filter((r) => r.parentId === parentId).sort((a, b) => a.order - b.order).map((r) => r.title);

const sample = () => createGoal({ title: 'g', steps: [{ title: 'A' }, { title: 'B', minutes: 5 }, { title: 'C', children: [{ title: 'C1' }, { title: 'C2' }] }, { title: 'D' }] });

describe('실행 취소', () => {
  it('쓰기를 되돌리면 목표와 단계가 그 전 상태로 복원된다', async () => {
    const undo = new UndoStack();
    const id = await sample();
    const before = await rowsOf(id);
    const goalBefore = await db.goals.get(id);
    await undo.record('삭제', id, () => deleteStep(before.find((r) => r.title === 'C')!.id));
    expect(await rowsOf(id)).toHaveLength(3);
    const r = await undo.undo();
    expect(r?.label).toBe('삭제');
    expect((await rowsOf(id)).sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    expect(await db.goals.get(id)).toEqual(goalBefore);
  });

  it('목표 삭제를 되돌리면 목표가 다시 생긴다', async () => {
    const undo = new UndoStack();
    const id = await sample();
    await undo.record('목표 삭제', id, () => deleteGoal(id));
    expect(await db.goals.get(id)).toBeUndefined();
    await undo.undo();
    expect((await db.goals.get(id))?.title).toBe('g');
    expect(await rowsOf(id)).toHaveLength(6);
  });

  it('새 목표 만들기를 되돌리면 목표가 사라진다', async () => {
    const undo = new UndoStack();
    const id = await undo.recordCreate('목표 만들기', () => createGoal({ title: 'new', steps: [{ title: 'x' }] }));
    const r = await undo.undo();
    expect(r?.goalExists).toBe(false);
    expect(await db.goals.get(id)).toBeUndefined();
    expect(await rowsOf(id)).toHaveLength(0);
  });

  it('여러 번 되돌리면 순서대로 복원된다', async () => {
    const undo = new UndoStack();
    const id = await sample();
    await undo.record('추가', id, () => addSteps(id, null, [{ title: 'E' }]));
    const d = (await get(id, 'D')).id;
    await undo.record('완료', id, () => setDone(d, true));
    expect(undo.size).toBe(2);
    await undo.undo();
    await undo.undo();
    expect(await kids(id, null)).toEqual(['A', 'B', 'C', 'D']);
    expect((await get(id, 'D')).doneAt).toBeNull();
    expect(await undo.undo()).toBeNull();
  });

  it('실패한 쓰기는 스택에 쌓이지 않는다', async () => {
    const undo = new UndoStack();
    const id = await sample();
    await expect(undo.record('x', id, () => setDone('nope', true))).rejects.toThrow();
    expect(undo.size).toBe(0);
  });

  it(`최대 ${UNDO_LIMIT}개까지만 보관한다`, async () => {
    const undo = new UndoStack();
    const id = await sample();
    const a = (await get(id, 'A')).id;
    for (let i = 0; i < UNDO_LIMIT + 5; i++) await undo.record(`이름 ${i}`, id, () => updateStep(a, { title: `A${i}` }));
    expect(undo.size).toBe(UNDO_LIMIT);
    expect(undo.peekLabel()).toBe(`이름 ${UNDO_LIMIT + 4}`);
  });

  it('구독자에게 변경을 알린다', async () => {
    const undo = new UndoStack();
    let calls = 0;
    undo.subscribe(() => calls++);
    const id = await sample();
    const a = (await get(id, 'A')).id;
    await undo.record('x', id, () => updateStep(a, { title: 'A!' }));
    await undo.undo();
    expect(calls).toBe(2);
  });
});

describe('다시 실행', () => {
  it('되돌린 작업을 다시 하고, 새 작업을 하면 다시 실행 목록이 비워진다', async () => {
    const u = new UndoStack();
    const g = await u.recordCreate('만들기', sample);
    await u.record('삭제', g, async () => deleteStep((await get(g, 'A')).id));
    await u.undo();
    expect(u.peekRedoLabel()).toBe('삭제');
    expect(await get(g, 'A')).toBeDefined();
    await u.redo();
    expect(await get(g, 'A')).toBeUndefined();
    expect(u.peekLabel()).toBe('삭제');

    // 만들기까지 되돌렸다가 다시 하면 목표와 단계가 그대로 돌아온다
    await u.undo();
    await u.undo();
    expect(await db.goals.get(g)).toBeUndefined();
    await u.redo();
    expect((await rowsOf(g)).length).toBe(6);

    await u.record('수정', g, async () => updateStep((await get(g, 'B')).id, { title: 'x' }));
    expect(u.peekRedoLabel()).toBeNull();
  });
});
