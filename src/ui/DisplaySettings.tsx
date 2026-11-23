import { setSetting, useSetting } from '../db/settings';
import { celebrate } from '../reward/celebrate';

/** 화면 설정: 지금은 완료 축하 켜기·끄기만 */
export function DisplaySettings() {
  const celebration = useSetting('celebration');
  if (celebration === undefined) return null;

  return (
    <section className="data-settings">
      <h1>화면 설정</h1>

      <h2 className="list-heading">축하 효과</h2>
      <label className="toggle-row">
        <input type="checkbox" checked={celebration} onChange={(e) => void setSetting('celebration', e.target.checked)} />
        <span>단계와 목표를 끝냈을 때 축하하기</span>
      </label>
      <p className="hint">체크 효과, 진동, “완료” 알림, 목표를 다 끝냈을 때의 색종이와 축하 창이에요. 끄면 모두 나오지 않아요.</p>
      <p className="hint">한 번 축하를 본 목표는 단계를 풀었다가 다시 끝내도 “완료” 알림만 나와요.</p>
      <div className="button-row">
        <button
          type="button"
          className="secondary small"
          onClick={() =>
            celebrate({
              level: 'goal',
              goalId: 'preview',
              goalTitle: '블로그 글 한 편 쓰기',
              stepIds: [],
              stepCount: 6,
              minutes: 95,
              reward: '좋아하는 빵 사 먹기',
              preview: true,
            })
          }
        >
          목표 완료 축하 미리 보기
        </button>
      </div>
    </section>
  );
}
