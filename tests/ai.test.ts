import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decompose, pickEngine } from '../src/ai';
import { chromeEngine, resetChromeEngine } from '../src/ai/chrome';
import {
  buildUserPrompt,
  cleanTitle,
  FEW_SHOT,
  isEcho,
  parseAnswer,
  SYSTEM_PROMPT,
  DEFAULT_MINUTES,
  estimateMinutes,
  LIMITS,
  parseSteps,
  repairJson,
  responseSchema,
  withMinutes,
} from '../src/ai/prompt';
import { rulesEngine } from '../src/ai/rules';
import { contextFor } from '../src/ai/context';
import type { Engine } from '../src/ai/types';
import { db } from '../src/db/schema';
import { setSetting } from '../src/db/settings';
import { josa } from '../src/ui/format';

const titles = (d: { title: string }[]) => d.map((x) => x.title);

describe('parseSteps: 작은 모델의 여러 가지 답', () => {
  it('정상 JSON', () => {
    const r = parseSteps('{"steps":[{"title":"자료 찾기"},{"title":"초안 쓰기","substeps":["서론","본론"]}]}');
    expect(titles(r)).toEqual(['자료 찾기', '초안 쓰기']);
    expect(titles(r[1].children!)).toEqual(['서론', '본론']);
  });

  it('코드 블록과 앞뒤 설명이 붙은 JSON', () => {
    const r = parseSteps('물론이죠! 다음과 같아요.\n```json\n{"steps":[{"title":"a"},{"title":"b"}]}\n```\n도움이 되길 바라요.');
    expect(titles(r)).toEqual(['a', 'b']);
  });

  it('끝이 잘린 JSON은 완성된 단계까지 살린다', () => {
    expect(titles(parseSteps('{"steps":[{"title":"하나"},{"title":"둘"},{"title":"셋'))).toEqual(['하나', '둘']);
    expect(titles(parseSteps('{"steps":[{"title":"하나","substeps":["a","b"]},{"tit'))).toEqual(['하나']);
    expect(titles(parseSteps('["하나","둘","세'))).toEqual(['하나', '둘']);
  });

  it('문자열 배열, 한국어 키, 다른 키 이름', () => {
    expect(titles(parseSteps('["a","b"]'))).toEqual(['a', 'b']);
    expect(titles(parseSteps('{"단계":[{"제목":"가"},{"제목":"나"}]}'))).toEqual(['가', '나']);
    const r = parseSteps('{"tasks":[{"name":"x","children":[{"name":"x1"},{"name":"x2"}]}]}');
    expect(titles(r[0].children!)).toEqual(['x1', 'x2']);
  });

  it('JSON이 아니면 번호·글머리표 목록으로 읽고 머리말·긴 설명은 버린다', () => {
    const text = `목표를 이렇게 나눠 봤어요:
1. **주제 정하기**
2. 자료 모으기
   - 책 찾기
   - 기사 찾기
3단계: 초안 쓰기.
이 계획을 따라 하면 목표를 훨씬 쉽게 이룰 수 있을 거예요. 하나씩 차근차근 해 보세요. 응원할게요! 화이팅!`;
    const r = parseSteps(text);
    expect(titles(r)).toEqual(['주제 정하기', '자료 모으기', '초안 쓰기']);
    expect(titles(r[1].children!)).toEqual(['책 찾기', '기사 찾기']);
  });

  it('번호·따옴표·마침표를 지우고 같은 단계는 하나만', () => {
    const r = parseSteps('{"steps":["1. \\"자료 찾기\\".","자료 찾기","Step 2: 쓰기","- [ ] 고치기"]}');
    expect(titles(r)).toEqual(['자료 찾기', '쓰기', '고치기']);
  });

  it('개수·길이·깊이 제한', () => {
    const many = JSON.stringify({ steps: Array.from({ length: 20 }, (_, i) => ({ title: `단계 ${i}`, substeps: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })) });
    const r = parseSteps(many);
    expect(r).toHaveLength(LIMITS.top);
    expect(r[0].children).toHaveLength(LIMITS.children);
    expect(parseSteps(`["${'가'.repeat(100)}"]`)[0].title).toHaveLength(LIMITS.title);
  });

  it('하위 단계가 하나뿐이면 버리고, flat이면 모두 버린다', () => {
    expect(parseSteps('{"steps":[{"title":"a","substeps":["a1"]}]}')[0]).not.toHaveProperty('children');
    expect(parseSteps('{"steps":[{"title":"a","substeps":["a1","a2"]}]}', true)[0]).not.toHaveProperty('children');
  });

  it('읽을 수 없으면 빈 배열', () => {
    expect(parseSteps('')).toEqual([]);
    expect(parseSteps('죄송하지만 도와드릴 수 없어요:')).toEqual([]);
    expect(parseSteps('{"error":"x"}')).toEqual([]);
  });

  it('repairJson', () => {
    expect(repairJson('{"a":[1,2')).toBeNull(); // 배열 속 숫자는 안전 지점이 아님
    expect(repairJson('{"a":["x","y')).toBe('{"a":["x"]}');
    expect(repairJson('{"a":1} 뒤의 말')).toBe('{"a":1}');
  });

  it('cleanTitle', () => {
    expect(cleanTitle('  **2) 「발표 연습」!** ')).toBe('발표 연습');
    expect(cleanTitle('1단계: 자료 찾기')).toBe('자료 찾기');
  });
});

