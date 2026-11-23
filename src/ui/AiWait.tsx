import { AI_TIMEOUT_MS, type AiPhase } from '../ai';

/**
 * AI가 나누는 동안의 기다림 안내. 너무 오래 기다리지 않는다는 것을 알려 준다.
 * 기본 규칙만 쓸 때는 phase가 오지 않으므로 아무것도 보이지 않는다.
 */
export function AiWait({ phase }: { phase: AiPhase | null }) {
  if (!phase) return null;
  const limit = `${Math.round(AI_TIMEOUT_MS / 60_000)}분`;
  return (
    <p className="hint small ai-wait" role="status">
      {phase.stage === 'preparing'
        ? `${phase.engineLabel} 준비 중이에요. 보통 몇 초면 돼요.`
        : `보통 10초 안팎, 늦어도 ${limit} 안에 끝나요. ${limit}이 넘으면 기본 규칙으로 대신해요.`}
    </p>
  );
}
