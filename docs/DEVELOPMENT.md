# 开发指南

> **版本**: v4.11.0  
> **最后更新**: 2026-10-19  
> **状态**: 活跃可信 · P0 分发自举（Batch 1）已落地

本文档描述如何在 Novel Writer AI Obsidian 插件中新增 Repository、状态切片、接入新功能，以及如何使用流式生成和缓存系统。所有代码示例均基于实际接口，可直接参考使用。

---

## 一、如何新增 Repository

新增一个 Repository 用于持久化新的实体类型。完整流程包含 5 步。

### 步骤 1：定义聚合根（继承 BaseEntity）

在 `engine/repository/domain/aggregates/` 下创建新的聚合根：

```typescript
// engine/repository/domain/aggregates/scene-aggregate.ts
import { BaseEntity, BaseEntityProps } from './base-entity';
import { EntityStatus, Frontmatter } from '../value-objects';
import type { EntityCategory } from './base-entity';

export interface SceneProps extends BaseEntityProps {
    sceneType: string;
    description: string;
    participants: string[];
    location: string;
}

export class Scene extends BaseEntity {
    private readonly _sceneProps: Omit<SceneProps, keyof BaseEntityProps>;

    private constructor(props: SceneProps) {
        super(props);
        const { id, name, filePath, tags, entityStatus, createdAt, lastChangedAt, lastChangedReason, frontmatter, body, content, ...rest } = props;
        this._sceneProps = {
            ...rest,
            participants: [...rest.participants],
        };
    }

    static create(id: string, name: string, filePath: string): Scene {
        return new Scene({
            id,
            name,
            filePath,
            tags: [],
            entityStatus: EntityStatus.ACTIVE,
            createdAt: new Date().toISOString(),
            lastChangedAt: new Date().toISOString(),
            lastChangedReason: null,
            frontmatter: Frontmatter.empty(),
            body: '',
            content: null,
            sceneType: 'action',
            description: '',
            participants: [],
            location: '',
        });
    }

    static from(props: SceneProps): Scene {
        return new Scene(props);
    }

    get category(): EntityCategory {
        return 'chapter';
    }

    get sceneType(): string { return this._sceneProps.sceneType; }
    get description(): string { return this._sceneProps.description; }
    get participants(): string[] { return [...this._sceneProps.participants]; }
    get location(): string { return this._sceneProps.location; }

    withStatus(status: EntityStatus): Scene {
        return new Scene({
            ...this._props,
            ...this._sceneProps,
            entityStatus: status,
        } as SceneProps);
    }

    withName(name: string): Scene {
        return new Scene({
            ...this._props,
            ...this._sceneProps,
            name,
        } as SceneProps);
    }
}
```

### 步骤 2：实现 fromMarkdown / toMarkdown

在 `engine/repository/domain/serializers/entity-factory.ts` 中扩展 `EntityFactory`：

```typescript
// 在 EntityFactory 类中添加

import { Scene } from '../aggregates';
import type { SceneProps } from '../aggregates';
import { FrontmatterSerializer } from './frontmatter-serializer';
import { EntityStatus, Frontmatter } from '../value-objects';
import { parseMarkdownContent } from '../../../../shared/frontmatter';

static sceneFromMarkdown(content: string, filePath: string = ''): Scene {
    const { frontmatter, body } = FrontmatterSerializer.parse(content);
    const fm = frontmatter.toObject();

    const props: SceneProps = {
        id: filePath ? filePath.replace(/\.md$/, '').split(/[\\/]/).pop() || '' : '',
        name: fm['name'] || fm['名称'] || '无名场景',
        filePath,
        tags: frontmatter.getTags(),
        entityStatus: EntityStatus.ACTIVE,
        createdAt: fm['created_at'] || null,
        lastChangedAt: fm['updated_at'] || null,
        lastChangedReason: null,
        frontmatter,
        body,
        content: parseMarkdownContent(body),
        sceneType: fm['scene_type'] || 'action',
        description: fm['description'] || '',
        participants: Array.isArray(fm['participants']) ? fm['participants'] : [],
        location: fm['location'] || '',
    };

    return Scene.from(props);
}

static sceneToMarkdown(scene: Scene): string {
    const fm: Record<string, any> = {
        name: scene.name,
        scene_type: scene.sceneType,
        description: scene.description,
        participants: scene.participants.length ? scene.participants : undefined,
        location: scene.location || undefined,
    };

    const frontmatter = Frontmatter.from(fm);
    const fmStr = FrontmatterSerializer.serialize(frontmatter);
    const body = scene.body || `# ${scene.name}\n`;
    return `${fmStr}\n${body}`;
}
```

并在 `engine/repository/domain/aggregates/index.ts` 中导出：

```typescript
export { Scene } from './scene-aggregate';
export type { SceneProps } from './scene-aggregate';
```

### 步骤 3：继承 BaseMarkdownRepository

在 `engine/repository/` 下创建具体实现：

```typescript
// engine/repository/scene-repository.ts
import type { FileSystemPort } from '../../shared/file-system-port';
import { pjScenesDir, pjSceneFile } from '../../shared/paths';
import { BaseMarkdownRepository } from './base-markdown-repository';
import type { BaseMarkdownRepositoryOptions } from './base-markdown-repository';
import { Scene } from './domain/aggregates';
import { EntityFactory } from './domain/serializers';

