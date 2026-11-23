// 앱 루트에 한 번만 둔다: <Celebration onClaimReward={...} onDismissGoal={...} />
import { useCallback, useEffect, useRef, useState } from 'react';
import { CELEBRATE_EVENT, type CelebrationDetail } from './celebrate';
import './reward.css';

// 차분한 파스텔: 민트, 연노랑, 산호, 하늘, 라벤더 (reward.css의 --hs-confetti-1~5로 바꿀 수 있음)
const FALLBACK_COLORS = ['#7fcdb8', '#f5cf73', '#f4a59b', '#8fc1ea', '#c3b1e6'];

function formatMinutes(m: number) {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 속도는 px/초, 시간은 초 단위. 화면 갱신 빈도(60Hz, 120Hz)와 상관없이 같은 빠르기로 움직인다 */
type Particle = {
  x: number; y: number; vx: number; vy: number;
  /** 다 감속한 뒤 떨어지는 최고 속도. 종이마다 조금씩 다르다 */
  fall: number;
  /** 좌우로 흔들리는 위상·빠르기·폭 */
  sway: number; swaySpeed: number; swayAmp: number;
  /** 회전과, 종이가 뒤집히는 위상·빠르기 */
  rot: number; vr: number; flip: number; flipSpeed: number;
  size: number; color: string;
  /** 종이 조각, 동그라미, 반걸음 마크를 닮은 반원 */
  shape: 'paper' | 'dot' | 'half';
  /** 이 시각(초) 뒤에 나타난다 */
  delay: number;
};

const GRAVITY = 900; // px/s²
const DRAG = 1.8; // 터진 직후 공기 저항 (클수록 빨리 느려짐)
const DURATION = 6; // 초. 끝나기 0.8초 전부터 서서히 사라진다
const FADE = 0.8;

const pickShape = (): Particle['shape'] => {
  const r = Math.random();
  return r < 0.62 ? 'paper' : r < 0.86 ? 'dot' : 'half';
};

/**
 * 목표 완료 색종이: 화면 양쪽 아래에서 터진 뒤 팔랑이며 내려오고, 조금 뒤 위에서도 몇 장 내린다.
 * 동작 줄이기: 날리지 않고 위쪽 절반에서 제자리에 나타났다 사라진다.
 */
function Confetti({ trigger }: { trigger: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!trigger || !canvas) return;
    const calm = reducedMotion();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const colors = FALLBACK_COLORS.map((c, i) => css.getPropertyValue(`--hs-confetti-${i + 1}`).trim() || c);
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    // 화면이 작으면 조금 덜 세게 쏜다
    const power = Math.min(1, Math.max(0.6, h / 900));

    const make = (i: number, p: Pick<Particle, 'x' | 'y' | 'vx' | 'vy' | 'delay'>): Particle => {
      const shape = pickShape();
      return {
        ...p,
        fall: rand(90, 170),
        sway: rand(0, Math.PI * 2),
        swaySpeed: rand(1.5, 3),
        swayAmp: rand(15, 45),
        rot: rand(0, Math.PI * 2),
        vr: rand(-3, 3),
        flip: rand(0, Math.PI * 2),
        flipSpeed: rand(4, 9),
        size: shape === 'paper' ? rand(9, 14) : rand(7, 11),
        color: colors[i % colors.length],
        shape,
      };
    };

    let parts: Particle[];
    if (calm) {
      parts = Array.from({ length: 60 }, (_, i) =>
        make(i, { x: w * rand(0.04, 0.96), y: h * rand(0.04, 0.5), vx: 0, vy: 0, delay: rand(0, 0.5) }),
      );
    } else {
      const burst = Array.from({ length: 150 }, (_, i) => {
        const fromLeft = i % 2 === 0;
        // 양쪽 아래 모서리에서 화면 안쪽 위로
        const angle = rand(55, 80) * (Math.PI / 180);
        // 화면 위쪽 1/4 안팎까지 올라가 거기서부터 팔랑이며 내려오도록
        const speed = rand(1700, 2400) * power;
        return make(i, {
          x: fromLeft ? rand(-10, 20) : w - rand(-10, 20),
          y: h + 10,
          vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
          vy: -Math.sin(angle) * speed,
          delay: rand(0, 0.15),
        });
      });
      const rain = Array.from({ length: 50 }, (_, i) =>
        make(i, { x: w * rand(0.05, 0.95), y: -rand(10, 120), vx: 0, vy: 0, delay: rand(0.6, 1.6) }),
      );
      parts = [...burst, ...rain];
    }

    const draw = (p: Particle) => {
      const s = p.size;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // 뒤집히는 종이: 세로 길이가 줄었다 늘었다 한다 (동작 줄이기에서는 뒤집지 않음)
      if (!calm && p.shape !== 'dot') ctx.scale(1, Math.max(0.15, Math.abs(Math.cos(p.flip))));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.shape === 'paper') ctx.rect(-s / 2, -s * 0.3, s, s * 0.6);
      else if (p.shape === 'dot') ctx.arc(0, 0, s / 2.4, 0, Math.PI * 2);
      else ctx.arc(0, 0, s / 2, 0, Math.PI);
      ctx.fill();
      ctx.restore();
    };

    let raf = 0;
    const start = performance.now();
    let last = start;

    // 동작 줄이기: 0.6초 동안 나타나고, 2초 머물고, 1초 동안 사라진다
    const FADE_IN = 0.6, HOLD = 2, FADE_OUT = 1;
    const calmTick = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const elapsed = (t - start) / 1000;
      for (const p of parts) {
        const e = elapsed - p.delay;
        if (e < 0) continue;
        ctx.globalAlpha = e < FADE_IN ? e / FADE_IN : e < FADE_IN + HOLD ? 1 : Math.max(0, 1 - (e - FADE_IN - HOLD) / FADE_OUT);
        draw(p);
      }
      ctx.globalAlpha = 1;
      if (elapsed < 0.5 + FADE_IN + HOLD + FADE_OUT) raf = requestAnimationFrame(calmTick);
      else ctx.clearRect(0, 0, w, h);
    };

    const tick = (t: number) => {
      // 탭이 잠깐 멈췄다 돌아와도 한 번에 크게 튀지 않게 최대 0.05초씩만 진행
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const elapsed = (t - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = elapsed > DURATION - FADE ? Math.max(0, (DURATION - elapsed) / FADE) : 1;
      let alive = false;
      const drag = Math.exp(-DRAG * dt);
      for (const p of parts) {
        if (elapsed < p.delay) {
          alive = true;
          continue;
        }
        // 터진 힘은 공기 저항으로 금방 줄고, 그 뒤로는 저마다의 속도로 팔랑이며 내려온다
        p.vx *= drag;
        p.vy = Math.min(p.vy * drag + GRAVITY * dt, p.fall);
        p.sway += p.swaySpeed * dt;
        p.flip += p.flipSpeed * dt;
        p.rot += p.vr * dt;
        // 흔들림은 떨어지는 중에만 (터지는 순간에는 직선으로 날아간다)
        const settled = Math.max(0, 1 - Math.abs(p.vy - p.fall) / 400);
        p.x += (p.vx + Math.cos(p.sway) * p.swayAmp * settled) * dt;
        p.y += p.vy * dt;
        if (p.y > h + 30) continue;
        alive = true;
        draw(p);
      }
      ctx.globalAlpha = 1;
      if (alive && elapsed < DURATION) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(calm ? calmTick : tick);

    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, w, h);
    };
  }, [trigger]);

  return <canvas ref={ref} className="hs-cel-canvas" aria-hidden="true" />;
}

