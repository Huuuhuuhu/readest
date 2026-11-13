import { useEffect, useRef, useState } from 'react';
import { useTVScope } from '@/hooks/useTVScope';
import { isTVMode } from '@/utils/tvInput';

/** Native select popups do not reliably receive bridged Android TV keys. */
export default function TVSelectDialog() {
  const [select, setSelect] = useState<HTMLSelectElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setSelect(null);
  useTVScope(root, !!select, {
    id: 'select-options',
    priority: 1100,
    onBack: close,
    onMenu: close,
    initialFocus: () => root.current?.querySelector('[aria-selected="true"]') ?? null,
  });
  useEffect(() => {
    if (!isTVMode()) return;
    const open = (event: Event) => {
      const field = (event as CustomEvent).detail;
      if (field instanceof HTMLSelectElement && field.isConnected && !field.disabled)
        setSelect(field);
    };
    window.addEventListener('tv-select', open);
    return () => window.removeEventListener('tv-select', open);
  }, []);
  if (!select) return null;
  const label = select.getAttribute('aria-label') || select.labels?.[0]?.textContent || '选择选项';
  return (
    <div className='fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-8'>
      <div
        ref={root}
        role='dialog'
        aria-modal='true'
        aria-label={label}
        className='bg-base-100 eink-bordered max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border p-5'
      >
        <h2 className='mb-3 text-xl font-bold'>{label}</h2>
        <p className='mb-3'>上下选择，确认应用，返回取消</p>
        <div role='listbox' aria-label={label}>
          {Array.from(select.options).map((option, index) => (
            <button
              key={index}
              type='button'
              role='option'
              aria-selected={index === select.selectedIndex}
              disabled={
                option.disabled ||
                (option.parentElement instanceof HTMLOptGroupElement &&
                  option.parentElement.disabled)
              }
              className='btn btn-ghost block min-h-12 w-full text-start'
              onClick={() => {
                if (select.isConnected && !select.disabled) {
                  select.selectedIndex = index;
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                close();
              }}
            >
              {index === select.selectedIndex ? '✓ ' : ''}
              {option.label}
            </button>
          ))}
        </div>
        <button className='btn mt-3' onClick={close}>
          取消
        </button>
      </div>
    </div>
  );
}
