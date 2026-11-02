/**
 * style-sample-service.ts — 指纹样章检索与向量化
 *
 * 11 步正文此前只拿到指纹“特征文本”，没有真实 prose 样本；
 * 知识库导入/复制/融合的指纹也没有写入 LocalVectorStore。
 * 本服务统一负责：样章向量化 + 正文侧样章检索（检索失败回退到原始样章）。
 */
import type { App } from 'obsidian';
import { LocalVectorStore } from '../local-vector-store';
import { getSharedEmbeddingProvider } from '../embedding/embedding-service';
import { createLogger } from '../../shared/logger';

const log = createLogger('StyleSampleService');

/** 只依赖样章服务需要的字段，避免与 style-fingerprint-library 形成静态循环。 */
export interface StyleSampleFingerprint {
    id: string;
    name: string;
    scope: 'template' | 'global' | 'project';
    samples: string[];
}

/**
 * 单条样文选择。
 */
export interface StyleSamplePick {
    text: string;
    score?: number;
    fingerprintId?: string;
    fingerprintName?: string;
}

/**
 * 样文选择结果。
 */
export interface StyleSampleSelection {
    samples: StyleSamplePick[];
    source: 'vector' | 'fallback' | 'none';
}

function sampleScope(fp: StyleSampleFingerprint): 'global' | 'project' {
    return fp.scope === 'project' ? 'project' : 'global';
}

/**
 * 把某个指纹的样章写入对应的 LocalVectorStore（覆盖旧样本）。
 *
 * @param app - Obsidian 应用实例
 * @param fingerprint - 指纹
 * @param project - 项目（路径或对象）
 * @param options - 配置项
 * @returns 是否成功
 */
export async function vectorizeFingerprintSamples(
    app: App,
    fingerprint: StyleSampleFingerprint,
    project?: string,
    options: { force?: boolean } = {},
): Promise<boolean> {
    const provider = getSharedEmbeddingProvider();
    if (!provider || !fingerprint.samples?.length) return false;
    const scope = sampleScope(fingerprint);
    if (scope === 'project' && !project) return false;

    try {
        const store = new LocalVectorStore(app, scope, provider, project);
        await store.delete(fingerprint.id).catch(() => undefined);
        await store.add(fingerprint.id, fingerprint.samples);
        return true;
    } catch (e) {
        log.warn(`[StyleSampleService] 样章向量化失败: ${fingerprint.id}`, e);
        return false;
    }
}

/**
 * 删除某个指纹的样章向量。
 * 指纹被删除时必须调用：否则样章向量文件留在磁盘上成为孤儿，
 * 检索侧仍可能命中一个已经不在库里的指纹。
 * @param app - Obsidian 应用实例
 * @param fingerprint - 指纹
 * @param project - 项目（路径或对象）
 * @returns 是否成功
 */
export async function deleteFingerprintSamples(
    app: App,
    fingerprint: Pick<StyleSampleFingerprint, 'id'> & { scope?: string },
    project?: string,
): Promise<boolean> {
    const provider = getSharedEmbeddingProvider();
    if (!provider) return false;
    const scope: 'global' | 'project' = fingerprint.scope === 'project' ? 'project' : 'global';
    if (scope === 'project' && !project) return false;

    try {
        const store = new LocalVectorStore(app, scope, provider, project);
        await store.delete(fingerprint.id);
        return true;
    } catch (e) {
        log.warn(`[StyleSampleService] 样章向量删除失败: ${fingerprint.id}`, e);
        return false;
    }
}

/**
 * 重建一批指纹的样章向量（供“重向量化全部”使用）。
 *
 * @param app - Obsidian 应用实例
 * @param fingerprints - 指纹集合
 * @param project - 项目（路径或对象）
 * @returns 数值结果
 */
