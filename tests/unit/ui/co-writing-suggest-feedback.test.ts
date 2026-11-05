import { describe, it, expect } from 'vitest';
import { resolveKnowledgeInjectionNotice } from '../../../ui/co-writing/suggest-feedback';

/**
 * 知识注入提示的三条分支：有注入、只有丢弃、都没有。
 * 预算不足的丢弃数必须出现在提示里，否则用户会以为知识完全没生效。
 */
describe('co-writing suggest-feedback 知识注入提示', () => {
    it('有注入且无丢弃时只报注入数', () => {
        expect(resolveKnowledgeInjectionNotice(3, 0)).toEqual({
            kind: 'success',
            text: '已注入 3 条知识库片段',
        });
    });

    it('有注入且有丢弃时同时报丢弃数', () => {
        expect(resolveKnowledgeInjectionNotice(3, 1)).toEqual({
            kind: 'success',
            text: '已注入 3 条知识库片段（另 1 条因预算不足未注入）',
        });
    });

    it('无注入但有丢弃时给出告警', () => {
        expect(resolveKnowledgeInjectionNotice(0, 2)).toEqual({
            kind: 'warning',
            text: '知识库片段因预算不足未注入（2 条）',
        });
    });

    it('都没有时不出提示', () => {
        expect(resolveKnowledgeInjectionNotice(0, 0)).toEqual({ kind: 'none', text: '' });
    });
});