describe('지시문을 되돌려 준 답 거르기', () => {
  it('Chromium의 되돌려 주기 답 (실제로 관찰한 형태)', () => {
    const echo = `On-device model is not available in Chromium, this API is just echoing back the input:\n${SYSTEM_PROMPT}${FEW_SHOT.user}${FEW_SHOT.assistant}목표: 이사\n\nRemember to respond in JSON`;
    // 파서만 쓰면 지시문 속 예시를 단계로 읽어 버린다
    expect(parseSteps(echo).length).toBeGreaterThan(0);
    expect(isEcho(echo)).toBe(true);
    expect(parseAnswer(echo, { kind: 'goal', goal: '이사' })).toEqual([]);
  });

  it('형식 자리표시만 있거나 예시를 베낀 답은 버린다', () => {
    expect(parseAnswer('{"steps":[{"title":"단계","substeps":["하위 단계"]}]}', { kind: 'goal', goal: '이사' })).toEqual([]);
    expect(parseAnswer(FEW_SHOT.assistant, { kind: 'goal', goal: '이사' })).toEqual([]);
    // 실제로 방 정리 목표라면 비슷한 답도 괜찮다
    expect(parseAnswer(FEW_SHOT.assistant, { kind: 'goal', goal: '방 정리' }).length).toBe(5);
  });

  it('지시문·분석 줄·목표를 그대로 옮긴 단계, 조금 바꿔 베낀 예시를 버린다 (2026-11-23 비교에서 나온 답)', () => {
    const gift = { kind: 'goal' as const, goal: '다음 주까지 부모님 생신 선물 사기' };
    const req = { ...gift, context: contextFor(gift) };
    expect(parseAnswer('{"steps":[{"title":"사기·고르기·대상 부모님 생신 선물 사기"},{"title":"마감 다음 주 마감일 정하기"}]}', req)).toEqual([]);
    const titles = parseAnswer('{"steps":[{"title":"다음 주까지 부모님 생신 선물 사기"},{"title":"예산 정하기","substeps":["목표치를 3~7개로 나누기","가격 비교하기"]}]}', req);
    expect(titles).toEqual([{ title: '예산 정하기', children: [{ title: '가격 비교하기', minutes: 15 }] }]);
    const volunteer = { kind: 'goal' as const, goal: '동네 봉사활동 시작하기' };
    const copied = '{"steps":[{"title":"집 근처 쓰레기봉투 찾기"},{"title":"집 근처 눈에 보이는 쓰레기 버리기"},{"title":"집 근처 바닥 닦기"}]}';
    expect(parseAnswer(copied, { ...volunteer, context: contextFor(volunteer) })).toEqual([]);
  });

  it('더 제안: 이미 있는 단계를 다시 내놓으면 뺀다 (모두 겹치면 빈 결과)', () => {
    const req = { kind: 'more' as const, goal: '글', existing: ['자료 찾기', '초안 쓰기'] };
    expect(parseAnswer('["자료 찾기","초안  쓰기","고치기"]', req).map((d) => d.title)).toEqual(['고치기']);
    expect(parseAnswer('["자료 찾기"]', req)).toEqual([]);
  });

  it('정상 답은 예상 시간까지 채운다', () => {
    expect(parseAnswer('["자료 찾기","초안 쓰기"]', { kind: 'more', goal: '글', existing: [] })).toEqual([
      { title: '자료 찾기', minutes: 20 },
      { title: '초안 쓰기', minutes: 30 },
    ]);
  });
});

