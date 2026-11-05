import { describe, it, expect } from 'vitest';
import { getFriendlyErrorMessage } from '../../../ui/co-writing/friendly-error';

/**
 * 错误文案转换的优先级最容易回归：解锁提示含「取消」，
 * 若先匹配 abort 会把「请输入加密口令」误报为「生成已取消」。
 */
describe('co-writing friendly-error', () => {
    it('未解锁优先于取消', () => {
        expect(getFriendlyErrorMessage('API Key 未解锁，操作已取消')).toBe('API 密钥未解锁：请输入加密口令后重试');
    });

    it('取消/中断映射为生成已取消', () => {
        expect(getFriendlyErrorMessage('AbortError: cancelled')).toBe('生成已取消');
        expect(getFriendlyErrorMessage('请求已取消')).toBe('生成已取消');
    });

    it('网络与超时分别给出可操作提示', () => {
        expect(getFriendlyErrorMessage('fetch failed')).toBe('网络连接失败，请检查网络连接后重试');
        expect(getFriendlyErrorMessage('request timeout')).toBe('请求超时，请稍后重试');
    });

    it('鉴权、限流、模型错误映射', () => {
        expect(getFriendlyErrorMessage('invalid api key')).toBe('API 密钥无效，请检查设置中的 API 配置');
        expect(getFriendlyErrorMessage('HTTP 429 rate limit')).toBe('请求过于频繁，请稍后再试');
        expect(getFriendlyErrorMessage('model not found')).toBe('模型调用失败，请检查模型配置');
    });

    it('空文本走兜底文案', () => {
        expect(getFriendlyErrorMessage('')).toBe('生成失败，请重试');
    });

    it('未命中规则时原样返回', () => {
        expect(getFriendlyErrorMessage('未知异常')).toBe('未知异常');
    });
});
