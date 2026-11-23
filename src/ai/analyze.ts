/**
 * 목표 문장 분석. 규칙 엔진과 AI 지시문이 함께 쓴다.
 * 예: "다음 주까지 부모님 생신 선물 사기"
 *   → 유형 buy(사기·고르기), 대상 "부모님 생신 선물", 마감 "다음 주"
 */
import type { StepDraft } from '../db/ops';
import {
  DEADLINE_STEP,
  ENDINGS,
  GOAL_TYPES,
  HABIT_WORDS,
  NOUN_VERBS,
  SYNONYMS,
  TARGET_NEEDS_NUMBER,
  TEMPLATE_MIN_SCORE,
  TEMPLATE_TYPES,
  TYPE_ORDER,
  type GoalType,
} from './rulesData';
import type { RuleTemplate } from './types';

export interface GoalAnalysis {
  text: string;
  type: GoalType;
  typeLabel: string;
  /** 목표의 대상. 없으면 '' */
  object: string;
  /** 습관 목표의 활동 (예: "책 읽기"). 없으면 '' */
  activity: string;
  /** 마감 (예: "다음 주", "11월 20일", "3일 안") */
  deadline?: string;
  /** 횟수 (예: "매일", "주 3회", "하루 30분") */
  frequency?: string;
  /** 1회 분량(분). "매일 20분"이면 20 */
  sessionMinutes?: number;
  /** 목표치 (예: "900점", "5km") */
  target?: string;
}

// ───────────── 표현 뽑기 ─────────────

interface Found {
  label: string;
  /** 문장에서 지울 부분 */
  match: string;
  minutes?: number;
}

type Finder = [RegExp, (m: RegExpMatchArray) => Omit<Found, 'match'>];

const DEADLINES: Finder[] = [
  [/(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:전까지|까지|전에|전)?/, (m) => ({ label: `${m[1]}월 ${m[2]}일` })],
  [/([월화수목금토일])요일\s*(?:까지|전까지|전에)/, (m) => ({ label: `${m[1]}요일` })],
  [
    /(이번|다음)\s*(주|달)\s*(말)?\s*(?:까지|안에|중에|중|내에|내)?/,
    (m) => ({ label: `${m[1]} ${m[2]}${m[3] ? (m[2] === '주' ? '말' : ' 말') : ''}` }), // "이번 주말", "이번 달 말"
  ],
  [/(\d{1,3})\s*(일|주|개월|달)\s*(?:안에|이내에|이내|내에|만에|동안|까지|안)/, (m) => ({ label: `${m[1]}${m[2] === '주' ? '주' : m[2]} 안` })],
  [/(오늘|내일|모레)\s*(?:까지|안에|중에|중)?/, (m) => ({ label: m[1] })],
  // 뒤에 "까지" 등이 있어야 마감 ("연말정산"의 연말은 마감이 아니다)
  [/(주말|월말|연말)\s*(?:까지|안에|전에|전)/, (m) => ({ label: m[1] })],
  [/올해\s*(?:안에|안|까지|중에|중)/, () => ({ label: '올해 안' })],
];

const FREQUENCIES: Finder[] = [
  [/(?:매일|날마다)\s*(\d{1,3})\s*(분|시간)\s*씩?/, (m) => ({ label: '매일', minutes: Number(m[1]) * (m[2] === '시간' ? 60 : 1) })],
  [/하루\s*(\d{1,3})\s*(분|시간)\s*씩?/, (m) => ({ label: '매일', minutes: Number(m[1]) * (m[2] === '시간' ? 60 : 1) })],
  [/주\s*(\d)\s*(?:회|번)\s*씩?/, (m) => ({ label: `주 ${m[1]}회` })],
  [/매주\s*([월화수목금토일])요일/, (m) => ({ label: `매주 ${m[1]}요일` })],
  [/매일\s*매일|매일|날마다/, () => ({ label: '매일' })],
  [/매주/, () => ({ label: '매주' })],
];

const TARGET = /(\d+(?:[.,]\d+)?)\s*(km|킬로미터|킬로|kg|키로|점|권|페이지|쪽|개|편|장|회|명|만\s*원|원|%|퍼센트|분|시간|급)/i;