describe('지시문', () => {
  it('요청 종류별로 필요한 정보가 들어간다', () => {
    expect(buildUserPrompt({ kind: 'goal', goal: '이사' })).toContain('목표: 이사');
    const split = buildUserPrompt({ kind: 'split', goal: '글', step: '초안', path: ['쓰기'] });
    expect(split).toContain('쓰기 > 초안');
    expect(split).toContain('substeps는 쓰지 마라');
    const more = buildUserPrompt({ kind: 'more', goal: '글', existing: ['a', 'b'] });
    expect(more).toContain('- a\n- b');
  });

  it('쪼개기·더 제안 스키마에는 substeps가 없다', () => {
    expect(JSON.stringify(responseSchema({ kind: 'goal', goal: 'x' }))).toContain('substeps');
    expect(JSON.stringify(responseSchema({ kind: 'more', goal: 'x', existing: [] }))).not.toContain('substeps');
  });
});

describe('예상 시간 (규칙)', () => {
  it('키워드로 추정, 긴 키워드 우선, 없으면 기본값', () => {
    expect(estimateMinutes('목차 정하기')).toBe(5);
    expect(estimateMinutes('초안 쓰기')).toBe(30);
    expect(estimateMinutes('짐 싸기')).toBe(45);
    expect(estimateMinutes('친구 만나기')).toBe(DEFAULT_MINUTES);
    expect(estimateMinutes('복습 1시간')).toBe(60);
  });

  it('리프에만 채우고, 제목 속 시간은 떼어 낸다', () => {
    const r = withMinutes([{ title: '초안 쓰기 40분' }, { title: '정리', children: [{ title: '책상 닦기' }, { title: '버리기' }] }], { kind: 'goal', goal: 'x' });
    expect(r[0]).toEqual({ title: '초안 쓰기', minutes: 40 });
    expect(r[1]).not.toHaveProperty('minutes');
    expect(r[1].children!.map((c) => c.minutes)).toEqual([15, 10]);
  });

  it('쪼개기: 원래 시간에 맞춰 비율로 나눈다', () => {
    const r = withMinutes([{ title: '자료 찾기' }, { title: '쓰기' }, { title: '확인' }], { kind: 'split', goal: 'x', step: 'y', minutes: 60, path: [] });
    // 추정 20 / 30 / 5 → 합 55 → 60분에 맞춰 비율 배분 후 5분 단위
    expect(r.map((d) => d.minutes)).toEqual([20, 35, 5]);
  });

  it('조사', () => {
    expect(josa('기본 규칙', '으로')).toBe('기본 규칙으로');
    expect(josa('Chrome 내장 AI', '으로')).toBe('Chrome 내장 AI로');
    expect(josa('기기 내 모델', '이')).toBe('기기 내 모델이');
    expect(josa('서울', '으로')).toBe('서울로');
    expect(josa('Chrome 내장 AI', '을')).toBe('Chrome 내장 AI를');
  });
});

// ───────────── Chrome 내장 AI (가짜 LanguageModel) ─────────────

type Behavior = {
  availability?: (opts: { expectedOutputs?: unknown }) => string;
  prompt?: (input: string, opts: { responseConstraint?: unknown; signal?: AbortSignal }) => Promise<string>;
};

