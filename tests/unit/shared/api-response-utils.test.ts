/**
 * api-response-utils.test.ts — API 响应工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
    isAPIResponse,
    extractResponseContent,
    extractResponseText,
} from '../../../shared/api-response-utils';
import type { APIResponse } from '../../../engine/ai-engine';

describe('APIResponseUtils', () => {
    describe('isAPIResponse', () => {
        it('有 content 字段的对象返回 true', () => {
            expect(isAPIResponse({ content: 'hello' })).toBe(true);
        });

        it('字符串返回 false', () => {
            expect(isAPIResponse('hello')).toBe(false);
        });

        it('null 返回 false', () => {
            expect(isAPIResponse(null)).toBe(false);
        });

        it('undefined 返回 false', () => {
            expect(isAPIResponse(undefined)).toBe(false);
        });

        it('数字返回 false', () => {
            expect(isAPIResponse(42)).toBe(false);
        });

        it('无 content 字段的对象返回 false', () => {
            expect(isAPIResponse({ text: 'hello' })).toBe(false);
        });

        it('content 为空字符串也返回 true', () => {
            expect(isAPIResponse({ content: '' })).toBe(true);
        });
    });

    describe('extractResponseContent', () => {
        it('字符串直接返回', () => {
            expect(extractResponseContent('hello')).toBe('hello');
        });

        it('APIResponse 返回 content', () => {
            const resp = { content: 'world' } as APIResponse;
            expect(extractResponseContent(resp)).toBe('world');
        });

        it('null 返回默认空字符串', () => {
            expect(extractResponseContent(null)).toBe('');
        });

        it('undefined 返回默认空字符串', () => {
            expect(extractResponseContent(undefined)).toBe('');
        });

        it('null 返回自定义 fallback', () => {
            expect(extractResponseContent(null, 'fallback')).toBe('fallback');
        });

        it('APIResponse content 为空字符串返回空串（非 fallback）', () => {
            const resp = { content: '' } as APIResponse;
            expect(extractResponseContent(resp, 'fallback')).toBe('');
        });
    });

    describe('extractResponseText', () => {
        it('对结果执行 trim', () => {
            expect(extractResponseText('  hello  ')).toBe('hello');
        });

        it('APIResponse 也 trim', () => {
            const resp = { content: '  world  ' } as APIResponse;
            expect(extractResponseText(resp)).toBe('world');
        });

        it('null 返回空字符串', () => {
            expect(extractResponseText(null)).toBe('');
        });

        it('null 返回自定义 fallback', () => {
            expect(extractResponseText(null, 'default')).toBe('default');
        });

        it('纯空白内容 trim 后为空', () => {
            expect(extractResponseText('   ')).toBe('');
        });
    });
});