function findFirst(text: string, finders: Finder[]): Found | undefined {
  for (const [re, make] of finders) {
    const m = text.match(re);
    if (m) return { ...make(m), match: m[0] };
  }
  return undefined;
}

// ───────────── 낱말 정리 ─────────────

const PARTICLES = /(?:에서는|에게서|으로|에서|에게|까지|부터|처럼|을|를|이|가|은|는|에|로|와|과|도|의)$/;

/** 낱말 끝의 조사 하나를 뗀다 (남는 글자가 있을 때만) */
function stripParticle(word: string): string {
  const m = word.match(PARTICLES);
  return m && m.index! > 0 ? word.slice(0, m.index) : word;
}

/** 낱말 끝의 조사·어미 하나를 뗀다 (템플릿 키워드 맞추기용) */
export function stem(word: string): string {
  const w = word.toLowerCase();
  for (const e of ENDINGS) if (w.length > e.length && w.endsWith(e)) return w.slice(0, -e.length);
  return w;
}

/** 동사처럼 보이는 낱말 ("쓰기", "신청하기", "준비", "정리") */
function isVerbLike(word: string): boolean {
  if (/기$|하다$|다$/.test(word) || NOUN_VERBS.test(word)) return true;
  return TYPE_ORDER.some((t) => GOAL_TYPES[t].verbs.test(word));
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 목표치를 지우고 남은 조사 낱말 ("5만 원으로" → "으로") */
const LONE_PARTICLE = /^(?:으로|로|을|를|이|가|은|는|에|까지|만큼)$/;

/** "고쳐서", "준비하고"처럼 앞뒤 두 동작을 잇는 낱말. 대상이 두 가지 일에 걸쳐 있다는 뜻이다 */
const CONNECTIVE = /(?:해서|하고|아서|어서|여서|쳐서|워서|와서)$/;

/** 습관을 만든다는 뜻의 말. 활동 이름에서는 지운다 */
const HABIT_VERBS = /\s*(?:만들기|기르기|들이기|갖기|붙이기|유지하기|지키기)$/;

/**
 * 습관 목표의 활동 이름. "아침 6시에 일어나는 (습관) 만들기" → "아침 6시에 일어나기"
 */
function habitActivity(rest: string): string {
  const s = clean(rest.replace(TARGET, ' ')).replace(HABIT_VERBS, '');
  // 꾸미는 말("일어나는")로 끝나면 "-기"로 바꾼다
  return s.replace(/(\S+)는$/, (_, stem: string) => `${stem}기`);
}

// ───────────── 분석 ─────────────

export function analyzeGoal(goal: string): GoalAnalysis {
  const text = clean(goal);
  let rest = text;

  const deadline = findFirst(rest, DEADLINES);
  if (deadline) rest = clean(rest.replace(deadline.match, ' '));
  const frequency = findFirst(rest, FREQUENCIES);
  if (frequency) rest = clean(rest.replace(frequency.match, ' '));
  const habitWord = HABIT_WORDS.test(rest);
  rest = clean(rest.replace(HABIT_WORDS, ' '));
  const targetMatch = rest.match(TARGET);
  const target = targetMatch ? `${targetMatch[1]}${targetMatch[2].replace(/\s+/g, '')}` : undefined;

  // 마지막 낱말이 동사면 떼고, 남은 부분이 대상
  const words = rest.split(' ').filter(Boolean);
  const last = words.at(-1) ?? '';
  const verb = words.length > 1 && isVerbLike(last) ? last : words.length === 1 && isVerbLike(last) ? last : '';
  // 대상은 목표치("5만 원")를 빼고 본다
  const objectSource = targetMatch ? clean(rest.replace(targetMatch[0], ' ')) : rest;
  const objectAll = objectSource.split(' ').filter((w) => w && !LONE_PARTICLE.test(w));
  let objectWords = verb ? objectAll.slice(0, -1) : objectAll;
  if (targetMatch) objectWords = objectWords.filter((w) => !/\d/.test(w));
  // "당근에 팔기"처럼 동사 바로 앞의 장소("~에", "~에서")는 대상이 아니다
  if (objectWords.length > 1 && /(?:에서|에)$/.test(objectWords.at(-1)!) && !/(에게|한테|께)$/.test(objectWords.at(-1)!)) objectWords.pop();
  if (objectWords.length) objectWords[objectWords.length - 1] = stripParticle(objectWords.at(-1)!);
  let object = objectWords.join(' ');
  if (object.length > 14) object = objectWords.slice(-2).join(' ');
  // "이력서 고쳐서 회사"처럼 두 가지 일이 섞인 대상은 단계 제목에 넣지 않는다
  if (objectWords.some((w) => CONNECTIVE.test(w))) object = '';
  // 연락할 사람("집주인에게")이 있으면 그 사람을 대상으로
  const person = words.find((w) => /(에게|한테|께)$/.test(w));

  // 유형. "줄이기", "올리기" 같은 동사는 숫자가 있을 때만 목표치로 본다
  const isTarget = (t: GoalType) => t !== 'target' || !TARGET_NEEDS_NUMBER.test(verb) || !!targetMatch;
  let type: GoalType = 'general';
  if (frequency || habitWord) type = 'habit';
  else if (verb && GOAL_TYPES.target.verbs.test(verb) && isTarget('target')) type = 'target';
  else {
    const byVerb = verb ? TYPE_ORDER.find((t) => GOAL_TYPES[t].verbs.test(verb) && isTarget(t)) : undefined;
    const byWords = [...TYPE_ORDER, 'habit' as const].find((t) => GOAL_TYPES[t].words?.test(text));
    type = byVerb ?? byWords ?? 'general';
  }

  return {
    text,
    type,
    typeLabel: GOAL_TYPES[type].label,
    object: type === 'habit' ? '' : type === 'communicate' && person ? person : object,
    activity: type === 'habit' ? habitActivity(rest) : '',
    ...(deadline ? { deadline: deadline.label } : {}),
    ...(frequency ? { frequency: frequency.label } : habitWord ? { frequency: '꾸준히' } : {}),
    ...(frequency?.minutes ? { sessionMinutes: frequency.minutes } : {}),
    ...(target ? { target } : {}),
  };
}

/**
 * 메모에서 마감·횟수만 더한다 (목표 문장에 없을 때만). 유형은 목표 문장으로만 정한다.
 * 예: 목표 "블로그 글 쓰기" + 메모 "금요일까지 올려야 함" → 마감 금요일
 */
export function withNote(a: GoalAnalysis, note?: string): GoalAnalysis {
  const text = note?.trim();
  if (!text) return a;
  const n = analyzeGoal(text);
  const out: GoalAnalysis = { ...a };
  if (!out.deadline && n.deadline) out.deadline = n.deadline;
  const vague = !a.frequency || a.frequency === '꾸준히';
  if (a.type === 'habit' && vague && n.frequency && n.frequency !== '꾸준히') {
    out.frequency = n.frequency;
    if (n.sessionMinutes) out.sessionMinutes = n.sessionMinutes;
  }
  return out;
}

/** 화면에 보여 줄 "읽어 낸 정보" (없으면 빈 문자열) */
export function describeAnalysis(a: GoalAnalysis): string {
  const parts: string[] = [];
  if (a.object) parts.push(`대상 ${a.object}`);
  if (a.activity) parts.push(`활동 ${a.activity}`);
  if (a.frequency) parts.push(`횟수 ${a.frequency}${a.sessionMinutes ? ` ${a.sessionMinutes}분` : ''}`);
  if (a.target) parts.push(`목표치 ${a.target}`);
  if (a.deadline) parts.push(`마감 ${a.deadline}`);
  return parts.join(' · ');
}

// ───────────── 템플릿 맞추기 ─────────────

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 문장의 낱말 줄기와 비슷한 말을 모은다 */
function vocabulary(text: string): { stems: Set<string>; joined: string } {
  const stems = new Set<string>();
  for (const w of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const s = stem(w);
    stems.add(w);
    stems.add(s);
    for (const x of [w, s]) if (SYNONYMS[x]) stems.add(SYNONYMS[x]);
  }
  return { stems, joined: flat(text) + '|' + [...stems].join('|') };
}

export function templateScore(text: string, t: Pick<RuleTemplate, 'keywords'>): number {
  const { stems, joined } = vocabulary(text);
  let score = 0;
  for (const k of t.keywords) {
    const key = flat(k);
    if (!key) continue;
    // 한 글자 키워드("글", "방")는 낱말 단위로만 (글로벌, 방법에 걸리지 않게)
    const hit = key.length === 1 ? stems.has(key) : joined.includes(key);
    if (hit) score += key.length;
  }
  return score;
}

/** 키워드가 가장 많이(길게) 맞는 템플릿. 점수가 같으면 목록 앞쪽(내 템플릿)이 이긴다 */
export function matchTemplate<T extends Pick<RuleTemplate, 'keywords'>>(text: string, templates: readonly T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const t of templates) {
    const score = templateScore(text, t);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// ───────────── 계획 채우기 ─────────────

/** 습관의 횟수 → 이번 주에 해 볼 일. "이번 주 주 3회 지키기"처럼 겹치지 않게 횟수마다 문장을 맞춘다 */
function thisWeek(frequency?: string): string {
  if (frequency === '매일') return '이번 주 매일 해 보기';
  const times = frequency?.match(/^주 (\d)회$/);
  if (times) return `이번 주 ${times[1]}번 해 보기`;
  const day = frequency?.match(/^매주 (.)요일$/);
  if (day) return `이번 주 ${day[1]}요일에 해 보기`;
  return '이번 주 3번 해 보기'; // 꾸준히, 매주
}

/** 뼈대의 자리표시를 분석값으로 채운다 */
export function fillPlan(plan: readonly StepDraft[], a: GoalAnalysis): StepDraft[] {
  const fill = (title: string) =>
    clean(
      title
        .replace('{대상} ', a.object ? `${a.object} ` : '')
        .replace('{대상}', a.object)
        .replace('{활동}', a.activity || '이 일')
        .replace('{횟수}', a.frequency ?? '3번')
        .replace('{이번 주}', thisWeek(a.frequency))
        .replace('{목표치}', a.target ?? '목표'),
    );
  return plan.map((d) => {
    const out: StepDraft = { title: fill(d.title) };
    if (d.children?.length) out.children = fillPlan(d.children, a);
    else if (d.minutes) out.minutes = d.minutes;
    return out;
  });
}

export interface Plan {
  drafts: StepDraft[];
  /** 무엇을 근거로 나눴는지 (예: "‘시험 준비하기’ 템플릿", "사기·고르기 유형") */
  basis: string;
}

/**
 * 분석한 목표에 쓸 템플릿.
 * - 내 템플릿: 키워드가 하나라도 맞으면 (사용자가 직접 정한 키워드이므로)
 * - 기본 템플릿: 목표 유형과 같은 종류이거나, 유형을 못 정했거나, 키워드가 충분히(TEMPLATE_MIN_SCORE) 맞을 때
 *   (예: "여권 재발급 신청하기"는 '여권' 하나로 여행 템플릿이 되지 않고 신청 유형이 된다)
 */
export function templateFor(a: GoalAnalysis, templates: readonly RuleTemplate[]): RuleTemplate | null {
  let best: RuleTemplate | null = null;
  let bestScore = 0;
  for (const t of templates) {
    const score = templateScore(a.text, t);
    if (score === 0) continue;
    const types = t.types ?? TEMPLATE_TYPES[t.id] ?? [];
    const ok = t.mine || a.type === 'general' || types.includes(a.type) || score >= TEMPLATE_MIN_SCORE;
    if (ok && score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** 목표 분석으로 계획 만들기: 맞는 템플릿 → 유형 뼈대. 마감이 있으면 일정 단계를 넣는다 */
export function planFor(a: GoalAnalysis, templates: readonly RuleTemplate[]): Plan {
  const t = templateFor(a, templates);
  const drafts = t ? structuredClone(t.steps) : fillPlan(GOAL_TYPES[a.type].plan, a);
  if (a.type === 'habit' && a.sessionMinutes && !t) {
    const first = drafts.find((d: StepDraft) => d.title.startsWith('첫 1회'));
    if (first) first.minutes = a.sessionMinutes;
  }
  if (a.deadline && !drafts.some((d: StepDraft) => d.title.includes('달력'))) drafts.splice(1, 0, DEADLINE_STEP(a.deadline));
  return { drafts, basis: t ? `‘${t.title}’ 템플릿` : `${GOAL_TYPES[a.type].label} 유형` };
}
