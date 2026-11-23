import { beforeEach, describe, expect, it } from 'vitest';
import { db, type StepRow } from '../src/db/schema';
import {
  addStep,
  addSteps,
  createGoal,
  deleteGoal,
  deleteStep,
  HalfStepError,
  moveStep,
  setClock,
  setDone,
  toggleDone,
  updateGoal,
  updateStep,
} from '../src/db/ops';
import { buildTree, isDone, progress } from '../src/model/tree';

let now = 1000;
setClock(() => ++now);

beforeEach(async () => {
  now = 1000;
  await Promise.all([db.goals.clear(), db.steps.clear(), db.settings.clear()]);
});

const rowsOf = (goalId: string) => db.steps.where('goalId').equals(goalId).toArray();
const byTitle = async (goalId: string, title: string): Promise<StepRow> =>
  (await rowsOf(goalId)).find((r) => r.title === title)!;
const titles = async (goalId: string, parentId: string | null) =>
  buildTreeTitles((await rowsOf(goalId)).filter((r) => r.parentId === parentId));
const buildTreeTitles = (rows: StepRow[]) => rows.sort((a, b) => a.order - b.order).map((r) => r.title);

/** 테스트용 목표: 운동 ─ 준비(신발, 물) / 달리기 */
async function sample() {
  return createGoal({
    title: '  5km 달리기  ',
    note: '',
    origin: { source: 'template' },
    steps: [
      { title: '준비', children: [{ title: '신발', minutes: 5 }, { title: '물', minutes: 2 }] },
      { title: '달리기', minutes: 30 },
    ],
  });
}

/** 불변식 1: 자식이 있는 단계의 doneAt은 null */
async function expectInvariant1(goalId: string) {
  const rows = await rowsOf(goalId);
  const parents = new Set(rows.map((r) => r.parentId));
  for (const r of rows) if (parents.has(r.id)) expect(r.doneAt, `부모 ${r.title}`).toBeNull();
}

describe('목표', () => {
  it('createGoal: 제목을 다듬고 단계 트리를 평평하게 저장한다', async () => {
    const id = await sample();
    const goal = await db.goals.get(id);
    expect(goal?.title).toBe('5km 달리기');
    expect(goal).not.toHaveProperty('note');
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.source === 'template' && r.doneAt === null)).toBe(true);
    expect(await titles(id, null)).toEqual(['준비', '달리기']);
    const prep = await byTitle(id, '준비');
    expect(await titles(id, prep.id)).toEqual(['신발', '물']);
    expect((await byTitle(id, '신발')).minutes).toBe(5);
  });

  it('빈 제목은 거부한다', async () => {
    await expect(createGoal({ title: '   ' })).rejects.toBeInstanceOf(HalfStepError);
    expect(await db.goals.count()).toBe(0);
  });

  it('단계 저장이 실패하면 목표도 만들어지지 않는다 (트랜잭션)', async () => {
    await expect(createGoal({ title: '목표', steps: [{ title: 'ok' }, { title: '' }] })).rejects.toThrow();
    expect(await db.goals.count()).toBe(0);
    expect(await db.steps.count()).toBe(0);
  });

  it('updateGoal: 제목·메모 수정, updatedAt 갱신', async () => {
    const id = await sample();
    const before = (await db.goals.get(id))!.updatedAt;
    await updateGoal(id, { title: '10km 달리기', note: ' 천천히 ' });
    const goal = (await db.goals.get(id))!;
    expect(goal.title).toBe('10km 달리기');
    expect(goal.note).toBe('천천히');
    expect(goal.updatedAt).toBeGreaterThan(before);
  });

  it('deleteGoal: 목표와 그 단계 전체 삭제, 다른 목표는 유지 (불변식 5)', async () => {
    const a = await sample();
    const b = await createGoal({ title: '다른 목표', steps: [{ title: 'x' }] });
    await deleteGoal(a);
    expect(await db.goals.get(a)).toBeUndefined();
    expect(await rowsOf(a)).toHaveLength(0);
    expect(await rowsOf(b)).toHaveLength(1);
  });
});

