/**
 * 모든 AI 엔진(Chrome 내장 AI, 앱의 Gemini Nano·기기 내 모델)이 함께 쓰는 지시문과 답변 해석.
 *
 * 작은 모델의 부담을 줄이려고 AI에게는 단계 "제목"만 받는다(최대 2단계 깊이).
 * 예상 시간은 estimateMinutes()로 규칙에 따라 채운다.
 */
import type { StepDraft } from '../db/ops';
import { parseOutline, splitTitleMinutes } from '../model/outline';
import { describeAnalysis } from './analyze';
import type { DecomposeRequest } from './types';

export const LIMITS = {
  /** 최상위 단계 최대 수 */
  top: 8,
  /** 하위 단계 최대 수 */
  children: 5,
  /** 제목 최대 길이 */
  title: 60,
} as const;

// ───────────── 지시문 ─────────────

export const SYSTEM_PROMPT = `너는 큰 목표를 지금 바로 실행할 수 있는 작은 행동으로 나누는 도우미다.
규칙:
- 한국어로 답한다.
- 각 단계는 "자료 3개 찾기"처럼 동사로 끝나는 짧은 행동이다. 20자 이내.
- 추상적인 말("열심히 하기", "노력하기")은 쓰지 않는다.
- 순서대로 실행할 수 있게 적는다.
- JSON만 출력한다. 설명, 머리말, 코드 블록 표시는 쓰지 않는다.
형식: {"steps":[{"title":"단계","substeps":["하위 단계"]}]}`;

/** 예시 한 쌍. 형식과 단계 크기를 보여 준다 */
export const FEW_SHOT = {
  user: '목표: 방 정리하기\n3~7개 단계로 나눠라. 큰 단계에만 substeps를 2~4개 붙여라.',
  assistant: JSON.stringify({
    steps: [
      { title: '쓰레기봉투 준비하기' },
      { title: '눈에 보이는 쓰레기 버리기' },
      { title: '구역별로 정리하기', substeps: ['책상 위 치우기', '옷 개서 넣기', '바닥 물건 제자리에 두기'] },
      { title: '안 쓰는 물건 모으기' },
      { title: '바닥 닦기' },
    ],
  }),
};

/** 규칙이 목표에서 읽어 낸 정보 한 줄 (없으면 빈 배열) */
function analysisLines(req: DecomposeRequest): string[] {
  const a = req.context?.analysis;
  if (!a) return [];
  const info = describeAnalysis(a);
  return [`종류: ${a.typeLabel}${info ? ` · ${info}` : ''}`];
}

export function buildUserPrompt(req: DecomposeRequest): string {
  switch (req.kind) {
    case 'goal':
      return [
        `목표: ${req.goal}`,
        ...analysisLines(req),
        '3~7개 단계로 나눠라. 큰 단계에만 substeps를 2~4개 붙여라.' + (req.context?.analysis.deadline ? ' 마감에 맞춰 일정을 정하는 단계를 넣어라.' : ''),
      ].join('\n');
    case 'split':
      return [
        `목표: ${req.goal}`,
        `나눌 단계: ${[...req.path, req.step].join(' > ')}`,
        '이 단계 하나를 3~5개의 더 작은 행동으로 나눠라. substeps는 쓰지 마라.',
      ].join('\n');
    case 'more':
      return [
        `목표: ${req.goal}`,
        ...analysisLines(req),
        ...((req.doneRatio ?? 0) >= 0.6 ? ['거의 끝나 가는 목표다. 마무리와 점검 단계를 우선 제안하라.'] : []),
        '이미 있는 단계:',
        ...req.existing.slice(0, 30).map((t) => `- ${t}`),
        '목표를 마치는 데 빠진 단계를 2~3개만 제안하라. 이미 있는 단계와 겹치면 안 된다. substeps는 쓰지 마라.',
      ].join('\n');
  }
}

/** 응답 형식을 강제할 수 있는 엔진용 JSON 스키마 */
export function responseSchema(req: DecomposeRequest): Record<string, unknown> {
  const flat = req.kind !== 'goal';
  const item = flat
    ? { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
    : {
        type: 'object',
        properties: {
          title: { type: 'string' },
          substeps: { type: 'array', items: { type: 'string' }, maxItems: LIMITS.children },
        },
        required: ['title'],
      };
  return {
    type: 'object',
    properties: { steps: { type: 'array', items: item, minItems: 1, maxItems: flat ? 5 : 7 } },
    required: ['steps'],
  };
}

// ───────────── 답변 해석 ─────────────

/**
 * 끝이 잘린 JSON을 마지막으로 완성된 요소까지 살리고 괄호를 닫는다.
 * 예: '{"steps":[{"title":"a"},{"title":"b' → '{"steps":[{"title":"a"}]}'
 */
export function repairJson(text: string): string | null {
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let safeEnd = -1;
  let safeStack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') {
        inString = false;
        // 배열 안의 문자열 하나가 끝났으면 그 자리까지는 안전하다.
        if (stack.at(-1) === '[') {
          safeEnd = i + 1;
          safeStack = [...stack];
        }
      }
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      safeEnd = i + 1;
      safeStack = [...stack];
      if (stack.length === 0) return text.slice(0, i + 1);
    }
  }
  if (safeEnd < 0) return null;
  const closing = safeStack
    .reverse()
    .map((c) => (c === '{' ? '}' : ']'))
    .join('');
  return text.slice(0, safeEnd).replace(/,\s*$/, '') + closing;
}