export class SceneRepository extends BaseMarkdownRepository<Scene, string> {
    private readonly project: string;

    constructor(
        fs: FileSystemPort,
        project: string,
        options: BaseMarkdownRepositoryOptions = {},
    ) {
        super(fs, options);
        this.project = project;
    }

    protected idFromEntity(entity: Scene): string {
        return entity.id;
    }

    protected filePathFromId(id: string): string {
        return pjSceneFile(this.project, id);
    }

    protected deserialize(content: string, filePath: string): Scene {
        return EntityFactory.sceneFromMarkdown(content, filePath);
    }

    protected serialize(entity: Scene): string {
        return EntityFactory.sceneToMarkdown(entity);
    }

    protected getBasePath(): string {
        return pjScenesDir(this.project);
    }

    protected sampleId(): string {
        return 'sample';
    }

    async findBySceneType(sceneType: string): Promise<Scene[]> {
        const all = await this.findAll();
        return all.filter(s => s.sceneType === sceneType);
    }

    async findByLocation(location: string): Promise<Scene[]> {
        const all = await this.findAll();
        return all.filter(s => s.location === location);
    }

    async findByParticipant(characterName: string): Promise<Scene[]> {
        const all = await this.findAll();
        return all.filter(s => s.participants.includes(characterName));
    }

    getProjectName(): string {
        return this.project;
    }
}
```

### 步骤 4：注册到 EngineRegistry

在 `engine/engine-registry.ts` 中：

```typescript
// 1. 添加到 ENGINE_NAMES
export const ENGINE_NAMES = {
    // ... 现有项
    SCENE_REPOSITORY: 'sceneRepository',
} as const;

// 2. 添加获取方法（项目级单例）
async getSceneRepository(project: string): Promise<SceneRepository> {
    const key = project || '__default__';
    let repos = this.repositoryInstances.get(ENGINE_NAMES.SCENE_REPOSITORY);
    if (!repos) {
        repos = new Map();
        this.repositoryInstances.set(ENGINE_NAMES.SCENE_REPOSITORY, repos);
    }
    let repo = repos.get(key) as SceneRepository | undefined;
    if (!repo) {
        if (!this.plugin) throw new Error('[EngineRegistry] 未初始化');
        const fs = new ObsidianFileSystem(this.plugin.app);
        repo = new SceneRepository(fs, project);
        repos.set(key, repo);
    }
    return repo;
}
```

在 `engine/repository/index.ts` 中导出：

```typescript
export { SceneRepository } from './scene-repository';
```

### 步骤 5：编写单元测试

```typescript
// tests/unit/engine/repository/scene-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFileSystem } from '../../../shared/file-system-port';
import { SceneRepository } from '../../../engine/repository/scene-repository';
import { Scene } from '../../../engine/repository/domain/aggregates';
import { pjSceneFile } from '../../../shared/paths';

const TEST_PROJECT = 'test-project';

