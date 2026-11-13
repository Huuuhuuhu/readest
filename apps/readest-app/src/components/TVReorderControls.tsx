import { isTVMode } from '@/utils/tvInput';

/** Explicit remote alternative to drag handles. Uses each list's existing persistence path. */
export default function TVReorderControls({
  label,
  index,
  count,
  onMove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (direction: number) => void;
}) {
  if (!isTVMode() || count < 2) return null;
  return (
    <span className='inline-flex shrink-0 gap-1' role='group' aria-label={`${label}：排序`}>
      <button
        type='button'
        className='btn btn-ghost eink-bordered min-h-10 px-2'
        disabled={index <= 0}
        aria-label={`${label}：前移`}
        onClick={(event) => {
          event.stopPropagation();
          onMove(-1);
        }}
      >
        前移
      </button>
      <button
        type='button'
        className='btn btn-ghost eink-bordered min-h-10 px-2'
        disabled={index >= count - 1}
        aria-label={`${label}：后移`}
        onClick={(event) => {
          event.stopPropagation();
          onMove(1);
        }}
      >
        后移
      </button>
    </span>
  );
}
