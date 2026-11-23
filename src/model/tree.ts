import type { StepRow } from '../db/schema';

export interface StepNode extends StepRow {
  children: StepNode[];
}

/** parentId → 자식 행 목록 (order 순) */
export function childrenMap(rows: readonly StepRow[]): Map<string | null, StepRow[]> {
  const map = new Map<string | null, StepRow[]>();
  for (const row of rows) {
    const list = map.get(row.parentId);
    if (list) list.push(row);
    else map.set(row.parentId, [row]);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

/** id 아래의 모든 자손 id (자기 자신 제외) */
export function descendantIds(map: Map<string | null, StepRow[]>, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of map.get(cur) ?? []) {
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** id 아래의 모든 리프 id (id 자신이 리프면 [id]) */
export function leafIds(map: Map<string | null, StepRow[]>, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const kids = map.get(cur);
    if (!kids || kids.length === 0) out.push(cur);
    else for (const k of kids) stack.push(k.id);
  }
  return out;
}

/**
 * 평평한 행 → 트리. 부모를 찾을 수 없는 행은 최상위로 올려 데이터가 사라지지 않게 한다.
 * 한 목표의 행만 넘기는 것을 전제로 한다.
 */
export function buildTree(rows: readonly StepRow[]): StepNode[] {
  const ids = new Set(rows.map((r) => r.id));
  const normalized = rows.map((r) =>
    r.parentId !== null && !ids.has(r.parentId) ? { ...r, parentId: null } : r,
  );
  const map = childrenMap(normalized);
  const build = (parentId: string | null): StepNode[] =>
    (map.get(parentId) ?? []).map((row) => ({ ...row, children: build(row.id) }));
  return build(null);
}

export function isLeaf(node: StepNode): boolean {
  return node.children.length === 0;
}

/** 리프는 doneAt으로, 부모는 모든 자식이 완료일 때 완료 */
export function isDone(node: StepNode): boolean {
  if (isLeaf(node)) return node.doneAt !== null;
  return node.children.every(isDone);
}

function* leaves(nodes: readonly StepNode[]): Generator<StepNode> {
  for (const n of nodes) {
    if (isLeaf(n)) yield n;
    else yield* leaves(n.children);
  }
}

export interface Progress {
  done: number;
  total: number;
  /** 0~1, 단계가 없으면 0 */
  ratio: number;
}

/** 리프 개수 기준 진행률 */
export function progress(nodes: readonly StepNode[]): Progress {
  let done = 0;
  let total = 0;
  for (const leaf of leaves(nodes)) {
    total++;
    if (leaf.doneAt !== null) done++;
  }
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

export interface NextAction {
  node: StepNode;
  /** 최상위부터 부모까지의 제목 */
  path: string[];
}

/** 순서상 가장 먼저 나오는 미완료 리프 */
export function nextAction(nodes: readonly StepNode[], path: string[] = []): NextAction | null {
  for (const n of nodes) {
    if (isLeaf(n)) {
      if (n.doneAt === null) return { node: n, path };
    } else {
      const found = nextAction(n.children, [...path, n.title]);
      if (found) return found;
    }
  }
  return null;
}

export interface Remaining {
  /** 시간이 입력된 미완료 리프의 분 합계 */
  minutes: number;
  /** 시간이 입력되지 않은 미완료 리프 수 */
  unknown: number;
}

export function remainingMinutes(nodes: readonly StepNode[]): Remaining {
  let minutes = 0;
  let unknown = 0;
  for (const leaf of leaves(nodes)) {
    if (leaf.doneAt !== null) continue;
    if (typeof leaf.minutes === 'number') minutes += leaf.minutes;
    else unknown++;
  }
  return { minutes, unknown };
}
