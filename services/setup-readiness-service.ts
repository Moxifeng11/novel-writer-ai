/**
 * setup-readiness-service.ts — 首次使用环境自检（社区下载后可用性）
 *
 * 目的：插件从社区市场装好后，用户往往只有一份空 vault：
 * 模板树没建、没有项目、没有 API Key、标签/属性约定完全不知情，
 * 结果「装了但用不了」。本服务把「能不能开始写」拆成可检查项，
 * 每项给出状态 + 一键修复入口（由设置页/向导消费）。
 */

import { App, TFile } from 'obsidian';
import { createLogger } from '@/shared/logger';
import { TEMPLATE_SCAFFOLD_FILES } from '@/shared/template-scaffold-assets.generated';
import { TEMPLATE_ROOT } from '@/shared/template-scaffold';
import { listProjectIds } from '@/shared/project-catalog';

const log = createLogger('SetupReadiness');

/** 自检项状态 */
export type ReadinessStatus = 'ok' | 'warn' | 'missing';

/** 自检项 */
export interface ReadinessItem {
    /** 稳定 id（设置页按此挂修复按钮） */
    id: 'provider' | 'model' | 'templates' | 'projects' | 'folders' | 'index' | 'workspace';
    /** 展示名 */
    label: string;
    status: ReadinessStatus;
    /** 现状说明 */
    detail: string;
    /** 修复建议 */
    fix: string;
}

/** 自检结果 */
export interface ReadinessReport {
    /** 整体是否可用（无 missing） */
    usable: boolean;
    /** 各状态计数 */
    counts: Record<ReadinessStatus, number>;
    items: ReadinessItem[];
    /** 检查时间戳 */
    checkedAt: number;
}

/** 模式库根目录（与项目目录约定一致） */
const MODE_ROOTS = ['长篇小说', '短篇小说', '剧本'] as const;

/** 自检依赖（插件侧注入，便于测试） */
export interface ReadinessDeps {
    /** 是否已配置任意可用 API Key */
    hasApiKey(): boolean;
    /** 当前默认模型 id */
    currentModel(): string;
    /** 目标项目（可空） */
    activeProject(): string;
    /** ProjectIndexService.ensure 读取条目数（失败返回 0） */
    indexEntryCount(project: string): Promise<number>;
}

/**
 * 首次使用环境自检服务。
 */
export class SetupReadinessService {
    /**
     * @param app - Obsidian 应用
     * @param deps - 插件能力注入
     */
    constructor(
        private readonly app: App,
        private readonly deps: ReadinessDeps,
    ) {}

    /**
     * 跑一次自检。
     *
     * @returns 自检报告
     */
    async check(): Promise<ReadinessReport> {
        const items: ReadinessItem[] = [
            this.checkProvider(),
            this.checkModel(),
            await this.checkTemplates(),
            this.checkProjects(),
            this.checkFolders(),
            await this.checkIndex(),
            this.checkWorkspaceConventions(),
        ];
        const counts: Record<ReadinessStatus, number> = { ok: 0, warn: 0, missing: 0 };
        for (const item of items) counts[item.status] += 1;
        const report: ReadinessReport = {
            usable: counts.missing === 0,
            counts,
            items,
            checkedAt: Date.now(),
        };
        log.info(`环境自检：${report.usable ? '可用' : '不可用'}（ok ${counts.ok} / warn ${counts.warn} / missing ${counts.missing}）`);
        return report;
    }

    /** API Key 是否已配置 */
    private checkProvider(): ReadinessItem {
        const ok = this.deps.hasApiKey();
        return {
            id: 'provider',
            label: 'AI 供应商 API Key',
            status: ok ? 'ok' : 'missing',
            detail: ok ? '已配置至少一个供应商的 API Key' : '未配置任何 API Key，所有 AI 功能不可用',
            fix: ok ? '' : '打开「首启引导」或设置 → AI 供应商，填写 Key 并点「连通性测试」',
        };
    }

    /** 默认模型是否设置 */
    private checkModel(): ReadinessItem {
        const model = this.deps.currentModel();
        return {
            id: 'model',
            label: '默认模型',
            status: model ? 'ok' : 'warn',
            detail: model ? `当前默认模型：${model}` : '未选择默认模型，将回退到供应商第一个可用模型',
            fix: model ? '' : '设置 → AI 供应商，选择默认模型与上下文窗口',
        };
    }

