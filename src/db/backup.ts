/**
 * 백업 내보내기/가져오기.
 *
 * 형식 v2 (지금):
 *   { format: 'halfstep', version: 2, exportedAt, goals: Goal[], steps: StepRow[], templates: UserTemplate[] }
 * 형식 v1 (예전 앱, 트리 배열): 목표마다 steps(또는 children)에 단계 트리가 들어 있는 배열.
 *   정확한 모양을 모르므로 흔한 키 이름을 너그럽게 읽는다.
 *
 * 가져오기 원칙
 * - 이미 있는 목표·템플릿(같은 id)은 건너뛴다 (덮어쓰지 않음)
 * - 망가진 데이터는 고쳐서 받는다: 없는 부모 → 최상위, 자식 있는 단계의 완료값 → 비움(불변식 1), 이상한 값 → 기본값
 * - 한 트랜잭션: 중간에 실패하면 아무것도 들어가지 않는다
 */
import { HalfStepError } from './ops';
import { db, newId, ORDER_GAP, type Goal, type StepRow, type StepSource, type TemplateStep, type UserTemplate } from './schema';
import { getSetting, setSetting } from './settings';

export const BACKUP_FORMAT = 'halfstep';
export const BACKUP_VERSION = 2;

export interface BackupV2 {
  format: typeof BACKUP_FORMAT;
  version: 2;
  exportedAt: number;
  goals: Goal[];
  steps: StepRow[];
  templates: UserTemplate[];
}

// ───────────── 내보내기 ─────────────

export async function exportBackup(now = Date.now()): Promise<BackupV2> {
  const data = await db.transaction('r', db.goals, db.steps, db.templates, async () => ({
    goals: await db.goals.toArray(),
    steps: await db.steps.toArray(),
    templates: await db.templates.toArray(),
  }));
  await setSetting('lastBackupAt', now);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, ...data };
}

