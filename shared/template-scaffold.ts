/**
 * template-scaffold.ts — 全新安装的内置模板自举
 *
 * 项目创建流程以 vault 根目录的「元文件」为模板源（见 ui/create-project-modal.ts）。
 * 插件以 3 个文件分发时无法携带 assets 目录，因此将最小模板树嵌入 main.js，
 * 在插件加载与项目创建前按需落盘。
 *
 * 行为约定：
 * - 只补缺失文件，永不覆盖用户已修改的内容；
 * - 单文件失败不阻断其余文件；
 * - 失败信息包含路径，便于用户自助修复。
 */

import type { App } from 'obsidian';
import { TEMPLATE_SCAFFOLD_FILES } from './template-scaffold-assets.generated';
import { createLogger } from './logger';
import { writeVaultText } from './file-system-port';

const log = createLogger('TemplateScaffold');

export const TEMPLATE_ROOT = '元文件';

export interface TemplateScaffoldResult {
    /** 本次新建的文件数 */
    created: number;
    /** 已存在而跳过的文件数 */
    skipped: number;
    /** 写入失败的文件数 */
    failed: number;
}

interface ScaffoldAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    write(path: string, data: string): Promise<void>;
}

/**
 * 为待创建文件补齐父目录（按层级从浅到深）
 *
 * @param adapter - 适配器
 * @param paths - 路径列表
 */
async function ensureParentDirs(adapter: ScaffoldAdapter, paths: string[]): Promise<void> {
    const dirs = new Set<string>();
    for (const p of paths) {
        const segments = p.split('/');
        for (let i = 1; i < segments.length; i++) {
            dirs.add(segments.slice(0, i).join('/'));
        }
    }

    const sorted = [...dirs].sort((a, b) => a.split('/').length - b.split('/').length);
    for (const dir of sorted) {
        if (!(await adapter.exists(dir))) {
            await adapter.mkdir(dir);
        }
    }
}

/**
 * 确保「元文件」模板树存在；返回本次落盘统计。
 * 幂等：重复调用只补齐缺失文件。
 * @param app - Obsidian 应用实例
  * @returns TemplateScaffoldResult 实例
 */
export async function ensureTemplateScaffold(app: App): Promise<TemplateScaffoldResult> {
    const adapter = app.vault.adapter as unknown as ScaffoldAdapter;
    const result: TemplateScaffoldResult = { created: 0, skipped: 0, failed: 0 };

    const relativePaths = Object.keys(TEMPLATE_SCAFFOLD_FILES).map(p => `${TEMPLATE_ROOT}/${p}`);
    const missing: string[] = [];

    for (const fullPath of relativePaths) {
        try {
            if (await adapter.exists(fullPath)) {
                result.skipped++;
            } else {
                missing.push(fullPath);
            }
        } catch (e) {
            result.failed++;
            log.warn(`[TemplateScaffold] 检查文件失败: ${fullPath}`, e);
        }
    }

    if (missing.length === 0) {
        return result;
    }

    try {
        await ensureParentDirs(adapter, missing);
    } catch (e) {
        log.error('[TemplateScaffold] 创建模板目录失败:', e);
    }

    for (const fullPath of missing) {
        const relative = fullPath.slice(TEMPLATE_ROOT.length + 1);
        const content = TEMPLATE_SCAFFOLD_FILES[relative];
        try {
            // 走 vault 索引写入：新建的模板文件立即出现在文件浏览器/双链，
            // 移动端（无外部文件监听）也能同步。
            await writeVaultText(app, fullPath, content);
            result.created++;
        } catch (e) {
            result.failed++;
            log.warn(`[TemplateScaffold] 写入模板失败: ${fullPath}`, e);
        }
    }

    log.info(
        `[TemplateScaffold] 模板自举完成: 新建 ${result.created}，跳过 ${result.skipped}，失败 ${result.failed}`
    );
    return result;
}
