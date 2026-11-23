import { describe, expect, it } from 'vitest';
import { analyzeGoal, describeAnalysis, planFor, templateFor, templateScore } from '../src/ai/analyze';
import { BUILTIN, contextFor, exampleFor } from '../src/ai/context';
import { buildUserPrompt } from '../src/ai/prompt';
import { refine } from '../src/ai/refine';
import { splitByPattern } from '../src/ai/rules';
import { FIRST_STEP_MAX, GOAL_TYPES } from '../src/ai/rulesData';

describe('목표 분석', () => {
  it.each([
    ['다음 주까지 부모님 생신 선물 사기', { type: 'buy', object: '부모님 생신 선물', deadline: '다음 주' }],
    ['토익 900점 받기', { type: 'target', object: '토익', target: '900점' }],
    ['매일 20분 책 읽기', { type: 'habit', activity: '책 읽기', frequency: '매일', sessionMinutes: 20 }],
    ['주 3회 헬스 가기', { type: 'habit', frequency: '주 3회' }],
    ['꾸준히 일기 쓰기', { type: 'habit', activity: '일기 쓰기', frequency: '꾸준히' }],
    ['여권 재발급 신청하기', { type: 'admin', object: '여권 재발급' }],
    ['3일 안에 이력서 제출', { type: 'admin', object: '이력서', deadline: '3일 안' }],
    ['신발장 정리', { type: 'tidy', object: '신발장' }],
    ['11월 20일까지 블로그 글 쓰기', { type: 'make', object: '블로그 글', deadline: '11월 20일' }],
    ['엑셀 함수 배우기', { type: 'learn', object: '엑셀 함수' }],
    ['집주인에게 보일러 수리 요청하기', { type: 'communicate', object: '집주인에게' }],
    ['이번 달 말까지 5kg 빼기', { type: 'target', target: '5kg', deadline: '이번 달 말' }],
    ['노트북 바꾸기', { type: 'buy', object: '노트북' }],
    ['금요일까지 보고서 작성', { type: 'make', object: '보고서', deadline: '금요일' }],
    ['글로벌 마케팅 방법 조사', { type: 'general', object: '글로벌 마케팅 방법' }],
    // 2026-11-23: 규칙이 본 적 없는 목표에서 나온 문제
    ['이번 주말까지 중고 노트북 팔기', { type: 'sell', object: '중고 노트북', deadline: '이번 주말' }],
    ['일주일 식비 5만 원으로 줄이기', { type: 'target', object: '일주일 식비', target: '5만원' }],
    ['유튜브 첫 영상 올리기', { type: 'general' }],
    ['아침 6시에 일어나는 습관 만들기', { type: 'habit', activity: '아침 6시에 일어나기' }],
    ['이력서 고쳐서 회사 3곳 지원하기', { type: 'admin', object: '' }],
  ])('%s', (goal, expected) => {
    expect(analyzeGoal(goal)).toMatchObject(expected);
  });

  it('"연말정산"의 연말은 마감이 아니다', () => {
    expect(analyzeGoal('연말정산 서류 챙기기').deadline).toBeUndefined();
    expect(analyzeGoal('연말까지 보고서 작성').deadline).toBe('연말');
  });

  it('읽어 낸 정보 문장', () => {
    expect(describeAnalysis(analyzeGoal('다음 주까지 부모님 생신 선물 사기'))).toBe('대상 부모님 생신 선물 · 마감 다음 주');
    expect(describeAnalysis(analyzeGoal('매일 20분 책 읽기'))).toBe('활동 책 읽기 · 횟수 매일 20분');
  });
});

describe('계획 만들기', () => {
  const plan = (g: string) => planFor(analyzeGoal(g), BUILTIN);

  it('유형 뼈대에 대상과 마감을 채운다', () => {
    const p = plan('다음 주까지 부모님 생신 선물 사기');
    expect(p.basis).toBe('사기·고르기 유형');
    expect(p.drafts.map((d) => d.title).slice(0, 4)).toEqual([
      '부모님 생신 선물 예산 정하기',
      '다음 주까지 일정을 달력에 나눠 적기',
      '꼭 필요한 조건 3가지 적기',
      '부모님 생신 선물 후보 3개 찾기',
    ]);
    expect(plan('3일 안에 이력서 제출').drafts[1].title).toBe('3일 안에 끝내도록 일정을 달력에 나눠 적기');
  });

  it('습관: 활동·횟수·1회 분량', () => {
    const t = plan('매일 20분 책 읽기').drafts;
    expect(t.find((d) => d.title === '첫 1회 해 보기')?.minutes).toBe(20);
    expect(t.some((d) => d.title === '이번 주 매일 해 보기')).toBe(true);
    // 횟수마다 이번 주 문장이 자연스럽게
    const week = (g: string) => plan(g).drafts.find((d) => d.title.startsWith('이번 주'))?.title;
    expect(week('주 3회 화분에 물 주기')).toBe('이번 주 3번 해 보기');
    expect(week('매주 토요일 부모님께 전화하기')).toBe('이번 주 토요일에 해 보기');
    expect(week('아침 6시에 일어나는 습관 만들기')).toBe('이번 주 3번 해 보기');
  });

  it('템플릿은 유형이 맞거나 키워드가 충분할 때만', () => {
    expect(templateFor(analyzeGoal('여권 재발급 신청하기'), BUILTIN)).toBeNull(); // '여권' 하나로 여행 템플릿이 되지 않음
    expect(templateFor(analyzeGoal('시험'), BUILTIN)?.id).toBe('exam');
    expect(templateFor(analyzeGoal('친구 결혼식 축사 준비'), BUILTIN)?.id).toBe('presentation');
    expect(plan('11월 20일까지 블로그 글 쓰기').basis).toBe('‘글 한 편 쓰기’ 템플릿');
  });

  it('어미·비슷한 말·한 글자 키워드', () => {
    const exercise = BUILTIN.find((t) => t.id === 'exercise')!;
    expect(templateScore('살림살이 줄이기', exercise)).toBe(0);
    expect(templateScore('헬스장 다니기', exercise)).toBeGreaterThan(0);
    expect(templateScore('헬스를 시작', exercise)).toBeGreaterThan(0); // 헬스 → 운동
    const writing = BUILTIN.find((t) => t.id === 'writing')!;
    expect(templateScore('글로벌 시장', writing)).toBe(0); // '글'은 낱말 단위로만
    expect(templateScore('짧은 글 하나', writing)).toBeGreaterThan(0);
  });
});

