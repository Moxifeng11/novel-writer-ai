import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { Vault } from 'obsidian';
import {
    FANFIC_MAX_INJECTED_TIMELINE_ROWS,
    FANFIC_RULE_ITEM_MAX_CHARS,
    FANFIC_TIMELINE_ROW_MAX_CHARS,
    formatFanficRulesForPrompt,
    mergeFanficRequirement,
    parseFanficRules,
    parseFanficTimeline,
    parseProjectMeta,
    readFanficRules,
} from '../../../shared/fanfic-rules';
import { pjProjectMeta } from '../../../shared/paths';

/** 测试用 Vault：类型声明来自 obsidian 真实 typings，运行时由 vitest alias 指向 mock */
type TestVault = Vault & { write(path: string, content: string): Promise<void> };

function makeApp(): { app: App; vault: TestVault } {
    const vault = new Vault() as TestVault;
    return { app: { vault } as unknown as App, vault };
}

const PROJECT = '测试项目';
const FANFIC_PATH = `${PROJECT}/05-同人设定库/星尘学院设定.md`;

const FANFIC_CONTENT = `---
作品名称: 星尘学院
作品类型: 学院奇幻
作者: 测试作者
---

# 星尘学院 同人设定

## 原作核心设定
- **世界观类型**：学院奇幻
- **力量体系**：星图观测、星尘回路
- **核心规则**：能力来自星图共鸣，越界观测造成记忆污染。

## 创作规则
- **必须遵守的原作规则**：星术能力必须与星图观测有关。
- **允许改编的范围**：可以新增支线角色与边缘学院事件。
- **禁止触及的红线**：不能改写原作主角结局。
`;

