/**
 * context-aggregator.ts - one deterministic context pack per logical task.
 *
 * The aggregator does not gather vault data itself; callers inject already
 * gathered fragments. It dedupes, prioritizes and caches the pack so repeated
 * steps do not rebuild everything.
 */
import type { CreationMode } from '../../shared/creation-mode';
import { createLogger } from '../../shared/logger';
import { buildContextPack, type BuildContextPackInput, type ContextPack } from './context-pack';

const log = createLogger('ContextAggregator');

export interface ContextFragment {
    key: string;
    title: string;
    content: string;
    priority: number; // larger = keep longer under budget
    maxChars?: number;
}

export interface ContextAggregatorInput {
    projectId: string;
    mode: CreationMode;
    taskKey: string;
    fragments: ContextFragment[];
}

export interface AggregatedContext {
    projectId: string;
    mode: CreationMode;
    taskKey: string;
    sections: Array<{ title: string; content: string }>;
    promptText: string;
    totalChars: number;
    builtAt: number;
}

const CACHE_TTL_MS = 60_000;

export class ContextAggregator {
    private cache = new Map<string, { value: AggregatedContext; builtAt: number }>();

    invalidate(projectId?: string): void {
        if (!projectId) {
            this.cache.clear();
            return;
        }
        for (const key of Array.from(this.cache.keys())) {
            if (key.startsWith(`${projectId}::`)) this.cache.delete(key);
        }
    }

    aggregate(input: ContextAggregatorInput): AggregatedContext {
        const cacheKey = `${input.projectId}::${input.mode}::${input.taskKey}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
            return cached.value;
        }

        const seen = new Set<string>();
        const sections = input.fragments
            .filter(fragment => String(fragment.content || '').trim())
            .filter(fragment => {
                const dedupeKey = `${fragment.title}::${fragment.content.slice(0, 120)}`;
                if (seen.has(dedupeKey)) return false;
                seen.add(dedupeKey);
                return true;
            })
            .sort((a, b) => b.priority - a.priority)
            .map(fragment => ({
                title: fragment.title,
                content: fragment.maxChars
                    ? fragment.content.slice(0, fragment.maxChars)
                    : fragment.content,
            }));

        const promptText = sections
            .map(section => `【${section.title}】\n${section.content}`)
            .join('\n\n');
        const totalChars = promptText.length;

        const value: AggregatedContext = {
            projectId: input.projectId,
            mode: input.mode,
            taskKey: input.taskKey,
            sections,
            promptText,
            totalChars,
            builtAt: Date.now(),
        };
        this.cache.set(cacheKey, { value, builtAt: value.builtAt });
        log.info('context aggregated', { project: input.projectId, task: input.taskKey, sections: sections.length, chars: totalChars });
        return value;
    }
}

export const contextAggregator = new ContextAggregator();

/** 将 typed ContextFragment 编译为带 required 保护的 ContextPack。 */
export function aggregateContextPack(input: BuildContextPackInput): ContextPack {
    return buildContextPack(input);
}