function installFakeLM(b: Behavior) {
  const calls = { created: [] as unknown[], prompts: [] as { input: string; constrained: boolean }[], destroyed: 0 };
  const LM = {
    availability: vi.fn(async (opts: { expectedOutputs?: unknown }) => (b.availability ? b.availability(opts) : 'available')),
    create: vi.fn(async (opts: { monitor?: (m: EventTarget) => void }) => {
      calls.created.push(opts);
      if (opts.monitor) {
        const m = new EventTarget();
        opts.monitor(m);
        for (const loaded of [0, 0.5, 1]) m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
      }
      return {
        prompt: async (input: string, o: { responseConstraint?: unknown; signal?: AbortSignal }) => {
          calls.prompts.push({ input, constrained: !!o.responseConstraint });
          return b.prompt ? b.prompt(input, o) : '{"steps":[{"title":"자료 찾기"},{"title":"초안 쓰기"}]}';
        },
        destroy: () => {
          calls.destroyed++;
        },
      };
    }),
  };
  (globalThis as Record<string, unknown>).LanguageModel = LM;
  return calls;
}

beforeEach(async () => {
  resetChromeEngine();
  await db.settings.clear();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).LanguageModel;
});

describe('Chrome 내장 AI 엔진', () => {
  it('없으면 사용 불가와 이유', async () => {
    expect((await chromeEngine.available()).status).toBe('unsupported');
  });

  it('상태 변환', async () => {
    for (const [raw, status] of [['available', 'ready'], ['downloadable', 'needs-download'], ['downloading', 'downloading'], ['unavailable', 'unsupported']]) {
      resetChromeEngine();
      installFakeLM({ availability: () => raw });
      expect((await chromeEngine.available()).status).toBe(status);
    }
  });

  it('한국어 힌트를 지원하지 않으면 힌트 없이 쓴다', async () => {
    const calls = installFakeLM({ availability: (o) => (o.expectedOutputs ? 'unavailable' : 'available') });
    expect((await chromeEngine.available()).status).toBe('ready');
    await chromeEngine.decompose({ kind: 'goal', goal: '글쓰기' });
    expect(calls.created[0]).not.toHaveProperty('expectedOutputs');
  });

  it('형식을 강제해 묻고, 결과에 예상 시간을 채우고, 세션을 닫는다', async () => {
    const calls = installFakeLM({});
    const r = await chromeEngine.decompose({ kind: 'goal', goal: '블로그 글' });
    expect(r).toEqual([{ title: '자료 찾기', minutes: 20 }, { title: '초안 쓰기', minutes: 30 }]);
    expect(calls.prompts[0].constrained).toBe(true);
    expect(calls.prompts[0].input).toContain('블로그 글');
    expect(calls.destroyed).toBe(1);
  });

  it('형식 강제를 지원하지 않으면 강제 없이 다시 묻는다', async () => {
    const calls = installFakeLM({
      prompt: async (_i, o) => {
        if (o.responseConstraint) throw new Error('NotSupported');
        return '1. 하나\n2. 둘';
      },
    });
    expect(titles(await chromeEngine.decompose({ kind: 'goal', goal: 'x' }))).toEqual(['하나', '둘']);
    expect(calls.prompts.map((p) => p.constrained)).toEqual([true, false]);
    expect(calls.destroyed).toBe(1);
  });

  it('모델 받기 진행률', async () => {
    installFakeLM({ availability: () => 'downloadable' });
    const seen: number[] = [];
    await chromeEngine.download!((r) => seen.push(r));
    expect(seen).toEqual([0, 0.5, 1]);
  });
});

