/// <reference lib="webworker" />
/** WebLLM 모델은 이 워커 안에서 돈다 (AI가 생각하는 동안 화면이 멈추지 않도록). */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);
