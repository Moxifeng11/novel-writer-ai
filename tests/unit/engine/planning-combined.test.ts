import { describe, expect, it } from 'vitest';
import {
    COMBINED_PLANNING_MIN_MODULE_CHARS,
    COMBINED_PLANNING_STEP_KEYS,
    buildCombinedPlanningPrompts,
    evaluateCombinedPlanning,
    fillPlanningTemplate,
    parseCombinedPlanning,
} from '../../../engine/planning-combined';

const longText = (prefix: string) => prefix + '内'.repeat(COMBINED_PLANNING_MIN_MODULE_CHARS);

describe('parseCombinedPlanning — 合并规划输出解析', () => {
    it('按固定分隔符切出 5 个模块并去除首尾空白', () => {
        const content = [
            '========== INFO_PLAN ==========',
            '  信息规划内容  ',
            '========== PLOT_DISTILL ==========',
            '情节蒸馏内容',
            '========== OUTLINE ==========',
            '大纲摘要内容',
            '========== EMOTION_PLAN ==========',
            '情绪规划内容',
            '========== SCENE_EXPAND ==========',
            'Scene展开内容',
        ].join('\n');

        const parsed = parseCombinedPlanning(content);

        expect(Object.keys(parsed)).toEqual([...COMBINED_PLANNING_STEP_KEYS]);
        expect(parsed.infoPlan).toBe('信息规划内容');
        expect(parsed.plotDistill).toBe('情节蒸馏内容');
        expect(parsed.outline).toBe('大纲摘要内容');
        expect(parsed.emotionPlan).toBe('情绪规划内容');
        expect(parsed.sceneExpand).toBe('Scene展开内容');
    });

    it('缺失的模块不产生 key，已存在模块延续到下一个出现过的分隔符', () => {
        const content = [
            '========== INFO_PLAN ==========',
            '信息规划内容',
            '========== OUTLINE ==========',
            '大纲摘要内容',
        ].join('\n');

        const parsed = parseCombinedPlanning(content);

        expect(parsed.infoPlan).toBe('信息规划内容');
        expect(parsed.outline).toBe('大纲摘要内容');
        expect(parsed.plotDistill).toBeUndefined();
        expect(parsed.emotionPlan).toBeUndefined();
        expect(parsed.sceneExpand).toBeUndefined();
    });

    it('分隔符之间为空时忽略该模块', () => {
        const content = [
            '========== INFO_PLAN ==========',
            '   ',
            '========== PLOT_DISTILL ==========',
            '情节蒸馏内容',
        ].join('\n');

        const parsed = parseCombinedPlanning(content);

        expect(parsed.infoPlan).toBeUndefined();
        expect(parsed.plotDistill).toBe('情节蒸馏内容');
    });

    it('完全没有分隔符时返回空对象', () => {
        expect(parseCombinedPlanning('模型没有按要求输出')).toEqual({});
    });
});

describe('evaluateCombinedPlanning — 合一规划完整性判定', () => {
    it('5 个模块都有效时全部生成、无缺失、可继续写正文', () => {
        const parsed: Record<string, string> = {
            infoPlan: longText('信息规划'),
            plotDistill: longText('情节蒸馏'),
            outline: longText('大纲'),
            emotionPlan: longText('情绪规划'),
            sceneExpand: longText('场景展开'),
        };
        const result = evaluateCombinedPlanning(parsed, new Set());

        expect(result.generated).toEqual([...COMBINED_PLANNING_STEP_KEYS]);
        expect(result.missing).toEqual([]);
        expect(result.requiredReady).toBe(true);
    });

    it('缺 outline 时不得报成功，并列出缺失模块', () => {
        const result = evaluateCombinedPlanning(
            { infoPlan: longText('信息规划'), plotDistill: longText('情节蒸馏') },
            new Set(),
        );

        expect(result.generated).toEqual(['infoPlan', 'plotDistill']);
        expect(result.missing).toEqual(['outline', 'emotionPlan', 'sceneExpand']);
        expect(result.requiredReady).toBe(false);
    });

    it('之前已完成 outline 时，本次只生成 infoPlan 也算满足最低条件', () => {
        const result = evaluateCombinedPlanning(
            { infoPlan: longText('信息规划') },
            new Set(['outline']),
        );

        expect(result.requiredReady).toBe(true);
        expect(result.missing).not.toContain('outline');
        expect(result.missing).toEqual(['plotDistill', 'emotionPlan', 'sceneExpand']);
    });

    it('模块内容过短视为无效产出，不能标记完成', () => {
        const result = evaluateCombinedPlanning(
            { infoPlan: longText('信息规划'), outline: '太短' },
            new Set(),
        );

        expect(result.generated).toEqual(['infoPlan']);
        expect(result.missing).toContain('outline');
        expect(result.requiredReady).toBe(false);
    });

    it('isValid 结构化校验未通过的模块不算生成（Rev 185）', () => {
        const parsed = {
            infoPlan: longText('信息规划'),
            outline: longText('大纲'),
        };
        // 只有 outline 结构校验失败（例如只有标题没有内容）
        const result = evaluateCombinedPlanning(
            parsed,
            new Set(),
            COMBINED_PLANNING_MIN_MODULE_CHARS,
            (key) => key !== 'outline',
        );

        expect(result.generated).toEqual(['infoPlan']);
        expect(result.missing).toContain('outline');
        expect(result.requiredReady).toBe(false);
    });

    it('isValid 全部通过时与旧行为一致', () => {
        const parsed = {
            infoPlan: longText('信息规划'),
            outline: longText('大纲'),
        };
        const result = evaluateCombinedPlanning(
            parsed,
            new Set(),
            COMBINED_PLANNING_MIN_MODULE_CHARS,
            () => true,
        );

        expect(result.generated).toEqual(['infoPlan', 'outline']);
        expect(result.requiredReady).toBe(true);
    });
});

describe('buildCombinedPlanningPrompts — 模板变量填充', () => {
    it('替换全部 ${key}，缺失变量为空串', () => {
        const vars = { chapNum: '12', chapPlan: '第一卷规划', protagonistName: '林舟' };
        const { system, user } = buildCombinedPlanningPrompts(vars);

        expect(system).toContain('第12章');
        expect(system).not.toContain('${chapNum}');
        expect(user).toContain('第一卷规划');
        expect(user).toContain('林舟');
        // 未提供的变量（如 entityContext）应被清空而不是保留占位符
        expect(user).not.toContain('${entityContext}');
    });

    it('fillPlanningTemplate 支持同名变量多次出现', () => {
        const filled = fillPlanningTemplate('${a}-${a}-${b}', { a: 'X', b: 'Y' });
        expect(filled).toBe('X-X-Y');
    });
});