describe('단계 추가', () => {
  it('끝에 추가하면 order = 형제 최대값 + 1000', async () => {
    const id = await sample();
    await addStep(id, null, { title: '스트레칭' });
    expect(await titles(id, null)).toEqual(['준비', '달리기', '스트레칭']);
    const orders = (await rowsOf(id)).filter((r) => r.parentId === null).map((r) => r.order).sort((a, b) => a - b);
    expect(orders).toEqual([1000, 2000, 3000]);
  });

  it('리프에 자식이 생기면 그 단계의 doneAt → null (불변식 2)', async () => {
    const id = await sample();
    const run = await byTitle(id, '달리기');
    await setDone(run.id, true);
    expect((await db.steps.get(run.id))!.doneAt).not.toBeNull();
    await addSteps(id, run.id, [{ title: '1km', minutes: 6 }, { title: '2km', minutes: 6 }], { source: 'rules' });
    expect((await db.steps.get(run.id))!.doneAt).toBeNull();
    await expectInvariant1(id);
  });

  it('쪼갠 단계의 minutes가 보존된다 (알려진 문제 해결)', async () => {
    const id = await sample();
    const run = await byTitle(id, '달리기');
    await addSteps(id, run.id, [{ title: '1km', minutes: 6 }, { title: '나머지', minutes: 24 }], { source: 'rules' });
    expect((await byTitle(id, '1km')).minutes).toBe(6);
    expect((await byTitle(id, '나머지')).minutes).toBe(24);
    expect((await byTitle(id, '나머지')).source).toBe('rules');
  });

  it('다른 목표의 단계 아래에는 추가할 수 없다', async () => {
    const a = await sample();
    const b = await createGoal({ title: 'B' });
    const run = await byTitle(a, '달리기');
    await expect(addStep(b, run.id, { title: 'x' })).rejects.toBeInstanceOf(HalfStepError);
  });

  it('잘못된 minutes(0, 음수, NaN)는 저장하지 않는다', async () => {
    const id = await createGoal({ title: 'g', steps: [{ title: 'a', minutes: 0 }, { title: 'b', minutes: NaN }, { title: 'c', minutes: 2.6 }] });
    expect((await byTitle(id, 'a')).minutes).toBeUndefined();
    expect((await byTitle(id, 'b')).minutes).toBeUndefined();
    expect((await byTitle(id, 'c')).minutes).toBe(3);
  });
});

describe('완료 처리', () => {
  it('리프 체크/해제', async () => {
    const id = await sample();
    const shoe = await byTitle(id, '신발');
    await setDone(shoe.id, true);
    expect((await db.steps.get(shoe.id))!.doneAt).toBeGreaterThan(1000);
    await setDone(shoe.id, false);
    expect((await db.steps.get(shoe.id))!.doneAt).toBeNull();
  });

  it('부모 체크 = 하위 리프 일괄 설정, 부모 doneAt은 null 유지 (불변식 1, 4)', async () => {
    const id = await sample();
    const prep = await byTitle(id, '준비');
    await setDone(prep.id, true);
    expect((await byTitle(id, '신발')).doneAt).not.toBeNull();
    expect((await byTitle(id, '물')).doneAt).not.toBeNull();
    expect((await db.steps.get(prep.id))!.doneAt).toBeNull();
    const tree = buildTree(await rowsOf(id));
    expect(isDone(tree[0])).toBe(true);
    expect(progress(tree)).toEqual({ done: 2, total: 3, ratio: 2 / 3 });
    await expectInvariant1(id);
  });

  it('부모 체크 시 이미 완료된 리프의 완료 시각은 보존한다', async () => {
    const id = await sample();
    const shoe = await byTitle(id, '신발');
    await setDone(shoe.id, true);
    const first = (await db.steps.get(shoe.id))!.doneAt;
    await setDone((await byTitle(id, '준비')).id, true);
    expect((await db.steps.get(shoe.id))!.doneAt).toBe(first);
  });

  it('toggleDone: 일부만 완료된 부모는 전체 완료로, 다시 누르면 전체 해제', async () => {
    const id = await sample();
    const prep = await byTitle(id, '준비');
    await setDone((await byTitle(id, '신발')).id, true);
    expect(await toggleDone(prep.id)).toBe(true);
    expect((await byTitle(id, '물')).doneAt).not.toBeNull();
    expect(await toggleDone(prep.id)).toBe(false);
    expect((await byTitle(id, '신발')).doneAt).toBeNull();
    expect((await byTitle(id, '물')).doneAt).toBeNull();
  });

  it('완료된 리프만 doneAt 인덱스로 조회된다', async () => {
    const id = await sample();
    await setDone((await byTitle(id, '물')).id, true);
    const done = await db.steps.where('doneAt').above(0).toArray();
    expect(done.map((r) => r.title)).toEqual(['물']);
  });
});

