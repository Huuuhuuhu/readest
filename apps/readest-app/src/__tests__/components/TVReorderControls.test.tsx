import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TVReorderControls from '@/components/TVReorderControls';
vi.mock('@/utils/tvInput', () => ({ isTVMode: () => true }));
afterEach(cleanup);
it('moves by one position and prevents boundary moves using ordinary buttons', () => {
  const move = vi.fn();
  const view = render(<TVReorderControls label='词典' index={0} count={3} onMove={move} />);
  fireEvent.click(screen.getByRole('button', { name: '词典：前移' }));
  expect(move).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '词典：后移' }));
  expect(move).toHaveBeenLastCalledWith(1);
  view.rerender(<TVReorderControls label='词典' index={2} count={3} onMove={move} />);
  fireEvent.click(screen.getByRole('button', { name: '词典：前移' }));
  expect(move).toHaveBeenLastCalledWith(-1);
  expect((screen.getByRole('button', { name: '词典：后移' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
