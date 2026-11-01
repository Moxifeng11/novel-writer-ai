/**
 * 章节状态单一判定（B4）
 *
 * 结算幂等、导出检查、批量续跑、协同入口曾各写一套正则（全文/前4000字/仅 frontmatter），
 * 同一条 status 在不同入口可能得出不同结论。这里锁住唯一口径。
 */
import { describe, expect, it } from 'vitest';
import {
    extractFrontmatter,
    isChapterSettledText,
    parseChapterStatus,
    readFrontmatterStatus,
} from '../../../shared/chapter-status';
import { isBodySettled } from '../../../ui/full-writer/batch-targets';

function body(status: string): string {
    return `---\nstatus: ${status}\n---\n\n正文内容`;
}

describe('isChapterSettledText', () => {
    it('settled 与旧值都算已结算', () => {
        expect(isChapterSettledText(body('settled'))).toBe(true);
        expect(isChapterSettledText(body('已结算'))).toBe(true);
        expect(isChapterSettledText(body('已完稿'))).toBe(true);
    });

    it('带引号、CRLF、BOM 仍可识别', () => {
        expect(isChapterSettledText('---\r\nstatus: "settled"\r\n---\r\n正文')).toBe(true);
        expect(isChapterSettledText(`\uFEFF---\nstatus: 'settled'\n---\n正文`)).toBe(true);
    });

    it('written/drafting/未知值不算已结算', () => {
        expect(isChapterSettledText(body('written'))).toBe(false);
        expect(isChapterSettledText(body('drafting'))).toBe(false);
        expect(isChapterSettledText(body('乱七八糟'))).toBe(false);
    });

    it('没有 frontmatter 时视为未结算（正文里出现同名字样也不算）', () => {
        expect(isChapterSettledText('正文里写了 status: settled 这几个字')).toBe(false);
        expect(isChapterSettledText('')).toBe(false);
        expect(isChapterSettledText(undefined)).toBe(false);
        expect(isChapterSettledText('---\n标题: 没有结束分隔符')).toBe(false);
    });

    it('只看 frontmatter：正文后段出现 status 不影响结果', () => {
        expect(isChapterSettledText('---\nstatus: written\n---\n\nstatus: settled')).toBe(false);
    });
});

describe('frontmatter 读取', () => {
    it('状态值去引号与空白', () => {
        expect(readFrontmatterStatus(body(' written '))).toBe('written');
    });

    it('extractFrontmatter 不含分隔行', () => {
        expect(extractFrontmatter(body('settled'))).toBe('status: settled');
    });

    it('parseChapterStatus 归一化展示值', () => {
        expect(parseChapterStatus(body('settled'))).toBe('settled');
        expect(parseChapterStatus(body('written'))).toBe('written');
        expect(parseChapterStatus(body('drafting'))).toBe('draft');
        expect(parseChapterStatus('正文')).toBe('unknown');
    });
});

describe('调用方一致性', () => {
    it('batch-targets.isBodySettled 与统一判定一致', () => {
        expect(isBodySettled(body('settled'))).toBe(true);
        expect(isBodySettled(body('已结算'))).toBe(true);
        expect(isBodySettled(body('written'))).toBe(false);
    });
});