describe('이동', () => {
  it('위/아래 이동은 order 교환, 끝에서는 false', async () => {
    const id = await sample();
    const run = await byTitle(id, '달리기');
    expect(await moveStep(run.id, 'down')).toBe(false);
    expect(await moveStep(run.id, 'up')).toBe(true);
    expect(await titles(id, null)).toEqual(['달리기', '준비']);
    expect(await moveStep(run.id, 'up')).toBe(false);
  });

  it('하위 단계는 같은 부모 안에서만 움직인다', async () => {
    const id = await sample();
    const water = await byTitle(id, '물');
    await moveStep(water.id, 'up');
    expect(await titles(id, water.parentId)).toEqual(['물', '신발']);
    expect(await titles(id, null)).toEqual(['준비', '달리기']);
  });
});

describe('삭제', () => {
  it('하위 전체 연쇄 삭제 (불변식 5)', async () => {
    const id = await sample();
    await deleteStep((await byTitle(id, '준비')).id);
    expect((await rowsOf(id)).map((r) => r.title)).toEqual(['달리기']);
  });

  it('마지막 자식을 지우면 부모의 예전 완료값이 되살아나지 않는다 (불변식 3, 알려진 문제 해결)', async () => {
    const id = await sample();
    const run = await byTitle(id, '달리기');
    await setDone(run.id, true); // 리프일 때 완료
    const [child] = await addSteps(id, run.id, [{ title: '1km' }]); // 불변식 2로 doneAt → null
    await setDone(child, true);
    await deleteStep(child);
    const after = (await db.steps.get(run.id))!;
    expect(after.doneAt).toBeNull();
    expect(isDone(buildTree(await rowsOf(id)).find((n) => n.id === run.id)!)).toBe(false);
  });

  it('형제가 남아 있으면 부모는 그대로', async () => {
    const id = await sample();
    await deleteStep((await byTitle(id, '신발')).id);
    expect(await rowsOf(id)).toHaveLength(3);
    await expectInvariant1(id);
  });
});

describe('수정과 updatedAt', () => {
  it('updateStep: 제목·시간 수정, minutes null이면 제거', async () => {
    const id = await sample();
    const run = await byTitle(id, '달리기');
    await updateStep(run.id, { title: '조깅', minutes: null });
    const r = (await db.steps.get(run.id))!;
    expect(r.title).toBe('조깅');
    expect(r).not.toHaveProperty('minutes');
  });

  it('쓰기마다 목표 updatedAt이 갱신되지만 접기는 갱신하지 않는다', async () => {
    const id = await sample();
    const run = await byTitle(id, '달리기');
    const t0 = (await db.goals.get(id))!.updatedAt;
    await updateStep(run.id, { collapsed: true });
    expect((await db.goals.get(id))!.updatedAt).toBe(t0);
    expect((await db.steps.get(run.id))!.collapsed).toBe(true);
    await setDone(run.id, true);
    const t1 = (await db.goals.get(id))!.updatedAt;
    expect(t1).toBeGreaterThan(t0);
    await deleteStep(run.id);
    expect((await db.goals.get(id))!.updatedAt).toBeGreaterThan(t1);
  });

  it('없는 단계에 대한 작업은 HalfStepError', async () => {
    await expect(setDone('nope', true)).rejects.toBeInstanceOf(HalfStepError);
    await expect(deleteStep('nope')).rejects.toBeInstanceOf(HalfStepError);
  });
});
