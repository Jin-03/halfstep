/**
 * 모든 쓰기는 이 파일의 함수로만 한다. 각 함수는 한 트랜잭션 안에서
 * db-design.md의 불변식 1~6을 지키고 goals.updatedAt을 갱신한다.
 */
import { db, newId, ORDER_GAP, type Goal, type StepRow, type StepOrigin } from './schema';
import { childrenMap, descendantIds, leafIds } from '../model/tree';

const MANUAL: StepOrigin = { source: 'manual' };

/** 새로 만들 단계(하위 단계 포함 가능) */
export interface StepDraft {
  title: string;
  minutes?: number;
  children?: StepDraft[];
}

export class HalfStepError extends Error {}

let clock: () => number = () => Date.now();
/** 테스트용: 현재 시각 함수를 바꾼다 */
export function setClock(fn: () => number): void {
  clock = fn;
}

function rw<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', db.goals, db.steps, fn);
}

async function requireGoal(goalId: string): Promise<Goal> {
  const goal = await db.goals.get(goalId);
  if (!goal) throw new HalfStepError('목표를 찾을 수 없어요. 이미 삭제되었을 수 있어요.');
  return goal;
}

async function requireStep(stepId: string): Promise<StepRow> {
  const step = await db.steps.get(stepId);
  if (!step) throw new HalfStepError('단계를 찾을 수 없어요. 이미 삭제되었을 수 있어요.');
  return step;
}

function goalRows(goalId: string): Promise<StepRow[]> {
  return db.steps.where('goalId').equals(goalId).toArray();
}

async function touch(goalId: string, t: number): Promise<void> {
  await db.goals.update(goalId, { updatedAt: t });
}

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new HalfStepError('제목을 입력해 주세요.');
  return t;
}

function cleanMinutes(m: number | undefined): number | undefined {
  if (m === undefined || !Number.isFinite(m) || m <= 0) return undefined;
  return Math.round(m);
}

/** 초안 트리를 평평한 행으로 바꾼다. 쪼갠 단계의 minutes도 그대로 보존한다. */
function flatten(
  goalId: string,
  parentId: string | null,
  drafts: readonly StepDraft[],
  origin: StepOrigin,
  firstOrder: number,
  t: number,
  out: StepRow[],
): string[] {
  return drafts.map((d, i) => {
    const id = newId();
    const minutes = cleanMinutes(d.minutes);
    out.push({
      id,
      goalId,
      parentId,
      order: firstOrder + i * ORDER_GAP,
      title: cleanTitle(d.title),
      ...(minutes !== undefined ? { minutes } : {}),
      doneAt: null,
      source: origin.source,
      ...(origin.engine ? { engine: origin.engine } : {}),
      createdAt: t,
    });
    if (d.children?.length) flatten(goalId, id, d.children, origin, ORDER_GAP, t, out);
    return id;
  });
}

// ───────────── 목표 ─────────────

export function createGoal(input: {
  title: string;
  note?: string;
  reward?: string;
  steps?: StepDraft[];
  origin?: StepOrigin;
}): Promise<string> {
  return rw(async () => {
    const t = clock();
    const id = newId();
    const note = input.note?.trim();
    const reward = input.reward?.trim();
    await db.goals.add({
      id,
      title: cleanTitle(input.title),
      ...(note ? { note } : {}),
      ...(reward ? { reward } : {}),
      createdAt: t,
      updatedAt: t,
    });
    const rows: StepRow[] = [];
    flatten(id, null, input.steps ?? [], input.origin ?? MANUAL, ORDER_GAP, t, rows);
    await db.steps.bulkAdd(rows);
    return id;
  });
}

export function updateGoal(goalId: string, patch: { title?: string; note?: string; reward?: string }): Promise<void> {
  return rw(async () => {
    await requireGoal(goalId);
    const changes: Partial<Goal> = { updatedAt: clock() };
    if (patch.title !== undefined) changes.title = cleanTitle(patch.title);
    if (patch.note !== undefined) changes.note = patch.note.trim() || undefined;
    if (patch.reward !== undefined) changes.reward = patch.reward.trim() || undefined;
    await db.goals.update(goalId, changes);
  });
}

