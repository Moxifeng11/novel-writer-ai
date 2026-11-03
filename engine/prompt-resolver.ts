/**
 * prompt-resolver.ts — 步骤提示词的唯一解析入口
 *
 * 背景（2026-11-04 审计）：同一份“模板管理”下存在三条优先级不同的读取路径：
 *   - 交互式单步：vault 自定义 > PromptManager custom > 内置；
 *   - 批量/继续生成：PromptManager custom > 内置（完全不读 vault）；
 *   - 情绪规划/合并规划：直接使用内置常量（模板管理改了也不生效）。
 *
 * 本模块把优先级固定为：
 *   project（预留，当前无项目级 prompt） > vault 自定义 > 用户覆盖 > 内置
 * 所有执行器只允许调用 `resolveStepPrompt`，不再自己拼模板。
 *
 * 返回值带 `source / templateId / templateVersion / templateHash / unresolved`，
 * 供步骤结果归因、缓存键与排障使用；未替换变量只记录警告，不阻断旧模板。
 */
import type { App } from 'obsidian';
import { TemplateService } from '@/engine/template-service';
import { getStepTemplateAuto, type PromptTemplate } from '@/engine/prompts/template-utils';
import { renderMetaOf } from '@/engine/prompts/prompt-registry';
import { hashContent } from '@/shared/versioned-registry';

/** 提示词来源 */
export type PromptSource = 'vault' | 'user-override' | 'builtin';

/** 解析后的步骤提示词 */
export interface ResolvedStepPrompt {
    description: string;
    systemPrompt: string;
    userPrompt: string;
    source: PromptSource;
    /** 实际模板 id（正文会区分 v1/v2/v3/v4） */
    templateId: string;
    /** 实际模板版本 */
    templateVersion: string;
    /** 渲染后 system+user 的内容哈希 */
    templateHash: string;
    /** 仍未被变量替换的占位符（应为空；非空时调用方可提示用户） */
    unresolved: string[];
    /** 解析告警（读取失败、变量残留等） */
    warnings: string[];
}

interface TemplateOverride {
    system?: string;
    user?: string;
}

/**
 * 渲染 `${var}` 与 `{{var}}` 两种占位符。
 *
 * 不抛错：旧模板可能包含未提供的变量；返回 unresolved 供上层提示/归因，
 * 避免像旧实现那样把 `${foo}` 原样发给模型却没有任何痕迹。
 *
 * @param text - 模板文本
 * @param vars - 变量表
 * @returns 渲染文本与未解析变量
 */
export function renderTemplate(
    text: string,
    vars: Record<string, string>,
): { text: string; unresolved: string[] } {
    const unresolved = new Set<string>();
    const rendered = String(text || '')
        .replace(/\$\{([A-Za-z0-9_]+)\}/g, (raw, name: string) => {
            if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? '';
            unresolved.add(name);
            return raw;
        })
        .replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (raw, name: string) => {
            if (Object.prototype.hasOwnProperty.call(vars, name)) return vars[name] ?? '';
            unresolved.add(name);
            return raw;
        });
    return { text: rendered, unresolved: [...unresolved] };
}

/** 从 vars._stepOverrides 读取指定步骤的用户覆盖；解析失败视为无覆盖 */
function readOverride(vars: Record<string, string>, stepKey: string): TemplateOverride | null {
    const raw = vars._stepOverrides;
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Record<string, TemplateOverride>;
        const hit = parsed?.[stepKey];
        if (!hit || (!hit.system?.trim() && !hit.user?.trim())) return null;
        return hit;
    } catch {
        return null;
    }
}

/**
 * 解析一个步骤的 system/user 提示词。
 *
 * @param app - Obsidian 应用实例
 * @param stepKey - 步骤键（infoPlan / bodyGeneration / emotionPlan / deaiCheck …）
 * @param vars - 模板变量
 * @returns 解析结果；步骤没有内置模板时返回 null
 */
export async function resolveStepPrompt(
    app: App,
    stepKey: string,
    vars: Record<string, string> = {},
): Promise<ResolvedStepPrompt | null> {
    // 无 Obsidian app（单测/解耦调用）时跳过 vault，直接走内置/覆盖，
    // 不能因为宿主端口缺失让整个步骤失败。
    const canReadVault = !!(app && (app as { vault?: unknown }).vault);
    const service = canReadVault ? new TemplateService(app) : null;
    let template: PromptTemplate | null = null;
    let source: PromptSource = 'builtin';
    const warnings: string[] = [];

    const hasVaultOverride = service ? await service.hasCustomPrompt(stepKey) : false;
    if (hasVaultOverride) {
        template = await service!.getStepPrompt(stepKey);
        source = 'vault';
    } else {
        const override = readOverride(vars, stepKey);
        // 先取「不含用户覆盖」的内置模板，再按半段合并：
        // 旧实现要求 system + user 都非空才生效，只改 user 会被静默忽略。
        const cleanVars = { ...vars };
        delete cleanVars._stepOverrides;
        const builtin = getStepTemplateAuto(stepKey, cleanVars);
        if (builtin) {
            template = override
                ? {
                    description: '（用户自定义模板）',
                    systemPrompt: override.system?.trim() ? override.system : builtin.systemPrompt,
                    userPrompt: override.user?.trim() ? override.user : builtin.userPrompt,
                }
                : builtin;
            source = override ? 'user-override' : 'builtin';
        }
    }

    if (!template) return null;

    const system = renderTemplate(template.systemPrompt, vars);
    const user = renderTemplate(template.userPrompt, vars);
    const unresolved = [...new Set([...system.unresolved, ...user.unresolved])];
    if (unresolved.length > 0) {
        warnings.push(`模板仍有未替换变量：${unresolved.join('、')}`);
    }

    const meta = renderMetaOf(stepKey, { vars });
    const templateId = source === 'vault' ? `vault:${stepKey}` : (meta?.id ?? stepKey);
    const templateVersion = source === 'vault'
        ? 'vault'
        : source === 'user-override'
            ? 'custom'
            : (meta?.version ?? 'builtin');

    return {
        description: template.description,
        systemPrompt: system.text,
        userPrompt: user.text,
        source,
        templateId,
        templateVersion,
        templateHash: hashContent(`${system.text}\n${user.text}`),
        unresolved,
        warnings,
    };
}
