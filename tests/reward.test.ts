import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyImport, exportBackup, parseBackup } from '../src/db/backup';
import { claimReward, createGoal, markCelebrated, setClock, setDone, toggleDone, updateGoal } from '../src/db/ops';
import { db, type StepRow } from '../src/db/schema';
import { undoStack } from '../src/model/undo';
import { CELEBRATE_EVENT, celebrateChange, detectCompletion, type CelebrationDetail, type TreeNode } from '../src/reward/celebrate';
import { withCelebration } from '../src/reward/complete';

let now = 1000;
setClock(() => ++now);

// 테스트 환경(node)에는 window가 없으므로 축하 이벤트를 받을 대상만 만든다
let events: CelebrationDetail[] = [];
const target = new EventTarget();
target.addEventListener(CELEBRATE_EVENT, (e) => events.push((e as CustomEvent<CelebrationDetail>).detail));
(globalThis as { window?: unknown }).window = target;

beforeEach(async () => {
  now = 1000;
  events = [];
  undoStack.clear();
  await Promise.all([db.goals.clear(), db.steps.clear(), db.settings.clear()]);
});
afterEach(() => undoStack.clear());

const leaf = (id: string, done = false, minutes?: number): TreeNode => ({ id, title: id, doneAt: done ? 1 : null, minutes });
const branch = (id: string, children: TreeNode[]): TreeNode => ({ id, title: id, doneAt: null, children });

describe('detectCompletion', () => {
  const before = [branch('준비', [leaf('신발'), leaf('물')]), leaf('달리기')];

  it('리프 하나 → step', () => {
    const after = [branch('준비', [leaf('신발', true), leaf('물')]), leaf('달리기')];
    expect(detectCompletion(before, after)).toMatchObject({ level: 'step', stepIds: ['신발'] });
  });

  it('부모가 자동 완료 → branch, 새로 끝난 부모를 알려 준다', () => {
    const mid = [branch('준비', [leaf('신발', true), leaf('물')]), leaf('달리기')];
    const after = [branch('준비', [leaf('신발', true), leaf('물', true)]), leaf('달리기')];
    const hit = detectCompletion(mid, after)!;
    expect(hit.level).toBe('branch');
    expect(hit.parent?.title).toBe('준비');
  });

  it('전부 끝남 → goal', () => {
    const mid = [branch('준비', [leaf('신발', true), leaf('물', true)]), leaf('달리기')];
    const after = [branch('준비', [leaf('신발', true), leaf('물', true)]), leaf('달리기', true)];
    expect(detectCompletion(mid, after)?.level).toBe('goal');
  });

  it('새로 끝난 것이 없으면(해제 포함) null', () => {
    const done = [leaf('달리기', true)];
    expect(detectCompletion(done, done)).toBeNull();
    expect(detectCompletion(done, [leaf('달리기')])).toBeNull();
  });
});

describe('celebrateChange', () => {
  const before = [leaf('a', true), leaf('b')];
  const after = [leaf('a', true, 10), leaf('b', true, 20)];

  it('목표 완료: 단계 수, 시간 합, 보상을 담는다', () => {
    expect(celebrateChange({ id: 'g', title: '목표', reward: '  빵  ' }, before, after)).toBe('goal');
    expect(events[0]).toMatchObject({ level: 'goal', goalId: 'g', stepCount: 2, minutes: 30, reward: '빵' });
  });

  it('이미 축하를 본 목표는 토스트(branch)로 낮춘다', () => {
    expect(celebrateChange({ id: 'g', title: '목표', celebratedAt: 5 }, before, after)).toBe('branch');
    expect(events[0]).toMatchObject({ level: 'branch', stepTitle: '목표' });
  });
});

describe('저장소와 연결', () => {
  async function sample() {
    const id = await createGoal({
      title: '달리기',
      reward: '  좋아하는 빵 사 먹기 ',
      steps: [{ title: '준비', children: [{ title: '신발', minutes: 5 }, { title: '물' }] }, { title: '뛰기', minutes: 30 }],
    });
    const rows = await db.steps.where('goalId').equals(id).toArray();
    const step = (t: string) => rows.find((r: StepRow) => r.title === t)!.id;
    return { id, step };
  }

  it('보상은 다듬어 저장하고, 지우면 비운다', async () => {
    const { id } = await sample();
    expect((await db.goals.get(id))!.reward).toBe('좋아하는 빵 사 먹기');
    await updateGoal(id, { reward: '  ' });
    expect((await db.goals.get(id))!.reward).toBeUndefined();
  });

  it('withCelebration: 체크할 때마다 알맞은 단계로 축하한다', async () => {
    const { id, step } = await sample();
    await withCelebration(id, () => toggleDone(step('신발')));
    await withCelebration(id, () => toggleDone(step('물')));
    await withCelebration(id, () => toggleDone(step('뛰기')));
    expect(events.map((e) => e.level)).toEqual(['step', 'branch', 'goal']);
    expect(events[1].stepTitle).toBe('준비');
    expect(events[2]).toMatchObject({ stepCount: 3, minutes: 35, reward: '좋아하는 빵 사 먹기' });
  });

  it('완료 해제와 감싸지 않은 쓰기(실행 취소 등)는 축하하지 않는다', async () => {
    const { id, step } = await sample();
    await setDone(step('준비'), true);
    await withCelebration(id, () => toggleDone(step('신발')));
    expect(events).toEqual([]);
  });

  it('축하 기록은 updatedAt을 바꾸지 않고, 보상 받기는 축하 본 것도 기록한다', async () => {
    const { id } = await sample();
    const before = (await db.goals.get(id))!.updatedAt;
    await claimReward(id);
    const g = (await db.goals.get(id))!;
    expect(g.rewardClaimedAt).toBeGreaterThan(before);
    expect(g.celebratedAt).toBe(g.rewardClaimedAt);
    expect(g.updatedAt).toBe(before);
    await markCelebrated(id);
    expect((await db.goals.get(id))!.celebratedAt).toBe(g.celebratedAt);
  });

  it('실행 취소로 완료를 되돌려도 축하 기록은 남아, 다시 끝내면 토스트만 뜬다', async () => {
    const { id, step } = await sample();
    await setDone(step('준비'), true);
    await undoStack.record('완료', id, () => withCelebration(id, () => setDone(step('뛰기'), true)));
    expect(events.at(-1)?.level).toBe('goal');
    await markCelebrated(id);

    await undoStack.undo();
    const g = (await db.goals.get(id))!;
    expect(g.celebratedAt).toBeDefined();
    expect(g.reward).toBe('좋아하는 빵 사 먹기');

    await withCelebration(id, () => setDone(step('뛰기'), true));
    expect(events.at(-1)?.level).toBe('branch');
  });

  it('백업 v2는 보상과 축하 기록을 그대로 옮긴다', async () => {
    const { id } = await sample();
    await claimReward(id);
    const saved = (await db.goals.get(id))!;
    const text = JSON.stringify(await exportBackup());
    await Promise.all([db.goals.clear(), db.steps.clear()]);
    await applyImport(parseBackup(text));
    expect(await db.goals.get(id)).toEqual(saved);
  });

  it('예전 형식(v1)에서 온 목표는 축하를 본 것으로 둔다', () => {
    const parsed = parseBackup(JSON.stringify([{ title: '옛 목표', steps: [{ title: '끝난 일', done: true }] }]), 777);
    expect(parsed.goals[0].celebratedAt).toBe(777);
  });
});
