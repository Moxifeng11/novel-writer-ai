/**
 * knowledge-detail-labels.test.ts — 知识库详情弹窗（`knowledgeDetail.*`）双语（缺口⑦ 第二期第47片）
 *
 * 这个组此前在 en-US 里被整块写成了中文（`i18n-parity` 抓到 174 条 CJK），本片补齐英文并加回归断言：
 * 键集合一致、英文零 CJK、占位符逐键一致、文案抽检。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, translate } from '../../../i18n';
import { zhCN } from '../../../i18n/messages/zh-CN';
import { enUS } from '../../../i18n/messages/en-US';

const CJK = /[\u4e00-\u9fff]/;

/** 递归收集子树下的叶子键（`knowledgeDetail.*`） */
function leaves(tree: unknown, prefix: string, out: Record<string, unknown>): Record<string, unknown> {
    if (tree && typeof tree === 'object') {
        for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
            leaves(value, prefix + '.' + key, out);
        }
    } else {
        out[prefix] = tree;
    }
    return out;
}

const zhLeaves = leaves(zhCN.knowledgeDetail, 'knowledgeDetail', {});
const enLeaves = leaves(enUS.knowledgeDetail, 'knowledgeDetail', {});

describe('knowledgeDetail.* 资源（知识库详情弹窗）', () => {
    afterEach(() => setLocale('zh-CN'));

    it('中英键集合一致且不少于 180 条', () => {
        const keys = Object.keys(zhLeaves);
        expect(keys.length).toBeGreaterThanOrEqual(180);
        expect(Object.keys(enLeaves).sort()).toEqual(keys.sort());
    });

    it('英文资源零 CJK', () => {
        const offenders = Object.entries(enLeaves)
            .filter(([, value]) => CJK.test(String(value)))
            .map(([key]) => key);
        expect(offenders).toEqual([]);
    });

    it('占位符逐键一致', () => {
        const pick = (value: unknown): string => Array.from(String(value).matchAll(/\{(\w+)\}/g), m => m[1]).sort().join(',');
        const mismatched = Object.keys(zhLeaves).filter(key => pick(zhLeaves[key]) !== pick(enLeaves[key]));
        expect(mismatched).toEqual([]);
    });

    it('弹窗界面文案抽检（中/英）', () => {
        expect(translate('zh-CN', 'knowledgeDetail.info.title')).toBe('基本信息');
        expect(translate('en-US', 'knowledgeDetail.info.title')).toBe('Basic info');
        expect(translate('zh-CN', 'knowledgeDetail.fs.itemMeta', { category: '物品', chapter: 3 })).toBe('物品 · 首次出现：3');
        expect(translate('en-US', 'knowledgeDetail.fs.itemMeta', { category: 'Items', chapter: 3 })).toBe('Items · First seen: 3');
        expect(translate('zh-CN', 'knowledgeDetail.empty.title', { name: '风格分析数据' })).toBe('暂无风格分析数据');
        expect(translate('en-US', 'knowledgeDetail.empty.title', { name: 'Style analysis data' })).toBe('Style analysis data — no data yet');
    });
});
