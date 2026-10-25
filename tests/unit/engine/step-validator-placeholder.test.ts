import { describe, it, expect } from 'vitest';
import {
    validateStepResult,
    isTemplateSkeleton,
    stripPlaceholderLines,
} from '../../../engine/step-validator';

/**
 * Rev 185 回归：模板骨架里的「空标签 / 空表格行 / 枚举提示」不能算内容。
 * 样例取自九霄逆脉行第1卷第3章的真实模板文件（已去掉 frontmatter）。
 */

const TEMPLATE_PLOT_DISTILL = `# 第291章 情节蒸馏

## 场景节奏设计
- 起（铺垫）：
- 承（发展）：
- 转（转折）：
- 合（收尾）：

## 情节节点规划（3-5个）
- 节点1：
- 节点2：
- 节点3：
- 节点4：（可选）
- 节点5：（可选）

## 爽点设计
- 核心爽点：
- 爽点类型：逆袭/打脸/成长/揭秘/情感爆发
- 铺垫方式：

## 冲突升级路径
- 初始状态：
- 升级点1：
- 升级点2：
- 高潮点：
- 回落/悬念：

## 信息密度指标
- 预计章节字数：
- 情节节点密度：每千字≥1个节点
- 信息增量：高/中/低`;

const TEMPLATE_OUTLINE = `# 第291章 大纲摘要

## 全书定位
- 本章处于全书 [开端/发展/转折/高潮/收尾] 阶段
- 负责推进：
- 负责揭示：
- 负责铺垫：

## 关键场景（3-5个）
| # | 地点 | 人物 | 冲突 | 叙事目标 | 信息增量 |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |

## 结尾钩子
- 钩子类型：悬念式/反转式/预告式/前置冲突
- 钩子内容：`;

const REAL_PLOT_DISTILL = `## 场景节奏设计
- 起（铺垫）：沈渊在矿道口被顺脉执役拦下，测脉石亮出九脉逆行，围观人群哗然。
- 承（发展）：执役要给他扣上锁脉环，母亲挤进人群，用矿籍担保换他三天期限。
- 转（转折）：沈渊发现测脉石上的裂纹与父亲遗物上的刻痕一致，怀疑调换另有其人。
- 合（收尾）：他摘下矿牌走向天梯，身后铜哨响起，追捕提前开始。

## 情节节点规划（3-5个）
- 节点1：公测现场亮出九脉逆行，身份暴露。
- 节点2：母亲以矿籍担保，争来三天期限。
- 节点3：测脉石裂纹与父亲遗物吻合，调包线索浮现。
- 节点4：执役提前吹哨，围捕开始。
- 节点5：沈渊跳下废弃矿道，借倒旋灵压脱身。

## 爽点设计
- 核心爽点：被当众判死的逆脉者，反手用矿道地形甩开整队执役。
- 爽点类型：打脸/逆袭
- 铺垫方式：前文反复强调执役熟悉矿道，结果被矿道反杀。

## 冲突升级路径
- 初始状态：例行测脉，沈渊只想蒙混过关。
- 升级点1：测脉石亮起，人群围观，退路被封。
- 升级点2：母亲被扣作担保，倒计时开始。
- 高潮点：执役提前收网，铜哨四起。
- 回落/悬念：沈渊消失在废矿道，执役头目下令封井。

## 信息密度指标
- 预计章节字数：3200
- 情节节点密度：每千字 1.6 个节点
- 信息增量：高（测脉石调包线索首次出现）`;

const REAL_OUTLINE = `## 全书定位
本章处于全书发展阶段的第一次正面冲突：主角的逆脉身份从私下秘密变成公开通缉。
负责推进主线：测脉石调包案的第一条物证。
负责揭示：顺脉执役与矿籍制度如何把下层人钉死在原地。
负责铺垫：母亲被扣作担保，为后文赎人线埋下钩子。

## 关键场景
| # | 地点 | 人物 | 冲突 | 叙事目标 | 信息增量 |
|---|---|---|---|---|---|
| 1 | 矿道口 | 沈渊、顺脉执役、矿工 | 测脉石亮起，身份暴露 | 把秘密变成公开事件 | 九脉逆行第一次被官方记录 |
| 2 | 矿籍棚 | 沈渊、母亲沈柳氏 | 母亲以矿籍担保换三天 | 建立倒计时压力 | 矿籍可以作为抵押物 |
| 3 | 废弃矿道 | 沈渊、追捕队 | 借倒旋灵压脱身 | 展示主角的战斗智慧 | 倒旋灵压可被主动利用 |

地点：尘霄铁原矿道、矿籍棚、废矿道
人物：沈渊、沈柳氏、执役头目

## 结尾钩子
钩子类型：悬念式
钩子内容：沈渊在废矿道深处听见父亲当年的求救回声，而铜哨声正从三个方向逼近。`;

const SOUL_ALL_PLACEHOLDER = `【危烛】
欲望：>-
恐惧：>-
执念：>-
创伤：>-
弱点：>-
软处：>-
暴走红线：>-
底线：>-`;