describe('parseProjectMeta', () => {
    it('类型为 fanfic 时识别为同人项目', () => {
        const result = parseProjectMeta(`# P\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);
        expect(result.isFanfic).toBe(true);
        expect(result.fanficPath).toBe(FANFIC_PATH);
    });

    it('无类型但记录了同人设定路径时也视为同人', () => {
        const result = parseProjectMeta(`# P\n\n## 同人设定路径\n${FANFIC_PATH}\n`);
        expect(result.isFanfic).toBe(true);
    });

    it('原创项目不误判', () => {
        const result = parseProjectMeta('# P\n\n## 类型\noriginal\n');
        expect(result.isFanfic).toBe(false);
        expect(result.fanficPath).toBe('');
    });
});

describe('parseFanficRules', () => {
    it('解析作品名、原作核心设定与三条创作规则', () => {
        const rules = parseFanficRules(FANFIC_CONTENT, FANFIC_PATH);
        expect(rules.workName).toBe('星尘学院');
        expect(rules.worldviewType).toBe('学院奇幻');
        expect(rules.powerSystem).toContain('星图观测');
        expect(rules.coreRules).toContain('记忆污染');
        expect(rules.mustFollow).toContain('星图观测');
        expect(rules.adaptScope).toContain('支线角色');
        expect(rules.redlines).toContain('主角结局');
        expect(rules.path).toBe(FANFIC_PATH);
    });

    it('缺少标题时回退到 frontmatter 作品名称', () => {
        const rules = parseFanficRules('- **禁止触及的红线**：无\n', '');
        expect(rules.redlines).toBe('无');
        expect(rules.workName).toBe('');
    });

    it('多行规则保留续行，prompt 不会只剩第一行', () => {
        const content = `# 星尘学院 同人设定

## 创作规则
- **必须遵守的原作规则**：星术能力必须与星图观测有关。
- 不得出现无星图来源的凭空施法。
- **允许改编的范围**：可以新增支线角色。
`;
        const rules = parseFanficRules(content, FANFIC_PATH);
        expect(rules.mustFollow).toBe('星术能力必须与星图观测有关。\n- 不得出现无星图来源的凭空施法。');
        expect(rules.adaptScope).toBe('可以新增支线角色。');
        expect(formatFanficRulesForPrompt(rules)).toContain('不得出现无星图来源的凭空施法');
    });

    it('只有 frontmatter 时回退读取规则，避免整份约束丢失', () => {
        const content = `---
作品名称: 星尘学院
世界观类型: 学院奇幻
力量体系: 星图观测
核心规则: 能力来自星图共鸣。
必须遵守的原作规则: 能力必须与星图有关。
---
`;
        const rules = parseFanficRules(content, FANFIC_PATH);
        expect(rules.mustFollow).toBe('能力必须与星图有关。');
        expect(formatFanficRulesForPrompt(rules)).toContain('能力必须与星图有关');
    });

    it('正文与 frontmatter 同时存在时以正文为准', () => {
        const content = `---
必须遵守的原作规则: frontmatter 版本
---
- **必须遵守的原作规则**：正文版本
`;
        expect(parseFanficRules(content, FANFIC_PATH).mustFollow).toBe('正文版本');
    });
});

describe('formatFanficRulesForPrompt', () => {
    it('原创项目返回空串，不污染 prompt', () => {
        expect(formatFanficRulesForPrompt({
            isFanfic: false, path: '', workName: '',
            worldviewType: '', powerSystem: '', coreRules: '',
            mustFollow: '', adaptScope: '', redlines: '',
        })).toBe('');
    });

    it('同人项目输出最高优先级约束块，并包含原作核心设定', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(FANFIC_CONTENT, FANFIC_PATH));
        expect(text).toContain('【同人创作约束（最高优先级，违反即返工）】');
        expect(text).toContain('原作：《星尘学院》');
        expect(text).toContain('【原作核心设定】');
        expect(text).toContain('原作力量体系：星图观测、星尘回路');
        expect(text).toContain('原作核心规则：能力来自星图共鸣');
        expect(text).toContain('必须遵守的原作规则');
        expect(text).toContain('禁止触及的红线');
    });

    it('只有核心设定、没有创作规则时仍然注入', () => {
        const text = formatFanficRulesForPrompt({
            isFanfic: true, path: FANFIC_PATH, workName: '星尘学院',
            worldviewType: '学院奇幻', powerSystem: '星图观测', coreRules: '',
            mustFollow: '', adaptScope: '', redlines: '',
        });
        expect(text).toContain('原作力量体系：星图观测');
        expect(text).not.toContain('【创作规则】');
    });

    it('核心设定与规则全空时不输出空壳段落', () => {
        expect(formatFanficRulesForPrompt({
            isFanfic: true, path: FANFIC_PATH, workName: '星尘学院',
            worldviewType: '', powerSystem: '', coreRules: '',
            mustFollow: '', adaptScope: '', redlines: '',
        })).toBe('');
    });

    it('超长条目按上限截断，避免挤占本地窗口预算', () => {
        const text = formatFanficRulesForPrompt({
            isFanfic: true, path: FANFIC_PATH, workName: '星尘学院',
            worldviewType: '', powerSystem: '星'.repeat(FANFIC_RULE_ITEM_MAX_CHARS + 50), coreRules: '',
            mustFollow: '', adaptScope: '', redlines: '',
        });
        expect(text).toContain('…');
        expect(text).not.toContain('星'.repeat(FANFIC_RULE_ITEM_MAX_CHARS + 1));
    });
});

describe('mergeFanficRequirement', () => {
    it('同人块在前、用户要求在后，约束优先级高于用户补充', () => {
        expect(mergeFanficRequirement('【同人创作约束】', '写一个反派')).toBe('【同人创作约束】\n\n写一个反派');
    });

    it('没有用户要求时只返回同人块', () => {
        expect(mergeFanficRequirement('【同人创作约束】')).toBe('【同人创作约束】');
        expect(mergeFanficRequirement('【同人创作约束】', '   ')).toBe('【同人创作约束】');
    });

    it('原创项目（空块）透传用户要求并去除首尾空白', () => {
        expect(mergeFanficRequirement('', '  写一个反派  ')).toBe('写一个反派');
        expect(mergeFanficRequirement('', undefined)).toBe('');
    });
});

