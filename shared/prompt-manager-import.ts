/**
 * prompt-manager-import.ts — 提示词配置导入的纯逻辑（dry-run 差异 + 合并）
 *
 * 为什么单独成文件：导入有两个消费者——服务层的真正落盘（merge/replace）与
 * 界面层的「导入前预览」（统计新增/覆盖/将移除）。两边必须用**同一套匹配规则**
 * （id 或同名视为同一模板），否则预览说「覆盖 1 个」而落盘却新增了 1 个。
 *
 * 纯函数、无 Obsidian 依赖，可直接单测。
 */

import type {
    ABTest,
    PromptManagerConfig,
    PromptTemplate,
    PromptUsageRecord,
} from './prompt-manager-types';

/** 导入模式：整份替换 / 按 id（或同名）合并 */
export type PromptImportMode = 'replace' | 'merge';

/** 导入预览的差异统计（给弹窗展示，不含数据本体） */
export interface PromptImportDiff {
    /** 将被新增的模板名 */
    addedTemplates: string[];
    /** 将被覆盖（同 id 或同名）的模板名 */
    overwrittenTemplates: string[];
    /** 仅覆盖模式下：当前存在但文件里没有、导入后会被移除的模板名 */
    removedTemplates: string[];
    /** 将被新增的 A/B 测试名 */
    addedTests: string[];
    /** 将被覆盖（同 id）的 A/B 测试名 */
    overwrittenTests: string[];
    /** 文件里携带的使用记录条数（原样写入/去重合并） */
    usageInFile: number;
}

/** 当前配置的模板/测试快照（导入预览用，避免界面层直接摸配置对象） */
export interface PromptImportSnapshot {
    templates: PromptTemplate[];
    tests: ABTest[];
}

/**
 * 判断两个模板是否是「同一个模板」：同 id 或同名。
 *
 * 同名也算同一模板，是因为用户常在两个库之间手工改 id 后重导，
 * 只看 id 会得到「旧模板还在 + 新模板多一份」的双份模板。
 *
 * @param current - 当前库里的模板
 * @param incoming - 文件里的模板
 * @returns 是否视为同一模板
 */
export function isSameTemplate(current: PromptTemplate, incoming: PromptTemplate): boolean {
    return current.id === incoming.id || (Boolean(current.name) && current.name === incoming.name);
}

/**
 * 计算导入差异（dry-run），不修改任何状态。
 *
 * @param current - 当前配置的模板/测试快照
 * @param imported - 校验通过的导入配置
 * @param mode - 导入模式（决定 removedTemplates 是否为空）
 * @returns 差异统计
 *
 * @example
 * buildPromptImportDiff({ templates: [], tests: [] }, config, 'merge');
 * // { addedTemplates: ['伏笔密度体检'], overwrittenTemplates: [], ... }
 */
export function buildPromptImportDiff(
    current: PromptImportSnapshot,
    imported: PromptManagerConfig,
    mode: PromptImportMode,
): PromptImportDiff {
    const addedTemplates: string[] = [];
    const overwrittenTemplates: string[] = [];

    for (const incoming of imported.customTemplates) {
        if (current.templates.some((c) => isSameTemplate(c, incoming))) {
            overwrittenTemplates.push(incoming.name);
        } else {
            addedTemplates.push(incoming.name);
        }
    }

    const removedTemplates = mode === 'replace'
        ? current.templates
            .filter((c) => !imported.customTemplates.some((i) => isSameTemplate(c, i)))
            .map((c) => c.name)
        : [];

    const addedTests: string[] = [];
    const overwrittenTests: string[] = [];
    for (const incoming of imported.abTests) {
        if (current.tests.some((t) => t.id === incoming.id)) {
            overwrittenTests.push(incoming.name);
        } else {
            addedTests.push(incoming.name);
        }
    }

    return {
        addedTemplates,
        overwrittenTemplates,
        removedTemplates,
        addedTests,
        overwrittenTests,
        usageInFile: imported.usageHistory.length,
    };
}

/**
 * 合并两份配置（merge 模式）：入参不被修改，返回新对象。
 *
 * 规则：
 * - 模板按 id/同名覆盖，版本按版本号合并（文件里的版本优先，旧版本保留）
 * - A/B 测试按 id 覆盖
 * - 使用记录按 id 去重合并（保留现有，追加文件里没有的）
 * - A/B 总开关保留当前设置（导入不该悄悄打开实验分流）
 *
 * @param current - 当前配置
 * @param imported - 导入配置
 * @returns 合并后的新配置
 *
 * @example
 * mergePromptConfigs(current, imported).customTemplates.length;
 * // 3
 */
export function mergePromptConfigs(
    current: PromptManagerConfig,
    imported: PromptManagerConfig,
): PromptManagerConfig {
    const templates = current.customTemplates.map((t) => cloneTemplate(t));

    for (const incoming of imported.customTemplates) {
        const index = templates.findIndex((c) => isSameTemplate(c, incoming));
        if (index >= 0) {
            templates[index] = mergeTemplate(templates[index], incoming);
        } else {
            templates.push(cloneTemplate(incoming));
        }
    }

    const tests = current.abTests.map((t) => t);
    for (const incoming of imported.abTests) {
        const index = tests.findIndex((t) => t.id === incoming.id);
        if (index >= 0) {
            tests[index] = incoming;
        } else {
            tests.push(incoming);
        }
    }

    const seen = new Set(current.usageHistory.map((r) => r.id));
    const mergedUsage: PromptUsageRecord[] = [
        ...current.usageHistory,
        ...imported.usageHistory.filter((r) => !seen.has(r.id)),
    ].slice(-1000);

    return {
        customTemplates: templates,
        abTests: tests,
        usageHistory: mergedUsage,
        abTestingEnabled: current.abTestingEnabled,
    };
}

/**
 * 浅拷贝模板（版本/变量数组也复制一层，避免合并时改到当前配置）。
 *
 * @param template - 原模板
 * @returns 拷贝
 */
function cloneTemplate(template: PromptTemplate): PromptTemplate {
    return {
        ...template,
        versions: template.versions.map((v) => ({ ...v })),
        variables: template.variables.map((v) => ({ ...v })),
    };
}

/**
 * 合并同一个模板：保留现有 id（别把 A/B 测试引用的 id 换掉），版本取并集。
 *
 * @param existing - 当前库里的模板
 * @param incoming - 文件里的模板
 * @returns 合并后的模板
 */
function mergeTemplate(existing: PromptTemplate, incoming: PromptTemplate): PromptTemplate {
    const versions = incoming.versions.map((v) => ({ ...v }));
    for (const version of existing.versions) {
        if (!versions.some((v) => v.version === version.version)) {
            versions.push({ ...version });
        }
    }

    const activeVersion = incoming.versions.find((v) => v.isActive)?.version
        ?? existing.versions.find((v) => v.isActive)?.version
        ?? versions[0]?.version;

    return {
        ...incoming,
        id: existing.id,
        isCustom: incoming.isCustom ?? existing.isCustom ?? true,
        versions: versions.map((v) => ({ ...v, isActive: v.version === activeVersion })),
        variables: incoming.variables.map((v) => ({ ...v })),
    };
}
