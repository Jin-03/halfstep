export function formatMinutes(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

/** 마지막 글자의 받침 정보. 한글이 아니면(예: "AI") 받침 없음으로 본다 */
function finalConsonant(word: string): { has: boolean; isRieul: boolean } {
  const ch = word.trim().at(-1) ?? '';
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return { has: false, isRieul: false };
  const jong = code % 28;
  return { has: jong !== 0, isRieul: jong === 8 };
}

/** 단어 + 조사. 예: josa('규칙', '으로') → '규칙으로', josa('AI', '이') → 'AI가' */
export function josa(word: string, kind: '이' | '을' | '은' | '으로'): string {
  const { has, isRieul } = finalConsonant(word);
  switch (kind) {
    case '이':
      return word + (has ? '이' : '가');
    case '을':
      return word + (has ? '을' : '를');
    case '은':
      return word + (has ? '은' : '는');
    case '으로':
      return word + (has && !isRieul ? '으로' : '로');
  }
}
