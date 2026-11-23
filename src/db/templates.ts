/** 내 템플릿 저장. 목표 실행 취소와는 따로 관리한다 */
import { useLiveQuery } from 'dexie-react-hooks';
import { buildTree, type StepNode } from '../model/tree';
import { HalfStepError, type StepDraft } from './ops';
import { db, newId, type UserTemplate } from './schema';

export interface TemplateInput {
  title: string;
  summary?: string;
  keywords?: string[];
  steps: StepDraft[];
}

function clean(input: TemplateInput) {
  const title = input.title.trim();
  if (!title) throw new HalfStepError('템플릿 이름을 입력해 주세요.');
  if (input.steps.length === 0) throw new HalfStepError('단계를 하나 이상 적어 주세요.');
  const summary = input.summary?.trim();
  const keywords = [...new Set((input.keywords ?? []).map((k) => k.trim()).filter(Boolean))];
  return { title, ...(summary ? { summary } : {}), keywords, steps: structuredClone(input.steps) };
}

export async function createTemplate(input: TemplateInput, now = Date.now()): Promise<string> {
  const id = newId();
  await db.templates.add({ id, ...clean(input), createdAt: now, updatedAt: now });
  return id;
}

export async function updateTemplate(id: string, input: TemplateInput, now = Date.now()): Promise<void> {
  const old = await db.templates.get(id);
  if (!old) throw new HalfStepError('템플릿을 찾을 수 없어요.');
  // summary를 비웠으면 지운다
  await db.templates.put({ id, ...clean(input), createdAt: old.createdAt, updatedAt: now });
}

export async function deleteTemplate(id: string): Promise<UserTemplate | undefined> {
  const old = await db.templates.get(id);
  await db.templates.delete(id);
  return old;
}

/** 지운 템플릿 되살리기 */
export async function restoreTemplate(t: UserTemplate): Promise<void> {
  await db.templates.put(t);
}

export function listUserTemplates(): Promise<UserTemplate[]> {
  return db.templates.orderBy('updatedAt').reverse().toArray();
}

export function useUserTemplates(): UserTemplate[] | undefined {
  return useLiveQuery(listUserTemplates, []);
}

/** 단계 트리 → 템플릿용 초안 (완료 여부 등은 버림) */
export function nodesToDrafts(nodes: readonly StepNode[]): StepDraft[] {
  return nodes.map((n) => {
    const d: StepDraft = { title: n.title };
    if (n.children.length) d.children = nodesToDrafts(n.children);
    else if (n.minutes) d.minutes = n.minutes;
    return d;
  });
}

/** 지금 목표의 단계 구조로 템플릿을 만든다 */
export async function templateFromGoal(goalId: string): Promise<string> {
  const goal = await db.goals.get(goalId);
  if (!goal) throw new HalfStepError('목표를 찾을 수 없어요.');
  const tree = buildTree(await db.steps.where('goalId').equals(goalId).toArray());
  return createTemplate({ title: goal.title, steps: nodesToDrafts(tree), keywords: [] });
}
