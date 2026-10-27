/**
 * context-pack.ts - typed context evidence pack with required-fragment safety.
 */
import type { CreationMode } from '../../shared/creation-mode';

export type ContextKind =
    | 'worldview'
    | 'character'
    | 'relationship'
    | 'timeline'
    | 'foreshadow'
    | 'previous-summary'
    | 'chapter-state'
    | 'section-outline'
    | 'episode-outline'
    | 'scene-bible'
    | 'shot-ledger'
    | 'style'
    | 'rule'
    | 'research'
    | 'random-factor'
    | 'user-preference';

export type ContextScope =
    | 'global'
    | 'project'
    | 'volume'
    | 'chapter'
    | 'section'
    | 'episode'
    | 'scene';

export interface ContextFragment {
    id: string;
    kind: ContextKind;
    title: string;
    content: string;
    priority: number;
    freshness: number;
    scope: ContextScope;
    source: 'vault' | 'rag' | 'tool' | 'memory' | 'user' | 'model' | 'rule';
    verified: boolean;
    maxChars?: number;
    required?: boolean;
}

export interface BuildContextPackInput {
    projectId: string;
    mode: CreationMode;
    taskId: string;
    fragments: ContextFragment[];
    maxChars?: number;
}

export interface ContextPackDropped {
    id: string;
    reason: 'budget' | 'empty' | 'duplicate';
}

export interface ContextPack {
    id: string;
    projectId: string;
    mode: CreationMode;
    taskId: string;
    fragments: ContextFragment[];
    sections: Array<{ title: string; content: string }>;
    promptText: string;
    totalChars: number;
    builtAt: number;
    hash: string;
    dropped: ContextPackDropped[];
}

export interface CreateFragmentInput extends Omit<ContextFragment, 'freshness'> {
    freshness?: number;
}

export function createContextFragment(input: CreateFragmentInput): ContextFragment {
    return { ...input, freshness: input.freshness ?? Date.now() };
}

function hashText(text: string): string {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `cp_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Required fragments are never dropped. If their total exceeds the budget we
 * fail loudly instead of silently losing a must-have constraint.
 */
export function buildContextPack(input: BuildContextPackInput): ContextPack {
    const maxChars = Math.max(1000, input.maxChars ?? 12000);
    const dropped: ContextPackDropped[] = [];
    const seen = new Set<string>();
    const unique: ContextFragment[] = [];

    for (const fragment of input.fragments) {
        const content = String(fragment.content || '').trim();
        if (!content) {
            dropped.push({ id: fragment.id, reason: 'empty' });
            continue;
        }
        const dedupe = `${fragment.kind}::${fragment.title}::${content.slice(0, 120)}`;
        if (seen.has(dedupe)) {
            dropped.push({ id: fragment.id, reason: 'duplicate' });
            continue;
        }
        seen.add(dedupe);
        unique.push({ ...fragment, content });
    }

    const required = unique.filter(fragment => fragment.required);
    const optional = unique
        .filter(fragment => !fragment.required)
        .sort((a, b) => b.priority - a.priority || b.freshness - a.freshness);

    const requiredChars = required.reduce((sum, fragment) => sum + fragment.content.length, 0);
    if (requiredChars > maxChars) {
        throw new Error(`ContextPack: required 片段 ${requiredChars} 字超过预算 ${maxChars}，请缩小任务范围`);
    }

    const selected: ContextFragment[] = [...required];
    let used = requiredChars;
    for (const fragment of optional) {
        const limit = fragment.maxChars ?? fragment.content.length;
        const content = fragment.content.slice(0, limit);
        if (used + content.length > maxChars) {
            dropped.push({ id: fragment.id, reason: 'budget' });
            continue;
        }
        selected.push({ ...fragment, content });
        used += content.length;
    }

    const sections = selected.map(fragment => ({ title: fragment.title, content: fragment.content }));
    const promptText = sections.map(section => `【${section.title}】\n${section.content}`).join('\n\n');
    const id = `ctx_${hashText(`${input.projectId}|${input.mode}|${input.taskId}|${promptText}`)}`;

    return {
        id,
        projectId: input.projectId,
        mode: input.mode,
        taskId: input.taskId,
        fragments: selected,
        sections,
        promptText,
        totalChars: promptText.length,
        builtAt: Date.now(),
        hash: hashText(promptText),
        dropped,
    };
}

export function hasRequiredFragment(pack: ContextPack, kind: ContextKind): boolean {
    return pack.fragments.some(fragment => fragment.required && fragment.kind === kind);
}