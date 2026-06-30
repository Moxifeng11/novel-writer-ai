import { describe, it, expect } from 'vitest';
import {
    extractCharacterCoreFromContent,
    formatSoulForPrompt,
    buildCharacterSoulSummary,
    getProtagonistSoulDetail,
    gatherAllCharacterCores,
} from '../../../engine/character-soul';
import { Vault } from '../../__mocks__/obsidian';

const FULL_NESTED_FM = `---
tags: [人物]
姓名: 林惊鸿
character_core:
  desire: 找回失踪的妹妹
  fear: 再次目睹至亲死亡
  obsession: 复仇
  shame: 第一次出剑误伤同门
  trauma: 师门血夜
  weakness: 听见妹妹名字会失神
  soft_spot: 流浪儿
  rage_trigger: 有人威胁孩童
  moral_boundary: 不杀无辜
---
# 林惊鸿
`;

const FLAT_FM = `---
tags: [人物]
姓名: 苏白
desire: 解开身世之谜
fear: 被遗忘
obsession: 寻找母亲遗物
shame: 当年弃武
trauma: 父亲战死
weakness: 醉后无法控制法力
soft_spot: 老仆人
rage_trigger: 嘲笑亡父
moral_boundary: 不向凡人出手
---
正文`;

const PARTIAL_FM = `---
desire: 出名
fear: 失败
---`;

const NO_FM = `# 没有 frontmatter 的文件\n正文`;

describe('extractCharacterCoreFromContent', () => {
    it('YAML 嵌套 character_core 提取完整 9 字段', () => {
        const s = extractCharacterCoreFromContent('林惊鸿', FULL_NESTED_FM);
        expect(s.name).toBe('林惊鸿');
        expect(s.desire).toBe('找回失踪的妹妹');
        expect(s.fear).toBe('再次目睹至亲死亡');
        expect(s.obsession).toBe('复仇');
        expect(s.trauma).toBe('师门血夜');
        expect(s.moral_boundary).toBe('不杀无辜');
        expect(s.hasSoul).toBe(true);
    });

    it('顶级扁平字段回退提取', () => {
        const s = extractCharacterCoreFromContent('苏白', FLAT_FM);
        expect(s.desire).toBe('解开身世之谜');
        expect(s.weakness).toBe('醉后无法控制法力');
        expect(s.hasSoul).toBe(true);
    });

    it('字段缺失 → hasSoul=false 且缺失字段为空串', () => {
        const s = extractCharacterCoreFromContent('张三', PARTIAL_FM);
        expect(s.desire).toBe('出名');
        expect(s.trauma).toBe('');
        expect(s.hasSoul).toBe(false);
    });

    it('没有 frontmatter 时返回全空且 hasSoul=false', () => {
        const s = extractCharacterCoreFromContent('无名氏', NO_FM);
        expect(s.hasSoul).toBe(false);
        expect(s.desire).toBe('');
        expect(s.name).toBe('无名氏');
    });
});

describe('formatSoulForPrompt', () => {
    it('完整 soul 输出包含全部标签行', () => {
        const soul = extractCharacterCoreFromContent('林惊鸿', FULL_NESTED_FM);
        const out = formatSoulForPrompt(soul);
        expect(out).toContain('【林惊鸿】');
        expect(out).toContain('欲望：找回失踪的妹妹');
        expect(out).toContain('暴走红线：有人威胁孩童');
        expect(out).toContain('底线：不杀无辜');
        expect(out.split('\n').length).toBe(9);
    });

    it('未配置 soul 时返回提示字符串', () => {
        const soul = extractCharacterCoreFromContent('无名氏', NO_FM);
        expect(formatSoulForPrompt(soul)).toBe('【无名氏】无灵魂层数据。');
    });
});