function extractJson(text: string): unknown {
  const body = text.replace(/```(?:json)?/gi, '');
  const start = body.search(/[[{]/);
  if (start < 0) return undefined;
  const candidate = body.slice(start);
  for (const t of [candidate, repairJson(candidate)]) {
    if (!t) continue;
    try {
      return JSON.parse(t);
    } catch {
      // 다음 후보로
    }
  }
  return undefined;
}

const TITLE_KEYS = ['title', 'name', 'step', 'task', 'text', '제목', '단계', '이름'];
const CHILD_KEYS = ['substeps', 'subSteps', 'sub_steps', 'children', 'steps', 'subtasks', '하위', '하위단계', '하위 단계'];
const LIST_KEYS = ['steps', 'tasks', 'items', '단계', '단계들'];

function toDrafts(value: unknown, depth: number): StepDraft[] {
  if (!Array.isArray(value)) return [];
  const out: StepDraft[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      out.push({ title: item });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const titleKey = TITLE_KEYS.find((k) => typeof obj[k] === 'string');
      if (!titleKey) continue;
      const draft: StepDraft = { title: obj[titleKey] as string };
      const childKey = depth === 0 ? CHILD_KEYS.find((k) => Array.isArray(obj[k])) : undefined;
      if (childKey) {
        const children = toDrafts(obj[childKey], depth + 1);
        if (children.length) draft.children = children;
      }
      out.push(draft);
    }
  }
  return out;
}

function fromParsed(value: unknown): StepDraft[] {
  if (Array.isArray(value)) return toDrafts(value, 0);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const key = LIST_KEYS.find((k) => Array.isArray(obj[k]));
    if (key) return toDrafts(obj[key], 0);
  }
  return [];
}

const LIST_MARK = /^\s*(?:[-*•·]|\d{1,2}\s*[.)]|\d+\s*단계\s*[:.)-]|(?:step|단계)\s*\d+\s*[:.)-])\s*/i;

/**
 * JSON이 아닐 때: 번호·글머리표 목록으로 읽는다.
 * 목록 표시가 있는 줄이 2개 이상이면 표시 없는 줄(머리말·맺음말)은 버린다.
 */
function fromText(text: string): StepDraft[] {
  let lines = text
    .replace(/```\w*/g, '')
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      if (!t || /^[[{]/.test(t)) return false;
      if (/[:：]$/.test(t)) return false; // "다음은 단계입니다:" 같은 머리말
      const body = t.replace(LIST_MARK, '');
      if (body.length > 50 || /[.!?。]\s+\S/.test(body)) return false; // 설명 문장
      return true;
    });
  if (lines.filter((l) => LIST_MARK.test(l)).length >= 2) lines = lines.filter((l) => LIST_MARK.test(l));
  return parseOutline(lines.map((l) => l.replace(/\*\*/g, '')).join('\n'));
}

const PREFIX = /^(?:(?:step|단계)\s*\d+\s*[:.)-]|\d+\s*단계\s*[:.)-]|\d{1,2}\s*[.)]|[-*•·]|\[\s?\]|☐)\s*/i;
const QUOTES = /^["'“‘「『]+|["'”’」』]+$/g;
const TRAILING = /[.。!]+$/;

export function cleanTitle(raw: string): string {
  let t = raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  // 표시·따옴표·마침표가 겹쳐 있을 수 있으므로 바뀌지 않을 때까지 반복
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(PREFIX, '').replace(TRAILING, '').replace(QUOTES, '').trim();
    if (t === before) break;
  }
  if (t.length > LIMITS.title) t = t.slice(0, LIMITS.title).trim();
  return t;
}