describe('SceneRepository', () => {
    let fs: MockFileSystem;
    let repo: SceneRepository;

    beforeEach(() => {
        fs = new MockFileSystem();
        repo = new SceneRepository(fs, TEST_PROJECT, { cacheEnabled: false });
    });

    it('保存场景后可通过 ID 查找', async () => {
        const scene = Scene.create(
            'scene-1',
            '开场场景',
            pjSceneFile(TEST_PROJECT, 'scene-1'),
        );

        await repo.save(scene);
        const found = await repo.findById('scene-1');
        expect(found).not.toBeNull();
        expect(found?.name).toBe('开场场景');
    });

    it('findBySceneType 按场景类型查找', async () => {
        const scene1 = Scene.create('s1', '对话场景', pjSceneFile(TEST_PROJECT, 's1'));
        const scene2 = Scene.from({
            ...scene1.toJSON(),
            sceneType: 'dialogue',
        } as any);
        await repo.save(scene2);
        
        const results = await repo.findBySceneType('dialogue');
        expect(results.length).toBe(1);
    });

    it('findByParticipant 按人物查找', async () => {
        const scene = Scene.from({
            id: 's1',
            name: '战斗场景',
            filePath: pjSceneFile(TEST_PROJECT, 's1'),
            sceneType: 'action',
            participants: ['张三', '李四'],
            description: '',
            location: '战场',
        } as any);
        await repo.save(scene);

        const results = await repo.findByParticipant('张三');
        expect(results.length).toBe(1);
    });
});
```

**运行测试**：
```bash
npm test -- scene-repository
```

---

## 二、如何新增状态切片

为协同写作会话添加新的状态切片（如：插件设置切片）。完整流程包含 5 步。

### 步骤 1：定义 Slice 接口

在 `engine/co-writer/session-state.ts` 中添加新切片：

```typescript
// ============================================================
// 新增：PluginState 切片（持久化）
// ============================================================

export interface PluginState {
    writingMode: string;
    antiAiEnabled: boolean;
    contextWindowSize: number;
}

export const initialPluginState: PluginState = {
    writingMode: 'default',
    antiAiEnabled: false,
    contextWindowSize: 4096,
};
```

### 步骤 2：实现 Action Creators

```typescript
// ============================================================
// Plugin Slice Action Creators
// ============================================================

export interface PluginActionCreators {
    setWritingMode: (mode: string) => Partial<CoWritingSessionState>;
    setAntiAiEnabled: (enabled: boolean) => Partial<CoWritingSessionState>;
    setContextWindowSize: (size: number) => Partial<CoWritingSessionState>;
}

export const pluginActions: PluginActionCreators = {
    setWritingMode: (mode) => ({ writingMode: mode }),
    setAntiAiEnabled: (enabled) => ({ antiAiEnabled: enabled }),
    setContextWindowSize: (size) => ({ contextWindowSize: size }),
};
```

### 步骤 3：配置 persist 策略（持久化 vs 内存态）

在 `CoWritingSessionState` 接口中扩展，并明确持久化策略：

```typescript
export interface CoWritingSessionState
    extends ChapterState,
        SuggestionState,
        EditorState,
        MetricsState,
        UiState,
        PluginState {}

export const initialCoWritingSessionState: CoWritingSessionState = {
    ...initialChapterState,
    ...initialSuggestionState,
    ...initialEditorState,
    ...initialMetricsState,
    ...initialUiState,
    ...initialPluginState,
};

export function partializeCoWritingState(
    state: CoWritingSessionState,
): PersistedCoWritingState {
    const {
        currentProject, currentVolume, currentChapter,
        chapterTitle, chapterContent, wordCount, chapterStatus,
        plotCompletion, qualityScore, editHistory, sessionWordCount,
        rightPanelTab, isPanelExpanded, fontSize,
        writingMode, antiAiEnabled, contextWindowSize,
    } = state;

    return {
        currentProject, currentVolume, currentChapter,
        chapterTitle, chapterContent, wordCount, chapterStatus,
        plotCompletion, qualityScore,
        editHistory: editHistory.slice(0, MAX_EDIT_HISTORY),
        sessionWordCount,
        rightPanelTab, isPanelExpanded, fontSize,
        writingMode, antiAiEnabled, contextWindowSize,
    };
}

