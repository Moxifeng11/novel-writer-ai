import { describe, it, expect } from 'vitest';
import {
    isMeaningfulValue,
    validateCharacterOutput,
    validateFactionOutput,
    validateItemOutput,
    validateLocationOutput,
    validateSettingLibOutput,
    validateWritingStyleOutput,
    WRITING_STYLE_REQUIRED_SECTIONS,
} from '../../../shared/template-validator';
import { ENTITY_BODY_SECTIONS, SL_SECTIONS } from '../../../shared/format-constants';

const settingLibSample = SL_SECTIONS
    .map(section => `## ${section}\n- 这是「${section}」的具体内容，不能为空。`)
    .join('\n\n');

const writingStyleSample = WRITING_STYLE_REQUIRED_SECTIONS
    .map(section => {
        if (section === '二、文笔特征') {
            return `## ${section}\n### 总体风格\n偏冷峻克制\n### 句式特征\n长短句交替\n### 用语习惯\n少用成语`;
        }
        return `## ${section}\n这里是「${section}」的具体要求，内容非空。`;
    })
    .join('\n\n');

describe('isMeaningfulValue', () => {
    it('拒绝空值与占位词', () => {
        expect(isMeaningfulValue('')).toBe(false);
        expect(isMeaningfulValue('   ')).toBe(false);
        expect(isMeaningfulValue('""')).toBe(false);
        expect(isMeaningfulValue('待补充')).toBe(false);
        expect(isMeaningfulValue('TBD')).toBe(false);
        expect(isMeaningfulValue('（无）')).toBe(false);
        expect(isMeaningfulValue('---')).toBe(false);
    });

    it('接受真实内容', () => {
        expect(isMeaningfulValue('张三')).toBe(true);
        expect(isMeaningfulValue('一名落魄的剑修')).toBe(true);
    });
});

describe('validateSettingLibOutput', () => {
    it('8 个模块都有内容时通过', () => {
        const result = validateSettingLibOutput(settingLibSample);
        expect(result.valid).toBe(true);
        expect(result.missingFields).toEqual([]);
    });

    it('模块只有标题没有内容时判定不完整', () => {
        const broken = settingLibSample.replace(
            `## ${SL_SECTIONS[0]}\n- 这是「${SL_SECTIONS[0]}」的具体内容，不能为空。`,
            `## ${SL_SECTIONS[0]}`
        );
        const result = validateSettingLibOutput(broken);
        expect(result.valid).toBe(false);
        expect(result.missingFields.some(f => f.includes(SL_SECTIONS[0]))).toBe(true);
    });

    it('空内容直接失败', () => {
        expect(validateSettingLibOutput('   ')).toEqual({ valid: false, missingFields: ['内容为空'] });
    });
});

describe('validateWritingStyleOutput', () => {
    it('9 个一级分节与 3 个子节齐全时通过', () => {
        const result = validateWritingStyleOutput(writingStyleSample);
        expect(result.valid).toBe(true);
        expect(result.missingFields).toEqual([]);
    });

    it('缺少分节时列出缺失项', () => {
        const broken = writingStyleSample.replace('## 三、对话风格\n这里是「三、对话风格」的具体要求，内容非空。', '');
        const result = validateWritingStyleOutput(broken);
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('分节: 三、对话风格');
    });

    it('子节为空时判定不完整', () => {
        const broken = writingStyleSample.replace('### 句式特征\n长短句交替', '### 句式特征\n');
        const result = validateWritingStyleOutput(broken);
        expect(result.valid).toBe(false);
        expect(result.missingFields.some(f => f.includes('句式特征'))).toBe(true);
    });
});

describe('validateCharacterOutput 空值校验', () => {
    it('姓名被写成空字符串时判定缺失', () => {
        const content = `---
tags: [人物]
姓名: ""
年龄: 20
身份: 剑修
人物背景: 出身寒门
外貌特征: 清瘦
当前目标: 复仇
核心动机: 活下去
核心驱动力_软肋: 妹妹
习惯性小动作: 摸剑柄
当前状态: 受伤
当前情绪: 平静
性格标签: 隐忍
金手指/特殊能力: 无
功法/技能树: 基础剑法
所属势力: 无
entity_status: active
entity_created_at: 2026-01-01
character_core:
  desire: 复仇
  fear: 失去妹妹
  obsession: 剑道
  shame: 逃亡
  trauma: 灭门
  weakness: 寡言
  soft_spot: 妹妹
  bottom_line: 不伤无辜
  secret: 身世
性格三层:
  表层_面具: 冷漠
  中层_真实: 温柔
  深层_内核: 执拗
角色弧光:
  起点状态: 逃避
  成长触发点: 妹妹被抓
  终点状态: 直面
  弧光类型: 正向
---

## 确定性设定（已揭露，不可违背）
- 出身寒门

## 不确定性（未解之谜 / 角色弧光）
- 是否会黑化

## 自信息事件储备（低概率但合理的惊喜行为）
- 为救人放弃复仇

## 与其他角色的互信息
- 与妹妹关系深厚

## 功法/技能树
- 基础剑法

## 角色灵魂层（欲望/恐惧/创伤/底线）
- 渴望复仇
`;
        const result = validateCharacterOutput(content);
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('姓名');
    });
});