interface Props {
  /** "보상 받기"를 눌렀을 때: goal.rewardClaimedAt = Date.now() 저장 */
  onClaimReward?: (goalId: string) => void;
  /** 축하 창을 닫을 때: goal.celebratedAt = Date.now() 저장 */
  onDismissGoal?: (goalId: string) => void;
}

export function Celebration({ onClaimReward, onDismissGoal }: Props) {
  const [goal, setGoal] = useState<CelebrationDetail | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [burst, setBurst] = useState(0);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onCelebrate = (e: Event) => {
      const d = (e as CustomEvent<CelebrationDetail>).detail;
      if (d.level === 'goal') {
        setClaimed(false);
        setGoal(d);
        setBurst((n) => n + 1);
      } else if (d.level === 'branch') {
        setToast({ key: Date.now(), text: d.stepTitle ? `‘${d.stepTitle}’ 완료` : '한 묶음 완료' });
      }
    };
    window.addEventListener(CELEBRATE_EVENT, onCelebrate);
    return () => window.removeEventListener(CELEBRATE_EVENT, onCelebrate);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const close = useCallback(() => {
    if (goal && !goal.preview) onDismissGoal?.(goal.goalId);
    setGoal(null);
  }, [goal, onDismissGoal]);

  useEffect(() => {
    if (!goal) return;
    buttonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goal, close]);

  const claim = () => {
    if (!goal) return;
    setClaimed(true);
    if (!goal.preview) onClaimReward?.(goal.goalId);
  };

  const hasReward = !!goal?.reward;
  const showClaim = hasReward && !claimed;

  return (
    <>
      <Confetti trigger={burst} />

      {goal && (
        <div className="hs-cel-backdrop" onClick={close}>
          <section
            className="hs-cel-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hs-cel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="hs-cel-goal">{goal.goalTitle}</p>
            <h2 id="hs-cel-title" className="hs-cel-title">끝까지 왔어요</h2>
            {!!goal.stepCount && (
              <p className="hs-cel-stats">
                반걸음씩 {goal.stepCount}번 걸었어요
                {!!goal.minutes && <>.<br />들인 시간은 {formatMinutes(goal.minutes)}</>}
              </p>
            )}

            {hasReward && (
              <div className={`hs-cel-reward${claimed ? ' is-claimed' : ''}`}>
                <span className="hs-cel-reward-label">나에게 약속한 보상</span>
                <strong className="hs-cel-reward-text">{goal.reward}</strong>
                {claimed && <span className="hs-cel-stamp" aria-label="받음">받음</span>}
              </div>
            )}

            <button ref={buttonRef} type="button" className="hs-cel-button" onClick={showClaim ? claim : close}>
              {showClaim ? '보상 받기' : '닫기'}
            </button>
          </section>
        </div>
      )}

      {toast && (
        <div key={toast.key} className="hs-cel-toast" role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}
