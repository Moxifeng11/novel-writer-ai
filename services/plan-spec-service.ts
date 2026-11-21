/**
 * plan-spec-service.ts — 计划/规格文档读写
 *
 * 落盘：<项目>/04-项目总控/spec/<时间戳>-<标题>.md 与 plan/ 同构。
 * 每次写入走 FileTxService（原子），保留最新一份 README 指针便于 Agent 读取。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjPlanDir, pjSpecDir } from '@/shared/paths';
import type { FileTxService } from './file-tx';
import {
    parsePlanSteps,
    renderPlan,
    renderSpec,
    stepsFromText,
    type PlanDocument,
    type SpecDocument,
} from '@/shared/plan-spec-model';

const log = createLogger('PlanSpecService');

/** 保存结果 */
export interface PlanSpecSaveResult {
    /** 文件路径 */
    path: string;
    /** 是否新建 */
    created: boolean;
}

/**
 * 把标题清洗成安全文件名。
 *
 * @param title - 标题
 * @returns 文件名片段
 */
export function safeFileTitle(title: string): string {
    return String(title || '').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 40) || '未命名';
}

/**
 * 计划/规格服务。
 */
export class PlanSpecService {
    /**
     * @param app - Obsidian 应用
     * @param fileTx - 文件事务服务
     */
    constructor(private readonly app: App, private readonly fileTx: FileTxService) {}

    /**
     * 保存规格文档。
     *
     * @param project - 项目路径
     * @param spec - 规格
     * @returns 保存结果
     */
    async saveSpec(project: string, spec: SpecDocument): Promise<PlanSpecSaveResult> {
        const path = `${pjSpecDir(project)}/${Date.now()}-${safeFileTitle(spec.title)}.md`;
        const exists = this.app.vault.getAbstractFileByPath(path) != null;
        await this.fileTx.run(project, [{ path, content: renderSpec(spec) }]);
        await this.updateLatest(project, 'spec', path);
        return { path, created: !exists };
    }

    /**
     * 保存计划文档。
     *
     * @param project - 项目路径
     * @param plan - 计划
     * @returns 保存结果
     */
    async savePlan(project: string, plan: PlanDocument): Promise<PlanSpecSaveResult> {
        const path = `${pjPlanDir(project)}/${Date.now()}-${safeFileTitle(plan.title)}.md`;
        const exists = this.app.vault.getAbstractFileByPath(path) != null;
        await this.fileTx.run(project, [{ path, content: renderPlan(plan) }]);
        await this.updateLatest(project, 'plan', path);
        return { path, created: !exists };
    }

    /**
     * 读取最新计划（无则 null）。
     *
     * @param project - 项目路径
     * @returns 计划与路径
     */
    async readLatestPlan(project: string): Promise<{ path: string; plan: PlanDocument } | null> {
        const path = await this.latestPath(project, 'plan');
        if (!path) return null;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        const markdown = await this.app.vault.read(file);
        return {
            path,
            plan: { title: path.split('/').pop()?.replace(/\.md$/, '') ?? '', steps: parsePlanSteps(markdown) },
        };
    }

    /**
     * 读取最新规格（无则 null）。
     *
     * @param project - 项目路径
     * @returns 路径与原文
     */
    async readLatestSpec(project: string): Promise<{ path: string; markdown: string } | null> {
        const path = await this.latestPath(project, 'spec');
        if (!path) return null;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return null;
        return { path, markdown: await this.app.vault.read(file) };
    }

    /**
     * 由自然语言创建计划（步骤按行拆分）。
     *
     * @param project - 项目路径
     * @param title - 标题
     * @param text - 描述
     * @returns 保存结果
     */
    async createPlanFromText(project: string, title: string, text: string): Promise<PlanSpecSaveResult> {
        return this.savePlan(project, { title, steps: stepsFromText(text) });
    }

    private async latestPath(project: string, kind: 'plan' | 'spec'): Promise<string | null> {
        const dir = kind === 'plan' ? pjPlanDir(project) : pjSpecDir(project);
        const pointer = `${dir}/最新.md`;
        const file = this.app.vault.getAbstractFileByPath(pointer);
        if (!(file instanceof TFile)) return null;
        const target = (await this.app.vault.read(file)).trim();
        if (!target) return null;
        const resolved = target.startsWith('/') || target.includes(':') ? target : target;
        const targetFile = this.app.vault.getAbstractFileByPath(resolved);
        return targetFile instanceof TFile ? resolved : null;
    }

    private async updateLatest(project: string, kind: 'plan' | 'spec', path: string): Promise<void> {
        const dir = kind === 'plan' ? pjPlanDir(project) : pjSpecDir(project);
        try {
            await this.fileTx.run(project, [{ path: `${dir}/最新.md`, content: `${path}\n` }]);
        } catch (error) {
            // silent-ok: 指针写入失败不影响计划本体（已落盘）
            log.warn('计划指针写入失败:', error);
        }
    }
}
