/**
 * scene-retrieval-service.ts — 逐场按需检索 + 覆盖记录（A2/A3）
 *
 * A2：正文循环每一场生成前，检查该场在场角色是否都能在设定库解析；
 *     缺卡的给出「不要虚构」的显式提示（服务端确定性检索，不依赖模型发问）。
 * A3：把每场注入的检索结果与覆盖缺口记进账本，便于事后归因「这场为什么写歪」。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import type { SceneTask } from '@/engine/scene-generation-loop';

const log = createLogger('SceneRetrieval');

/** 单场检索结果 */
export interface SceneRetrievalResult {
    /** 场景序号 */
    scene: number;
    /** 场景里出现的角色名 */
    names: string[];
    /** 已解析实体 ID */
    resolved: string[];
    /** 缺失设定卡的角色 */
    missing: string[];
    /** 追加给模型的提示（空串表示无需提示） */
    hint: string;
}

/** 单场统计（进账本） */
export interface SceneInjectionStat {
    scene: number;
    chars: number;
    /** 检索到的实体数 */
    resolvedCount: number;
    /** 缺失实体名 */
    missing: string[];
    /** 是否触发了补检索提示 */
    hinted: boolean;
}

/** 账本条目 */
export interface SceneCoverageRecord {
    chapterName: string;
    recordedAt: number;
    scenes: SceneInjectionStat[];
    /** 有缺失实体的场景数 */
    scenesWithGaps: number;
}

/**
 * 场景检索/记录服务。
 */
export class SceneRetrievalService {
    /**
     * @param app - Obsidian 应用
     * @param resolveName - 名称 → 实体 ID（找不到 null）
     */
    constructor(
        private readonly app: App,
        private readonly resolveName: (name: string) => Promise<string | null>,
    ) {}

    /**
     * 检查单场的在场角色覆盖情况。
     *
     * @param task - 场景任务
     * @returns 检索结果
     */
    async retrieve(task: SceneTask): Promise<SceneRetrievalResult> {
        const names = this.extractNames(task);
        const resolved: string[] = [];
        const missing: string[] = [];
        for (const name of names) {
            const id = await this.resolveName(name).catch(() => null);
            if (id) resolved.push(id);
            else missing.push(name);
        }
        const hint = missing.length > 0
            ? `【实体缺口】以下角色没有设定卡：${missing.join('、')}。按场景已知信息写，不要虚构其背景、能力与关系。`
            : '';
        return { scene: task.num, names, resolved, missing, hint };
    }

    /**
     * 记录逐场覆盖到账本（覆盖同章旧记录）。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名
     * @param scenes - 逐场统计
     * @returns 账本记录
     */
    async recordCoverage(project: string, chapterName: string, scenes: readonly SceneInjectionStat[]): Promise<SceneCoverageRecord> {
        const record: SceneCoverageRecord = {
            chapterName,
            recordedAt: Date.now(),
            scenes: [...scenes],
            scenesWithGaps: scenes.filter(scene => scene.missing.length > 0).length,
        };
        const path = this.ledgerPath(project);
        const existing = await this.loadLedger(project);
        const merged = { ...existing, [chapterName]: record };
        await this.writeText(path, JSON.stringify({ version: 1, chapters: merged }, null, 2));
        log.info(`场景覆盖记录：${chapterName} ${scenes.length} 场，缺口场景 ${record.scenesWithGaps}`);
        return record;
    }

    /**
     * 读取账本（便于面板/诊断）。
     *
     * @param project - 项目路径
     * @param chapterName - 章节名（省略返回全部）
     * @returns 记录
     */
    async readCoverage(project: string, chapterName?: string): Promise<Record<string, SceneCoverageRecord>> {
        const ledger = await this.loadLedger(project);
        return chapterName ? { [chapterName]: ledger[chapterName] } : ledger;
    }

    /** 从场景任务提取角色名（characters 字段优先，兼容中文「在场人物：」行） */
    private extractNames(task: SceneTask): string[] {
        const raw = String(task.characters ?? '').trim()
            || String(task.rawBlock ?? '').match(/在场人物[：:]\s*(.+)/)?.[1]?.trim()
            || '';
        if (!raw) return [];
        return [...new Set(raw.split(/[、,，;；\s]+/).map(name => name.trim()).filter(Boolean))];
    }

    /** 账本路径 */
    private ledgerPath(project: string): string {
        return `${project}/04-项目总控/注入账本/场景覆盖.json`;
    }

    /** 读账本 */
    private async loadLedger(project: string): Promise<Record<string, SceneCoverageRecord>> {
        const file = this.app.vault.getAbstractFileByPath(this.ledgerPath(project));
        if (!(file instanceof TFile)) return {};
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as { chapters?: Record<string, SceneCoverageRecord> };
            return parsed.chapters ?? {};
        } catch (error) { // silent-ok: 账本损坏时按空处理并记 warn，不阻断新记录
            log.warn('场景覆盖账本读取失败，按空处理：', error);
            return {};
        }
    }

    /** 写文件（自动建目录） */
    private async writeText(path: string, content: string): Promise<void> {
        const dir = path.split('/').slice(0, -1).join('/');
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
            await this.app.vault.createFolder(dir).catch(() => undefined); // silent-ok: 已存在时忽略
        }
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) await this.app.vault.modify(existing, content);
        else await this.app.vault.create(path, content);
    }
}
