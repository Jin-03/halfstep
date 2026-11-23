/**
 * WebLLM (브라우저 안에서 WebGPU로 도는 모델). 사용자가 AI 설정에서 받을 때만 쓰는 선택 엔진이다.
 * - 모델: Qwen3.5-4B [결정 2026-11-23, 모델 비교 결과]. 약 2.3GB, 사실상 PC용.
 * - WebLLM 코드는 크므로 받기·나누기를 할 때만 불러온다(import()). 받았는지는 설정(webllmModel)으로 안다.
 * - 모델은 워커에서 돈다(AI가 생각하는 동안 화면이 멈추지 않도록).
 * - 지시문·응답 형식·답 해석은 Chrome 내장 AI와 같은 prompt.ts를 쓴다.
 */
import type { StepDraft } from '../db/ops';
import { getSetting, setSetting } from '../db/settings';
import { DEFAULT_EXAMPLE } from './context';
import { buildUserPrompt, parseAnswer, responseSchema, SYSTEM_PROMPT } from './prompt';
import type { Availability, DecomposeRequest, Engine } from './types';

type WebLLM = typeof import('@mlc-ai/web-llm');
export type LoadedModel = import('@mlc-ai/web-llm').WebWorkerMLCEngine;

/** GPU가 16비트 연산(shader-f16)을 지원하면 앞의 것, 아니면 뒤의 것 */
export const WEBLLM_MODELS = { f16: 'Qwen3.5-4B-q4f16_1-MLC', f32: 'Qwen3.5-4B-q4f32_1-MLC' } as const;

/** 마지막으로 쓴 뒤 이 시간이 지나면 모델을 GPU 메모리에서 내린다 */
const IDLE_UNLOAD_MS = 10 * 60 * 1000;

let lib: Promise<WebLLM> | null = null;
const loadLib = () => (lib ??= import('@mlc-ai/web-llm'));

const abortError = () => new DOMException('멈췄어요', 'AbortError');

// ───────────── WebGPU ─────────────

type GpuStatus = { ok: true; f16: boolean } | { ok: false; reason: string };
let gpuStatus: Promise<GpuStatus> | null = null;

/** WebGPU를 쓸 수 있는지. 없으면 이유를 돌려준다 (한 번만 확인) */
export function webgpuStatus(): Promise<GpuStatus> {
  return (gpuStatus ??= (async (): Promise<GpuStatus> => {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    if (!gpu) return { ok: false, reason: '이 브라우저는 WebGPU를 지원하지 않아요. 데스크톱 Chrome이나 Edge에서 쓸 수 있어요.' };
    const adapter = await gpu.requestAdapter().catch(() => null);
    if (!adapter) return { ok: false, reason: '이 기기의 GPU를 쓸 수 없어요.' };
    return { ok: true, f16: adapter.features.has('shader-f16') };
  })());
}

// ───────────── 모델 받기·불러오기 ─────────────

/** 모델이 이미 받아져 있는지 (WebLLM 코드를 불러온다) */
export async function isModelCached(modelId: string): Promise<boolean> {
  const w = await loadLib();
  return w.hasModelInCache(modelId);
}

/**
 * 모델을 (필요하면 받아서) GPU에 올린다. 진행률은 0~1.
 * 처음이면 받기, 그다음부터는 기기에 저장된 파일에서 불러오기만 한다.
 * signal로 멈추면 워커를 끝내고 AbortError를 던진다 (받던 파일은 남아 다음에 이어 받는다).
 */
