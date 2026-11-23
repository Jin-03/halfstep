import { useEffect, useRef, useState } from 'react';

/** 눌러서 바로 고치는 글자. Enter·포커스 이동 = 저장, Esc = 취소. */
export function EditableText({
  value,
  onSave,
  className,
  label,
  multiline = false,
  placeholder,
  allowEmpty = false,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
  /** 스크린리더용 이름, 예: "단계 제목" */
  label: string;
  multiline?: boolean;
  placeholder?: string;
  /** false면 빈 값으로 고쳤을 때 저장하지 않고 원래 값으로 돌아간다 */
  allowEmpty?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next && !allowEmpty) return;
    if (next !== value.trim()) onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={`editable ${className ?? ''} ${value ? '' : 'is-empty'}`}
        aria-label={`${label}: ${value || '비어 있음'}. 눌러서 고치기`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value || placeholder}
      </button>
    );
  }

  const props = {
    ref,
    className: `editing ${className ?? ''}`,
    value: draft,
    'aria-label': label,
    placeholder,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
    },
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}
