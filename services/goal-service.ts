/**
 * goal-service.ts — 长任务目标读写
 *
 * 落盘：<项目>/04-项目总控/goal/<id>.json；同目录 latest.md 指向当前目标。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjGoalDir } from '@/shared/paths';
import type { FileTxService } from './file-tx';
import { createGoal, parseGoal, type GoalDefinition } from '@/shared/goal-model';

const log = createLogger('GoalService');

/**
 * 目标服务。
 */
export class GoalService {
    /**
     * @param app - Obsidian 应用
     * @param fileTx - 文件事务服务
     */
    constructor(private readonly app: App, private readonly fileTx: FileTxService) {}

    /**
     * 保存目标。
     *
     * @param project - 项目路径
     * @param goal - 目标
     * @returns 文件路径
     */
    async save(project: string, goal: GoalDefinition): Promise<string> {
        const path = `${pjGoalDir(project)}/${goal.id}.json`;
        await this.fileTx.run(project, [{ path, content: JSON.stringify(goal, null, 2) + '\n' }]);
        try {
            await this.fileTx.run(project, [{ path: `${pjGoalDir(project)}/latest.md`, content: goal.id + '\n' }]);
        } catch (error) { // silent-ok: 指针写入失败不影响目标本体
            log.warn('目标指针写入失败:', error);
        }
        return path;
    }

    /**
     * 读取当前目标。
     *
     * @param project - 项目路径
     * @returns 目标或 null
     */
    async readLatest(project: string): Promise<GoalDefinition | null> {
        const pointer = this.app.vault.getAbstractFileByPath(`${pjGoalDir(project)}/latest.md`);
        if (!(pointer instanceof TFile)) return null;
        const id = (await this.app.vault.read(pointer)).trim();
        if (!id) return null;
        const file = this.app.vault.getAbstractFileByPath(`${pjGoalDir(project)}/${id}.json`);
        if (!(file instanceof TFile)) return null;
        return parseGoal(await this.app.vault.read(file));
    }

    /**
     * 创建并保存目标。
     *
     * @param project - 项目路径
     * @param title - 标题
     * @param objective - 目标描述
     * @returns 目标
     */
    async create(project: string, title: string, objective: string): Promise<GoalDefinition> {
        const goal = createGoal(title, objective);
        await this.save(project, goal);
        return goal;
    }
}
