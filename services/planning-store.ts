/**
 * planning-store.ts — 规划画布持久化（原子写入 + 损坏兜底）
 *
 * 存储位置：`<项目>/04-项目总控/规划/画布.json`。
 * 写入走 FileTxService（暂存→提交→清理），避免写一半损坏画布。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { pjPlanningCanvasFile } from '@/shared/paths';
import {
    emptyCanvas,
    PLANNING_CANVAS_VERSION,
    type PlanningCanvas,
} from '@/domains/planning/model';
import type { FileTxService } from './file-tx';

const log = createLogger('PlanningStore');

/**
 * 规划画布存储。
 */
export class PlanningStore {
    private readonly app: App;
    private readonly fileTx: FileTxService;

    constructor(app: App, fileTx: FileTxService) {
        this.app = app;
        this.fileTx = fileTx;
    }

    /**
     * 读取画布；不存在或损坏时返回空画布（不阻断使用）。
     *
     * @param project - 项目路径
     * @returns 画布
     */
    async load(project: string): Promise<PlanningCanvas> {
        const file = this.app.vault.getAbstractFileByPath(pjPlanningCanvasFile(project));
        if (!(file instanceof TFile)) return emptyCanvas();
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as Partial<PlanningCanvas>;
            if (parsed?.version !== PLANNING_CANVAS_VERSION || !Array.isArray(parsed.nodes)) {
                return emptyCanvas();
            }
            return {
                version: PLANNING_CANVAS_VERSION,
                updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
                nodes: parsed.nodes,
                edges: Array.isArray(parsed.edges) ? parsed.edges : [],
            };
        } catch (error) {
            // silent-ok: 画布损坏等价于空画布，用户可重新编辑，不阻断写作
            log.warn('规划画布解析失败，按空画布处理:', error);
            return emptyCanvas();
        }
    }

    /**
     * 保存画布（原子写入）。
     *
     * @param project - 项目路径
     * @param canvas - 画布
     * @returns 保存后的画布
     */
    async save(project: string, canvas: PlanningCanvas): Promise<PlanningCanvas> {
        const next: PlanningCanvas = { ...canvas, version: PLANNING_CANVAS_VERSION, updatedAt: Date.now() };
        await this.fileTx.run(project, [{
            path: pjPlanningCanvasFile(project),
            content: JSON.stringify(next, null, 2) + '\n',
        }]);
        return next;
    }
}