const SOUL_REAL = `【沈渊】
欲望："解除锁脉环，带母亲与矿村幸存者脱离霄贡矿籍，登上一次不再被抽压的天梯。"
恐惧："自己倒灌失控，重演父亲被矿道灵压压碎的场面，并连累同伴。"
执念："追查测脉大典上谁调换了测脉石，为什么偏偏验出他九脉逆行。"
创伤："父亲死在矿道塌方，他隔着脉门听见求救声，却破不开锁死的矿闸。"
弱点："锁脉环未解时强行逆流会经脉刺痛、右臂短暂失力；对同乡苦难难以袖手。"
软处："母亲沈柳氏与矿村小妹阿箐；看见孩童被抽压会失去部分判断。"
暴走红线："顺脉执役把下三霄人命称作“承压耗材”。"
底线："不拿无辜者脉力为自己续命；不因复仇屠戮矿役和被迫执役者。"`;

describe('stripPlaceholderLines — 模板占位行清洗', () => {
    it('删除空标签、空表格行、枚举提示与方括号模板说明', () => {
        const input = [
            '- 节点1：',
            '- 节点4：（可选）',
            '| 1 | | | | | |',
            '- 钩子类型：悬念式/反转式/预告式/前置冲突',
            '- 本章处于全书 [开端/发展/转折/高潮/收尾] 阶段',
        ].join('\n');
        expect(stripPlaceholderLines(input).trim()).toBe('');
    });

    it('保留带实际值的标签行与表格行', () => {
        const input = [
            '- 节点1：主角在祠堂遇见旧敌并爆发冲突',
            '| 1 | 矿道口 | 沈渊 | 身份暴露 | 建立压力 | 九脉逆行被记录 |',
        ].join('\n');
        const out = stripPlaceholderLines(input);
        expect(out).toContain('主角在祠堂遇见旧敌');
        expect(out).toContain('矿道口');
    });

    it('不误删普通正文行', () => {
        const body = '他站在矿道口，听见铜哨从三个方向逼近。';
        expect(stripPlaceholderLines(body)).toBe(body);
    });
});

describe('validateStepResult — 模板骨架不再判 complete（Rev 185）', () => {
    it('情节蒸馏模板（空节点/枚举）不能判完成', () => {
        const r = validateStepResult('plotDistill', TEMPLATE_PLOT_DISTILL);
        expect(r.valid).toBe(false);
        expect(r.level).not.toBe('complete');
        expect(r.missing).toContain('情节节点规划');
        expect(r.missing).toContain('冲突升级路径');
    });

    it('大纲摘要模板（空表格/枚举）不能判完成', () => {
        const r = validateStepResult('outline', TEMPLATE_OUTLINE);
        expect(r.valid).toBe(false);
        expect(r.level).not.toBe('complete');
        expect(r.missing).toContain('关键场景');
    });

    it('真实情节蒸馏仍判完成', () => {
        const r = validateStepResult('plotDistill', REAL_PLOT_DISTILL);
        expect(r.level).toBe('complete');
        expect(r.valid).toBe(true);
    });

    it('真实大纲摘要仍判完成', () => {
        const r = validateStepResult('outline', REAL_OUTLINE);
        expect(r.level).toBe('complete');
        expect(r.valid).toBe(true);
    });

    it('isTemplateSkeleton 能识别没有 ${} 占位符的模板', () => {
        expect(isTemplateSkeleton(TEMPLATE_PLOT_DISTILL, 'plotDistill')).toBe(true);
        expect(isTemplateSkeleton(TEMPLATE_OUTLINE, 'outline')).toBe(true);
        expect(isTemplateSkeleton(REAL_PLOT_DISTILL, 'plotDistill')).toBe(false);
        expect(isTemplateSkeleton(REAL_OUTLINE, 'outline')).toBe(false);
    });
});

describe('validateCharacterSoul — 按角色块判定（Rev 185）', () => {
    it('全部字段为 >- 的空灵魂块不能判完成', () => {
        const r = validateStepResult('characterSoul', SOUL_ALL_PLACEHOLDER);
        expect(r.valid).toBe(false);
        expect(r.missing).toEqual(['主角欲望/动机', '主角恐惧/创伤', '主角道德边界']);
    });

    it('真实角色灵魂判完成', () => {
        const r = validateStepResult('characterSoul', SOUL_REAL);
        expect(r.level).toBe('complete');
        expect(r.valid).toBe(true);
    });

    it('只有欲望、缺恐惧与底线时仍是 partial', () => {
        const partial = `【沈渊】\n欲望：解除锁脉环，带母亲离开矿籍。\n恐惧：>-\n底线：>-`;
        const r = validateStepResult('characterSoul', partial);
        expect(r.valid).toBe(false);
        expect(r.missing).toContain('主角恐惧/创伤');
        expect(r.missing).toContain('主角道德边界');
    });

    it('占位在另一个角色块、主角完整时仍可判完成（块级取并集）', () => {
        const mixed = `${SOUL_REAL}\n\n${SOUL_ALL_PLACEHOLDER}`;
        const r = validateStepResult('characterSoul', mixed);
        expect(r.level).toBe('complete');
    });
});
