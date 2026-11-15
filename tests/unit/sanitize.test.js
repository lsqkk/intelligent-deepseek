import { describe, expect, it } from 'vitest';
import { sanitizeDeep, sanitizeJsonText } from '../../src/sanitize.js';
import { applyInjection } from '../../src/prompt.js';

const settings = { enabled: true, protocolLanguage: 'zh', customProtocol: '' };
const injected = applyInjection('你好', settings);

describe('history sanitization', () => {
  it('strips injection from nested response strings', () => {
    const payload = {
      code: 0,
      data: {
        biz_data: {
          chat_messages: [
            { role: 'USER', fragments: [{ type: 'REQUEST', content: injected }] },
            { role: 'ASSISTANT', fragments: [{ type: 'RESPONSE', content: '好的' }] },
          ],
        },
      },
    };
    const cleaned = sanitizeDeep(payload);
    expect(cleaned.data.biz_data.chat_messages[0].fragments[0].content).toBe('你好');
    expect(cleaned.data.biz_data.chat_messages[1].fragments[0].content).toBe('好的');
    expect(cleaned.code).toBe(0);
  });

  it('keeps unchanged branches by reference when nothing matches', () => {
    const payload = { a: ['x', 'y'], b: { c: 'z' } };
    const cleaned = sanitizeDeep(payload);
    expect(cleaned).toBe(payload);
  });

  it('sanitizes JSON text and tolerates invalid JSON', () => {
    const text = JSON.stringify({ content: injected });
    expect(JSON.parse(sanitizeJsonText(text)).content).toBe('你好');
    expect(sanitizeJsonText('not json')).toBe('not json');
  });

  it('does not recurse forever on cyclic input', () => {
    const payload = { content: injected };
    payload.self = payload;
    expect(() => sanitizeDeep(payload)).not.toThrow();
  });
});
