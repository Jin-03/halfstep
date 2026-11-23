/**
 * WebLLM (브라우저 안에서 WebGPU로 도는 모델). 선택해서 받는 엔진이다.
 * WebLLM 코드는 크므로 처음 쓸 때만 불러온다(import()).
 * 지시문·응답 형식·답 해석은 Chrome 내장 AI와 같은 prompt.ts를 쓴다.
 */
import type { StepDraft } from '../db/ops';
import { DEFAULT_EXAMPLE } from './context';
import { buildUserPrompt, parseAnswer, responseSchema, SYSTEM_PROMPT } from './prompt';
import type { DecomposeRequest } from './types';

type WebLLM = typeof import('@mlc-ai/web-llm');
export type LoadedModel = import('@mlc-ai/web-llm').WebWorkerMLCEngine;

let lib: Promise<WebLLM> | null = null;
const loadLib = () => (lib ??= import('@mlc-ai/web-llm'));

/** WebGPU를 쓸 수 있는지. 없으면 이유를 돌려준다 */
export async function webgpuStatus(): Promise<{ ok: true; f16: boolean } | { ok: false; reason: string }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return { ok: false, reason: '이 브라우저는 WebGPU를 지원하지 않아요.' };
  const adapter = await gpu.requestAdapter().catch(() => null);
  if (!adapter) return { ok: false, reason: '이 기기의 GPU를 쓸 수 없어요.' };
  return { ok: true, f16: adapter.features.has('shader-f16') };
}

/** 모델이 이미 받아져 있는지 */
export async function isModelCached(modelId: string): Promise<boolean> {
  const w = await loadLib();
  return w.hasModelInCache(modelId);
}

/** 받아 둔 모델 지우기 */
export async function deleteModel(modelId: string): Promise<void> {
  const w = await loadLib();
  await w.deleteModelAllInfoInCache(modelId);
}

/**
 * 모델을 (필요하면 받아서) GPU에 올린다. 진행률은 0~1.
 * 처음이면 받기, 그다음부터는 기기에 저장된 파일에서 불러오기만 한다.
 */
export async function loadModel(
  modelId: string,
  onProgress?: (ratio: number, text: string) => void,
): Promise<LoadedModel> {
  const w = await loadLib();
  const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
  return w.CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback: (p) => onProgress?.(p.progress, p.text),
  });
}

/** 모델이 낸 원래 답과, 그 답을 단계로 읽은 결과 */
export interface WebllmAnswer {
  raw: string;
  drafts: StepDraft[];
  finishReason: string | null;
}

/** 지시문 + 목표와 가까운 예시 한 쌍 + 요청으로 한 번 묻는다 */
export async function askModel(model: LoadedModel, req: DecomposeRequest, signal?: AbortSignal): Promise<WebllmAnswer> {
  const ex = req.context?.example ?? DEFAULT_EXAMPLE;
  const onAbort = () => model.interruptGenerate();
  signal?.addEventListener('abort', onAbort);
  try {
    await model.resetChat();
    const reply = await model.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt({ kind: 'goal', goal: ex.goal }) },
        { role: 'assistant', content: ex.answer },
        { role: 'user', content: buildUserPrompt(req) },
      ],
      response_format: { type: 'json_object', schema: JSON.stringify(responseSchema(req)) },
      temperature: 0.3,
      max_tokens: 600,
      // Qwen3 계열의 "생각하기"를 끈다 (답이 늦어지고 형식이 깨지기 쉬움)
      extra_body: { enable_thinking: false },
    });
    if (signal?.aborted) throw new DOMException('멈췄어요', 'AbortError');
    const choice = reply.choices[0];
    const raw = choice?.message.content ?? '';
    return { raw, drafts: parseAnswer(raw, req), finishReason: choice?.finish_reason ?? null };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
