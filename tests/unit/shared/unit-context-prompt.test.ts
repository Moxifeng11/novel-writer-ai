import { describe, expect, it } from 'vitest';
import { renderScriptUnitContext, renderShortUnitContext, unitContextTokens } from '@/shared/unit-context-prompt';
import { parseScriptEpisodeOutline, parseScriptScenes, parseShortUnitOutline, parseShotList } from '@/shared/unit-card-model';

const SHORT = `## 第1节：雨夜来客
- 目标：发现异样
- 结尾钩子：脚步声

## 第2节：追踪
- 目标：跟踪黑影
`;

const EPISODES = `## 第1集：入门
- 核心冲突：测灵失败

## 第2集：试炼
- 核心冲突：试炼受阻
`;

const BODY = `### 1-1 日/内 山门
人物：林玄、苏婉
△ 抬头看牌匾。

### 1-2 夜/外 后山
△ 风声。
`;

const SHOTS = `| 镜号 | 景别 | 运镜 | 时长 |
|---|---|---|---|
| E01-S01-SH01 | 全景 | 推 | 3s |
`;

describe('renderShortUnitContext', () => {
    it('当前节全字段 + 其余一行', () => {
        const text = renderShortUnitContext(parseShortUnitOutline(SHORT), 1);
        expect(text).toContain('【当前节】第1节');
        expect(text).toContain('- 目标：发现异样');
        expect(text).toContain('【其余节（仅标题）】');
        expect(text).toContain('第2节：追踪');
    });

    it('节号越界取第一节', () => {
        const text = renderShortUnitContext(parseShortUnitOutline(SHORT), 99);
        expect(text).toContain('第1节');
    });

    it('空输入返回空串', () => {
        expect(renderShortUnitContext([], 1)).toBe('');
    });
});

describe('renderScriptUnitContext', () => {
    const episodes = parseScriptEpisodeOutline(EPISODES);
    const scenes = parseScriptScenes(BODY, 1);
    const shots = parseShotList(SHOTS);

    it('当前集全字段 + 当前场 + 本场分镜', () => {
        const text = renderScriptUnitContext(episodes, scenes, shots, { episode: 1, scene: 1 });
        expect(text).toContain('【当前集】第1集');
        expect(text).toContain('- 核心冲突：测灵失败');
        expect(text).toContain('EP01-S01');
        expect(text).toContain('- 人物：林玄、苏婉');
        expect(text).toContain('E01-S01-SH01');
    });

    it('其余场与其余集只一行', () => {
        const text = renderScriptUnitContext(episodes, scenes, shots, { episode: 1, scene: 1 });
        expect(text).toContain('【本集其余场（仅一行）】');
        expect(text).toContain('EP01-S02');
        expect(text).toContain('【其余集（仅标题）】');
        expect(text).toContain('第2集：试炼');
    });

    it('空输入返回空串', () => {
        expect(renderScriptUnitContext([], [], [], { episode: 1 })).toBe('');
    });

    it('token 估算', () => {
        expect(unitContextTokens('1234')).toBe(2);
    });
});
