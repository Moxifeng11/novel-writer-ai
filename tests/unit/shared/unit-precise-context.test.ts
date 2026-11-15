/**
 * M8/M9：精确单元上下文接入 mode-unit-writer
 */

import { describe, expect, it } from 'vitest';
import { buildUnitPreciseContext } from '@/shared/unit-context-prompt';

describe('buildUnitPreciseContext', () => {
    it('短篇：解析分节大纲后渲染当前节', () => {
        const text = buildUnitPreciseContext({
            mode: 'short',
            unitNumber: 2,
            outlineText: '## 第1节：起\n- 目标：A\n\n## 第2节：承\n- 目标：B\n',
        });
        expect(text).toContain('【当前节】第2节');
        expect(text).toContain('- 目标：B');
        expect(text).toContain('第1节：起');
    });

    it('剧本：集卡 + 场卡 + 分镜', () => {
        const text = buildUnitPreciseContext({
            mode: 'script',
            unitNumber: 1,
            outlineText: '## 第1集：入门\n- 核心冲突：测灵失败\n',
            storyDoc: '### 1-1 日/内 山门\n人物：林玄\n△ 抬头。\n',
            storyboardText: '| 镜号 | 景别 |\n|---|---|\n| E01-S01-SH01 | 全景 |\n',
        });
        expect(text).toContain('【当前集】第1集');
        expect(text).toContain('EP01-S01');
        expect(text).toContain('E01-S01-SH01');
    });

    it('解析失败返回空串（调用方回退整份注入）', () => {
        expect(buildUnitPreciseContext({ mode: 'short', unitNumber: 1, outlineText: '没有分节标题' })).toBe('');
        expect(buildUnitPreciseContext({ mode: 'script', unitNumber: 1, outlineText: '没有分集标题' })).toBe('');
    });
});
