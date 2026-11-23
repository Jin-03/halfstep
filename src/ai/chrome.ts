/**
 * Chrome 내장 AI (Prompt API, Gemini Nano). 데스크톱 Chrome 전용이라 PC에서 AI 흐름을 확인하는 용도.
 * API: https://github.com/webmachinelearning/prompt-api
 */
/// <reference types="dom-chromium-ai" />
import type { StepDraft } from '../db/ops';
import { DEFAULT_EXAMPLE } from './context';
import { buildUserPrompt, parseAnswer, responseSchema, SYSTEM_PROMPT } from './prompt';
import type { Availability, DecomposeRequest, Engine } from './types';

type LM = typeof LanguageModel;

function api(): LM | undefined {
  return (globalThis as { LanguageModel?: LM }).LanguageModel;
}

/** 한국어 출력 힌트. 지원하지 않는 버전이면 힌트 없이 쓴다 */
const WITH_KO = {
  expectedInputs: [{ type: 'text' as const, languages: ['ko', 'en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['ko'] }],
};
let createOptions: typeof WITH_KO | Record<string, never> | null = null;

async function resolveOptions(lm: LM): Promise<{ options: typeof WITH_KO | Record<string, never>; availability: string }> {
  if (createOptions) return { options: createOptions, availability: await lm.availability(createOptions) };
  let a: string = 'unavailable';
  try {
    a = await lm.availability(WITH_KO);
  } catch {
    // 언어 옵션 자체를 모르는 버전
  }
  if (a !== 'unavailable') return { options: WITH_KO, availability: a };
  const plain = {} as Record<string, never>;
  return { options: plain, availability: await lm.availability(plain) };
}

export const chromeEngine: Engine = {
  id: 'chrome',
  label: 'Chrome 내장 AI',
  description: '데스크톱 Chrome에 들어 있는 AI예요. 인터넷 없이 기기 안에서 동작해요.',

  async available(): Promise<Availability> {
    const lm = api();
    if (!lm) return { status: 'unsupported', reason: '이 브라우저에는 없어요. 데스크톱 Chrome에서만 쓸 수 있어요.' };
    try {
      const { availability } = await resolveOptions(lm);
      switch (availability) {
        case 'available':
          return { status: 'ready' };
        case 'downloadable':
          return { status: 'needs-download', reason: '처음 한 번 모델을 받아야 해요.' };
        case 'downloading':
          return { status: 'downloading', reason: '모델을 받는 중이에요.' };
        default:
          return { status: 'unsupported', reason: '이 기기에서는 쓸 수 없어요. (저장 공간·메모리·GPU 조건)' };
      }
    } catch {
      return { status: 'unsupported', reason: '상태를 확인하지 못했어요.' };
    }
  },

  async download(onProgress, signal) {
    const lm = api();
    if (!lm) throw new Error('LanguageModel 없음');
    const { options } = await resolveOptions(lm);
    const session = await lm.create({
      ...options,
      signal,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => onProgress((e as ProgressEvent).loaded));
      },
    });
    createOptions = options;
    session.destroy();
  },

  async decompose(req: DecomposeRequest, signal?: AbortSignal): Promise<StepDraft[]> {
    const lm = api();
    if (!lm) throw new Error('LanguageModel 없음');
    const { options } = await resolveOptions(lm);
    createOptions = options;
    const session = await lm.create({
      ...options,
      signal,
      initialPrompts: examplePrompts(req),
    });
    try {
      const input = buildUserPrompt(req);
      let text: string;
      try {
        text = await session.prompt(input, { responseConstraint: responseSchema(req), signal });
      } catch (err) {
        if (signal?.aborted) throw err;
        // 형식 강제를 지원하지 않는 버전: 지시문과 파서에 맡긴다.
        text = await session.prompt(input, { signal });
      }
      return parseAnswer(text, req);
    } finally {
      session.destroy();
    }
  },
};

/** 테스트용: 기억해 둔 옵션을 지운다 */
export function resetChromeEngine(): void {
  createOptions = null;
}

/** 지시문 + 목표와 가까운 예시 한 쌍 (decompose()가 만든 맞춤 예시, 없으면 기본 예시) */
function examplePrompts(req: DecomposeRequest): NonNullable<LanguageModelCreateOptions["initialPrompts"]> {
  const ex = req.context?.example ?? DEFAULT_EXAMPLE;
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt({ kind: 'goal', goal: ex.goal }) },
    { role: 'assistant', content: ex.answer },
  ];
}
