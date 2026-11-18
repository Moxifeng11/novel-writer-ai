/**
 * setup-readiness-service.ts — 首次使用环境自检（社区下载后可用性）
 *
 * 目的：插件从社区市场装好后，用户往往只有一份空 vault：
 * 模板树没建、没有项目、没有 API Key、标签/属性约定完全不知情，
 * 结果「装了但用不了」。本服务把「能不能开始写」拆成可检查项，
 * 每项给出状态 + 一键修复入口（由设置页/向导消费）。
 */

import { App, TFile } from 'obsidian';
import { t, getLocale } from '@/i18n';
import { createLogger } from '@/shared/logger';
import { TEMPLATE_SCAFFOLD_FILES } from '@/shared/template-scaffold-assets.generated';
import { TEMPLATE_ROOT } from '@/shared/template-scaffold';
import { listProjectIds } from '@/shared/project-catalog';
import { USAGE_GUIDE_PATH } from '@/shared/usage-guide-content';

const log = createLogger('SetupReadiness');

/** 自检项状态 */
export type ReadinessStatus = 'ok' | 'warn' | 'missing';

/** 自检项 */
export interface ReadinessItem {
    /** 稳定 id（设置页按此挂修复按钮） */
    id: 'provider' | 'model' | 'templates' | 'projects' | 'folders' | 'index' | 'workspace' | 'settlement' | 'worker';
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
    /** 密钥是否以密文形式存在且当前口令未解锁 */
    secretsLocked?(): boolean;
    /** 重活运行模式：worker=后台线程；main-thread=目录版未带 workers 时的降级 */
    workerMode?(): 'worker' | 'worker-inline' | 'main-thread' | Promise<'worker' | 'worker-inline' | 'main-thread'>;
    /** 上次结算遗留的回滚日志章数（无则 0） */
    pendingSettlementCount?(project: string): Promise<number>;
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
            await this.checkSettlementPending(),
            await this.checkWorkerMode(),
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
        if (ok) {
            return {
                id: 'provider',
                label: t('settings.setup.items.providerLabel'),
                status: 'ok',
                detail: t('settings.setup.items.providerOkDetail'),
                fix: '',
            };
        }
        // 密文锁定态：Key 其实存着，但当前会话拿不到明文 → 生成会全部失败
        if (this.deps.secretsLocked?.()) {
            return {
                id: 'provider',
                label: t('settings.setup.items.providerLabel'),
                status: 'missing',
                detail: t('settings.setup.items.providerLockedDetail'),
                fix: t('settings.setup.items.providerLockedFix'),
            };
        }
        return {
            id: 'provider',
            label: t('settings.setup.items.providerLabel'),
            status: 'missing',
            detail: t('settings.setup.items.providerMissingDetail'),
            fix: t('settings.setup.items.providerMissingFix'),
        };
    }

    /** 默认模型是否设置 */
    private checkModel(): ReadinessItem {
        const model = this.deps.currentModel();
        return {
            id: 'model',
            label: t('settings.setup.items.modelLabel'),
            status: model ? 'ok' : 'warn',
            detail: model ? t('settings.setup.items.modelOkDetail', { model }) : t('settings.setup.items.modelMissingDetail'),
            fix: model ? '' : t('settings.setup.items.modelMissingFix'),
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
            return { id: 'templates', label: t('settings.setup.items.templatesLabel', { root: TEMPLATE_ROOT }), status: 'ok', detail: t('settings.setup.items.templatesOkDetail', { count: paths.length }), fix: '' };
        }
        return {
            id: 'templates',
            label: t('settings.setup.items.templatesLabel', { root: TEMPLATE_ROOT }),
            status: 'missing',
            detail: t('settings.setup.items.templatesMissingDetail', { missing, count: paths.length }),
            fix: t('settings.setup.items.templatesMissingFix'),
        };
    }

    /** 是否已有项目 */
    private checkProjects(): ReadinessItem {
        const projects = listProjectIds(this.app);
        if (projects.length > 0) {
            return { id: 'projects', label: t('settings.setup.items.projectsLabel'), status: 'ok', detail: t('settings.setup.items.projectsOkDetail', { count: projects.length }), fix: '' };
        }
        return {
            id: 'projects',
            label: t('settings.setup.items.projectsLabel'),
            status: 'missing',
            detail: t('settings.setup.items.projectsMissingDetail'),
            fix: t('settings.setup.items.projectsMissingFix'),
        };
    }

    /** 三模式根目录是否存在 */
    private checkFolders(): ReadinessItem {
        const missing = MODE_ROOTS.filter(root => !this.app.vault.getAbstractFileByPath(root));
        const sep = getLocale() === 'zh-CN' ? '、' : ', ';
        if (missing.length === 0) {
            return { id: 'folders', label: t('settings.setup.items.foldersLabel'), status: 'ok', detail: t('settings.setup.items.foldersOkDetail', { roots: MODE_ROOTS.join(sep) }), fix: '' };
        }
        return {
            id: 'folders',
            label: t('settings.setup.items.foldersLabel'),
            status: 'warn',
            detail: t('settings.setup.items.foldersMissingDetail', { roots: missing.join(sep) }),
            fix: t('settings.setup.items.foldersFix'),
        };
    }

    /** 项目索引是否可用 */
    private async checkIndex(): Promise<ReadinessItem> {
        const project = this.deps.activeProject();
        if (!project) {
            return {
                id: 'index',
                label: t('settings.setup.items.indexLabel'),
                status: 'warn',
                detail: t('settings.setup.items.indexNoProjectDetail'),
                fix: t('settings.setup.items.indexNoProjectFix'),
            };
        }
        const count = await this.deps.indexEntryCount(project).catch(() => 0);
        if (count > 0) {
            return { id: 'index', label: t('settings.setup.items.indexLabel'), status: 'ok', detail: t('settings.setup.items.indexOkDetail', { project, count }), fix: '' };
        }
        return {
            id: 'index',
            label: t('settings.setup.items.indexLabel'),
            status: 'warn',
            detail: t('settings.setup.items.indexEmptyDetail', { project }),
            fix: t('settings.setup.items.indexEmptyFix'),
        };
    }

    /** 重活运行模式（社区目录只下发三件套，没有 workers/） */
    private async checkWorkerMode(): Promise<ReadinessItem> {
        const mode = (await this.deps.workerMode?.()) ?? 'worker';
        if (mode === 'worker') {
            return { id: 'worker', label: t('settings.setup.items.workerLabel'), status: 'ok', detail: t('settings.setup.items.workerOkDetail'), fix: '' };
        }
        if (mode === 'worker-inline') {
            return { id: 'worker', label: t('settings.setup.items.workerLabel'), status: 'ok', detail: t('settings.setup.items.workerInlineDetail'), fix: '' };
        }
        return {
            id: 'worker',
            label: t('settings.setup.items.workerLabel'),
            status: 'warn',
            detail: t('settings.setup.items.workerMainDetail'),
            fix: t('settings.setup.items.workerMainFix'),
        };
    }

    /** 上次结算中断是否遗留回滚日志 */
    private async checkSettlementPending(): Promise<ReadinessItem> {
        const project = this.deps.activeProject();
        if (!project || !this.deps.pendingSettlementCount) {
            return { id: 'settlement', label: t('settings.setup.items.settlementLabel'), status: 'warn', detail: t('settings.setup.items.settlementNoProjectDetail'), fix: t('settings.setup.items.settlementNoProjectFix') };
        }
        const pending = await this.deps.pendingSettlementCount(project).catch(() => 0);
        if (pending === 0) {
            return { id: 'settlement', label: t('settings.setup.items.settlementLabel'), status: 'ok', detail: t('settings.setup.items.settlementOkDetail'), fix: '' };
        }
        return {
            id: 'settlement',
            label: t('settings.setup.items.settlementLabel'),
            status: 'missing',
            detail: t('settings.setup.items.settlementPendingDetail', { count: pending }),
            fix: t('settings.setup.items.settlementPendingFix'),
        };
    }

    /** 标签/笔记属性约定说明（始终 warn 提示一次，用户知道约定即算达标） */
    private checkWorkspaceConventions(): ReadinessItem {
        // 路径单源：与「生成使用说明」按钮写入的文件保持一致，否则点完仍显示 warning
        const notePath = USAGE_GUIDE_PATH;
        const exists = this.app.vault.getAbstractFileByPath(notePath) instanceof TFile;
        return {
            id: 'workspace',
            label: t('settings.setup.items.workspaceLabel'),
            status: exists ? 'ok' : 'warn',
            detail: exists
                ? t('settings.setup.items.workspaceOkDetail', { path: notePath })
                : t('settings.setup.items.workspaceMissingDetail'),
            fix: exists ? '' : t('settings.setup.items.workspaceMissingFix'),
        };
    }
}
