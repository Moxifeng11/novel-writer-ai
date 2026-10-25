import { describe, it, expect } from 'vitest';
import {
    isMeaningfulValue,
    validateCharacterOutput,
    validateSettingLibOutput,
    validateWritingStyleOutput,
    WRITING_STYLE_REQUIRED_SECTIONS,
} from '../../../shared/template-validator';
import { SL_SECTIONS } from '../../../shared/format-constants';

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