function normalize(drafts: StepDraft[], limit: number, flat: boolean): StepDraft[] {
  const seen = new Set<string>();
  const out: StepDraft[] = [];
  for (const d of drafts) {
    const title = cleanTitle(d.title);
    const key = title.replace(/\s/g, '');
    if (!title || seen.has(key)) continue;
    seen.add(key);
    const children = !flat && d.children ? normalize(d.children, LIMITS.children, true) : [];
    // 하위 단계가 하나뿐이면 나눌 의미가 없으므로 버린다.
    out.push(children.length >= 2 ? { title, children } : { title });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * AI 답변 → 단계 초안(제목만). 읽을 수 없으면 빈 배열.
 * @param flat true면 하위 단계를 버린다 (쪼개기·더 제안)
 */
export function parseSteps(text: string, flat = false): StepDraft[] {
  const parsed = extractJson(text);
  // JSON으로 읽혔다면 그 내용만 믿는다 (단계가 없으면 빈 결과)
  const drafts = parsed !== undefined ? fromParsed(parsed) : fromText(text);
  return normalize(drafts, LIMITS.top, flat);
}

/** 지시문 속 형식 예시의 자리표시 제목 */
const PLACEHOLDER_TITLES = new Set(['단계', '하위 단계', '하위단계', 'title', 'step']);

/**
 * 모델이 지시문을 그대로 되돌려 준 답인지.
 * (작은 모델이 가끔 그러고, 모델이 없는 Chromium은 항상 입력을 되돌려 준다)
 */
export function isEcho(text: string): boolean {
  return (
    text.includes('작은 행동으로 나누는 도우미') ||
    text.includes('JSON만 출력한다') ||
    /echoing back the input/i.test(text)
  );
}

/** AI 답변 → 예상 시간까지 채운 단계. 쓸 수 없는 답이면 빈 배열 (호출하는 쪽이 기본 규칙으로 넘어감) */
export function parseAnswer(text: string, req: DecomposeRequest): StepDraft[] {
  if (isEcho(text)) return [];
  let drafts = parseSteps(text, req.kind !== 'goal');
  // 더 제안: 이미 있는 단계를 다시 내놓으면 뺀다
  if (req.kind === 'more') {
    const have = new Set(req.existing.map((t) => t.replace(/\s/g, '')));
    drafts = drafts.filter((d) => !have.has(d.title.replace(/\s/g, '')));
  }
  if (drafts.length === 0 || drafts.every((d) => PLACEHOLDER_TITLES.has(d.title.toLowerCase()))) return [];
  // 예시로 보여 준 단계를 그대로 베낀 답도 버린다 (방 정리 목표가 아닐 때)
  const example = (JSON.parse(FEW_SHOT.assistant) as { steps: { title: string }[] }).steps.map((x) => x.title);
  const copied = drafts.filter((d) => example.includes(d.title)).length;
  if (copied >= 3 && !/정리|청소/.test(JSON.stringify(req))) return [];
  return withMinutes(drafts, req);
}

// ───────────── 예상 시간 (규칙) ─────────────

/** [키워드, 분]. 더 긴 키워드가 먼저 맞도록 정렬해서 쓴다 */
const MINUTE_RULES: [string, number][] = [
  ['정하기', 5], ['적기', 10], ['적어', 10], ['확인', 5], ['연락', 5], ['신청', 15], ['예약', 15],
  ['고르기', 10], ['꺼내', 5], ['버리기', 10], ['준비하기', 10], ['메모', 10], ['목록', 15], ['계획', 20],
  ['찾기', 20], ['조사', 30], ['검색', 15], ['읽기', 30], ['보기', 20], ['듣기', 20],
  ['쓰기', 30], ['작성', 30], ['만들기', 30], ['그리기', 30], ['고치기', 20], ['검토', 20], ['다듬기', 20],
  ['연습', 20], ['공부', 40], ['복습', 30], ['풀기', 30], ['외우기', 20],
  ['청소', 20], ['정리', 20], ['닦기', 15], ['빨래', 30], ['짐 싸기', 45], ['이동', 30],
  ['운동', 30], ['달리기', 30], ['스트레칭', 10], ['산책', 30],
  ['회의', 30], ['발표', 20], ['제출', 10], ['올리기', 10], ['보내기', 5],
];
const SORTED_RULES = [...MINUTE_RULES].sort((a, b) => b[0].length - a[0].length);
export const DEFAULT_MINUTES = 15;

export function estimateMinutes(title: string): number {
  const explicit = splitTitleMinutes(title).minutes;
  if (explicit) return explicit;
  const t = title.replace(/\s+/g, ' ');
  for (const [k, m] of SORTED_RULES) if (t.includes(k)) return m;
  return DEFAULT_MINUTES;
}

const roundTo5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/**
 * 제목만 있는 AI 결과에 예상 시간을 채운다(리프만).
 * 쪼개기에서 원래 단계에 시간이 있으면 그 시간에 맞춰 비율로 나눈다.
 */
export function withMinutes(drafts: StepDraft[], req: DecomposeRequest): StepDraft[] {
  const fill = (list: StepDraft[]): StepDraft[] =>
    list.map((d) => {
      const { title, minutes } = splitTitleMinutes(d.title);
      if (d.children?.length) return { title, children: fill(d.children) };
      return { title, minutes: minutes ?? estimateMinutes(title) };
    });
  const filled = fill(drafts);
  if (req.kind === 'split' && req.minutes && filled.every((d) => !d.children)) {
    const sum = filled.reduce((n, d) => n + (d.minutes ?? 0), 0);
    if (sum > 0) for (const d of filled) d.minutes = roundTo5((req.minutes * (d.minutes ?? 0)) / sum);
  }
  return filled;
}