export function backupFileName(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `halfstep-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function backupBlob(data: BackupV2): Blob {
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}

// ───────────── 읽기·고치기 ─────────────

export interface ParsedBackup {
  version: 1 | 2;
  goals: Goal[];
  steps: StepRow[];
  templates: UserTemplate[];
  /** 고치거나 버린 것에 대한 설명 */
  warnings: string[];
}

const SOURCES: StepSource[] = ['ai-native', 'ai-gemini-nano', 'ai-chrome', 'rules', 'template', 'manual', 'legacy'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pos = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && n > 0 ? Math.round(n) : undefined;
};
/** 숫자 시각 또는 날짜 문자열 → ms */
const time = (v: unknown): number | undefined => {
  if (num(v) !== undefined) return v as number;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

/** 단계 행들을 고친다: 없는 부모 → 최상위, 자식 있는 단계의 doneAt → null */
function repairSteps(rows: StepRow[], warnings: string[]): StepRow[] {
  const ids = new Set(rows.map((r) => r.id));
  let orphans = 0;
  const fixed = rows.map((r) => {
    if (r.parentId !== null && !ids.has(r.parentId)) {
      orphans++;
      return { ...r, parentId: null };
    }
    return r;
  });
  if (orphans) warnings.push(`부모를 찾을 수 없는 단계 ${orphans}개를 최상위로 옮겼어요.`);
  const parents = new Set(fixed.map((r) => r.parentId));
  return fixed.map((r) => (parents.has(r.id) && r.doneAt !== null ? { ...r, doneAt: null } : r));
}

function parseV2(data: Obj, now: number): ParsedBackup {
  const warnings: string[] = [];
  const goals: Goal[] = [];
  for (const g of Array.isArray(data.goals) ? data.goals : []) {
    if (!isObj(g)) continue;
    const id = str(g.id);
    const title = str(g.title);
    if (!id || !title) {
      warnings.push('id나 제목이 없는 목표를 건너뛰었어요.');
      continue;
    }
    const createdAt = time(g.createdAt) ?? now;
    const note = str(g.note);
    const reward = str(g.reward);
    const celebratedAt = time(g.celebratedAt);
    const rewardClaimedAt = time(g.rewardClaimedAt);
    goals.push({
      id,
      title,
      ...(note ? { note } : {}),
      ...(reward ? { reward } : {}),
      ...(celebratedAt ? { celebratedAt } : {}),
      ...(rewardClaimedAt ? { rewardClaimedAt } : {}),
      createdAt,
      updatedAt: time(g.updatedAt) ?? createdAt,
    });
  }
  const goalIds = new Set(goals.map((g) => g.id));

  const steps: StepRow[] = [];
  let dropped = 0;
  for (const [i, s] of (Array.isArray(data.steps) ? data.steps : []).entries()) {
    if (!isObj(s)) continue;
    const id = str(s.id);
    const goalId = str(s.goalId);
    const title = str(s.title);
    if (!id || !goalId || !goalIds.has(goalId) || !title) {
      dropped++;
      continue;
    }
    const minutes = pos(s.minutes);
    const source = SOURCES.includes(s.source as StepSource) ? (s.source as StepSource) : 'manual';
    steps.push({
      id,
      goalId,
      parentId: str(s.parentId) ?? null,
      order: num(s.order) ?? (i + 1) * ORDER_GAP,
      title,
      ...(minutes ? { minutes } : {}),
      doneAt: time(s.doneAt) ?? null,
      ...(s.collapsed === true ? { collapsed: true } : {}),
      source,
      createdAt: time(s.createdAt) ?? now,
    });
  }
  if (dropped) warnings.push(`목표를 찾을 수 없거나 제목이 없는 단계 ${dropped}개를 건너뛰었어요.`);

  const templates: UserTemplate[] = [];
  for (const t of Array.isArray(data.templates) ? data.templates : []) {
    if (!isObj(t)) continue;
    const id = str(t.id);
    const title = str(t.title);
    const tsteps = templateSteps(t.steps);
    if (!id || !title || tsteps.length === 0) continue;
    const summary = str(t.summary);
    const createdAt = time(t.createdAt) ?? now;
    templates.push({
      id,
      title,
      ...(summary ? { summary } : {}),
      keywords: Array.isArray(t.keywords) ? t.keywords.filter((k): k is string => typeof k === 'string' && !!k.trim()) : [],
      steps: tsteps,
      createdAt,
      updatedAt: time(t.updatedAt) ?? createdAt,
    });
  }

  return { version: 2, goals, steps: repairSteps(steps, warnings), templates, warnings };
}

function templateSteps(v: unknown): TemplateStep[] {
  if (!Array.isArray(v)) return [];
  const out: TemplateStep[] = [];
  for (const s of v) {
    if (!isObj(s)) continue;
    const title = str(s.title);
    if (!title) continue;
    const children = templateSteps(s.children);
    const minutes = pos(s.minutes);
    out.push({ title, ...(children.length ? { children } : minutes ? { minutes } : {}) });
  }
  return out;
}

// v1 (예전 앱): 흔한 키 이름들
const V1_TITLE = ['title', 'text', 'name'];
const V1_CHILDREN = ['children', 'steps', 'substeps', 'subSteps', 'items'];
const pick = (o: Obj, keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined);

function parseV1(list: unknown[], now: number): ParsedBackup {
  const warnings: string[] = [];
  const goals: Goal[] = [];
  const steps: StepRow[] = [];
  for (const g of list) {
    if (!isObj(g)) continue;
    const title = str(pick(g, V1_TITLE));
    if (!title) continue;
    const id = str(g.id) ?? newId();
    const createdAt = time(g.createdAt) ?? now;
    const updatedAt = time(g.updatedAt) ?? createdAt;
    const note = str(g.note);
    // 예전 앱에서 이미 끝낸 목표에 축하 창이 뜨지 않도록, 축하는 본 것으로 둔다
    goals.push({ id, title, ...(note ? { note } : {}), celebratedAt: now, createdAt, updatedAt });

    const walk = (nodes: unknown, parentId: string | null) => {
      if (!Array.isArray(nodes)) return;
      nodes.forEach((n, i) => {
        if (!isObj(n)) return;
        const stitle = str(pick(n, V1_TITLE));
        if (!stitle) return;
        const sid = str(n.id) ?? newId();
        const minutes = pos(n.minutes);
        // 예전 앱은 완료를 done(true/false)으로 저장했다. 실제 완료 시각은 모르므로 목표의 수정 시각으로 둔다.
        const doneAt = time(n.doneAt) ?? (n.done === true ? updatedAt : null);
        steps.push({
          id: sid,
          goalId: id,
          parentId,
          order: (i + 1) * ORDER_GAP,
          title: stitle,
          ...(minutes ? { minutes } : {}),
          doneAt,
          ...(n.collapsed === true ? { collapsed: true } : {}),
          source: 'legacy',
          createdAt: time(n.createdAt) ?? createdAt,
        });
        walk(pick(n, V1_CHILDREN), sid);
      });
    };
    walk(pick(g, V1_CHILDREN), null);
  }
  if (goals.length) warnings.push('예전 형식이라 완료 시각은 목표의 마지막 수정 시각으로 넣었어요.');
  return { version: 1, goals, steps: repairSteps(steps, warnings), templates: [], warnings };
}

/** 백업 파일 내용 → 고친 데이터. 읽을 수 없으면 HalfStepError */
export function parseBackup(text: string, now = Date.now()): ParsedBackup {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new HalfStepError('백업 파일을 읽을 수 없어요. 반걸음에서 내보낸 JSON 파일인지 확인해 주세요.');
  }
  let parsed: ParsedBackup;
  if (isObj(data) && data.format === BACKUP_FORMAT) {
    if (typeof data.version === 'number' && data.version > BACKUP_VERSION) {
      throw new HalfStepError('더 새로운 버전의 반걸음에서 만든 백업이에요. 앱을 업데이트한 뒤 가져와 주세요.');
    }
    parsed = parseV2(data, now);
  } else if (Array.isArray(data)) {
    parsed = parseV1(data, now);
  } else if (isObj(data) && Array.isArray(data.goals) && !Array.isArray(data.steps)) {
    parsed = parseV1(data.goals, now);
  } else {
    throw new HalfStepError('반걸음 백업 형식이 아니에요.');
  }
  if (parsed.goals.length === 0 && parsed.templates.length === 0) throw new HalfStepError('백업에 가져올 목표나 템플릿이 없어요.');
  return parsed;
}

// ───────────── 가져오기 ─────────────

export interface ImportPreview {
  parsed: ParsedBackup;
  newGoals: number;
  skippedGoals: number;
  newSteps: number;
  newTemplates: number;
  skippedTemplates: number;
}

/** 가져오기 전에 무엇이 들어가고 무엇을 건너뛸지 */
export async function previewImport(parsed: ParsedBackup): Promise<ImportPreview> {
  const existingGoals = new Set(await db.goals.toCollection().primaryKeys());
  const existingTemplates = new Set(await db.templates.toCollection().primaryKeys());
  const newGoalIds = new Set(parsed.goals.filter((g) => !existingGoals.has(g.id)).map((g) => g.id));
  const newTemplates = parsed.templates.filter((t) => !existingTemplates.has(t.id)).length;
  return {
    parsed,
    newGoals: newGoalIds.size,
    skippedGoals: parsed.goals.length - newGoalIds.size,
    newSteps: parsed.steps.filter((s) => newGoalIds.has(s.goalId)).length,
    newTemplates,
    skippedTemplates: parsed.templates.length - newTemplates,
  };
}

export interface ImportResult {
  goals: number;
  steps: number;
  templates: number;
}

/** 가져오기 (한 트랜잭션). 이미 있는 목표·템플릿은 건너뛰고, 단계 id가 겹치면 새 id로 바꾼다 */
export async function applyImport(parsed: ParsedBackup): Promise<ImportResult> {
  return db.transaction('rw', db.goals, db.steps, db.templates, async () => {
    const existingGoals = new Set(await db.goals.toCollection().primaryKeys());
    const existingSteps = new Set(await db.steps.toCollection().primaryKeys());
    const existingTemplates = new Set(await db.templates.toCollection().primaryKeys());

    const goals = parsed.goals.filter((g) => !existingGoals.has(g.id));
    const goalIds = new Set(goals.map((g) => g.id));
    const rows = parsed.steps.filter((s) => goalIds.has(s.goalId));
    // 다른 목표의 단계와 id가 겹치면(드묾) 새 id로 바꾸고 부모 연결도 따라 바꾼다
    const remap = new Map<string, string>();
    for (const r of rows) if (existingSteps.has(r.id)) remap.set(r.id, newId());
    const steps = rows.map((r) => ({
      ...r,
      id: remap.get(r.id) ?? r.id,
      parentId: r.parentId !== null ? (remap.get(r.parentId) ?? r.parentId) : null,
    }));
    const templates = parsed.templates.filter((t) => !existingTemplates.has(t.id));

    await db.goals.bulkAdd(goals);
    await db.steps.bulkAdd(steps);
    await db.templates.bulkAdd(templates);
    return { goals: goals.length, steps: steps.length, templates: templates.length };
  });
}

// ───────────── 예전 앱의 localStorage ─────────────

export const LEGACY_KEY = 'halfstep:goals:v1';
const LEGACY_ENGINE_KEY = 'halfstep:engine';

/**
 * 같은 브라우저에 예전 앱의 데이터가 있으면 처음 한 번 옮긴다. 원본은 지우지 않는다(백업으로 남김).
 * @returns 옮긴 목표 수 (옮길 게 없거나 이미 옮겼으면 0)
 */
export async function migrateLegacyLocalStorage(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Promise<number> {
  if (!storage || (await getSetting('migratedFromLocalStorage'))) return 0;
  let moved = 0;
  try {
    const raw = storage.getItem(LEGACY_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.goals) ? data.goals : [];
      if (list.length) moved = (await applyImport(parseV1(list, Date.now()))).goals;
    }
    const engine = storage.getItem(LEGACY_ENGINE_KEY);
    if (engine === 'auto' || engine === 'chrome' || engine === 'rules') await setSetting('enginePref', engine);
  } catch (err) {
    console.warn('예전 데이터를 옮기지 못했어요', err);
  }
  await setSetting('migratedFromLocalStorage', true);
  return moved;
}
