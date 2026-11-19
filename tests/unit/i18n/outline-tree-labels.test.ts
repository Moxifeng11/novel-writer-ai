/**
 * outline-tree-labels.test.ts — 章节大纲树弹窗双语（缺口⑦ 第二期第48片）
 *
 * 覆盖 `ui/chapter-outline-tree-modal.ts` 的 `outlineTree.*` 资源（45 键）：标题栏、章号区间搜索、
 * 卷/章/场景行、概览与匹配计数、底部按钮，以及编辑/拖拽/保存的 16 条 Notice。
 *
 * 刻意保留中文的不是界面文案：分卷大纲与场景展开文件的解析正则、`## 场景N：` 与 `key_scene:` 文件格式、
 * 新建场景的默认名「新场景」、规划画布节点的卷标签（都落盘或进数据）、`log.*` 与注释。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale, translate } from '../../../i18n';
import { zhCN } from '../../../i18n/messages/zh-CN';
import { enUS } from '../../../i18n/messages/en-US';
import type { MessageTree } from '../../../i18n/messages/zh-CN';

const CJK = /[\u4e00-\u9fff]/;
const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

interface FlatLeaf { key: string; value: string }

function flatten(tree: MessageTree, prefix = ''): FlatLeaf[] {
    const out: FlatLeaf[] = [];
    for (const [k, v] of Object.entries(tree)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'string') out.push({ key, value: v });
        else out.push(...flatten(v, key));
    }
    return out;
}

const zhLeaves = flatten(zhCN.outlineTree as MessageTree);
const enLeaves = flatten(enUS.outlineTree as MessageTree);
const enMap = new Map(enLeaves.map(l => [l.key, l.value]));
const zhMap = new Map(zhLeaves.map(l => [l.key, l.value]));

function placeholders(text: string): string[] {
    return [...text.matchAll(PLACEHOLDER)].map(m => m[1]).sort();
}

describe('outlineTree 资源', () => {
    afterEach(() => setLocale('zh-CN'));

    it('中英键集合一致且不少于 45 条', () => {
        expect(zhLeaves.length).toBeGreaterThanOrEqual(45);
        expect(enLeaves.map(l => l.key).sort()).toEqual(zhLeaves.map(l => l.key).sort());
    });

    it('英文侧零 CJK', () => {
        for (const [key, value] of enMap) {
            expect(CJK.test(value), `${key} = ${value}`).toBe(false);
        }
    });

    it('占位符集合逐键一致', () => {
        for (const [key, zh] of zhMap) {
            expect(placeholders(enMap.get(key) ?? ''), key).toEqual(placeholders(zh));
        }
    });

    it('中文文案与迁移前逐字一致', () => {
        expect(zhMap.get('title')).toBe('📖 分卷大纲 · 章节冲突预览');
        expect(zhMap.get('empty')).toBe('⚠️ 未找到分卷大纲，请先执行"全书规划"步骤。');
        expect(zhMap.get('volume.hintNoMatch')).toBe('第{n}卷 {name} — {count}章 (无匹配)');
        expect(zhMap.get('footer.save')).toBe('💾 保存所有修改');
        expect(zhMap.get('notice.chapterDropped')).toBe(
            '已移动章节到第{vol}卷"{name}"第{index}位，章号已自动更新（点击"保存所有修改"写入文件）',
        );
        expect(zhMap.get('notice.savedWithScenes')).toBe('已保存 {edits} 处章节修改，{scenes} 个场景文件');
    });

    it('插值在两种语言下都生效', () => {
        // translate 的第一参数是 locale，不是全局 setLocale

        expect(translate('zh-CN', 'outlineTree.notice.sceneAdded', { num: 7 })).toBe('已添加场景7（点击"保存所有修改"写入文件）');
        expect(translate('zh-CN', 'outlineTree.volume.overviewMatch', { matched: 3, total: 12 })).toBe('🔍 匹配 3/12 章');
        expect(translate('en-US', 'outlineTree.notice.sceneAdded', { num: 7 })).toBe(
            'Added scene 7 (click "Save all changes" to write it to the file)',
        );
        expect(translate('en-US', 'outlineTree.volume.overviewMatch', { matched: 3, total: 12 })).toBe('🔍 3/12 ch. matched');
    });
});