describe('readFanficRules', () => {
    it('按 .project 的同人设定路径读取并解析', async () => {
        const { app, vault } = makeApp();
        await vault.write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);
        await vault.write(FANFIC_PATH, FANFIC_CONTENT);

        const rules = await readFanficRules(app, PROJECT);
        expect(rules.isFanfic).toBe(true);
        expect(rules.workName).toBe('星尘学院');
        expect(rules.redlines).toContain('主角结局');
    });

    it('原创项目返回空规则', async () => {
        const { app, vault } = makeApp();
        await vault.write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\noriginal\n`);

        const rules = await readFanficRules(app, PROJECT);
        expect(rules.isFanfic).toBe(false);
        expect(formatFanficRulesForPrompt(rules)).toBe('');
    });

    it('同人项目但设定文件缺失时不抛错，保留路径', async () => {
        const { app, vault } = makeApp();
        await vault.write(pjProjectMeta(PROJECT), `# ${PROJECT}\n\n## 类型\nfanfic\n\n## 同人设定路径\n${FANFIC_PATH}\n`);

        const rules = await readFanficRules(app, PROJECT);
        expect(rules.isFanfic).toBe(true);
        expect(rules.path).toBe(FANFIC_PATH);
        expect(formatFanficRulesForPrompt(rules)).toBe('');
    });

    it('项目 .project 缺失时返回空规则', async () => {
        const { app } = makeApp();
        const rules = await readFanficRules(app, PROJECT);
        expect(rules.isFanfic).toBe(false);
    });
});

const FANFIC_WITH_CHARACTERS = `${FANFIC_CONTENT}
## 主要人物
- **人物名**：沈星野
  - **原作定位**：星图学院一年级，观测系天才
  - **在同人中的变化**：提前觉醒，性格更沉默
- **人物名**：白鹭
  - **原作定位**：学生会会长，秩序派
  - **在同人中的变化**：

## 势力组织
- **势力名**：观测系
  - **原作定位**：保守派
  - **在同人中的变化**：分裂为两派
`;

describe('同人设定库 · 原作主要人物', () => {
    it('解析「## 主要人物」下的多条人物条目', () => {
        const rules = parseFanficRules(FANFIC_WITH_CHARACTERS, FANFIC_PATH);
        expect(rules.characters).toHaveLength(2);
        expect(rules.characters?.[0]).toEqual({
            name: '沈星野',
            originalRole: '星图学院一年级，观测系天才',
            change: '提前觉醒，性格更沉默',
        });
        expect(rules.characters?.[1].name).toBe('白鹭');
        expect(rules.characters?.[1].change).toBe('');
    });

    it('原作人物进入 prompt 的【原作主要人物】段', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(FANFIC_WITH_CHARACTERS, FANFIC_PATH));
        expect(text).toContain('【原作主要人物】');
        expect(text).toContain('沈星野');
        expect(text).toContain('原作定位：星图学院一年级');
        expect(text).toContain('在同人中的变化：提前觉醒');
        // 势力条目属于势力段，不能混进人物段
        expect(text.split('【原作势力组织】')[0]).not.toContain('- 观测系（');
    });

    it('没有「## 主要人物」段时不出现该标题（向后兼容）', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(FANFIC_CONTENT, FANFIC_PATH));
        expect(text).not.toContain('【原作主要人物】');
    });

    it('人物条目超过上限时只注入前 N 条，避免挤占本地窗口', () => {
        const many = Array.from({ length: 10 }, (_, i) => `- **人物名**：角色${i + 1}\n  - **原作定位**：定位${i + 1}\n`).join('');
        const content = `${FANFIC_CONTENT}\n## 主要人物\n${many}`;
        const rules = parseFanficRules(content, FANFIC_PATH);
        const text = formatFanficRulesForPrompt(rules);
        expect(rules.characters).toHaveLength(10);
        expect(text).toContain('角色6');
        expect(text).not.toContain('角色7');
    });

    it('人物名是占位「待补充」时忽略该条目', () => {
        const content = `${FANFIC_CONTENT}\n## 主要人物\n- **人物名**：待补充\n  - **原作定位**：待补充\n`;
        const rules = parseFanficRules(content, FANFIC_PATH);
        expect(rules.characters).toEqual([]);
        expect(formatFanficRulesForPrompt(rules)).not.toContain('【原作主要人物】');
    });
});

