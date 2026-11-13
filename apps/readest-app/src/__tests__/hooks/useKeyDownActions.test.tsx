import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));

import { useKeyDownActions } from '@/hooks/useKeyDownActions';

afterEach(cleanup);

describe('useKeyDownActions', () => {
  it('does not confirm a dialog when Enter is pressed on its Cancel button', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const Harness = () => {
      const ref = useKeyDownActions({ onConfirm, onCancel });
      return (
        <div ref={ref}>
          <button onClick={onCancel}>Cancel</button>
        </div>
      );
    };
    render(<Harness />);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    // The browser's normal button activation remains the only action.
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not submit text fields or react to an already consumed key', () => {
    const onConfirm = vi.fn();
    renderHook(() => useKeyDownActions({ onConfirm }));
    const input = document.createElement('textarea');
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    input.remove();
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // A dialog whose confirm handler closes over state (e.g. "has changes") must
  // get the handler from its latest render, not the one from its first.
  it('calls the latest callbacks after a rerender', () => {
    const first = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const latest = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = renderHook((props) => useKeyDownActions(props), { initialProps: first });
    rerender(latest);

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(latest.onConfirm).toHaveBeenCalledTimes(1);
    expect(latest.onCancel).toHaveBeenCalledTimes(1);
    expect(first.onConfirm).not.toHaveBeenCalled();
    expect(first.onCancel).not.toHaveBeenCalled();
  });
});
