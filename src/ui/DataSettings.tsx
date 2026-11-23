import { useEffect, useRef, useState } from 'react';
import {
  applyImport,
  backupBlob,
  backupFileName,
  exportBackup,
  parseBackup,
  previewImport,
  type ImportPreview,
} from '../db/backup';
import { useSetting } from '../db/settings';
import { formatBytes, requestPersist, storageInfo, type StorageInfo } from '../db/storage';
import { useActions } from './actions';

const dateTime = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function canShareFiles(): boolean {
  try {
    return !!navigator.canShare?.({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
  } catch {
    return false;
  }
}

export function DataSettings() {
  const { run, notify } = useActions();
  const lastBackupAt = useSetting('lastBackupAt');
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shareable = canShareFiles();

  const refresh = () => void storageInfo().then(setInfo);
  useEffect(refresh, []);

  const save = async (mode: 'download' | 'share') => {
    const data = await run('백업', null, () => exportBackup(), { skipUndo: true });
    if (!data) return;
    const name = backupFileName(data.exportedAt);
    const blob = backupBlob(data);
    if (mode === 'share') {
      try {
        await navigator.share({ files: [new File([blob], name, { type: 'application/json' })], title: '반걸음 백업' });
        notify('백업 파일을 공유했어요.');
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') notify('공유하지 못했어요. "파일로 저장"을 써 보세요.', 'error');
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`백업 파일(${name})을 저장했어요.`);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const p = await run(
      '백업 읽기',
      null,
      async () => previewImport(parseBackup(await file.text())),
      { skipUndo: true },
    );
    if (p) setPreview(p);
    if (fileInput.current) fileInput.current.value = '';
  };

  const confirmImport = async () => {
    if (!preview) return;
    const r = await run('가져오기', null, () => applyImport(preview.parsed), { skipUndo: true });
    if (r) {
      notify(`목표 ${r.goals}개, 단계 ${r.steps}개, 템플릿 ${r.templates}개를 가져왔어요.`);
      setPreview(null);
      refresh();
    }
  };

  return (
    <section className="data-settings">
      <h1>백업과 저장 공간</h1>
      <p className="hint">반걸음의 데이터는 이 기기의 브라우저 안에만 있어요. 기기를 바꾸거나 브라우저 데이터를 지우면 사라지니, 가끔 백업 파일로 저장해 두세요.</p>

      <h2 className="list-heading">백업</h2>
      <p className="hint">
        {lastBackupAt ? `마지막 백업: ${dateTime.format(lastBackupAt)}` : '아직 백업한 적이 없어요.'}
      </p>
      <div className="button-row">
        <button type="button" className="primary small" onClick={() => void save('download')}>
          파일로 저장
        </button>
        {shareable && (
          <button type="button" className="secondary small" onClick={() => void save('share')}>
            공유하기
          </button>
        )}
      </div>
      {shareable && <p className="hint small">공유하기로 드라이브나 메신저의 나에게 보내 두면 휴대폰을 바꿔도 찾기 쉬워요.</p>}

      <h2 className="list-heading">가져오기</h2>
      <p className="hint">백업 파일의 목표와 템플릿을 이 기기에 더해요. 이미 있는 목표는 건너뛰어서 겹치지 않아요. 예전 버전 반걸음의 백업도 읽을 수 있어요.</p>
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      {!preview ? (
        <button type="button" className="secondary small" onClick={() => fileInput.current?.click()}>
          백업 파일 고르기
        </button>
      ) : (
        <div className="import-preview">
          <p>
            <strong>가져올 내용</strong>
            <br />
            목표 {preview.newGoals}개 (단계 {preview.newSteps}개){preview.newTemplates > 0 && ` · 템플릿 ${preview.newTemplates}개`}
          </p>
          {(preview.skippedGoals > 0 || preview.skippedTemplates > 0) && (
            <p className="hint small">
              이미 있어서 건너뛸 것: {preview.skippedGoals > 0 && `목표 ${preview.skippedGoals}개`}
              {preview.skippedGoals > 0 && preview.skippedTemplates > 0 && ', '}
              {preview.skippedTemplates > 0 && `템플릿 ${preview.skippedTemplates}개`}
            </p>
          )}
          {preview.parsed.warnings.map((w) => (
            <p key={w} className="hint small">
              {w}
            </p>
          ))}
          <div className="button-row">
            <button
              type="button"
              className="primary small"
              disabled={preview.newGoals === 0 && preview.newTemplates === 0}
              onClick={() => void confirmImport()}
            >
              가져오기
            </button>
            <button type="button" className="text-btn" onClick={() => setPreview(null)}>
              취소
            </button>
          </div>
          {preview.newGoals === 0 && preview.newTemplates === 0 && <p className="hint small">새로 가져올 것이 없어요.</p>}
        </div>
      )}

      <h2 className="list-heading">저장 공간</h2>
      {info === null ? null : (
        <>
          <p className={info.persisted === false ? 'notice' : 'hint'}>
            {info.persisted === true && '보호됨 · 공간이 부족해도 브라우저가 이 데이터를 지우지 않아요.'}
            {info.persisted === false && '보호 안 됨 · 저장 공간이 부족해지면 브라우저가 데이터를 지울 수 있어요.'}
            {info.persisted === null && '이 브라우저에서는 보호 여부를 확인할 수 없어요.'}
          </p>
          {info.persisted === false && (
            <>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  const ok = await requestPersist();
                  notify(ok ? '저장 공간을 보호했어요.' : '브라우저가 아직 허락하지 않았어요. 홈 화면에 설치해서 쓰면 보통 허락돼요.');
                  refresh();
                }}
              >
                보호 요청
              </button>
              <p className="hint small">휴대폰에서는 반걸음을 홈 화면에 설치해서 쓰면 보통 자동으로 보호돼요.</p>
            </>
          )}
          {info.usage !== null && (
            <p className="hint small">
              사용 중 {formatBytes(info.usage)}
              {info.quota ? ` · 쓸 수 있는 공간 약 ${formatBytes(info.quota)}` : ''}
            </p>
          )}
        </>
      )}
    </section>
  );
}