export async function loadModel(
  modelId: string,
  onProgress?: (ratio: number, text: string) => void,
  signal?: AbortSignal,
): Promise<LoadedModel> {
  const w = await loadLib();
  if (signal?.aborted) throw abortError();
  const worker = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
  const created = w.CreateWebWorkerMLCEngine(worker, modelId, {
    initProgressCallback: (p) => onProgress?.(p.progress, p.text),
  });
  if (!signal) return created;
  return new Promise<LoadedModel>((resolve, reject) => {
    const onAbort = () => {
      worker.terminate();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    created.then(
      (m) => {
        signal.removeEventListener('abort', onAbort);
        resolve(m);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        worker.terminate();
        reject(e);
      },
    );
  });
}

/** 받아 둔 모델 지우기 */
export async function deleteModel(modelId: string): Promise<void> {
  const w = await loadLib();
  await w.deleteModelAllInfoInCache(modelId);
}

// ───────────── 묻기 ─────────────

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
    if (signal?.aborted) throw abortError();
    const choice = reply.choices[0];
    const raw = choice?.message.content ?? '';
    return { raw, drafts: parseAnswer(raw, req), finishReason: choice?.finish_reason ?? null };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// ───────────── 엔진 ─────────────

/** 지금 메모리에 올라와 있거나 올리는 중인 모델 */
let current: { id: string; model: Promise<LoadedModel>; ctrl: AbortController } | null = null;
let downloading = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** 받아 둔 모델을 메모리에 올린다 (이미 올라와 있으면 그대로) */
function getModel(id: string, onProgress?: (ratio: number) => void, signal?: AbortSignal): Promise<LoadedModel> {
  if (!current || current.id !== id) {
    void unload();
    const ctrl = new AbortController();
    const model = loadModel(id, (r) => onProgress?.(r), ctrl.signal);
    current = { id, model, ctrl };
    model.catch(() => {
      if (current?.model === model) current = null;
    });
  }
  const mine = current;
  if (!signal) return mine.model;
  // 기다리던 쪽이 멈추면 불러오기도 멈춘다 (다음에는 기기에 저장된 파일에서 다시 불러온다)
  return new Promise<LoadedModel>((resolve, reject) => {
    const onAbort = () => {
      mine.ctrl.abort();
      reject(abortError());
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    mine.model.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** 모델을 GPU 메모리에서 내린다 (받은 파일은 남는다) */
async function unload(): Promise<void> {
  clearTimeout(idleTimer);
  const c = current;
  current = null;
  if (!c) return;
  c.ctrl.abort();
  await c.model.then((m) => m.unload()).catch(() => {});
}

function touchIdle(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void unload(), IDLE_UNLOAD_MS);
}

async function pickModelId(): Promise<string> {
  const gpu = await webgpuStatus();
  return gpu.ok && gpu.f16 ? WEBLLM_MODELS.f16 : WEBLLM_MODELS.f32;
}

export const webllmEngine: Engine = {
  id: 'webllm',
  label: 'WebLLM (Qwen3.5-4B)',
  description: '받아 두면 인터넷 없이 기기 안에서 동작하는 AI예요. PC 권장, 처음 한 번 약 2.3GB를 받아요.',

  async available(): Promise<Availability> {
    const gpu = await webgpuStatus();
    if (!gpu.ok) return { status: 'unsupported', reason: gpu.reason };
    if (downloading) return { status: 'downloading', reason: '모델을 받는 중이에요.' };
    if (await getSetting('webllmModel')) return { status: 'ready' };
    return { status: 'needs-download', reason: '모델을 받은 뒤에 쓸 수 있어요.' };
  },

  async download(onProgress, signal) {
    const id = await pickModelId();
    downloading = true;
    try {
      await getModel(id, onProgress, signal);
      await setSetting('webllmModel', id);
      // 받기만 하고 GPU 메모리는 비워 둔다. 처음 나눌 때 다시 올린다(몇 초).
      await unload();
    } finally {
      downloading = false;
    }
  },

  async remove() {
    const id = (await getSetting('webllmModel')) ?? (await pickModelId());
    await unload();
    await deleteModel(id);
    await setSetting('webllmModel', null);
  },

  async warmup(signal) {
    const id = await getSetting('webllmModel');
    if (!id) throw new Error('WebLLM 모델을 받지 않았어요.');
    await getModel(id, undefined, signal);
    touchIdle();
  },

  async decompose(req: DecomposeRequest, signal?: AbortSignal): Promise<StepDraft[]> {
    const id = await getSetting('webllmModel');
    if (!id) throw new Error('WebLLM 모델을 받지 않았어요.');
    const model = await getModel(id, undefined, signal);
    try {
      return (await askModel(model, req, signal)).drafts;
    } finally {
      touchIdle();
    }
  },
};
