import { beforeEach, describe, expect, it } from 'vitest';
import { decomposeByRules, matchTemplate, rulesEngine } from '../src/ai/rules';
import { createGoal, setDone } from '../src/db/ops';
import { db } from '../src/db/schema';
import { createTemplate, deleteTemplate, listUserTemplates, restoreTemplate, templateFromGoal, updateTemplate } from '../src/db/templates';
import { TEMPLATES } from '../src/model/templates';

beforeEach(async () => {
  await Promise.all([db.goals.clear(), db.steps.clear(), db.templates.clear()]);
});

describe('내 템플릿', () => {
  it('만들기·고치기·삭제·되살리기', async () => {
    const id = await createTemplate({ title: '  주간 보고서 ', summary: ' ', keywords: [' 보고서', '주간', '', '보고서'], steps: [{ title: '자료 모으기', minutes: 20 }] }, 100);
    let t = (await db.templates.get(id))!;
    expect(t).toMatchObject({ title: '주간 보고서', keywords: ['보고서', '주간'], createdAt: 100, updatedAt: 100 });
    expect(t).not.toHaveProperty('summary');
    await updateTemplate(id, { title: '주간 보고', summary: '금요일마다', keywords: ['보고'], steps: [{ title: 'a' }, { title: 'b' }] }, 200);
    t = (await db.templates.get(id))!;
    expect(t).toMatchObject({ title: '주간 보고', summary: '금요일마다', createdAt: 100, updatedAt: 200 });
    const removed = await deleteTemplate(id);
    expect(await listUserTemplates()).toHaveLength(0);
    await restoreTemplate(removed!);
    expect((await listUserTemplates())[0].title).toBe('주간 보고');
  });

  it('이름이나 단계가 비면 거부', async () => {
    await expect(createTemplate({ title: ' ', steps: [{ title: 'a' }] })).rejects.toThrow('이름');
    await expect(createTemplate({ title: 'x', steps: [] })).rejects.toThrow('단계');
  });

  it('목표를 템플릿으로: 구조와 리프 시간만 옮기고 완료 여부는 버린다', async () => {
    const g = await createGoal({ title: '이사', steps: [{ title: '준비', children: [{ title: '견적', minutes: 30 }, { title: '포장' }] }, { title: '신고', minutes: 20 }] });
    const rows = await db.steps.where('goalId').equals(g).toArray();
    await setDone(rows.find((r) => r.title === '견적')!.id, true);
    const id = await templateFromGoal(g);
    const t = (await db.templates.get(id))!;
    expect(t.title).toBe('이사');
    expect(t.steps).toEqual([{ title: '준비', children: [{ title: '견적', minutes: 30 }, { title: '포장' }] }, { title: '신고', minutes: 20 }]);
  });

  it('기본 규칙이 내 템플릿을 키워드로 고르고, 점수가 같으면 내 템플릿 우선', async () => {
    await createTemplate({ title: '주간 보고', keywords: ['주간 보고'], steps: [{ title: '이번 주 한 일 적기' }] });
    const r = await rulesEngine.decompose({ kind: 'goal', goal: '금요일 주간 보고 쓰기' });
    expect(r[0].title).toBe('이번 주 한 일 적기');
    // 기본 템플릿과 같은 키워드("시험")를 가진 내 템플릿
    await createTemplate({ title: '내 시험', keywords: ['시험'], steps: [{ title: '내 방식대로 공부' }] });
    expect((await rulesEngine.decompose({ kind: 'goal', goal: '시험' }))[0].title).toBe('내 방식대로 공부');
    // 내 템플릿이 없으면 기본 템플릿
    expect(matchTemplate('시험')?.id).toBe('exam');
    expect(decomposeByRules({ kind: 'goal', goal: '시험' }, TEMPLATES)[0].title).toBe('시험 범위 파악하기');
  });
});
