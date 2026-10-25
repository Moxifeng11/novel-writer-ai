import { describe, it, expect } from 'vitest';
import { validateStepResult } from '../../../engine/step-validator';

/**
 * D4 — 修正类步骤（fix / finalFix）的 2000 字门槛。
 * 修复前三项检查存的是 RegExp / boolean 字面量，恒为 truthy → 任何内容都判 complete。
 */

/** 生成长度为 length 的正文；withDialogue 决定是否包含对话引号 */
function body(length: number, withDialogue = true): string {
    const tail = withDialogue ? '「好」。' : '。';
    return '字'.repeat(Math.max(0, length - tail.length)) + tail;
}

describe('D4 validateFixStep — 字数与结构门槛生效', () => {
    it('1999 字（含对话、句号）→ 不通过，missing 指出字数不足', () => {
        const result = validateStepResult('fix', body(1999));

        expect(result.valid).toBe(false);
        expect(result.level).not.toBe('complete');
        expect(result.missing).toContain('字数达标（>=2000）');
    });

    it('2000 字（含对话、句号）→ complete', () => {
        const result = validateStepResult('fix', body(2000));

        expect(result.valid).toBe(true);
        expect(result.level).toBe('complete');
        expect(result.missing).toEqual([]);
    });

    it('499 字（含对话、句号）→ 字数与叙事完整同时缺失', () => {
        const result = validateStepResult('fix', body(499));

        expect(result.valid).toBe(false);
        expect(result.missing).toContain('字数达标（>=2000）');
        expect(result.missing).toContain('叙事完整');
    });

    it('500 字是「叙事完整」的严格边界（> 500 才算）', () => {
        expect(validateStepResult('fix', body(500)).missing).toContain('叙事完整');
        expect(validateStepResult('fix', body(501)).missing).not.toContain('叙事完整');
    });

    it('2000 字但无对话 → 不通过，missing 指出对话描写', () => {
        const result = validateStepResult('fix', body(2000, false));

        expect(result.valid).toBe(false);
        expect(result.missing).toEqual(['对话描写']);
    });

    it('空内容不再被误判为 complete', () => {
        const result = validateStepResult('fix', '');

        expect(result.valid).toBe(false);
        expect(result.level).not.toBe('complete');
        expect(result.missing).toHaveLength(3);
    });
});