export async function vectorizeFingerprintSamplesBatch(
    app: App,
    fingerprints: StyleSampleFingerprint[],
    project?: string,
): Promise<number> {
    let ok = 0;
    for (const fp of fingerprints) {
        if (await vectorizeFingerprintSamples(app, fp, project)) ok++;
    }
    return ok;
}

/**
 * 为正文生成挑选样章。
 *
 * 优先用 LocalVectorStore 做语义检索；embedding 不可用/无结果时回退到
 * 启用指纹的原始 samples，避免“样章注入静默为空”。
 * @param app - Obsidian 应用实例
 * @param project - 项目（路径或对象）
 * @param fingerprints - 指纹集合
 * @param query - 查询串
 * @param limit - 上限
  * @returns StyleSampleSelection 实例
 */
export async function selectBodyStyleSamples(
    app: App,
    project: string | undefined,
    fingerprints: StyleSampleFingerprint[],
    query: string,
    limit = 3,
): Promise<StyleSampleSelection> {
    const usable = fingerprints.filter(fp => fp.samples?.length > 0);
    if (usable.length === 0) return { samples: [], source: 'none' };

    const provider = getSharedEmbeddingProvider();
    if (provider) {
        try {
            const byId = new Map(usable.map(fp => [fp.id, fp]));
            const globalFps = usable.filter(fp => sampleScope(fp) === 'global');
            const projectFps = usable.filter(fp => sampleScope(fp) === 'project');
            const globalStore = globalFps.length > 0
                ? new LocalVectorStore(app, 'global', provider)
                : null;
            const projectStore = project && projectFps.length > 0
                ? new LocalVectorStore(app, 'project', provider, project)
                : null;

            const results = [];
            if (globalStore) results.push(...await globalStore.search(query, limit * 3));
            if (projectStore) results.push(...await projectStore.search(query, limit * 3));

            const filtered = results
                .filter(r => !r.fingerprintId || byId.has(r.fingerprintId))
                .sort((a, b) => b.score - a.score)
                .filter((r, index, arr) => index === 0 || r.sample !== arr[index - 1].sample)
                .slice(0, limit);

            if (filtered.length > 0) {
                return {
                    samples: filtered.map(r => ({
                        text: r.sample,
                        score: r.score,
                        fingerprintId: r.fingerprintId,
                        fingerprintName: r.fingerprintId ? byId.get(r.fingerprintId)?.name : undefined,
                    })),
                    source: 'vector',
                };
            }
        } catch (e) {
            log.warn('[StyleSampleService] 样章检索失败，回退到原始样章:', e);
        }
    }

    // 回退：按作用域优先（project → global/template），每指纹取第一条，最多 limit 条
    const ordered = [...usable].sort((a, b) => {
        const rank = (fp: StyleSampleFingerprint) => fp.scope === 'project' ? 0 : 1;
        return rank(a) - rank(b);
    });
    const fallback: StyleSamplePick[] = [];
    for (const fp of ordered) {
        for (const sample of fp.samples) {
            if (!sample?.trim()) continue;
            fallback.push({ text: sample, fingerprintId: fp.id, fingerprintName: fp.name });
            if (fallback.length >= limit) break;
        }
        if (fallback.length >= limit) break;
    }
    return { samples: fallback, source: fallback.length > 0 ? 'fallback' : 'none' };
}

/**
 * 格式化为正文 system prompt 片段（限长 1500 字）。
 *
 * @param selection - 选区
 * @param maxChars - 最大字符数
 * @returns 文本结果
 */
export function formatStyleSamplesForPrompt(
    selection: StyleSampleSelection,
    maxChars = 1500,
): string {
    if (selection.samples.length === 0) return '';
    const lines = ['【参考片段（只模仿句法/质感，不得照抄情节）】'];
    let used = lines[0].length;
    for (let i = 0; i < selection.samples.length; i++) {
        const text = selection.samples[i].text.replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!text) continue;
        const line = `${i + 1}. ${text}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length;
    }
    return lines.length > 1 ? lines.join('\n') : '';
}