describe('同人设定库 · 势力组织', () => {
    it('解析「## 势力组织」下的多条势力条目', () => {
        const rules = parseFanficRules(FANFIC_WITH_CHARACTERS, FANFIC_PATH);
        expect(rules.factions).toHaveLength(1);
        expect(rules.factions?.[0]).toEqual({
            name: '观测系',
            originalRole: '保守派',
            change: '分裂为两派',
        });
    });

    it('势力进入 prompt 的【原作势力组织】段，且不与人物段混排', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(FANFIC_WITH_CHARACTERS, FANFIC_PATH));
        expect(text).toContain('【原作势力组织】');
        expect(text).toContain('- 观测系（原作定位：保守派；在同人中的变化：分裂为两派）');
        const characterSection = text.split('【原作势力组织】')[0];
        expect(characterSection).not.toContain('- 观测系（');
    });

    it('没有「## 势力组织」段时不出现该标题（向后兼容）', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(FANFIC_CONTENT, FANFIC_PATH));
        expect(text).not.toContain('【原作势力组织】');
    });

    it('势力名为占位「（待补充）」时忽略该条目', () => {
        const content = `${FANFIC_CONTENT}\n## 势力组织\n- **势力名**：（待补充）\n  - **原作定位**：（待补充）\n`;
        const rules = parseFanficRules(content, FANFIC_PATH);
        expect(rules.factions).toEqual([]);
        expect(formatFanficRulesForPrompt(rules)).not.toContain('【原作势力组织】');
    });
});

const FANFIC_WITH_TIMELINE = `${FANFIC_CONTENT}
## 原作剧情时间线
| 时间节点 | 原作事件 | 涉及人物 | 章节参考 | 你的同人如何切入 |
|---------|---------|---------|---------|----------------|
| 星历 301 年 | 星门崩裂 | 林澈 | 原作第 12 章 | 主角提前入学 |
| 待补充 | 待补充 | 待补充 | 待补充 | 待补充 |

## 故事背景时间线（你的同人）
| 你的时间节点 | 你的事件 | 对应原作时间 | 涉及人物 |
|------------|---------|------------|---------|
| 入学第一周 | 主角被观测系盯上 | 星历 301 年 | 林澈 |
`;

