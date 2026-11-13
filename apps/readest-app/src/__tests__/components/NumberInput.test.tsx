import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import NumberInput from '@/components/settings/NumberInput';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

afterEach(cleanup);

describe('NumberInput', () => {
  it('adjusts a focused TV row with left/right without entering text editing', () => {
    const onChange = vi.fn();
    render(<NumberInput label='Columns' value={2} min={1} max={4} onChange={onChange} />);
    const field = screen.getByDisplayValue('2');
    field.dispatchEvent(
      new CustomEvent('tv-navigate', {
        detail: { key: 'ArrowLeft' },
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(1);
  });

  const defaultProps = {
    label: 'Font Size',
    value: 16,
    min: 8,
    max: 72,
    onChange: vi.fn(),
  };

  it('commits value on Enter key (form submit)', () => {
    const onChange = vi.fn();
    render(<NumberInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByDisplayValue('16');
    fireEvent.change(input, { target: { value: '24' } });
    expect(onChange).not.toHaveBeenCalled();

    // Enter triggers form submit which commits the value
    fireEvent.submit(input.closest('form')!);
    expect(onChange).toHaveBeenCalledWith(24);
  });

  it('commits value on blur', () => {
    const onChange = vi.fn();
    render(<NumberInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByDisplayValue('16');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('clamps value to min/max on commit', () => {
    const onChange = vi.fn();
    render(<NumberInput {...defaultProps} onChange={onChange} />);

    const input = screen.getByDisplayValue('16');
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.submit(input.closest('form')!);
    expect(onChange).toHaveBeenCalledWith(72);
  });
});