// 축하 기록은 화면 상태에 가까우므로 updatedAt을 바꾸지 않고, 실행 취소로도 지워지지 않는다(model/undo).

/** 목표 완료 축하 창을 닫았을 때. 이미 값이 있으면 그대로 둔다 */
export function markCelebrated(goalId: string): Promise<void> {
  return rw(async () => {
    const goal = await requireGoal(goalId);
    if (!goal.celebratedAt) await db.goals.update(goalId, { celebratedAt: clock() });
  });
}

/** "보상 받기"를 눌렀을 때. 축하를 본 것으로도 기록한다 */
export function claimReward(goalId: string): Promise<void> {
  return rw(async () => {
    const goal = await requireGoal(goalId);
    const t = clock();
    await db.goals.update(goalId, {
      rewardClaimedAt: goal.rewardClaimedAt ?? t,
      celebratedAt: goal.celebratedAt ?? t,
    });
  });
}

/** 불변식 5: 목표 삭제 = 그 목표의 단계 전체 삭제 */
export function deleteGoal(goalId: string): Promise<void> {
  return rw(async () => {
    await db.steps.where('goalId').equals(goalId).delete();
    await db.goals.delete(goalId);
  });
}

// ───────────── 단계 추가 ─────────────

/**
 * parentId 아래(또는 최상위)에 단계 여러 개를 끝에 추가한다.
 * 쪼개기, 단계 더 제안, 하위 추가가 모두 이 함수를 쓴다.
 * 불변식 2: 리프였던 부모에 자식이 생기면 부모의 doneAt → null.
 * @returns 새로 추가된 최상위 초안들의 id
 */
export function addSteps(
  goalId: string,
  parentId: string | null,
  drafts: readonly StepDraft[],
  origin: StepOrigin = MANUAL,
): Promise<string[]> {
  return rw(async () => {
    await requireGoal(goalId);
    if (drafts.length === 0) return [];
    const t = clock();
    if (parentId !== null) {
      const parent = await requireStep(parentId);
      if (parent.goalId !== goalId) throw new HalfStepError('다른 목표의 단계 아래에는 추가할 수 없어요.');
      if (parent.doneAt !== null) await db.steps.update(parentId, { doneAt: null });
    }
    const siblings = (await goalRows(goalId)).filter((r) => r.parentId === parentId);
    const maxOrder = siblings.reduce((m, r) => Math.max(m, r.order), 0);
    const rows: StepRow[] = [];
    const ids = flatten(goalId, parentId, drafts, origin, maxOrder + ORDER_GAP, t, rows);
    await db.steps.bulkAdd(rows);
    await touch(goalId, t);
    return ids;
  });
}

export async function addStep(
  goalId: string,
  parentId: string | null,
  draft: StepDraft,
  origin: StepOrigin = MANUAL,
): Promise<string> {
  const [id] = await addSteps(goalId, parentId, [draft], origin);
  return id;
}

// ───────────── 단계 수정 ─────────────

export function updateStep(
  stepId: string,
  patch: { title?: string; minutes?: number | null; collapsed?: boolean },
): Promise<void> {
  return rw(async () => {
    const step = await requireStep(stepId);
    const changes: Partial<StepRow> = {};
    if (patch.title !== undefined) changes.title = cleanTitle(patch.title);
    if (patch.minutes !== undefined) changes.minutes = cleanMinutes(patch.minutes ?? undefined);
    if (patch.collapsed !== undefined) changes.collapsed = patch.collapsed || undefined;
    await db.steps.update(stepId, changes);
    // 접기는 UI 상태라서 목표의 수정 시각을 바꾸지 않는다.
    if (patch.title !== undefined || patch.minutes !== undefined) await touch(step.goalId, clock());
  });
}

/**
 * 완료 상태 설정.
 * - 리프: doneAt = now 또는 null
 * - 부모(불변식 4): 하위 모든 리프를 일괄 설정. 이미 완료된 리프의 완료 시각은 그대로 둔다.
 */
