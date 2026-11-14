/**
 * plan/spec 模型与工具测试
 */

import { describe, expect, it } from 'vitest';
import {
    parsePlanSteps,
    planProgress,
    renderPlan,
    renderSpec,
    stepsFromText,
} from '@/shared/plan-spec-model';
import { safeFileTitle as serviceSafeTitle } from '@/services/plan-spec-service';
import { createPlanSpecTools } from '@/engine/agent/harness/plan-spec-tools';

describe('规格渲染', () => {
    it('含标题/背景/约束/验收', () => {
        const text = renderSpec({
            title: '第三章重写',
            background: '节奏太慢',
            constraints: ['保持人设'],
            acceptance: ['读者能看懂动机'],
        });
        expect(text).toContain('# 规格：第三章重写');
        expect(text).toContain('## 需求背景');
        expect(text).toContain('保持人设');
        expect(text).toContain('1. 读者能看懂动机');
    });
});

describe('计划渲染与解析', () => {
    const plan = {
        title: '改稿',
        steps: [
            { step: '读第三章', status: 'done' as const, accept: '读完' },
            { step: '重写开头', status: 'in_progress' as const },
            { step: '润色', status: 'pending' as const },
        ],
    };

    it('渲染带状态标记与验收', () => {
        const text = renderPlan(plan);
        expect(text).toContain('[已完成] 读第三章（验收：读完）');
        expect(text).toContain('[进行中] 重写开头');
        expect(text).toContain('[ ] 润色');
    });

    it('解析回步骤（状态与验收）', () => {
        const steps = parsePlanSteps(renderPlan(plan));
        expect(steps).toHaveLength(3);
        expect(steps[0]).toMatchObject({ status: 'done', accept: '读完' });
        expect(steps[1].status).toBe('in_progress');
        expect(steps[2].status).toBe('pending');
    });

    it('空计划显示提示', () => {
        expect(renderPlan({ title: '空', steps: [] })).toContain('还没有步骤');
    });

    it('进度统计', () => {
        expect(planProgress(plan)).toEqual({ done: 1, total: 3 });
    });
});

describe('stepsFromText', () => {
    it('按换行/分号拆分并去掉序号', () => {
        const steps = stepsFromText('1. 读大纲\n2. 写细纲；3、改正文');
        expect(steps.map(step => step.step)).toEqual(['读大纲', '写细纲', '改正文']);
        expect(steps.every(step => step.status === 'pending')).toBe(true);
    });

    it('空文本返回空数组', () => {
        expect(stepsFromText('   ')).toEqual([]);
    });
});

describe('文件名清洗', () => {
    it('去掉非法字符并截断', () => {
        expect(serviceSafeTitle('a/b:c*d')).toBe('a_b_c_d');
        expect(serviceSafeTitle('   ')).toBe('未命名');
    });
});

describe('plan/spec 工具', () => {
    const service = {
        saveSpec: async () => ({ path: 'p/spec/1.md', created: true }),
        savePlan: async () => ({ path: 'p/plan/1.md', created: true }),
        readLatestPlan: async () => ({
            path: 'p/plan/1.md',
            plan: { title: 't', steps: [{ step: '读', status: 'done' as const }, { step: '写', status: 'pending' as const }] },
        }),
    };

    const tools = createPlanSpecTools(() => service as never, () => '长篇小说/书A');

    it('write_spec 拆分约束与验收', async () => {
        const tool = tools.find(item => item.name === 'write_spec')!;
        const result = await tool.execute({
            title: '规格A', background: '背景', constraints: 'a；b', acceptance: '1；2',
        }, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('p/spec/1.md');
    });

    it('write_plan 空步骤被拒绝', async () => {
        const tool = tools.find(item => item.name === 'write_plan')!;
        const result = await tool.execute({ title: 't', steps: '  ' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('步骤为空');
    });

    it('read_plan 渲染状态标记', async () => {
        const tool = tools.find(item => item.name === 'read_plan')!;
        const result = await tool.execute({}, {} as never);
        expect(result.ok).toBe(true);
        expect(result.content).toContain('[已完成] 读');
        expect(result.content).toContain('[ ] 写');
    });

    it('无项目时拒绝写入', async () => {
        const noProject = createPlanSpecTools(() => service as never, () => '');
        const tool = noProject.find(item => item.name === 'write_plan')!;
        const result = await tool.execute({ title: 't', steps: 'a' }, {} as never);
        expect(result.ok).toBe(false);
        expect(result.content).toContain('请先打开一个项目');
    });

    it('三个工具的动作分类正确', () => {
        expect(tools.find(item => item.name === 'write_spec')?.kind).toBe('write-setting');
        expect(tools.find(item => item.name === 'write_plan')?.kind).toBe('write-setting');
        expect(tools.find(item => item.name === 'read_plan')?.kind).toBe('read');
    });
});