describe('同人设定库 · 时间线表格', () => {
    it('解析两张时间线表格，丢弃表头、分隔行与整行占位', () => {
        const rules = parseFanficRules(FANFIC_WITH_TIMELINE, FANFIC_PATH);

        expect(rules.originalTimeline).toEqual(['星历 301 年｜星门崩裂｜林澈｜原作第 12 章｜主角提前入学']);
        expect(rules.fanficTimeline).toEqual(['入学第一周｜主角被观测系盯上｜星历 301 年｜林澈']);
    });

    it('原作时间线与同人时间线分两段注入，不与人物/势力混排', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(FANFIC_WITH_TIMELINE, FANFIC_PATH));

        expect(text).toContain('【原作剧情时间线】');
        expect(text).toContain('- 星历 301 年｜星门崩裂｜林澈｜原作第 12 章｜主角提前入学');
        expect(text).toContain('【同人时间线】');
        expect(text).toContain('- 入学第一周｜主角被观测系盯上｜星历 301 年｜林澈');
        expect(text.indexOf('【原作剧情时间线】')).toBeLessThan(text.indexOf('【同人时间线】'));
        expect(text).not.toContain('待补充');
    });

    it('时间线注入有上限：最多 8 行，单行超长截断', () => {
        const longEvent = '长'.repeat(FANFIC_TIMELINE_ROW_MAX_CHARS + 60);
        const rows = Array.from(
            { length: 10 },
            (_, index) => `| 星历 ${index} 年 | 事件${index} | 人物${index} | 第${index}章 |`,
        );
        const content = `${FANFIC_CONTENT}\n## 原作剧情时间线\n| 时间节点 | 原作事件 |\n|---|---|\n`
            + `| 星历 999 年 | ${longEvent} |\n${rows.join('\n')}\n`;

        const rules = parseFanficRules(content, FANFIC_PATH);
        expect(rules.originalTimeline).toHaveLength(11);

        const lines = formatFanficRulesForPrompt(rules)
            .split('\n')
            .filter((line) => line.startsWith('- 星历'));
        expect(lines).toHaveLength(FANFIC_MAX_INJECTED_TIMELINE_ROWS);
        expect(lines[0]).toContain('…');
        expect(lines[0].length).toBeLessThanOrEqual(FANFIC_TIMELINE_ROW_MAX_CHARS + 3);
        expect(lines.join('\n')).not.toContain('星历 8 年');
    });

    it('没有时间线小节或只有占位行时不出现这两段（向后兼容）', () => {
        const plain = formatFanficRulesForPrompt(parseFanficRules(FANFIC_CONTENT, FANFIC_PATH));
        expect(plain).not.toContain('【原作剧情时间线】');
        expect(plain).not.toContain('【同人时间线】');

        const placeholderOnly = `${FANFIC_CONTENT}\n## 原作剧情时间线\n| 时间节点 | 原作事件 |\n|---|---|\n| 待补充 | 待补充 |\n`;
        const rules = parseFanficRules(placeholderOnly, FANFIC_PATH);
        expect(rules.originalTimeline).toEqual([]);
        expect(formatFanficRulesForPrompt(rules)).not.toContain('【原作剧情时间线】');
    });

    it('parseFanficTimeline 不匹配表标题以外的段（避免误吞后续小节）', () => {
        const content = `${FANFIC_WITH_TIMELINE}\n## 创作规则\n- **必须遵守的原作规则**：不得改写结局\n`;
        expect(parseFanficTimeline(content, '原作剧情时间线')).toEqual([
            '星历 301 年｜星门崩裂｜林澈｜原作第 12 章｜主角提前入学',
        ]);
    });
});

describe('同人设定库 · 核心字段占位', () => {
    const PLACEHOLDER_ONLY = `---
作品名称: 星尘学院
---

# 星尘学院 同人设定

## 原作核心设定
- **世界观类型**：（待补充）
- **力量体系**：待补充
- **核心规则**：(待补充)

## 创作规则
- **必须遵守的原作规则**：（待补充）
- **允许改编的范围**：（待补充）
- **禁止触及的红线**：（待补充）
`;

    it('核心设定与规则全是占位时解析为空字符串', () => {
        const rules = parseFanficRules(PLACEHOLDER_ONLY, FANFIC_PATH);
        expect(rules.worldviewType).toBe('');
        expect(rules.powerSystem).toBe('');
        expect(rules.coreRules).toBe('');
        expect(rules.mustFollow).toBe('');
        expect(rules.adaptScope).toBe('');
        expect(rules.redlines).toBe('');
    });

    it('全是占位时不产生「同人创作约束」块（占位不是真实约束）', () => {
        const text = formatFanficRulesForPrompt(parseFanficRules(PLACEHOLDER_ONLY, FANFIC_PATH));
        expect(text).toBe('');
    });

    it('混填时只丢弃占位字段，真实字段照常注入', () => {
        const content = PLACEHOLDER_ONLY.replace(
            '- **核心规则**：(待补充)',
            '- **核心规则**：能力来自星图共鸣',
        ).replace(
            '- **必须遵守的原作规则**：（待补充）',
            '- **必须遵守的原作规则**：星术必须与星图有关',
        );
        const text = formatFanficRulesForPrompt(parseFanficRules(content, FANFIC_PATH));

        expect(text).toContain('- 原作核心规则：能力来自星图共鸣');
        expect(text).toContain('- 必须遵守的原作规则：星术必须与星图有关');
        expect(text).not.toContain('（待补充）');
        expect(text).not.toContain('待补充');
    });
});