describe('엔진 선택과 기본 규칙으로 넘어가기', () => {
  const fake = (over: Partial<Engine>): Engine => ({
    id: 'chrome',
    label: 'Chrome 내장 AI',
    description: '',
    available: async () => ({ status: 'ready' }),
    decompose: async () => [{ title: 'AI 단계', minutes: 5 }],
    ...over,
  });

  it('자동: 쓸 수 있는 첫 엔진', async () => {
    const r = await decompose({ kind: 'goal', goal: '시험 공부' }, undefined, { engines: [fake({}), rulesEngine] });
    expect(r).toMatchObject({ origin: { source: 'ai', engine: 'chrome' }, engineLabel: 'Chrome 내장 AI' });
    expect(r.fallbackReason).toBeUndefined();
  });

  it('자동: AI를 쓸 수 없으면 조용히 기본 규칙 (이유 없음)', async () => {
    const r = await decompose({ kind: 'goal', goal: '시험 공부' }, undefined, {
      engines: [fake({ available: async () => ({ status: 'unsupported', reason: '없음' }) }), rulesEngine],
    });
    expect(r.origin).toEqual({ source: 'rules' });
    expect(r.fallbackReason).toBeUndefined();
    expect(r.drafts[0].title).toBe('시험 범위 파악하기');
  });

  it('직접 고른 AI를 쓸 수 없으면 기본 규칙과 그 이유', async () => {
    await setSetting('enginePref', 'chrome');
    const r = await decompose({ kind: 'goal', goal: 'x' }, undefined, {
      engines: [fake({ available: async () => ({ status: 'needs-download', reason: '모델을 받아야 해요.' }) }), rulesEngine],
    });
    expect(r.origin).toEqual({ source: 'rules' });
    expect(r.fallbackReason).toBe('Chrome 내장 AI: 모델을 받아야 해요.');
  });

  it('기다림 안내: AI는 준비(있으면) → 생각 순서로 알리고, 기본 규칙은 알리지 않는다', async () => {
    const phases: string[] = [];
    const onPhase = (p: { stage: string }) => phases.push(p.stage);
    await decompose({ kind: 'goal', goal: 'x' }, undefined, { engines: [fake({ warmup: async () => {} }), rulesEngine], onPhase });
    expect(phases).toEqual(['preparing', 'thinking']);
    phases.length = 0;
    await decompose({ kind: 'goal', goal: 'x' }, undefined, { engines: [rulesEngine], onPhase });
    expect(phases).toEqual([]);
  });

  it('기본 규칙을 고르면 AI가 있어도 규칙', async () => {
    await setSetting('enginePref', 'rules');
    const { engine } = await pickEngine([fake({}), rulesEngine]);
    expect(engine.id).toBe('rules');
  });

  it('AI가 실패하면 기본 규칙', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await decompose({ kind: 'goal', goal: 'x' }, undefined, {
      engines: [fake({ decompose: async () => { throw new Error('boom'); } }), rulesEngine],
    });
    expect(r.origin).toEqual({ source: 'rules' });
    expect(r.fallbackReason).toBe('Chrome 내장 AI 실행 중 문제가 생겼어요.');
    warn.mockRestore();
  });

  it('AI 답을 읽지 못하면 기본 규칙', async () => {
    const r = await decompose({ kind: 'goal', goal: 'x' }, undefined, { engines: [fake({ decompose: async () => [] }), rulesEngine] });
    expect(r.fallbackReason).toBe('Chrome 내장 AI의 답을 단계로 읽지 못했어요.');
  });

  it('너무 오래 걸리면 엔진을 멈추고 기본 규칙', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let engineSignal: AbortSignal | undefined;
    const slow = fake({
      decompose: (_r, signal) => {
        engineSignal = signal;
        return new Promise(() => {});
      },
    });
    const r = await decompose({ kind: 'goal', goal: 'x' }, undefined, { engines: [slow, rulesEngine], timeoutMs: 20 });
    expect(r.fallbackReason).toBe('Chrome 내장 AI가 너무 오래 걸렸어요.');
    expect(engineSignal?.aborted).toBe(true);
    warn.mockRestore();
  });

  it('사용자가 멈추면 AbortError (기본 규칙으로 넘어가지 않음)', async () => {
    const ctrl = new AbortController();
    const slow = fake({
      decompose: (_r, signal) =>
        new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))),
    });
    const p = decompose({ kind: 'goal', goal: 'x' }, ctrl.signal, { engines: [slow, rulesEngine] });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
