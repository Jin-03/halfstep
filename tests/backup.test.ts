import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyImport,
  backupFileName,
  exportBackup,
  LEGACY_KEY,
  migrateLegacyLocalStorage,
  parseBackup,
  previewImport,
} from '../src/db/backup';
import { createGoal, setDone } from '../src/db/ops';
import { db } from '../src/db/schema';
import { getSetting } from '../src/db/settings';
import { createTemplate } from '../src/db/templates';
import { buildTree, isDone, progress } from '../src/model/tree';

beforeEach(async () => {
  await Promise.all([db.goals.clear(), db.steps.clear(), db.templates.clear(), db.settings.clear()]);
});

const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

async function sample() {
  const g = await createGoal({ title: '이사', note: '12월', steps: [{ title: '준비', children: [{ title: '견적', minutes: 30 }, { title: '포장' }] }, { title: '신고', minutes: 20 }] });
  const rows = await db.steps.where('goalId').equals(g).toArray();
  await setDone(rows.find((r) => r.title === '견적')!.id, true);
  await createTemplate({ title: '주간 보고', keywords: ['보고'], steps: [{ title: '한 일 적기', minutes: 10 }] });
  return g;
}

describe('내보내기 → 가져오기', () => {
  it('빈 기기로 옮기면 그대로 복원된다', async () => {
    await sample();
    const data = await exportBackup(1_700_000_000_000);
    expect(data).toMatchObject({ format: 'halfstep', version: 2, exportedAt: 1_700_000_000_000 });
    expect(await getSetting('lastBackupAt')).toBe(1_700_000_000_000);
    const before = { goals: await db.goals.toArray(), steps: await db.steps.toArray(), templates: await db.templates.toArray() };

    await Promise.all([db.goals.clear(), db.steps.clear(), db.templates.clear()]);
    const parsed = parseBackup(JSON.stringify(data));
    expect(parsed.warnings).toEqual([]);
    const preview = await previewImport(parsed);
    expect(preview).toMatchObject({ newGoals: 1, skippedGoals: 0, newSteps: 4, newTemplates: 1, skippedTemplates: 0 });
    expect(await applyImport(parsed)).toEqual({ goals: 1, steps: 4, templates: 1 });

    expect(await db.goals.toArray()).toEqual(before.goals);
    expect(sortById(await db.steps.toArray())).toEqual(sortById(before.steps));
    expect(await db.templates.toArray()).toEqual(before.templates);
  });

  it('이미 있는 목표·템플릿은 건너뛴다', async () => {
    await sample();
    const parsed = parseBackup(JSON.stringify(await exportBackup()));
    const preview = await previewImport(parsed);
    expect(preview).toMatchObject({ newGoals: 0, skippedGoals: 1, newSteps: 0, newTemplates: 0, skippedTemplates: 1 });
    expect(await applyImport(parsed)).toEqual({ goals: 0, steps: 0, templates: 0 });
    expect(await db.steps.count()).toBe(4);
  });

  it('파일 이름', () => {
    expect(backupFileName(new Date(2026, 10, 9, 15).getTime())).toBe('halfstep-backup-2026-11-09.json');
  });
});

