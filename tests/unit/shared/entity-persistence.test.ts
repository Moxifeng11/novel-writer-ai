import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import { saveEntities, normalizeEntityContent } from '../../../shared/entity-persistence';
import { pjCharFile, pjFactionFile, pjLocFile } from '../../../shared/paths';

function makeApp(): App {
    return new App();
}

/** 完整人物卡（用于验证严格落盘契约） */
function completeCharacter(name: string, background: string): string {
    return `---
tags: [人物]
姓名: "${name}"
年龄: "二十"
身份: "主角"
人物背景: "${background}"
外貌特征: "青衫"
当前目标: "复仇"
核心动机: "活下去"
核心驱动力_软肋: "妹妹"
习惯性小动作: "摸刀柄"
当前状态: "受伤"
当前情绪: "冷静"
性格标签: "隐忍"
金手指/特殊能力: "读心"
功法/技能树: "刀法"
所属势力: "青云宗"
entity_status: active
entity_created_at: "第1章"
性格三层:
  表层_面具: "温和"
  中层_真实: "警惕"
  深层_内核: "偏执"
角色弧光:
  起点状态: "逃避"
  成长触发点: "妹妹失踪"
  终点状态: "担当"
  弧光类型: "成长弧"
character_core:
  desire: "守护"
  fear: "失去"
  obsession: "复仇"
  shame: "逃跑"
  trauma: "灭门"
  weakness: "妹妹"
  soft_spot: "孤儿"
  rage_trigger: "提到灭门"
  moral_boundary: "不杀无辜"
---
# ${name}
## 确定性设定
- 外貌：青衫
## 不确定性
- 内心矛盾：复仇与守护
## 关系网
- [[阿宁]]：妹妹
## 自信息事件储备
- 可能做出的出人意料举动：放过仇人
## 功法/技能
- 修为：筑基
## 灵魂层
- desire：守护
## 变更记录
- 第1章 | 初次登场`;
}

function completeLocation(name: string): string {
    return `---
tags: [地点]
名称: "${name}"
别称: ""
类型: "山脉"
描述: "终年积雪的圣地"
重要程度: "高"
地理特征: "高海拔"
主要居民/势力: "青云宗"
所在世界/区域: "东域"
---
# ${name}
## 确定性设定
- 地理特征：终年积雪
## 不确定性
- 隐藏秘密：山腹有古阵
## 与其他元素的互信息
- [[青云宗]]：宗门坐落于此
## 变更记录
- 第1章 | 初次登场`;
}

function completeFaction(name: string): string {
    return `---
tags: [势力]
名称: "${name}"
别称: ""
类型: "宗门"
描述: "东域第一宗"
领袖: "林远"
地位/排名: "第一"
entity_status: active
entity_created_at: "第1章"
---
# ${name}
## 确定性设定
- 领袖：林远
## 不确定性
- 内部矛盾：长老争权
## 与其他元素的互信息
- [[林昭]]：弟子
## 变更记录
- 第1章 | 初次登场`;
}

describe('saveEntities（实体落盘统一契约）', () => {
    it('完整实体正常落盘', async () => {
        const app = makeApp();
        const outcome = await saveEntities(app, '项目A', 'locations', [
            { name: '青云山', content: completeLocation('青云山') },
        ]);

        expect(outcome.saved).toEqual(['青云山']);
        expect(outcome.failed).toEqual([]);

        const raw = await (app.vault as any).readByPath(pjLocFile('项目A', '青云山'));
        expect(raw).toContain('tags: [地点]');
        expect(raw).toContain('## 确定性设定');
    });

    it('内容不完整时拒绝落盘，并给出缺失明细', async () => {
        const app = makeApp();
        const outcome = await saveEntities(app, '项目A', 'locations', [
            { name: '空壳山', content: '---\ntags: [地点]\n名称: "空壳山"\n---\n\n# 空壳山\n' },
        ]);

        expect(outcome.saved).toEqual([]);
        expect(outcome.failed).toHaveLength(1);
        expect(outcome.failed[0].error).toContain('内容不完整');
        expect(app.vault.getAbstractFileByPath(pjLocFile('项目A', '空壳山'))).toBeNull();
    });

    it('关闭严格模式时允许写入不完整内容（显式选择）', async () => {
        const app = makeApp();
        const outcome = await saveEntities(
            app,
            '项目A',
            'locations',
            [{ name: '草稿山', content: '---\ntags: [地点]\n名称: "草稿山"\n---\n\n草稿' }],
            { requireComplete: false }
        );

        expect(outcome.saved).toEqual(['草稿山']);
    });

    it('人物使用「姓名」字段而不是「名称」', () => {
        const content = normalizeEntityContent('正文', '林昭', 'characters');
        expect(content).toContain('tags: [人物]');
        expect(content).toContain('姓名: "林昭"');
        expect(content).not.toContain('名称:');
    });

    it('同名且内容一致：幂等跳过，不产生副本', async () => {
        const app = makeApp();
        const content = completeCharacter('林昭', '边城孤儿');

        const first = await saveEntities(app, '项目A', 'characters', [{ name: '林昭', content }]);
        const second = await saveEntities(app, '项目A', 'characters', [{ name: '林昭', content }]);

        expect(first.saved).toEqual(['林昭']);
        expect(second.saved).toEqual([]);
        expect(second.skipped).toEqual(['林昭']);
        expect(second.renamed).toEqual([]);
        expect(app.vault.getAbstractFileByPath(pjCharFile('项目A', '林昭（2）'))).toBeNull();
    });

    it('同名但内容不同：另存为「名称（2）」而非覆盖（区分同名分身）', async () => {
        const app = makeApp();

        await saveEntities(app, '项目A', 'characters', [
            { name: '林昭', content: completeCharacter('林昭', '本体设定') },
        ]);
        const second = await saveEntities(app, '项目A', 'characters', [
            { name: '林昭', content: completeCharacter('林昭', '分身设定') },
        ]);

        expect(second.renamed).toEqual([{ name: '林昭', savedAs: '林昭（2）' }]);
        expect(app.vault.getAbstractFileByPath(pjCharFile('项目A', '林昭'))).not.toBeNull();
        expect(app.vault.getAbstractFileByPath(pjCharFile('项目A', '林昭（2）'))).not.toBeNull();

        const original = await (app.vault as any).readByPath(pjCharFile('项目A', '林昭'));
        const copy = await (app.vault as any).readByPath(pjCharFile('项目A', '林昭（2）'));
        expect(original).toContain('本体设定');
        expect(copy).toContain('分身设定');
    });

    it('非法文件名被 sanitizeName 收敛', async () => {
        const app = makeApp();
        const outcome = await saveEntities(app, '项目A', 'factions', [
            { name: '青云/宗', content: completeFaction('青云/宗') },
        ]);

        expect(outcome.saved).toEqual(['青云/宗']);
        expect(app.vault.getAbstractFileByPath(pjFactionFile('项目A', '青云/宗'))).not.toBeNull();
    });

    it('空名称进入失败明细，不写入文件', async () => {
        const app = makeApp();
        const outcome = await saveEntities(app, '项目A', 'items', [{ name: '   ', content: 'x' }]);

        expect(outcome.saved).toEqual([]);
        expect(outcome.failed).toHaveLength(1);
        expect(outcome.failed[0].error).toContain('名称为空');
    });
});