describe('实体卡校验器：未闭合 / 空值 / 标签分支', () => {
    /** 拼装通用实体卡（地点/势力/物品共用 ENTITY_BODY_SECTIONS） */
    function entityCard(fields: Record<string, string>, closeYaml = true): string {
        const yaml = Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n');
        const body = ENTITY_BODY_SECTIONS.map(section => `## ${section}\n- 具体内容`).join('\n\n');
        const frontmatter = closeYaml ? `---\n${yaml}\n---` : `---\n${yaml}`;
        return `${frontmatter}\n\n${body}\n`;
    }

    const factionFields = (overrides: Record<string, string> = {}): Record<string, string> => ({
        tags: '[势力]',
        名称: '天剑宗',
        别称: '无',
        类型: '宗门',
        描述: '东域剑道第一宗门',
        领袖: '李沧澜',
        '地位/排名': '东域第一',
        entity_status: 'active',
        entity_created_at: '2026-01-01',
        ...overrides,
    });

    const locationFields = (overrides: Record<string, string> = {}): Record<string, string> => ({
        tags: '[地点]',
        名称: '落霞谷',
        别称: '无',
        类型: '山谷',
        描述: '常年瘴气弥漫的峡谷',
        重要程度: '高',
        地理特征: '两山夹一谷',
        '主要居民/势力': '散修',
        '所在世界/区域': '东域',
        ...overrides,
    });

    const itemFields = (overrides: Record<string, string> = {}): Record<string, string> => ({
        tags: '[物品功法]',
        名称: '青锋剑',
        类型: '兵器',
        描述: '一柄三寸青锋',
        效果: '斩金断玉',
        '品阶/等级': '地阶',
        '所属/归属': '天剑宗',
        entity_status: 'active',
        entity_created_at: '2026-01-01',
        ...overrides,
    });

    it('势力卡：完整输出通过', () => {
        const result = validateFactionOutput(entityCard(factionFields()));
        expect(result.valid).toBe(true);
        expect(result.missingFields).toEqual([]);
    });

    it('势力卡：YAML 未闭合返回 PARSE_ERROR', () => {
        const result = validateFactionOutput(entityCard(factionFields(), false));
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('PARSE_ERROR');
        expect(result.missingFields).toEqual(['YAML frontmatter 未闭合']);
    });

    it('势力卡：必填值字段为空时判定缺失（区别于键不存在）', () => {
        const result = validateFactionOutput(entityCard(factionFields({ 描述: '""' })));
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('描述（值为空）');
        expect(result.missingFields).not.toContain('描述');
    });

    it('势力卡：tags 缺少「势力」标签时单独报错', () => {
        const result = validateFactionOutput(entityCard(factionFields({ tags: '[人物]' })));
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('tags 缺失 [势力] 标签');
    });

    it('地点卡：YAML 未闭合返回 PARSE_ERROR', () => {
        const result = validateLocationOutput(entityCard(locationFields(), false));
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('PARSE_ERROR');
    });

    it('地点卡：名称为空时判定缺失', () => {
        const result = validateLocationOutput(entityCard(locationFields({ 名称: '""' })));
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('名称（值为空）');
    });

    it('物品卡：YAML 未闭合返回 PARSE_ERROR', () => {
        const result = validateItemOutput(entityCard(itemFields(), false));
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('PARSE_ERROR');
    });

    it('物品卡：效果为空且标签错误时同时报告两处', () => {
        const result = validateItemOutput(
            entityCard(itemFields({ 效果: '""', tags: '[地点]' }))
        );
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('效果（值为空）');
        expect(result.missingFields).toContain('tags 缺失 [物品功法] 标签');
    });

    it('人物卡：完全没有 YAML 头部时返回 PARSE_ERROR', () => {
        const result = validateCharacterOutput('# 张三\n\n没有任何 frontmatter 的人物卡');
        expect(result.valid).toBe(false);
        expect(result.errorType).toBe('PARSE_ERROR');
        expect(result.missingFields).toEqual(['YAML frontmatter 未闭合']);
    });

    it('人物卡：tags 缺少「人物」标签时单独报错', () => {
        const result = validateCharacterOutput(`---
tags: [势力]
姓名: 张三
---

## 确定性设定（已揭露，不可违背）
- 出身寒门
`);
        expect(result.valid).toBe(false);
        expect(result.missingFields).toContain('tags 缺失 [人物] 标签');
    });
});