describe('망가진 백업 고치기', () => {
  const base = (over: Record<string, unknown>) =>
    JSON.stringify({ format: 'halfstep', version: 2, exportedAt: 1, goals: [{ id: 'g', title: '목표', createdAt: 1, updatedAt: 1 }], steps: [], templates: [], ...over });

  it('없는 부모 → 최상위, 자식 있는 단계의 완료값 → 비움, 이상한 값 → 기본값', () => {
    const p = parseBackup(
      base({
        steps: [
          { id: 'p', goalId: 'g', parentId: null, order: 1000, title: '부모', doneAt: 5, source: 'manual', createdAt: 1 },
          { id: 'c', goalId: 'g', parentId: 'p', order: 1000, title: '자식', doneAt: 6, source: 'ai-webllm', createdAt: 1, minutes: -3 },
          { id: 'o', goalId: 'g', parentId: 'nope', order: 'x', title: '고아', doneAt: null, createdAt: 1 },
          { id: 'x', goalId: 'other', parentId: null, order: 1, title: '다른 목표', doneAt: null },
          { id: 'y', goalId: 'g', parentId: null, order: 1, title: '   ', doneAt: null },
        ],
      }),
    );
    const byId = Object.fromEntries(p.steps.map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual(['c', 'o', 'p']);
    expect(byId.p.doneAt).toBeNull(); // 불변식 1
    expect(byId.c).toMatchObject({ doneAt: 6, source: 'manual' });
    expect(byId.c).not.toHaveProperty('minutes');
    expect(byId.o).toMatchObject({ parentId: null, order: 3000 });
    expect(p.warnings).toHaveLength(2);
  });

  it('다른 목표의 단계와 id가 겹치면 새 id로 바꾸고 부모 연결도 따라간다', async () => {
    await createGoal({ title: '기존', steps: [{ title: 'a' }] });
    const existing = (await db.steps.toArray())[0].id;
    const p = parseBackup(
      base({
        steps: [
          { id: existing, goalId: 'g', parentId: null, order: 1000, title: '부모', doneAt: null, source: 'manual', createdAt: 1 },
          { id: 'c', goalId: 'g', parentId: existing, order: 1000, title: '자식', doneAt: null, source: 'manual', createdAt: 1 },
        ],
      }),
    );
    await applyImport(p);
    const rows = await db.steps.where('goalId').equals('g').toArray();
    const parent = rows.find((r) => r.title === '부모')!;
    expect(parent.id).not.toBe(existing);
    expect(rows.find((r) => r.title === '자식')!.parentId).toBe(parent.id);
    expect(await db.steps.get(existing)).toMatchObject({ title: 'a' });
  });

  it('읽을 수 없는 파일은 이유와 함께 거부', () => {
    expect(() => parseBackup('not json')).toThrow('읽을 수 없어요');
    expect(() => parseBackup('{"hello":1}')).toThrow('형식이 아니에요');
    expect(() => parseBackup(JSON.stringify({ format: 'halfstep', version: 9, goals: [] }))).toThrow('더 새로운 버전');
    expect(() => parseBackup(base({ goals: [] }))).toThrow('가져올 목표나 템플릿이 없어요');
  });
});

describe('예전 형식 (트리 배열)', () => {
  const legacy = [
    {
      id: 'old1',
      title: '블로그 글',
      updatedAt: '2026-10-01T10:00:00Z',
      steps: [
        { text: '주제 정하기', done: true, minutes: 10 },
        { text: '초안', done: true, children: [{ text: '서론', done: false }, { text: '본론', done: true }] },
      ],
    },
    { title: '제목만 있는 목표' },
    { nothing: true },
  ];

  it('트리를 펼치고, 완료는 리프만, 시각은 목표 수정 시각으로', async () => {
    const p = parseBackup(JSON.stringify(legacy), 42);
    expect(p.version).toBe(1);
    expect(p.goals.map((g) => g.title)).toEqual(['블로그 글', '제목만 있는 목표']);
    await applyImport(p);
    const rows = await db.steps.where('goalId').equals('old1').toArray();
    expect(rows.every((r) => r.source === 'legacy')).toBe(true);
    const t = buildTree(rows);
    expect(t.map((n) => n.title)).toEqual(['주제 정하기', '초안']);
    expect(t[0].doneAt).toBe(Date.parse('2026-10-01T10:00:00Z'));
    expect(t[1].doneAt).toBeNull(); // 자식이 있으므로
    expect(isDone(t[1])).toBe(false); // 서론이 남음
    expect(progress(t)).toEqual({ done: 2, total: 3, ratio: 2 / 3 });
  });

  it('{ goals: [...] } 모양도 읽는다', () => {
    expect(parseBackup(JSON.stringify({ goals: legacy })).goals).toHaveLength(2);
  });
});

describe('예전 앱의 localStorage 옮기기', () => {
  const fake = (items: Record<string, string>) => ({ getItem: (k: string) => items[k] ?? null });

  it('처음 한 번만 옮기고 엔진 설정도 가져온다', async () => {
    const storage = fake({ [LEGACY_KEY]: JSON.stringify([{ title: '옛 목표', steps: [{ title: '하나' }] }]), 'halfstep:engine': 'rules' });
    expect(await migrateLegacyLocalStorage(storage)).toBe(1);
    expect((await db.goals.toArray()).map((g) => g.title)).toEqual(['옛 목표']);
    expect(await getSetting('enginePref')).toBe('rules');
    expect(await getSetting('migratedFromLocalStorage')).toBe(true);
    expect(await migrateLegacyLocalStorage(storage)).toBe(0);
    expect(await db.goals.count()).toBe(1);
  });

  it('없으면 표시만 하고, 망가져 있어도 앱은 계속', async () => {
    expect(await migrateLegacyLocalStorage(fake({}))).toBe(0);
    await db.settings.clear();
    const warn = console.warn;
    console.warn = () => {};
    expect(await migrateLegacyLocalStorage(fake({ [LEGACY_KEY]: '{broken' }))).toBe(0);
    console.warn = warn;
    expect(await getSetting('migratedFromLocalStorage')).toBe(true);
  });
});