export function setDone(stepId: string, done: boolean): Promise<void> {
  return rw(async () => {
    const step = await requireStep(stepId);
    const t = clock();
    const rows = await goalRows(step.goalId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const updates = leafIds(childrenMap(rows), stepId)
      .filter((id) => (byId.get(id)!.doneAt !== null) !== done)
      .map((key) => ({ key, changes: { doneAt: done ? t : null } }));
    if (updates.length) await db.steps.bulkUpdate(updates);
    await touch(step.goalId, t);
  });
}

/** 현재 완료 여부(리프 기준 계산)를 뒤집는다. @returns 바뀐 뒤의 완료 여부 */
export function toggleDone(stepId: string): Promise<boolean> {
  return rw(async () => {
    const step = await requireStep(stepId);
    const rows = await goalRows(step.goalId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const allDone = leafIds(childrenMap(rows), stepId).every((id) => byId.get(id)!.doneAt !== null);
    await setDone(stepId, !allDone);
    return !allDone;
  });
}

/** 같은 부모 안에서 한 칸 위/아래로. 이동 = order 값 교환. @returns 이동했으면 true */
export function moveStep(stepId: string, direction: 'up' | 'down'): Promise<boolean> {
  return rw(async () => {
    const step = await requireStep(stepId);
    const siblings = childrenMap(await goalRows(step.goalId)).get(step.parentId)!;
    const i = siblings.findIndex((s) => s.id === stepId);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return false;
    const other = siblings[j];
    await db.steps.bulkUpdate([
      { key: step.id, changes: { order: other.order } },
      { key: other.id, changes: { order: step.order } },
    ]);
    await touch(step.goalId, clock());
    return true;
  });
}

/**
 * 단계 삭제(불변식 5: 하위 전체 연쇄 삭제).
 * 불변식 3: 마지막 자식이 지워져 부모가 리프로 돌아가면 부모 doneAt = null.
 */
export function deleteStep(stepId: string): Promise<void> {
  return rw(async () => {
    const step = await requireStep(stepId);
    const rows = await goalRows(step.goalId);
    const map = childrenMap(rows);
    await db.steps.bulkDelete([stepId, ...descendantIds(map, stepId)]);
    if (step.parentId !== null) {
      const remaining = (map.get(step.parentId) ?? []).filter((r) => r.id !== stepId);
      if (remaining.length === 0) await db.steps.update(step.parentId, { doneAt: null });
    }
    await touch(step.goalId, clock());
  });
}

/**
 * 들여쓰기: 바로 위 형제의 마지막 자식이 된다.
 * 불변식 2: 위 형제가 리프였다면 그 doneAt → null. 옮긴 단계가 보이도록 새 부모를 펼친다.
 * @returns 위 형제가 없어 옮기지 못하면 false
 */
export function indentStep(stepId: string): Promise<boolean> {
  return rw(async () => {
    const step = await requireStep(stepId);
    const map = childrenMap(await goalRows(step.goalId));
    const siblings = map.get(step.parentId)!;
    const i = siblings.findIndex((s) => s.id === stepId);
    if (i <= 0) return false;
    const newParent = siblings[i - 1];
    const kids = map.get(newParent.id) ?? [];
    const maxOrder = kids.reduce((m, r) => Math.max(m, r.order), 0);
    await db.steps.update(stepId, { parentId: newParent.id, order: maxOrder + ORDER_GAP });
    await db.steps.update(newParent.id, { doneAt: null, collapsed: undefined });
    await touch(step.goalId, clock());
    return true;
  });
}

/**
 * 내어쓰기: 부모 바로 다음 자리(부모의 형제)로 올라간다.
 * 불변식 3: 부모가 마지막 자식을 잃으면 부모 doneAt = null.
 * @returns 이미 최상위라 옮기지 못하면 false
 */
export function outdentStep(stepId: string): Promise<boolean> {
  return rw(async () => {
    const step = await requireStep(stepId);
    if (step.parentId === null) return false;
    const map = childrenMap(await goalRows(step.goalId));
    const parent = (await db.steps.get(step.parentId))!;
    const uncles = map.get(parent.parentId)!;
    const after = uncles[uncles.findIndex((s) => s.id === parent.id) + 1];
    const order = after ? (parent.order + after.order) / 2 : parent.order + ORDER_GAP;
    await db.steps.update(stepId, { parentId: parent.parentId, order });
    if ((map.get(parent.id) ?? []).length === 1) await db.steps.update(parent.id, { doneAt: null });
    await touch(step.goalId, clock());
    return true;
  });
}