it('모든 유형 뼈대의 첫 단계는 기준 시간 이내', () => {
  for (const [type, rule] of Object.entries(GOAL_TYPES)) expect(rule.plan[0].minutes ?? 0, type).toBeLessThanOrEqual(FIRST_STEP_MAX);
});

describe('쪼개기 패턴', () => {
  it('단계 성격별로, 원래 시간에 맞춰', () => {
    expect(splitByPattern('보고서 쓰기', 60).map((d) => [d.title, d.minutes])).toEqual([
      ['쓸 내용 세 줄로 개요 잡기', 10],
      ['초안 쓰기', 35],
      ['다시 읽고 고치기', 15],
    ]);
    expect(splitByPattern('숙소 찾기').map((d) => d.title)).toEqual(['검색어나 기준 정하기', '후보 모으기', '비교해서 고르기']);
    expect(splitByPattern('영어 공부', 90).filter((d) => d.minutes === 25)).toHaveLength(4);
  });
});

describe('결과 검사', () => {
  it('다짐뿐인 단계는 빼고, 하나만 남으면 그대로', () => {
    const req = { kind: 'more' as const, goal: 'x', existing: [] };
    expect(refine([{ title: '열심히 하기' }, { title: '자료 찾기' }], req).map((d) => d.title)).toEqual(['자료 찾기']);
    expect(refine([{ title: '노력하기' }], req).map((d) => d.title)).toEqual(['노력하기']);
  });

  it('첫 단계가 15분보다 길면 더 작게 나눈다', () => {
    const r = refine([{ title: '초안 쓰기', minutes: 40 }, { title: '올리기', minutes: 10 }], { kind: 'goal', goal: 'x' });
    expect(r[0].minutes).toBeUndefined();
    expect(r[0].children?.[0]).toEqual({ title: '쓸 내용 세 줄로 개요 잡기', minutes: 10 });
    expect(r[1]).toEqual({ title: '올리기', minutes: 10 });
  });
});

describe('AI 지시문 연결', () => {
  it('분석 줄과 마감 지시가 들어간다', () => {
    const req = { kind: 'goal' as const, goal: '다음 주까지 부모님 생신 선물 사기' };
    const text = buildUserPrompt({ ...req, context: contextFor(req) });
    expect(text).toContain('종류: 사기·고르기 · 대상 부모님 생신 선물 · 마감 다음 주');
    expect(text).toContain('마감에 맞춰 일정을 정하는 단계');
    expect(buildUserPrompt(req)).not.toContain('종류:');
  });

  it('예시: 맞는 템플릿 → 유형 예시 → 기본 예시', () => {
    expect(exampleFor(analyzeGoal('블로그 글 쓰기'), BUILTIN).goal).toBe('글 한 편 쓰기');
    const buy = exampleFor(analyzeGoal('노트북 바꾸기'), BUILTIN);
    expect(buy.goal).toBe('새 운동화 사기');
    expect(buy.answer).toContain('새 운동화 후보 3개 찾기');
    expect(exampleFor(analyzeGoal('동네 봉사활동 시작하기'), BUILTIN).goal).toBe('방 정리하기');
  });

  it('더 제안: 많이 진행됐으면 마무리 우선 지시', () => {
    expect(buildUserPrompt({ kind: 'more', goal: 'x', existing: ['a'], doneRatio: 0.7 })).toContain('마무리와 점검');
  });
});

describe('목표 메모 (2026-11-23)', () => {
  it('AI 지시문에 메모가 들어가고, 기본 규칙은 메모에서 마감만 더 읽는다', () => {
    const req = { kind: 'goal' as const, goal: '블로그 글 쓰기', note: '금요일까지 올려야 해요. 주제는 이미 정했어요.' };
    const ctx = contextFor(req);
    expect(ctx.analysis).toMatchObject({ type: 'make', deadline: '금요일' });
    const prompt = buildUserPrompt({ ...req, context: ctx });
    expect(prompt).toContain('메모: 금요일까지 올려야 해요. 주제는 이미 정했어요.');
    expect(prompt).toContain('마감에 맞춰 일정을 정하는 단계');
    // 메모가 없으면 지시문도 그대로
    expect(buildUserPrompt({ kind: 'goal', goal: '블로그 글 쓰기' })).not.toContain('메모');
    // 메모로 유형이 바뀌지는 않는다
    expect(contextFor({ kind: 'goal', goal: '블로그 글 쓰기', note: '매일 조금씩' }).analysis.type).toBe('make');
  });
});
