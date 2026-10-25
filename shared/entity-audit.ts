/**
 * 存量实体完整性审计与回写。
 *
 * 背景：旧版本保存入口未做内容校验，vault 里可能残留「只有 frontmatter 或只有标题」的空壳实体。
 * 本模块负责把它们找出来，并在 AI 补全 + 复检通过后原地覆写，
 * 避免修复时走 saveEntities 的同名另存逻辑产生「名称（2）」副本。
 */
import { App, TFile } from 'obsidian';
import { pjCharsDir, pjFactionsDir, pjItemsDir, pjLocsDir, pjWorldview } from './paths';
import { validateEntityContent, type EntityKind } from './entity-persistence';

const KIND_DIRS: Record<EntityKind, (project: string) => string> = {
    characters: pjCharsDir,
    factions: pjFactionsDir,
    locations: pjLocsDir,
    items: pjItemsDir,
};

export interface AuditedEntity {
    kind: EntityKind;
    name: string;
    file: TFile;
    content: string;
    missingFields: string[];
}

/** 扫描项目下四类实体，返回所有未通过完整性校验的文件 */
export async function auditEntityFiles(app: App, project: string): Promise<AuditedEntity[]> {
    const incomplete: AuditedEntity[] = [];

    for (const kind of Object.keys(KIND_DIRS) as EntityKind[]) {
        const dirPath = KIND_DIRS[kind](project);
        const files = app.vault.getFiles().filter(f =>
            f.path.startsWith(`${dirPath}/`) &&
            f.name.endsWith('.md') &&
            !f.name.includes('模板')
        );

        for (const file of files) {
            try {
                const content = await app.vault.read(file);
                const validation = validateEntityContent(kind, content);
                if (!validation.valid) {
                    incomplete.push({
                        kind,
                        name: file.basename,
                        file,
                        content,
                        missingFields: validation.missingFields,
                    });
                }
            } catch {
                // 单个文件读取失败不影响其他实体的审计
            }
        }
    }

    return incomplete;
}

/** 读取项目世界观，作为 AI 补全的上下文（可为空） */
export async function readProjectWorldview(app: App, project: string): Promise<string> {
    const file = app.vault.getAbstractFileByPath(pjWorldview(project));
    if (!(file instanceof TFile)) return '';
    try {
        return await app.vault.read(file);
    } catch {
        return '';
    }
}

/**
 * 复检通过后原地覆写实体文件。
 * 返回 false 表示补全结果仍不完整，调用方必须保持原文件不变。
 */
export async function overwriteEntityIfComplete(
    app: App,
    item: AuditedEntity,
    content: string
): Promise<{ ok: boolean; missingFields: string[] }> {
    const validation = validateEntityContent(item.kind, content);
    if (!validation.valid) {
        return { ok: false, missingFields: validation.missingFields };
    }
    await app.vault.modify(item.file, content);
    return { ok: true, missingFields: [] };
}
