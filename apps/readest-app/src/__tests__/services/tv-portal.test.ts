import { describe, expect, it } from 'vitest';
import { validateTTSInput, publicTTSConfig, resolveTTSInput } from '@/services/tvPortalConfig';
const input = {
  name: 'My voice',
  baseUrl: 'https://speech.example/v1',
  model: 'tts-1',
  voices: 'alloy',
  apiKey: 'private-key',
};
describe('TV phone configuration boundary', () => {
  it('never returns saved keys or legacy ciphertext to the phone', () => {
    const result = publicTTSConfig([
      { ...input, id: 'a', addedAt: 1, updatedAt: 1, lastSeenCipher: { apiKey: 'cipher' } },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private-key|cipher/);
    expect(result[0]?.hasApiKey).toBe(true);
  });
  it('keeps a stored key when the masked field is unchanged, and allows explicit clearing', () => {
    const old = { ...input, id: 'a', addedAt: 1, updatedAt: 1 };
    expect(resolveTTSInput({ ...input, apiKey: '', keepApiKey: true }, old).apiKey).toBe(
      'private-key',
    );
    expect(resolveTTSInput({ ...input, apiKey: '', keepApiKey: false }, old).apiKey).toBe('');
  });
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://key:secret@speech.example/v1',
  ])('rejects non-service endpoints %s', (baseUrl) => {
    expect(() => validateTTSInput({ ...input, baseUrl })).toThrow();
  });
  it('accepts a self-hosted HTTP endpoint without a Readest account', () => {
    expect(validateTTSInput({ ...input, baseUrl: 'http://192.168.1.9:8880/v1' }).baseUrl).toBe(
      'http://192.168.1.9:8880/v1',
    );
  });
  it('bounds text and rejects invalid formats', () => {
    expect(() => validateTTSInput({ ...input, instructions: 'x'.repeat(9000) })).toThrow();
    expect(() => validateTTSInput({ ...input, responseFormat: 'exe' })).toThrow();
  });
});
