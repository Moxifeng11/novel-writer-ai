/**
 * quality-panel-service.ts — 质量面板数据（B4）
 *
 * 把每次「生成后校验 / 定向修订」的结果追加到
 * `<项目>/04-项目总控/质量面板/校验历史.json`，并提供聚合读取。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import {
    renderQualityPanel,
    summarizeQualityPanel,
    type QualityPanelSummary,
    type QualityRecord,
} from '@/shared/quality-panel-model';

const log = createLogger('QualityPanel');

/** 历史保留上限（避免无限增长） */
const MAX_RECORDS = 200;

/** 面板读取结果 */
export interface QualityPanelView extends QualityPanelSummary {
    /** 渲染文本 */
    report: string;
    /** 历史文件路径 */
    path: string;
}

/**
 * 质量面板服务。
 */
export class QualityPanelService {
    /**
     * @param app - Obsidian 应用
     */
    constructor(private readonly app: App) {}

    /**
     * 追加一条记录。
     *
     * @param project - 项目路径
     * @param record - 记录
     * @returns 写入后的总条数
     */
    async record(project: string, record: QualityRecord): Promise<number> {
        const path = this.historyPath(project);
        const records = await this.load(project);
        records.push(record);
        const trimmed = records.slice(-MAX_RECORDS);
        await this.writeText(path, JSON.stringify({ version: 1, records: trimmed }, null, 2));
        log.info(`质量记录：${record.chapterName}（累计 ${trimmed.length} 条）`);
        return trimmed.length;
    }

    /**
     * 读取并聚合面板。
     *
     * @param project - 项目路径
     * @returns 面板视图
     */
    async view(project: string): Promise<QualityPanelView> {
        const records = await this.load(project);
        const summary = summarizeQualityPanel(records);
        return { ...summary, report: renderQualityPanel(summary), path: this.historyPath(project) };
    }

    /** 读历史记录 */
    private async load(project: string): Promise<QualityRecord[]> {
        const path = this.historyPath(project);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return [];
        try {
            const parsed = JSON.parse(await this.app.vault.read(file)) as { records?: unknown };
            return Array.isArray(parsed.records) ? parsed.records as QualityRecord[] : [];
        } catch (error) { // silent-ok: 历史损坏时降级为空并记 warn，不阻断新记录写入
            log.warn('质量历史读取失败，按空处理：', error);
            return [];
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

    /** 历史文件路径 */
    private historyPath(project: string): string {
        return `${project}/04-项目总控/质量面板/校验历史.json`;
    }
}
