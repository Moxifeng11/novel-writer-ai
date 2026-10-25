import { describe, it, expect } from 'vitest';
import { compressWorldContext } from '../../../engine/context-compressor';

describe('compressWorldContext — 短输入不截断', () => {
    it('所有字段在阈值内时原样返回且不截断', () => {
        const wv = '世界观：东方玄幻大陆。';
        const sl = '设定：剑道体系。';
        const fs = 'F1|黑剑|高|第1章|第5章|已埋未揭';
        const tl = '第1章：祠堂血夜';
        const r = compressWorldContext(wv, sl, fs, tl, '', 1, 8000);
        expect(r.truncationApplied).toBe(false);
        expect(r.worldView).toBe(wv);
        expect(r.settingLib).toBe(sl);
    });

    it('世界观 <=2000 字符时原样保留', () => {
        const wv = 'a'.repeat(2000);
        const r = compressWorldContext(wv, '', '', '', '', 1, 8000);
        expect(r.worldView.length).toBe(2000);
    });

    it('设定库 <=1000 字符时原样保留', () => {
        const sl = 'b'.repeat(1000);
        const r = compressWorldContext('', sl, '', '', '', 1, 8000);
        expect(r.settingLib.length).toBe(1000);
    });
});

describe('compressWorldContext — 空输入处理', () => {
    it('所有字段为空时返回空且不截断', () => {
        const r = compressWorldContext('', '', '', '', '', 1, 8000);
        expect(r.worldView).toBe('');
        expect(r.settingLib).toBe('');
        expect(r.foreshadows).toBe('');
        expect(r.timeline).toBe('');
        expect(r.truncationApplied).toBe(false);
    });

    it('伏笔库为空时 foreshadows 为空串', () => {
        const r = compressWorldContext('', '', '', '', '', 5, 8000);
        expect(r.foreshadows).toBe('');
    });

    it('时间线为空时 timeline 为空串', () => {
        const r = compressWorldContext('', '', '', '', '', 5, 8000);
        expect(r.timeline).toBe('');
    });
});

describe('compressWorldContext — 世界观压缩', () => {
    it('世界观超过 2000 字符时被压缩', () => {
        // 构造可被关键词命中的长文本：关键词"剑客"重复出现
        const paragraph = '剑客行于荒野，长剑出鞘，剑光凛冽。\n\n';
        const wv = paragraph.repeat(200); // 远超 2000
        const outline = '剑客复仇的故事';
        const r = compressWorldContext(wv, '', '', '', outline, 1, 8000);
        expect(r.worldView.length).toBeLessThanOrEqual(2000);
    });

    it('设定库上限随模型窗口放大，不再固定 1000 字', () => {
        const paragraphs = Array.from({ length: 8 }, (_, i) =>
            `设定${i}：` + '设'.repeat(480),
        );
        const sl = paragraphs.join('\n\n'); // 约 4000 字

        const small = compressWorldContext('', sl, '', '', '', 1, 8000);
        const large = compressWorldContext('', sl, '', '', '', 1, 128000);

        expect(small.settingLib.length).toBeLessThanOrEqual(1000);
        expect(large.settingLib.length).toBeGreaterThan(1000);
        expect(large.settingLib.length).toBeLessThanOrEqual(6000);
    });
});

describe('compressWorldContext — 伏笔压缩', () => {
    it('保留已过 plannedReveal 但未揭示的伏笔', () => {
        // currentChapter=10，F1 的 plannedReveal=第5章（已过期）
        const fs = 'F1|黑剑|高|第1章|第5章|已埋未揭';
        const r = compressWorldContext('', '', fs, '', '', 10, 8000);
        expect(r.foreshadows).toContain('黑剑');
    });

    it('未过期伏笔按离 currentChapter 距离排序，最近的优先', () => {
        // currentChapter=10
        // F1 计划第12章揭示（距离2）
        // F2 计划第20章揭示（距离10）
        const fs = [
            'F1|近伏笔|中|第1章|第12章|已埋未揭',
            'F2|远伏笔|中|第1章|第20章|已埋未揭',
        ].join('\n');
        const r = compressWorldContext('', '', fs, '', '', 10, 8000);
        // 两者都被保留，但"近伏笔"应在"远伏笔"之前
        const idxNear = r.foreshadows.indexOf('近伏笔');
        const idxFar = r.foreshadows.indexOf('远伏笔');
        expect(idxNear).toBeGreaterThanOrEqual(0);
        expect(idxFar).toBeGreaterThanOrEqual(0);
        expect(idxNear).toBeLessThan(idxFar);
    });

    it('无章号解析的伏笔仍被保留', () => {
        const fs = 'F1|无章号伏笔|中|第1章|未知|已埋未揭';
        const r = compressWorldContext('', '', fs, '', '', 5, 8000);
        expect(r.foreshadows).toContain('无章号伏笔');
    });
});

describe('compressWorldContext — 时间线压缩', () => {
    it('时间线超过 15 行时只保留最后 15 行', () => {
        const lines: string[] = [];
        for (let i = 1; i <= 20; i++) {
            lines.push(`第${i}章：事件${i}`);
        }
        const tl = lines.join('\n');
        const r = compressWorldContext('', '', '', tl, '', 20, 8000);
        const outLines = r.timeline.split('\n');
        expect(outLines.length).toBe(15);
        // 保留的是最后 15 行（第6..20章）
        expect(r.timeline).toContain('第20章：事件20');
        expect(r.timeline).not.toContain('第1章：事件1');
    });

    it('时间线 <=15 行时原样保留', () => {
        const tl = '第1章：a\n第2章：b\n第3章：c';
        const r = compressWorldContext('', '', '', tl, '', 3, 8000);
        expect(r.timeline).toBe(tl);
    });
});

describe('compressWorldContext — 硬截断兜底', () => {
    it('总长度超过 maxContext*0.6 时触发截断标记', () => {
        // 使用 <=2000 / <=1000 的字段使其原样保留（绕过 compressByKeywords），
        // 再用小 maxContext 强制走 applyHardTruncation 兜底
        const wv = 'a'.repeat(2000);
        const sl = 'b'.repeat(1000);
        const fs = 'F1|黑剑|高|第1章|第5章|已埋未揭';
        const tl = '第1章：事件';
        // maxContext=1000 → maxAllowed=600，原样总长 ~3000 必然超标
        const r = compressWorldContext(wv, sl, fs, tl, '', 10, 1000);
        expect(r.truncationApplied).toBe(true);
        const total = r.worldView.length + r.settingLib.length + r.foreshadows.length + r.timeline.length;
        expect(total).toBeLessThanOrEqual(1000);
    });

    it('截断后各字段长度不大于原始长度', () => {
        const wv = 'a'.repeat(2000);
        const sl = 'b'.repeat(1000);
        const r = compressWorldContext(wv, sl, '', '', '', 1, 1000);
        expect(r.worldView.length).toBeLessThanOrEqual(wv.length);
        expect(r.settingLib.length).toBeLessThanOrEqual(sl.length);
        expect(r.truncationApplied).toBe(true);
    });
});