export type PersistedCoWritingState =
    & ChapterState
    & MetricsState
    & UiState
    & PluginState;

export function isPersistedField(key: string): boolean {
    const persistedKeys = [
        // ... 已有字段
        'writingMode', 'antiAiEnabled', 'contextWindowSize',
    ];
    return persistedKeys.includes(key);
}
```

### 步骤 4：整合到 CoWritingSessionState

更新 `AllActionCreators` 接口和 `allActions` 实现：

```typescript
export interface AllActionCreators
    extends ChapterActionCreators,
        SuggestionActionCreators,
        EditorActionCreators,
        MetricsActionCreators,
        UiActionCreators,
        PluginActionCreators {}

export const allActions: AllActionCreators = {
    ...chapterActions,
    ...suggestionActions,
    ...editorActions,
    ...metricsActions,
    ...uiActions,
    ...pluginActions,
};
```

在 `engine/co-writer/index.ts` 中导出新类型：

```typescript
export type {
    PluginState,
    PluginActionCreators,
} from './session-state';

export {
    initialPluginState,
    pluginActions,
} from './session-state';
```

### 步骤 5：编写单元测试

```typescript
// tests/unit/engine/co-writer/plugin-slice.test.ts
import { describe, it, expect } from 'vitest';
import {
    createStore,
    subscribeWithSelector,
} from '../../../../shared/store';
import {
    initialCoWritingSessionState,
    pluginActions,
    partializeCoWritingState,
    isPersistedField,
} from '../../../../engine/co-writer/session-state';

describe('PluginState 切片', () => {
    it('setWritingMode 更新写作模式', () => {
        const store = createStore(initialCoWritingSessionState);
        store.setState(pluginActions.setWritingMode('precise'));
        expect(store.getState().writingMode).toBe('precise');
    });

    it('setAntiAiEnabled 切换 AI 检测规则', () => {
        const store = createStore(initialCoWritingSessionState);
        store.setState(pluginActions.setAntiAiEnabled(true));
        expect(store.getState().antiAiEnabled).toBe(true);
    });

    it('PluginState 字段被持久化', () => {
        const state = {
            ...initialCoWritingSessionState,
            writingMode: 'creative',
            antiAiEnabled: true,
        };
        const persisted = partializeCoWritingState(state);
        expect(persisted.writingMode).toBe('creative');
        expect(persisted.antiAiEnabled).toBe(true);

        expect(isPersistedField('writingMode')).toBe(true);
    });
});
```

---

## 三、如何接入新功能

新功能从 UI 到 Engine 的完整接入流程，4 步即可。

### 步骤 1：在 Facade 中添加方法

```typescript
// ui/services/co-write-facade.ts
export class CoWriteFacade {
    // ... 已有方法

    async analyzeChaptersBatch(
        project: string,
        chapterIds: string[],
    ): Promise<AnalysisResult[]> {
        const repo = this.registry?.getChapterRepository(project);
        if (!repo) {
            throw new Error('ChapterRepository 不可用');
        }

        const results: AnalysisResult[] = [];
        for (const id of chapterIds) {
            const chapter = await repo.findById(id);
            if (chapter) {
                const result = await this.engine.analyzeChapter(chapter);
                results.push(result);
            }
        }
        return results;
    }
}
```

### 步骤 2：在 Engine 中实现业务

```typescript
// engine/co-writer-engine.ts
export class CoWriterEngine {
    // ... 已有方法

    async analyzeChapter(chapter: Chapter): Promise<AnalysisResult> {
        const markId = performanceMonitor.startMark('analyzeChapter', {
            chapterId: chapter.id,
        });

        try {
            const wordCount = chapter.wordCount.chinese;
            const sentenceCount = chapter.body.split(/[。！？!?]+/).length;

            return {
                chapterId: chapter.id,
                wordCount,
                sentenceCount,
                avgSentenceLength: wordCount / Math.max(1, sentenceCount),
            };
        } finally {
            performanceMonitor.endMark(markId);
        }
    }
}
```

### 步骤 3：在 View 中消费状态

```typescript
// ui/cowriting-view.ts
import type { CoWriteFacade } from './services/co-write-facade';

export class CoWritingView {
    private facade: CoWriteFacade;

