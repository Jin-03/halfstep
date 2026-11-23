import { useState } from 'react';

/** 한 줄 입력 후 Enter로 추가. 추가 뒤에도 입력란이 남아 있어 연달아 적을 수 있다. */
export function AddStepInput({
  onAdd,
  placeholder,
  autoFocus,
  onCancel,
}: {
  onAdd: (title: string) => Promise<unknown> | void;
  placeholder: string;
  autoFocus?: boolean;
  onCancel?: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <form
      className="add-step"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        setText('');
        await onAdd(t);
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="done"
        onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
      />
      <button type="submit" disabled={!text.trim()}>
        추가
      </button>
    </form>
  );
}
