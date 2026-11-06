import { describe, it, expect } from 'vitest';
import {
    isMeaningfulValue,
    validateCharacterOutput,
    validateFactionOutput,
    validateItemOutput,
    validateLocationOutput,
    validateSettingLibOutput,
    validateWritingStyleOutput,
    validateWorldviewOutput,
    validateOutlineOutput,
    validateBulletFormat,
    validateFanficSettings,
    detectTimelineStrategy,
    loadFanficRules,
    isFanficValueFilled,
    parseCanonTimelineTable,
    parseTimelineBoardTable,
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

    it('人物卡：尾部缺少闭合符时回退解析，不误报 PARSE_ERROR', () => {
        const result = validateCharacterOutput('---\ntags: [人物]\n姓名: 张三\n');
        expect(result.errorType).toBeUndefined();
        expect(result.missingFields).not.toContain('姓名');
        expect(result.missingFields).not.toContain('YAML frontmatter 未闭合');
    });

    it('势力卡：YAML 块标量（> 与 |）视为有值', () => {
        const card = (marker: '>' | '|'): string => {
            const yaml = [
                'tags: [势力]',
                '名称: 天剑宗',
                '别称: 无',
                '类型: 宗门',
                `描述: ${marker}`,
                '  东域剑道',
                '',
                '  第一宗门',
                '领袖: 李沧澜',
                '地位/排名: 东域第一',
                'entity_status: active',
                'entity_created_at: 2026-01-01',
            ].join('\n');
            const body = ENTITY_BODY_SECTIONS.map(section => `## ${section}\n- 具体内容`).join('\n\n');
            return `---\n${yaml}\n---\n\n${body}\n`;
        };

        expect(validateFactionOutput(card('>')).valid).toBe(true);
        expect(validateFactionOutput(card('|')).valid).toBe(true);
    });

    it('地点卡：tags 缺少「地点」标签时单独报错', () => {
        const result = validateLocationOutput(entityCard(locationFields({ tags: '[势力]' })));
        expect(result.missingFields).toContain('tags 缺失 [地点] 标签');
    });

    it('物品卡：必填值字段为空时判定缺失', () => {
        const result = validateItemOutput(entityCard(itemFields({ '品阶/等级': '""' })));
        expect(result.missingFields).toContain('品阶/等级（值为空）');
    });

    it('物品卡：必填键完全缺失时按缺键报告', () => {
        const content = entityCard(itemFields()).replace('品阶/等级: 地阶\n', '');
        const result = validateItemOutput(content);
        expect(result.missingFields).toContain('品阶/等级');
    });

    it('物品卡：缺少正文分节时报告分节缺失', () => {
        const section = ENTITY_BODY_SECTIONS[1];
        const content = entityCard(itemFields()).replace(`## ${section}\n- 具体内容\n\n`, '');
        const result = validateItemOutput(content);
        expect(result.missingFields).toContain(`正文分节: ${section}`);
    });
});

describe('template-validator 零依赖分支尾盘', () => {
    it('同人字段：null 与占位值一律未填，明确值算已填', () => {
        expect(isFanficValueFilled(null)).toBe(false);
        expect(isFanficValueFilled('（待补充）')).toBe(false);
        expect(isFanficValueFilled('未知')).toBe(true);
    });

    it('设定库：分节里只有空标签或空链接时判为内容为空', () => {
        const onlyLabels = `## ${SL_SECTIONS[0]}\n- 外貌：\n- [[链接]]`;
        const rest = SL_SECTIONS.slice(1).map(section => `## ${section}\n- 有内容`).join('\n\n');
        const result = validateSettingLibOutput(`${onlyLabels}\n\n${rest}`);
        expect(result.missingFields).toEqual([`模块内容为空: ${SL_SECTIONS[0]}`]);
    });

    it('设定库：整节缺失时报「模块」而不是「模块内容为空」', () => {
        const broken = settingLibSample.replace(
            `## ${SL_SECTIONS[0]}\n- 这是「${SL_SECTIONS[0]}」的具体内容，不能为空。\n\n`,
            ''
        );
        const result = validateSettingLibOutput(broken);
        expect(result.missingFields).toEqual([`模块: ${SL_SECTIONS[0]}`]);
    });

    it('文笔风格：空内容直接失败', () => {
        expect(validateWritingStyleOutput('   ')).toEqual({ valid: false, missingFields: ['内容为空'] });
    });

    it('连续 200+ 中文字符无换行判定为散文段落（世界观输出同口径生效）', () => {
        const prose = '这'.repeat(220);
        expect(validateBulletFormat(prose).errorType).toBe('prose_detected');
        const worldview = validateWorldviewOutput(prose);
        expect(worldview.valid).toBe(false);
        expect(worldview.missingFields).toContain(
            '散文段落检测：发现连续200+中文字符无换行的大段叙述'
        );
    });

    it('大纲：章节范围格式不合法时单独报错', () => {
        const result = validateOutlineOutput('### 第1卷\n- **卷名**：开篇');
        expect(result.missingFields).toContain('第1卷.章节范围格式(需为"第X章 - 第Y章")');
    });

    it('大纲：没有任何分卷时提示未找到分卷', () => {
        expect(validateOutlineOutput('随便写点内容').missingFields).toEqual([
            '未找到任何分卷(### 第N卷)',
        ]);
    });

    it('同人设定：时间线整节缺失时报表格缺失', () => {
        const filled = `---
作品名称: 星尘学院
作品类型: 同人
作者: 张三
---
- **世界观类型**：星际
- **力量体系**：观测系
- **核心规则**：原作优先
- **必须遵守的原作规则**：主线不变
- **允许改编的范围**：支线
- **禁止触及的红线**：不改结局
`;
        expect(validateFanficSettings(filled).missingFields).toEqual([
            '原作剧情时间线(表格)',
            '故事背景时间线(表格)',
        ]);
    });

    it('时间线策略：原创项目走 original，行内式「类型：同人」识别为同人且无路径', () => {
        expect(detectTimelineStrategy('## 类型\n原创')).toEqual({
            strategy: 'original',
            timelines: ['board'],
            rules: false,
        });
        const fanfic = detectTimelineStrategy('类型：同人');
        expect(fanfic.strategy).toBe('fanfic');
        expect(fanfic.fanficSettingsPath).toBeUndefined();
    });

    it('同人规则：完全没有规则文本时返回空规则', () => {
        expect(loadFanficRules('')).toEqual({ mustFollow: [], adaptScope: '', redlines: [] });
    });

    it('时间线看板：缺少纪元时间轴分节时返回空数组', () => {
        expect(parseTimelineBoardTable('## 其他\n| # | 事件名称 |')).toEqual([]);
    });

    it('时间线看板：遇到下一个标题即停止收集', () => {
        const content = `## 纪元 / 时间轴
| # | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型 |
|---|---|---|---|---|---|---|
| 1 | 星门崩裂 | 星历 301 年 | 东域 | 林澈 | 第 12 章 | 转折 |
## 后记
| 2 | 不该被收录 |`;
        expect(parseTimelineBoardTable(content)).toHaveLength(1);
    });

    it('原作时间线：数据行列数不足时后续列补空串', () => {
        const content = `## 原作剧情时间线
| 时间节点 | 原作事件 |
|---|---|
| 星历 301 年 | 星门崩裂 |
`;
        const rows = parseCanonTimelineTable(content);
        expect(rows[0]['章节参考']).toBe('');
    });
});
