import { describe, it, expect } from 'vitest';
import { computePromptHash } from '../../../engine/prompt-hash';

const BASE = {
  systemPrompt: '你是一位网文作家',
  userPrompt: '请续写：他推开了那扇门。',
  model: 'deepseek-v4-flash',
  temperature: 0.7,
  maxTokens: 4096,
};

describe('computePromptHash — TR-1.1 确定性', () => {
  it('相同五元组两次计算结果一致', () => {
    const a = computePromptHash(BASE.systemPrompt, BASE.userPrompt, BASE.model, BASE.temperature, BASE.maxTokens);
    const b = computePromptHash(BASE.systemPrompt, BASE.userPrompt, BASE.model, BASE.temperature, BASE.maxTokens);
    expect(a).toBe(b);
  });

  it('不同参数顺序不影响——参数即五元组，无环境依赖（同进程内稳定）', () => {
    const a = computePromptHash('s', 'u', 'm', 0.5, 1024);
    const b = computePromptHash('s', 'u', 'm', 0.5, 1024);
    expect(a).toBe(b);
  });
});

describe('computePromptHash — TR-1.2 维度敏感性', () => {
  const base = computePromptHash(BASE.systemPrompt, BASE.userPrompt, BASE.model, BASE.temperature, BASE.maxTokens);

  it('systemPrompt 变化 → hash 变化', () => {
    const h = computePromptHash('你是另一位作家', BASE.userPrompt, BASE.model, BASE.temperature, BASE.maxTokens);
    expect(h).not.toBe(base);
  });

  it('userPrompt 变化 → hash 变化', () => {
    const h = computePromptHash(BASE.systemPrompt, '请续写：他关上了那扇门。', BASE.model, BASE.temperature, BASE.maxTokens);
    expect(h).not.toBe(base);
  });

  it('model 变化 → hash 变化', () => {
    const h = computePromptHash(BASE.systemPrompt, BASE.userPrompt, 'deepseek-v4-pro', BASE.temperature, BASE.maxTokens);
    expect(h).not.toBe(base);
  });

  it('temperature 变化 → hash 变化', () => {
    const h = computePromptHash(BASE.systemPrompt, BASE.userPrompt, BASE.model, 0.8, BASE.maxTokens);
    expect(h).not.toBe(base);
  });

  it('maxTokens 变化 → hash 变化', () => {
    const h = computePromptHash(BASE.systemPrompt, BASE.userPrompt, BASE.model, BASE.temperature, 8192);
    expect(h).not.toBe(base);
  });

  it('端点/思考作用域变化 → hash 变化，避免跨渠道缓存串味', () => {
    const a = computePromptHash('s', 'u', 'm', 0.7, 1024, 'https://a/v1|on|4096');
    const b = computePromptHash('s', 'u', 'm', 0.7, 1024, 'https://b/v1|on|4096');
    expect(a).not.toBe(b);
  });
});

describe('computePromptHash — TR-1.3 边界', () => {
  it('空 prompt 不抛异常且格式稳定', () => {
    const h = computePromptHash('', '', 'm', 0.7, 4096);
    expect(typeof h).toBe('string');
    expect(h.length).toBeGreaterThan(0);
  });

  it('极长 prompt（约 100KB）不抛异常', () => {
    const long = '长'.repeat(1024 * 100);
    expect(() => computePromptHash(long, long, 'm', 0.7, 4096)).not.toThrow();
  });

  it('输出为稳定十六进制格式', () => {
    const h = computePromptHash(BASE.systemPrompt, BASE.userPrompt, BASE.model, BASE.temperature, BASE.maxTokens);
    expect(h).toMatch(/^[\da-f]+$/);
  });
});
