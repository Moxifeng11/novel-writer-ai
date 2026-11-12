/**
 * 联动场景：知识库 → 注入 → 落盘 → 使用统计（G7-5 链 2）
 *
 * 这条链此前只有各段单测，没有任何用例把「注入器上报来源 → 步骤落盘写
 * rag_sources → 统计页读回来」串起来。断在任何一段都不会报错，只会表现成
 * 「知识引用统计一直是 0」。
 *
 * 覆盖：
 *  1. injectKnowledgeBase 通过 ragSink 逐条上报真实命中（书/维度/分数/片段）
 *  2. pushRagSource 去重与截断后写入步骤 frontmatter 的 rag_sources
 *  3. collectKnowledgeUsage 能读回同一份 frontmatter 并汇总命中率/书目
 */
import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { KnowledgeInjector } from '../../engine/knowledge-injector';
import type { KnowledgeSearchResult } from '../../engine/knowledge-vector-store';
import { StepResultSaver } from '../../engine/step-result-saver';
import { MockFileSystem, type FrontmatterPort } from '../../shared/file-system-port';
import { formatRagSources, pushRagSource, type RagSource } from '../../shared/rag-sources';
import { collectKnowledgeUsage } from '../../engine/knowledge-usage';

class FakeFrontmatter implements FrontmatterPort {
    states = new Map<string, Record<string, unknown>>();

    async processFrontmatter(file: TFile, updater: (fm: Record<string, unknown>) => void): Promise<void> {
        const fm = { ...(this.states.get(file.path) || {}) };
        updater(fm);
        this.states.set(file.path, fm);
    }
}

interface FakeNode {
    path: string;
    name: string;
    extension?: string;
    stat?: { mtime: number };
    children?: FakeNode[];
}

/** 由文件路径搭目录树，模拟 TFolder.children */
function treeOf(files: Array<{ path: string; name: string; mtime?: number }>): FakeNode {
    const root: FakeNode = { path: '', name: '', children: [] };
    for (const file of files) {
        const parts = file.path.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            let next = (node.children ?? []).find(child => child.name === parts[i] && child.children);
            if (!next) {
                next = { path: parts.slice(0, i + 1).join('/'), name: parts[i], children: [] };
                node.children!.push(next);
            }
            node = next;
        }
        node.children!.push({
            path: file.path,
            name: file.name,
            extension: 'md',
            stat: { mtime: file.mtime ?? 1 },
        });
    }
    return root;
}

const PROJECT = '长篇小说/书A';
const CHAP_DIR = `${PROJECT}/03-大纲与章节/步骤结果/第1卷/第1章`;
const TARGET = `${CHAP_DIR}/第1章_分析报告.md`;

function searchHit(category: string, excerpt: string, score = 0.9): KnowledgeSearchResult {
    return {
        sample: excerpt,
        bookId: 'b1',
        bookName: '参考书',
        dimension: 'technique',
        category,
        score,
    };
}

function makeInjector(hits: KnowledgeSearchResult[]) {
    const store = { search: vi.fn(async () => hits) };
    const injector = new KnowledgeInjector(null as never, {
        knowledgeVectorStore: store as never,
    });
    injector.addReferenceBook('b1', '参考书', 1, true);
    // 只开技巧维度：其它维度保持 0，避免同一份 mock 被多路重复消费
    injector.setDimensionWeights({ character: 0, worldview: 0, style: 0, rhythm: 0, technique: 1 });
    return { injector, store };
}

describe('联动链 2：知识库命中 → 注入上报 → 步骤落盘 → 使用统计', () => {
    it('注入器上报的命中最终能在统计里读回来', async () => {
        const { injector } = makeInjector([
            searchHit('伏笔', '开篇埋下玉佩的来路，第三次出现才回收'),
            searchHit('反转', '把读者以为是盟友的人写成真正的推手'),
        ]);

        // 1) 注入：ragSink 收到的就是「实际进入 prompt」的来源
        const sources: RagSource[] = [];
        const text = await injector.injectKnowledgeBase({
            projectPath: PROJECT,
            outline: '主角在当铺发现玉佩，掌柜神色异常',
            ragSink: source => { pushRagSource(sources, source); },
        }, 0.8);

        expect(text).toContain('参考书');
        expect(sources).toHaveLength(2);
        expect(sources.map(source => source.dimension)).toEqual(['technique', 'technique']);
        expect(sources[0].excerpt).toContain('玉佩');
        // 分数被归一化到两位小数
        expect(sources[0].score).toBe(0.9);

        // 重复上报不产生第二条（同一书/维度/片段）
        expect(pushRagSource(sources, { ...sources[0] })).toBe(false);
        expect(sources).toHaveLength(2);

        // 2) 落盘：与 StepRunner 相同的清洗（去重 + 上限），写进步骤 frontmatter
        const fs = new MockFileSystem();
        const frontmatter = new FakeFrontmatter();
        const saver = new StepResultSaver({ fs, frontmatter });
        const saved = await saver.saveStepResult(
            'analysisReport',
            '# 分析报告\n本章埋线清晰，冲突略弱。\n总结：建议加强当铺一场的对峙。',
            CHAP_DIR,
            '第1章',
            '第1卷',
            { ragSources: formatRagSources(sources) },
        );
        expect(saved).toBe(true);

        const written = frontmatter.states.get(TARGET) || {};
        expect(written['rag_sources']).toEqual(formatRagSources(sources));

        // 3) 统计：读回同一份 frontmatter 汇总
        const app = {
            vault: {
                getAbstractFileByPath: (path: string) => {
                    const root = treeOf([{ path: TARGET, name: '第1章_分析报告.md', mtime: 10 }]);
                    if (path === '') return root;
                    let node: FakeNode | undefined = root;
                    for (const part of path.split('/')) {
                        node = node?.children?.find(child => child.children && child.name === part);
                        if (!node) return null;
                    }
                    return node;
                },
            },
            metadataCache: {
                getFileCache: (target: { path: string }) => {
                    const fm = frontmatter.states.get(target.path);
                    return fm ? { frontmatter: fm } : null;
                },
            },
        };

        const usage = await collectKnowledgeUsage(app, PROJECT, { recentLimit: 5 });
        expect(usage.stepsTotal).toBe(1);
        expect(usage.stepsWithRag).toBe(1);
        expect(usage.hitRate).toBe(1);
        expect(usage.totalSources).toBe(2);
        expect(usage.byBook).toEqual([{ book: '参考书', count: 2 }]);
        expect(usage.recent[0].label).toBe('分析报告');
    });

    it('注入失败/无命中时不写空 rag_sources（统计保持 0，而不是脏数据）', async () => {
        const { injector } = makeInjector([]);
        const sources: RagSource[] = [];
        const text = await injector.injectKnowledgeBase({
            projectPath: PROJECT,
            outline: '主角赴宴',
            ragSink: source => { pushRagSource(sources, source); },
        }, 0.8);

        expect(text).toBe('');
        expect(sources).toEqual([]);

        const fs = new MockFileSystem();
        const frontmatter = new FakeFrontmatter();
        const saver = new StepResultSaver({ fs, frontmatter });
        await saver.saveStepResult(
            'analysisReport',
            '# 分析报告\n无知识库参考。\n总结：按大纲写作。',
            CHAP_DIR,
            '第1章',
            '第1卷',
            { ragSources: formatRagSources(sources) },
        );
        expect((frontmatter.states.get(TARGET) || {})['rag_sources']).toBeUndefined();
    });
});
