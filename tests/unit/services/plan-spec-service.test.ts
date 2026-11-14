/**
 * PlanSpecService 落盘测试（mock vault）
 */

import { describe, expect, it } from 'vitest';
import { App, Vault } from 'obsidian';
import { FileTxService } from '@/services/file-tx';
import { PlanSpecService } from '@/services/plan-spec-service';

/** 构造带 mock vault 的 App。 */
const makeService = (): { service: PlanSpecService; vault: Vault } => {
    const vault = new Vault();
    const app = new App();
    app.vault = vault;
    return { service: new PlanSpecService(app, new FileTxService(app)), vault };
};

describe('PlanSpecService 落盘', () => {
    it('保存规格并写「最新」指针', async () => {
        const { service, vault } = makeService();
        const result = await service.saveSpec('长篇小说/书A', {
            title: '重写第三章',
            background: '节奏慢',
            constraints: ['保持人设'],
            acceptance: ['动机清楚'],
        });
        expect(result.created).toBe(true);
        const content = await vault.adapter.read(result.path);
        expect(content).toContain('# 规格：重写第三章');
        expect(content).toContain('保持人设');
        const pointer = await vault.adapter.read('长篇小说/书A/04-项目总控/spec/最新.md');
        expect(pointer.trim()).toBe(result.path);
    });

    it('保存计划后能读回步骤', async () => {
        const { service } = makeService();
        const saved = await service.savePlan('长篇小说/书A', {
            title: '改稿',
            steps: [
                { step: '读第三章', status: 'done' },
                { step: '重写开头', status: 'pending' },
            ],
        });
        expect(saved.created).toBe(true);
        const latest = await service.readLatestPlan('长篇小说/书A');
        expect(latest?.path).toBe(saved.path);
        expect(latest?.plan.steps).toHaveLength(2);
        expect(latest?.plan.steps[0]).toMatchObject({ status: 'done', step: '读第三章' });
    });

    it('没有计划时返回 null', async () => {
        const { service } = makeService();
        expect(await service.readLatestPlan('长篇小说/空项目')).toBeNull();
    });

    it('由自然语言创建计划（按行拆步骤）', async () => {
        const { service } = makeService();
        const saved = await service.createPlanFromText('长篇小说/书A', '快速计划', '读大纲\n写细纲');
        expect(saved.created).toBe(true);
        const latest = await service.readLatestPlan('长篇小说/书A');
        expect(latest?.plan.steps.map(step => step.step)).toEqual(['读大纲', '写细纲']);
    });
});