    /** 「元文件」模板树是否完整 */
    private async checkTemplates(): Promise<ReadinessItem> {
        const adapter = this.app.vault.adapter;
        const paths = Object.keys(TEMPLATE_SCAFFOLD_FILES).map(path => `${TEMPLATE_ROOT}/${path}`);
        let missing = 0;
        for (const path of paths) {
            try {
                if (!(await adapter.exists(path))) missing += 1;
            } catch (error) { // silent-ok: 模板探测失败按缺失计，用户仍可从设置页一键补齐
                log.warn(`模板探测失败：${path}`, error);
                missing += 1;
            }
        }
        if (missing === 0) {
            return { id: 'templates', label: `「${TEMPLATE_ROOT}」模板树`, status: 'ok', detail: `${paths.length} 个模板文件齐全`, fix: '' };
        }
        return {
            id: 'templates',
            label: `「${TEMPLATE_ROOT}」模板树`,
            status: 'missing',
            detail: `缺少 ${missing}/${paths.length} 个模板文件，创建项目会拿不到大纲/世界观/规则模板`,
            fix: '点「补齐模板文件」自动生成；或重启插件（启动维护会自动自举）',
        };
    }

    /** 是否已有项目 */
    private checkProjects(): ReadinessItem {
        const projects = listProjectIds(this.app);
        if (projects.length > 0) {
            return { id: 'projects', label: '作品项目', status: 'ok', detail: `已识别 ${projects.length} 个项目`, fix: '' };
        }
        return {
            id: 'projects',
            label: '作品项目',
            status: 'missing',
            detail: '还没有任何项目；主界面不会出现可选作品',
            fix: '点「创建示例项目」，或「新建作品」按向导创建',
        };
    }

    /** 三模式根目录是否存在 */
    private checkFolders(): ReadinessItem {
        const missing = MODE_ROOTS.filter(root => !this.app.vault.getAbstractFileByPath(root));
        if (missing.length === 0) {
            return { id: 'folders', label: '模式目录', status: 'ok', detail: `已存在：${MODE_ROOTS.join('、')}`, fix: '' };
        }
        return {
            id: 'folders',
            label: '模式目录',
            status: 'warn',
            detail: `缺少目录：${missing.join('、')}（新建对应模式作品时会自动创建）`,
            fix: '无需手动处理；创建作品时会自动建目录',
        };
    }

    /** 项目索引是否可用 */
    private async checkIndex(): Promise<ReadinessItem> {
        const project = this.deps.activeProject();
        if (!project) {
            return {
                id: 'index',
                label: '项目索引',
                status: 'warn',
                detail: '尚未选择当前作品，索引将在打开作品后建立',
                fix: '打开任意作品后会自动建立索引',
            };
        }
        const count = await this.deps.indexEntryCount(project).catch(() => 0);
        if (count > 0) {
            return { id: 'index', label: '项目索引', status: 'ok', detail: `${project}：${count} 条索引条目`, fix: '' };
        }
        return {
            id: 'index',
            label: '项目索引',
            status: 'warn',
            detail: `${project}：索引为空（可能刚创建或缺文件）`,
            fix: '点「重建索引」；若仍为 0，检查项目内是否有 作品信息.md / 世界观总览.md',
        };
    }

    /** 标签/笔记属性约定说明（始终 warn 提示一次，用户知道约定即算达标） */
    private checkWorkspaceConventions(): ReadinessItem {
        const notePath = '写作知识库/使用说明.md';
        const exists = this.app.vault.getAbstractFileByPath(notePath) instanceof TFile;
        return {
            id: 'workspace',
            label: '标签与笔记属性约定',
            status: exists ? 'ok' : 'warn',
            detail: exists
                ? `已生成说明文件：${notePath}`
                : '标签用 nw/ 命名空间（nw/人物、nw/设定/世界观…），笔记属性用于记录卷/章/状态与实体 ID',
            fix: exists ? '' : '点「生成使用说明」，会在 写作知识库 写一份标签/属性/目录约定速查',
        };
    }
}
