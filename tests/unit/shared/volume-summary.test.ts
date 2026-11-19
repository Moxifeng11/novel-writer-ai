/**
 * volume-summary.test.ts — 分卷大纲解析/摘要单一真源（C 清单 P2 #16）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    FIELD_VOLUME_NAME,
    FIELD_TOTAL_WORDS,
    FIELD_TOTAL_CHAPTERS,
    FIELD_VOLUME_COUNT,
} from '@/shared/format-constants';
import {
    isVolumeOutlineFileName,
    pjVolumeOutlineFile,
    volumeNumberFromOutlineName,
    VOLUME_OUTLINE_SUFFIX,
} from '@/shared/paths';
import { formatVolumePromptSummary, parseVolumeSummary } from '@/shared/volume-summary';

const SAMPLE = `---
tags: [大纲]
---

# 全书规划 & 分卷大纲

## 全书总览
- **总字数目标**：120万
- **总章节数**：300
- **分卷数**：3

### 第1卷
- **卷名**：《初入宗门》
- **章节范围**：第1章 - 第100章
- **核心冲突**：入门试炼
- **本卷高潮**：宗门大比
- **结尾过渡**：下山历练

| 章号 | 核心冲突 |
|------|---------|
| 1 | 测灵根 |
| 2 | 拜师 |

### 第2卷
- **卷名**：《下山历练》
- **章节范围**：第101章 - 第200章
- **核心冲突**：江湖恩怨
`;

describe('parseVolumeSummary', () => {
    it('解析全书总览三个字段（字段名取自 format-constants）', () => {
        const { bookSummary } = parseVolumeSummary(SAMPLE);
        expect(bookSummary.totalWords).toBe('120万');
        expect(bookSummary.totalChapters).toBe('300');
        expect(bookSummary.totalVolumes).toBe('3');
        expect(FIELD_TOTAL_WORDS).toBe('总字数目标');
        expect(FIELD_TOTAL_CHAPTERS).toBe('总章节数');
        expect(FIELD_VOLUME_COUNT).toBe('分卷数');
    });

    it('按卷头切卷，KV 进 sections，键名可按 FIELD_VOLUME_NAME 读取', () => {
        const { volumes } = parseVolumeSummary(SAMPLE);
        expect(volumes.map(v => v.name)).toEqual(['第1卷', '第2卷']);
        expect(volumes[0].sections[FIELD_VOLUME_NAME]).toBe('《初入宗门》');
        expect(volumes[1].sections[FIELD_VOLUME_NAME]).toBe('《下山历练》');
        expect(volumes[0].sections['核心冲突']).toBe('入门试炼');
    });

    it('只有出现「章节范围」的卷才收章节表行', () => {
        const { volumes } = parseVolumeSummary(SAMPLE);
        expect(volumes[0].chapters).toEqual([
            { num: 1, conflict: '测灵根' },
            { num: 2, conflict: '拜师' },
        ]);
        // 第 2 卷前没有表格行；即便有，缺「章节范围」也不收
        expect(volumes[1].chapters).toEqual([]);
    });

    it('卷头之前的内容不会产生空卷；无卷时返回空数组', () => {
        expect(parseVolumeSummary('随便一段正文\n- **卷名**：x').volumes).toEqual([]);
    });
});

describe('formatVolumePromptSummary', () => {
    it('默认前缀「关键冲突示例」，含卷名与章节范围', () => {
        const { volumes } = parseVolumeSummary(SAMPLE);
        const out = formatVolumePromptSummary(volumes);
        expect(out).toContain('=== 第1卷：《初入宗门》 ===');
        expect(out).toContain('章节：第1章 - 第100章');
        expect(out).toContain('关键冲突示例：测灵根 / 拜师');
    });

    it('可改冲突行前缀（novel-tags 用「冲突示例」）', () => {
        const { volumes } = parseVolumeSummary(SAMPLE);
        expect(formatVolumePromptSummary(volumes, { conflictLabel: '冲突示例' })).toContain('冲突示例：');
    });

    it('maxChars 截断；未命名卷有占位', () => {
        const { volumes } = parseVolumeSummary(SAMPLE);
        expect(formatVolumePromptSummary(volumes, { maxChars: 10 })).toHaveLength(10);
        const unnamed = parseVolumeSummary('### 第1卷\n- **章节范围**：第1章 - 第2章').volumes;
        expect(formatVolumePromptSummary(unnamed)).toContain('第1卷：未命名');
    });

    it('无卷但有全书总览时用总览兜底', () => {
        const bookSummary = { totalWords: '90万', totalChapters: '200', totalVolumes: '2' };
        const out = formatVolumePromptSummary([], { bookSummary });
        expect(out).toContain('总字数目标：90万');
        expect(out).toContain('分卷数：2');
        expect(formatVolumePromptSummary([])).toBe('');
    });
});

describe('分卷大纲文件名常量（shared/paths）', () => {
    it('pjVolumeOutlineFile 由 VOLUME_OUTLINE_SUFFIX 拼出', () => {
        const p = pjVolumeOutlineFile('《示例》', 2);
        expect(p).toBe(`《示例》/03-大纲与章节/分卷大纲/第2卷${VOLUME_OUTLINE_SUFFIX}`);
        expect(isVolumeOutlineFileName(p.split('/').pop() as string)).toBe(true);
    });

    it('isVolumeOutlineFileName 只认卷文件，旧版单文件返回 false', () => {
        expect(isVolumeOutlineFileName('第2卷_分卷大纲.md')).toBe(true);
        expect(isVolumeOutlineFileName('分卷大纲.md')).toBe(false);
        expect(isVolumeOutlineFileName('第2卷_正文.md')).toBe(false);
    });

    it('volumeNumberFromOutlineName 解析卷号，非卷文件返回 0', () => {
        expect(volumeNumberFromOutlineName('第3卷_分卷大纲.md')).toBe(3);
        expect(volumeNumberFromOutlineName('第10卷_分卷大纲.md')).toBe(10);
        expect(volumeNumberFromOutlineName('第3卷_正文.md')).toBe(0);
        expect(volumeNumberFromOutlineName('分卷大纲.md')).toBe(0);
    });
});

describe('两个弹窗共用同一解析器（源码级不变量）', () => {
    const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

    it.each(['ui/novel-tags-modal.ts', 'ui/volume-intro-modal.ts'])('%s 不再自写卷头/KV/表格正则', (file) => {
        const src = read(file);
        expect(src).toContain("from '@/shared/volume-summary'");
        expect(src).not.toMatch(/line\.match\(\/\^###\\s\+\(第\\d\+卷\)\//);
        expect(src).not.toMatch(/line\.match\(\/\^-\\s\*\\\(\\\.\*\?\\\)/);
    });

    it('运行时代码不再就地判断「_分卷大纲.md」后缀', () => {
        for (const file of ['ui/chapter-outline-tree-modal.ts', 'ui/plot-canvas-modal.ts', 'utils/helpers.ts']) {
            expect(read(file)).not.toContain("endsWith('_分卷大纲.md')");
        }
    });
});