    async onAnalyzeButtonClick(): Promise<void> {
        const results = await this.facade.analyzeChaptersBatch(
            this.currentProject,
            this.selectedChapterIds,
        );

        const store = this.facade.getStore();
        if (store) {
            store.setState({
                analysisResults: results,
            });
        }
    }

    private subscribeToAnalysisResults(): void {
        const store = this.facade.getStore();
        if (!store) return;

        store.subscribe(
            (state) => state.analysisResults,
            (results) => {
                this.renderAnalysisResults(results);
            },
            { equalityFn: shallow },
        );
    }
}
```

### 步骤 4：添加性能节点

```typescript
import { performanceMonitor } from '../engine/performance';

export class CoWriteFacade {
    async analyzeChaptersBatch(
        project: string,
        chapterIds: string[],
    ): Promise<AnalysisResult[]> {
        const markId = performanceMonitor.startMark(
            'analyzeChaptersBatch',
            { project, chapterCount: chapterIds.length },
        );

        try {
            // ... 业务逻辑
            return results;
        } finally {
            performanceMonitor.endMark(markId);
        }
    }
}

// 定期输出统计（开发环境）
if (isDevMode) {
    setInterval(() => {
        const stats = performanceMonitor.getStats();
        console.log('[Performance]', stats.slowestTop10);
    }, 60_000);
}
```

---

## 四、如何使用流式生成

### 1. 原生流式（推荐）

```typescript
import type { CoWriterEngine } from '../engine/co-writer-engine';

const facade = new CoWriteFacade({ plugin });

const controller = new AbortController();
const signal = controller.signal;

try {
    const stream = facade.suggestStream(
        precedingText,
        cursorHint,
        'default',
        0,
        signal,
    );

    for await (const chunk of stream) {
        editor.insertText(chunk);
        updateProgressBar(chunk.length);
    }
} catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
        console.log('用户取消生成');
    } else {
        console.error('生成错误:', e);
    }
}

// controller.abort(); // 用户点击取消按钮时
```

### 2. 并行建议（多个方向同时生成）

```typescript
const result = facade.suggestParallel(
    precedingText,
    cursorHint,
    'default',
    3,
    {
        timeoutMs: 30000,
        maxRetries: 1,
    },
);

console.log(`启动了 ${result.handles.length} 个并行流`);

for (const handle of result.handles) {
    (async () => {
        for await (const chunk of handle.iterator) {
            console.log(`[${handle.direction}] ${chunk}`);
        }
    })();
}

const suggestions = await result.allCompleted;
console.log(`完成 ${suggestions.length} 条建议`);

import { sortSuggestionsByQuality } from '../engine/co-writer';
const sorted = sortSuggestionsByQuality(suggestions, precedingText);
```

### 3. 直接使用底层 AI 客户端（高级用法）

```typescript
import { AIApiClient } from '../engine/ai-api-client';

const client = new AIApiClient(plugin);

// callAIAsyncIterator 自动降级：原生 SSE → 模拟流式 → 完整响应
const iterator = client.callAIAsyncIterator(
    systemPrompt,
    userPrompt,
    'gpt-4',
    0.7,
    4096,
    {
        isWritingTask: true,
        signal: controller.signal,
    },
);

let fullContent = '';
for await (const chunk of iterator) {
    fullContent += chunk;
    renderToUI(chunk);
}

const result = await iterator.next();
// result.value 包含 usage 信息
```

### 4. 模拟流式（用于测试或本地模型）

```typescript
import { createSimulatedStream, createSimulatedStreamWithSignal } from '../engine/streaming';

// 简单模拟流
const stream = createSimulatedStream(
    '这是一段完整文本，将会被分段输出。',
    {
        splitBy: 'sentence',
        minDelayMs: 20,
        maxDelayMs: 60,
        chunkSize: 1,
    },
);

for await (const chunk of stream) {
    console.log(chunk);
}

// 可取消的模拟流
const controller = new AbortController();
const cancellableStream = createSimulatedStreamWithSignal(
    '可取消的模拟流式',
    controller.signal,
    { splitBy: 'paragraph' },
);
```

### 5. 流式格式解析

```typescript
import { StreamParser, parseReadableStream } from '../engine/streaming';