describe('buildCharacterSoulSummary', () => {
    it('正确标记主角并压缩多人灵魂层', () => {
        const a = extractCharacterCoreFromContent('林惊鸿', FULL_NESTED_FM);
        const b = extractCharacterCoreFromContent('苏白', FLAT_FM);
        const c = extractCharacterCoreFromContent('张三', PARTIAL_FM);
        const summary = buildCharacterSoulSummary([a, b, c], '林惊鸿');

        expect(summary.protagonist?.name).toBe('林惊鸿');
        expect(summary.hasSoulData).toBe(true);
        expect(summary.allSouls).toContain('【★主角】');
        expect(summary.allSouls).toContain('欲>找回失踪的妹妹');
        expect(summary.allSouls).toContain('（灵魂层未配置）');
    });

    it('主角不在列表时 protagonist=null', () => {
        const a = extractCharacterCoreFromContent('苏白', FLAT_FM);
        const summary = buildCharacterSoulSummary([a], '不存在的主角');
        expect(summary.protagonist).toBeNull();
        expect(summary.hasSoulData).toBe(true);
    });

    it('全员无 soul 时 hasSoulData=false', () => {
        const a = extractCharacterCoreFromContent('张三', NO_FM);
        const summary = buildCharacterSoulSummary([a], '张三');
        expect(summary.hasSoulData).toBe(false);
    });

    it('空数组时返回 hasSoulData=false 且 allSouls=空串', () => {
        const summary = buildCharacterSoulSummary([], '无');
        expect(summary.protagonist).toBeNull();
        expect(summary.hasSoulData).toBe(false);
        expect(summary.allSouls).toBe('');
    });
});

describe('getProtagonistSoulDetail', () => {
    it('完整 soul 输出 9 行第二人称描述', () => {
        const soul = extractCharacterCoreFromContent('林惊鸿', FULL_NESTED_FM);
        const out = getProtagonistSoulDetail(soul);
        expect(out.split('\n').length).toBe(9);
        expect(out).toContain('你知道自己最想得到什么：找回失踪的妹妹');
        expect(out).toContain('你知道自己的底线在哪里：不杀无辜');
    });

    it('未完整 soul 时返回空串', () => {
        const soul = extractCharacterCoreFromContent('张三', PARTIAL_FM);
        expect(getProtagonistSoulDetail(soul)).toBe('');
    });
});

describe('gatherAllCharacterCores', () => {
    it('批量读取多个角色文件构建 CharacterSoul[]', async () => {
        const vault = new Vault();
        const f1 = vault._seedFile('Proj/01-世界架构/人物/林惊鸿.md', FULL_NESTED_FM);
        const f2 = vault._seedFile('Proj/01-世界架构/人物/苏白.md', FLAT_FM);
        const f3 = vault._seedFile('Proj/01-世界架构/人物/张三.md', PARTIAL_FM);
        const souls = await gatherAllCharacterCores([f1, f2, f3], vault as any);
        expect(souls).toHaveLength(3);
        expect(souls.map(s => s.name)).toEqual(['林惊鸿', '苏白', '张三']);
        expect(souls[0].hasSoul).toBe(true);
        expect(souls[2].hasSoul).toBe(false);
    });

    it('vault.read 抛错时跳过该文件，不中断整体', async () => {
        const vault = new Vault();
        const f1 = vault._seedFile('Proj/01-世界架构/人物/林惊鸿.md', FULL_NESTED_FM);
        const f2 = vault._seedFile('Proj/01-世界架构/人物/坏文件.md', '');
        const origRead = vault.read;
        vault.read = (async (f: any) => {
            if (f.path.includes('坏文件')) throw new Error('IO error');
            return (origRead as any)(f);
        }) as any;
        const souls = await gatherAllCharacterCores([f1, f2], vault as any);
        expect(souls).toHaveLength(1);
        expect(souls[0].name).toBe('林惊鸿');
    });

    it('空数组返回空 souls', async () => {
        const vault = new Vault();
        const souls = await gatherAllCharacterCores([], vault as any);
        expect(souls).toEqual([]);
    });
});
