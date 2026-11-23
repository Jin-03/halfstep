/** 반걸음 상징: 반쯤 채운 원. ratio로 채움 정도를 바꿀 수도 있다. */
export function HalfMark({ size = 22, ratio = 0.5 }: { size?: number; ratio?: number }) {
  const r = 9;
  const w = 2 * r * Math.min(1, Math.max(0, ratio));
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true" className="half-mark">
      <defs>
        <clipPath id={`hm-${size}-${Math.round(ratio * 100)}`}>
          <rect x={11 - r} y={0} width={w} height={22} />
        </clipPath>
      </defs>
      <circle cx="11" cy="11" r={r} fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="11" cy="11" r={r} fill="currentColor" clipPath={`url(#hm-${size}-${Math.round(ratio * 100)})`} />
    </svg>
  );
}