const parser = new StreamParser('auto');
const response = await fetch(apiUrl);
const reader = response.body!.getReader();

const contentIterator = parseReadableStream(reader, 'auto', signal);

for await (const chunk of contentIterator) {
    renderToUI(chunk);
}

const result = await contentIterator.next();
// result.value = { content, usage }
```

---

### 6. 旧路径章节流式生成

旧版完整章节入口和 `bodyGeneration` 步骤已统一接入流式调用：

- `AIEngine.generateChapterStream()` 负责完整章节流式生成。
- `StepRunner` 的 `bodyGeneration` 通过相同的流式回调持续刷新正文。
- 响应因 `finishReason: 'length'` 截断时，最多自动续写 3 次，并携带已生成内容尾部避免断层。
- `WriteChapterModal` 和 `FullWriterView` 均向底层传递 `AbortSignal`；关闭视图或主动取消会终止请求。
- 最终回调以 `done: true` 返回合并后的完整正文，持久化仍只在完整结果确认后执行。

定向回归命令：

```bash
npx vitest run tests/unit/engine/ai-engine.test.ts tests/unit/engine/step-runner.test.ts
```

## 五、缓存系统

### 1. 多层缓存（推荐用于 Repository）

```typescript
import { MultiLayerCache } from '../engine/cache';
import { ObsidianFileSystem } from '../shared/file-system-port';

const fs = new ObsidianFileSystem(plugin.app);

const cache = new MultiLayerCache(
    {
        l1MaxSize: 100,
        l1TtlMs: 5 * 60 * 1000,
        l2Enabled: true,
        l2CacheDir: '.cache',
        l2TtlMs: 24 * 60 * 60 * 1000,
        l2MaxFiles: 1000,
        slowWarnThresholdMs: 500,
        autoAdapt: true,
    },
    fs,
);

await cache.set('character:张三', characterData, {
    sourcePath: 'projects/张三/01-世界观设定/人物/张三.md',
    sourceMtime: Date.now(),
});

const cached = await cache.get<CharacterData>('character:张三');
if (cached) {
    console.log('缓存命中');
}

await cache.invalidate('character:张三');
await cache.invalidateByPrefix('character:');
await cache.invalidateBySourcePath('path/to/file.md');

const stats = cache.getStats();
console.log('L1 命中率', stats.l1.hitRate);
console.log('L2 命中率', stats.l2.hitRate);
```

### 2. 在 Repository 中集成缓存

```typescript
import { CharacterRepository } from '../engine/repository';
import { MultiLayerCache } from '../engine/cache';
import { ObsidianFileSystem } from '../shared/file-system-port';

const fs = new ObsidianFileSystem(plugin.app);
const cache = new MultiLayerCache({ l2Enabled: true }, fs);

const characterRepo = new CharacterRepository(fs, projectName, {
    cacheMaxSize: 100,
    cacheTtlMs: 5 * 60 * 1000,
    multiLayerCache: cache,
    cacheKeyPrefix: 'char:',
});

const character = await characterRepo.findById('张三');

characterRepo.invalidateCache('张三');
characterRepo.invalidateCacheByPrefix('char:');
characterRepo.clearCache();
```

### 3. 文件缓存（独立使用）

```typescript
import { FileCache } from '../engine/cache';
import { ObsidianFileSystem } from '../shared/file-system-port';

const fs = new ObsidianFileSystem(plugin.app);

const fileCache = new FileCache(fs, {
    cacheDir: '.cache/expensive-computations',
    ttlMs: 24 * 60 * 60 * 1000,
    maxFiles: 500,
});

async function expensiveAnalysis(text: string, sourcePath: string): Promise<Result> {
    const key = `analysis:${hash(text)}`;

    const cached = await fileCache.get<Result>(key);
    if (cached) return cached;

    const result = performExpensiveComputation(text);

    await fileCache.set(key, result, {
        sourcePath,
        sourceMtime: Date.now(),
    });

    return result;
}

fileCache.invalidateBySourcePath('path/to/source.md');
```

### 4. 预加载管理器（高级用法）

```typescript
import { PreloadManager, preloadManager } from '../engine/cache';

preloadManager.setChapterRepository(chapterRepo);
preloadManager.enable();

