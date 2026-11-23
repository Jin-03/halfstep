import { describe, expect, it } from 'vitest';
import type { StepRow } from '../src/db/schema';
import {
  buildTree,
  childrenMap,
  descendantIds,
  isDone,
  leafIds,
  nextAction,
  progress,
  remainingMinutes,
} from '../src/model/tree';

function row(id: string, parentId: string | null, order: number, extra: Partial<StepRow> = {}): StepRow {
  return { id, goalId: 'g', parentId, order, title: id, doneAt: null, source: 'manual', createdAt: 0, ...extra };
}

// A ─ A1 (10분, 완료)
//   └ A2 (20분)
// B (시간 없음)
// C ─ C1 ─ C1a (5분)
const rows: StepRow[] = [
  row('C', null, 3000),
  row('A2', 'A', 2000, { minutes: 20 }),
  row('A', null, 1000),
  row('B', null, 2000),
  row('A1', 'A', 1000, { minutes: 10, doneAt: 111 }),
  row('C1', 'C', 1000),
  row('C1a', 'C1', 1000, { minutes: 5 }),
];

describe('buildTree', () => {
  it('order 순으로 트리를 조립한다', () => {
    const tree = buildTree(rows);
    expect(tree.map((n) => n.id)).toEqual(['A', 'B', 'C']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['A1', 'A2']);
    expect(tree[2].children[0].children[0].id).toBe('C1a');
  });

  it('부모가 없는 행은 최상위로 올린다', () => {
    const tree = buildTree([row('X', 'missing', 1000), row('Y', null, 2000)]);
    expect(tree.map((n) => n.id)).toEqual(['X', 'Y']);
  });

  it('빈 목록이면 빈 트리', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('트리 계산', () => {
  const tree = buildTree(rows);

  it('isDone: 리프는 doneAt, 부모는 자식 전부 완료일 때', () => {
    expect(isDone(tree[0].children[0])).toBe(true);
    expect(isDone(tree[0])).toBe(false);
    const allDone = buildTree([row('P', null, 1000), row('P1', 'P', 1000, { doneAt: 1 })]);
    expect(isDone(allDone[0])).toBe(true);
  });

  it('부모 자신의 doneAt 값은 무시한다', () => {
    const t = buildTree([row('P', null, 1000, { doneAt: 999 }), row('P1', 'P', 1000)]);
    expect(isDone(t[0])).toBe(false);
  });

  it('progress: 리프 기준', () => {
    expect(progress(tree)).toEqual({ done: 1, total: 4, ratio: 0.25 });
    expect(progress([])).toEqual({ done: 0, total: 0, ratio: 0 });
  });

  it('nextAction: 첫 미완료 리프와 경로', () => {
    const next = nextAction(tree);
    expect(next?.node.id).toBe('A2');
    expect(next?.path).toEqual(['A']);
    const deep = nextAction(buildTree(rows.filter((r) => !['A', 'A1', 'A2', 'B'].includes(r.id))));
    expect(deep?.node.id).toBe('C1a');
    expect(deep?.path).toEqual(['C', 'C1']);
  });

  it('nextAction: 모두 완료면 null', () => {
    expect(nextAction(buildTree([row('A', null, 1000, { doneAt: 1 })]))).toBeNull();
  });

  it('remainingMinutes: 미완료 리프의 분 합계와 시간 미입력 수', () => {
    expect(remainingMinutes(tree)).toEqual({ minutes: 25, unknown: 1 });
  });

  it('descendantIds / leafIds', () => {
    const map = childrenMap(rows);
    expect(descendantIds(map, 'C').sort()).toEqual(['C1', 'C1a']);
    expect(leafIds(map, 'A').sort()).toEqual(['A1', 'A2']);
    expect(leafIds(map, 'B')).toEqual(['B']);
  });
});
