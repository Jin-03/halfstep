/**
 * 분해 엔진 선택과 실행.
 * - 웹(PWA): Chrome 내장 AI → WebLLM(받아 둔 경우만) → 기본 규칙
 * - 앱(6단계): Gemini Nano → 기기 내 모델 → 기본 규칙  (ENGINES 앞에 추가)
 * AI가 실패하거나, 너무 오래 걸리거나, 읽을 수 없는 답을 내면 기본 규칙으로 넘어가고 그 이유를 알려 준다.
 */
import type { StepDraft } from '../db/ops';
import type { StepOrigin } from '../db/schema';
import { getSetting } from '../db/settings';
import { describeAnalysis } from './analyze';
import { chromeEngine } from './chrome';
import { webllmEngine } from './webllm';
import { makeContext } from './context';
import { refine } from './refine';
import { rulesEngine, rulesPlan } from './rules';
import { originOf, type DecomposeRequest, type Engine } from './types';
import { josa } from '../ui/format';

export const ENGINES: readonly Engine[] = [chromeEngine, webllmEngine, rulesEngine];

export const AI_TIMEOUT_MS = 60_000;

export interface DecomposeResult {
  drafts: StepDraft[];
  origin: StepOrigin;
  engineLabel: string;
  /** 고른 엔진 대신 기본 규칙을 썼다면 그 이유 */
  fallbackReason?: string;
  /** 기본 규칙이 무엇을 근거로 나눴는지 (예: "사기·고르기 유형") */
  basis?: string;
  /** 목표에서 읽어 낸 정보 (예: "대상 부모님 생신 선물 · 마감 다음 주"). 없으면 '' */
  understood: string;
}

/** 설정과 상태에 따라 쓸 엔진. 고른 엔진을 쓸 수 없으면 기본 규칙과 이유를 돌려준다 */
export async function pickEngine(engines: readonly Engine[] = ENGINES): Promise<{ engine: Engine; reason?: string }> {
  const pref = await getSetting('enginePref');
  if (pref !== 'auto') {
    const chosen = engines.find((e) => e.id === pref);
    if (chosen) {
      const a = await chosen.available();
      if (a.status === 'ready') return { engine: chosen };
      return { engine: rulesEngine, reason: `${chosen.label}: ${a.reason ?? '지금은 쓸 수 없어요.'}` };
    }
  }
  for (const e of engines) if ((await e.available()).status === 'ready') return { engine: e };
  return { engine: rulesEngine };
}

/**
 * AI가 지금 무엇을 하는지 (화면의 기다림 안내용). 기본 규칙만 쓸 때는 알리지 않는다(바로 끝나므로).
 * - preparing: 모델을 메모리에 올리는 중 (WebLLM. 시간 제한 밖)
 * - thinking: 답을 기다리는 중 (AI_TIMEOUT_MS 안에 끝나거나 기본 규칙으로 넘어감)
 */
export interface AiPhase {
  stage: 'preparing' | 'thinking';
  engineLabel: string;
}

export class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, ctrl: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError());
    }, ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * 고른 엔진으로 나누고, 안 되면 기본 규칙으로.
 * 사용자가 멈추면(signal) AbortError를 그대로 던진다.
 */
export async function decompose(
  req: DecomposeRequest,
  signal?: AbortSignal,
  opts: { engines?: readonly Engine[]; timeoutMs?: number; onPhase?: (phase: AiPhase) => void } = {},
): Promise<DecomposeResult> {
  const { engine, reason } = await pickEngine(opts.engines);
  // 목표 분석·템플릿·맞춤 예시를 한 번 만들어 모든 엔진이 함께 쓴다.
  const full = { ...req, context: req.context ?? (await makeContext(req)) };
  const understood = describeAnalysis(full.context.analysis);
  const viaRules = async (fallbackReason?: string): Promise<DecomposeResult> => {
    const plan = rulesPlan(full, full.context);
    return {
      drafts: refine(plan.drafts, full),
      origin: originOf(rulesEngine),
      engineLabel: rulesEngine.label,
      basis: plan.basis,
      understood,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
  };
  if (engine === rulesEngine) return viaRules(reason);

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    // 엔진을 고르는 사이에 이미 멈췄을 수 있다.
    if (signal?.aborted) throw new DOMException('멈췄어요', 'AbortError');
    // 모델을 메모리에 올리는 시간(WebLLM은 몇 초)은 답을 기다리는 시간 제한에 넣지 않는다
    if (engine.warmup) {
      opts.onPhase?.({ stage: 'preparing', engineLabel: engine.label });
      await engine.warmup(ctrl.signal);
    }
    opts.onPhase?.({ stage: 'thinking', engineLabel: engine.label });
    const drafts = await withTimeout(engine.decompose(full, ctrl.signal), opts.timeoutMs ?? AI_TIMEOUT_MS, ctrl);
    if (drafts.length > 0) return { drafts: refine(drafts, full), origin: originOf(engine), engineLabel: engine.label, understood };
    return viaRules(`${engine.label}의 답을 단계로 읽지 못했어요.`);
  } catch (err) {
    if (signal?.aborted) throw new DOMException('멈췄어요', 'AbortError');
    console.warn(`[${engine.id}] 실패, 기본 규칙 사용`, err);
    return viaRules(
      err instanceof TimeoutError
        ? `${josa(engine.label, '이')} 너무 오래 걸렸어요.`
        : `${engine.label} 실행 중 문제가 생겼어요.`,
    );
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export type { DecomposeRequest, Engine } from './types';