preloadManager.registerEntityLoader<Character>(
    'character',
    (id) => characterRepo.findById(id),
    100,
);

await preloadManager.preloadAdjacentChapters('v1-c5');

const cachedChapter = preloadManager.getCachedChapter('v1-c4');
if (cachedChapter) {
    console.log('预加载命中');
}

const character = await preloadManager.lazyLoadEntity<Character>(
    'character',
    '张三',
);

preloadManager.recordBehavior({
    action: 'navigate',
    chapterId: 'v1-c5',
});

const { predicted, prewarmed } = await preloadManager.predictNextAction({
    action: 'navigate',
    chapterId: 'v1-c5',
});

preloadManager.enqueueIdleTask({
    id: 'preload-relationships-张三',
    priority: 2,
    description: '预加载张三的关系网络',
    execute: async () => {
        await relationshipEngine.precomputeRelations('张三');
    },
});
```

### 5. LRU 缓存（基础用法）

```typescript
import { LruCache } from '../engine/repository';

const cache = new LruCache<string, MyData>({
    maxSize: 100,
    ttlMs: 5 * 60 * 1000,
});

cache.set('key1', data);
const cached = cache.get('key1');
if (cached !== undefined) {
    console.log('命中');
}

cache.deleteByPrefix('user:');
const pruned = cache.pruneExpired();
console.log(`清理了 ${pruned} 个过期条目`);
```

---

## 六、构建与测试

### 构建命令

```bash
npm run build          # 生产构建（同步版本号 + 生成内置模板资源）
npm run dev            # 开发模式（watch）
npm run typecheck      # 类型检查
npm run version:sync   # 同步版本号
npm run gen:templates  # 由 assets/template-scaffold 重新生成内置模板模块
npm run check:templates # 校验生成物与资源目录一致（CI 使用）
npm run check:release  # 发布前资产与版本一致性校验
```

### 测试命令

```bash
npm test               # 单元测试
npm run test:cov       # 单元测试 + 覆盖率
npm run test:e2e       # E2E 测试
npm run test:e2e:ui    # E2E 测试（UI 模式）
npm run test:e2e:headed # E2E 测试（有头模式）
npm run test:e2e:report # 查看 E2E 测试报告
```

### 当前验证状态

截至 2026-10-19（v4.11.0 + Batch 1）：

- `npm run check:templates` / `npm run lint` / `npm run typecheck` 通过。
- `npm test`：164 个测试文件、3014 个用例全部通过。
- `npm run build` 通过，构建版本为 v4.11.0。
- `npm run check:release` 通过（三资产、Worker 产物、内置模板嵌入均校验）。
- CI / 发布流水线配置位于 `.github/workflows/`（PR 全量 Gate；`v*` tag 自动发布）。
- `npm run check-engines` 仍报告既有 EngineRegistry 治理项，需在独立治理任务中处理。

### 发布流程

1. 修改 `package.json` 的 `version`，执行 `npm run version:sync` 同步 `manifest.json`。
2. 本地执行全量 Gate：`check:templates` → `lint` → `typecheck` → `test` → `build` → `check:release`。
3. 合并到 `master` 后打 annotated tag（`vX.Y.Z`）。
4. 推送 tag：`.github/workflows/release.yml` 会重新执行 Gate 并创建/更新 GitHub Release（`main.js` / `manifest.json` / `styles.css`）。

### 内置模板资源

- 资源源文件位于 `assets/template-scaffold/`；修改后执行 `npm run gen:templates` 更新 `shared/template-scaffold-assets.generated.ts`。
- 生成物随 `main.js` 打包，保证仅安装 3 个发布文件时也能自举 `元文件/`。
- 禁止在资源中放置示例项目数据或第三方作品原文（单测会校验受限内容）。

### 引擎合规检查

```bash
npm run check-engines  # 检查引擎实例化合规性
```

---

## 七、相关文档

- [架构视图](./ARCHITECTURE.md) — 分层架构与设计决策
- [性能优化指南](./PERFORMANCE.md) — 缓存策略与性能监控
- [API 文档](./API.md) — 完整 API 参考
- [Repository 迁移指南](../engine/repository/MIGRATION.md) — 旧代码渐进式迁移