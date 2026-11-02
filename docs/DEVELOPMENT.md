# 开发指南

> **版本**: v4.26.0
> **最后更新**: 2026-11-02  
> **状态**: 活跃可信 · 协同写作建议链路运行时验收通过（云端 32–72s / 本地 192s 返回 3 条，面板可见）
>
> **当前基线**：以 `npm run preflight` 与 `docs/progress/program-status.json` 为准（不在本文写死用例数）；测试口径见 [handbook/05-testing.md](handbook/05-testing.md)。
>
> **已修复的运行时阻断（2026-10-20）**：
> - `.nw-cowrite-suggestions-panel` 被 `display:none` 永久隐藏（生成成功也看不见）
> - 思考型模型 `reasoning_content` 吃满 `max_tokens` → 正文为空被误判「AI流式返回为空」（三处解析已支持截断扩容）
> - `CO_WRITE_MAX_TOKENS_CAP` 2000 硬顶过紧 → 提到 8192
> - 完成度 / 情节线 JSON 解析不兼容 `<think>` 前缀与 ```json 围栏（新增 `extractJsonObject` / `extractJsonArray`）
> - `bge-m3` embedding 输入超 2348 字符报 HTTP 500（截断到 2000）
> - 模型回退写死 `'flash'` 导致云端 400（改为 `flashModel || defaultModel`）
> - `saveBody` 用正则解析 YAML 块列表 → 每次保存清空 `涉及人物/地点/势力/物品功法`；`getStepFilePath` 文件名漏 `第N章_` 前缀 → H1 丢标题

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
        const markId = performanceMonitor.start('analyzeChapter', 'chapterGeneration', undefined, {
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
            performanceMonitor.end(markId);
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
import { performanceMonitor } from '../services/performance-monitor';

export class CoWriteFacade {
    async analyzeChaptersBatch(
        project: string,
        chapterIds: string[],
    ): Promise<AnalysisResult[]> {
        const markId = performanceMonitor.start(
            'analyzeChaptersBatch',
            'chapterGeneration',
            undefined,
            { project, chapterCount: chapterIds.length },
        );

        try {
            // ... 业务逻辑
            return results;
        } finally {
            performanceMonitor.end(markId);
        }
    }
}

// 定期输出统计（开发环境）
if (isDevMode) {
    setInterval(() => {
        console.log('[Performance]', performanceMonitor.generateTextReport());
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

### 2. 直接使用底层 AI 客户端（高级用法）

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

### 3. 模拟流式（用于测试或本地模型）

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

### 4. 流式格式解析

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

### 5. 旧路径章节流式生成

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

### 6. 内容完整性契约（实体 / 向导）

新增实体类型或修改实体模板时，必须同时改三处，否则会出现「模板写了但没生成、校验却放过」：

1. `shared/format-constants.ts`：字段键清单、嵌套组（`*_NESTED_FIELD_GROUPS`）、内容字段（`*_REQUIRED_VALUE_KEYS`，系统字段只查键是否存在）。
2. `shared/template-validator.ts`：对应 `validateXxxOutput`，并保证 `assets/template-scaffold/` 下的模板本身能通过校验（有单测覆盖）。
3. 生成提示词（`engine/ai-*-generator.ts`）：字段名必须与 1、2 完全一致。

落盘一律走 `shared/entity-persistence.ts#saveEntities`：

```typescript
import { ensureEntityIntegrity } from '../shared/entity-integrity';
import { saveEntities, formatSaveOutcome } from '../shared/entity-persistence';

const integrity = await ensureEntityIntegrity(kind, name, content, (req) =>
    plugin.aiEngine.repairEntity(kind, req.name, req.content, req.missingFields, worldview)
);
if (!integrity.valid) {
    new Notice(`❌ ${name} 缺少：${integrity.missingFields.join('、')}`);
    return;
}
const outcome = await saveEntities(app, project, kind, [{ name, content: integrity.content }]);
```

硬约束（不要绕过）：
- `saveEntities` 默认 `requireComplete: true`，不完整一律不落盘；仅在明确的迁移/导入场景才传 `false`。
- 单次保存上限 200；空名拒绝；同名不覆盖（改另存「名称（2）」）。
- 实体文件读取/统计唯一入口是 `shared/entity-reader.ts`（`listEntityFiles` / `countProjectEntities` / `entityDir`）：目录前缀匹配 + 仅 `.md` + 排除名称含「模板」+ 路径升序。AI 世界元素生成器、实体管理、向导完成页、`context-manager.gatherEntityRecords`、`entity-audit` 等消费方不得再各自 `vault.getFiles().filter(...)`，否则同一项目在不同界面数量/顺序不一致。旧 `shared/entity-stats.ts` 已删除。
- 实体/章节选择器的新类名必须在 `styles.css` 有对应定义再提交：Rev 192 前 AI 世界元素生成器的 66 个 `novel-writer-ai-builder-*` 类零样式，浏览器按默认 block 排版，项目卡片塌成一列窄条、统计项竖排。「所有章节」弹窗必须提供搜索 + 按卷分组 + 自适应网格 + 限高滚动，且 `showAllChapters` 内部必须先 `sortChaptersByNumber`（章节来源是「正文 ∪ 骨架目录」的合并顺序，不保证升序）。新类名必须先写进 `styles-src/` 对应源文件，再跑 `npm run build:styles` 生成根 `styles.css`；直接编辑 `styles.css` 会被 `check:styles` 判为产物漂移（`preflight` 失败）。
- 一次渲染要对多个项目取章节时必须走 `ui/project-utils.ts#scanProjectChapters`（一次遍历 + 按 `项目/03-大纲与章节/` 前缀分桶），禁止对每个项目各调一次 `getChaptersForProject`（那是 N 轮全库遍历）。`getChaptersForProject` 与批量扫描共用内部 `buildChapterEntries`，正文 ∪ 骨架、去重、排序口径不得分叉。同一渲染周期内 `getProjectMeta` 结果与单元列表按项目复用，缓存随 render 丢弃——不要做长驻 vault 事件索引（外部改动/批量操作事件不全，会留下陈旧数据）。
- 向导步骤前进入下一步必须调用 `validateWizardStepContent`（`ui/full-writer/wizard-step-validators.ts`），不完整时只允许「重新生成」或显式「跳过此步骤」。
- 文笔风格预设新增走 `ui/writing-style-presets.ts#saveStylePreset`：落盘前用 `validateWritingStyleOutput` 校验 9 个一级分节 + 「二、文笔特征」3 个子节，不完整（含 `—` 占位）直接抛错，不写文件。
- AI 补全（`repairEntity` / `completeCharacter` / `BatchEntityGenerator._retryFixEntity`）必须与生成共用同一输出契约，显式列出 YAML 字段、嵌套组与正文分节；只写「补全缺失字段」会让模型只补 frontmatter，复检必然失败。补全结果统一用 `stripCodeFence` 清理围栏。
- AI 调用的 `maxTokens` / 上下文窗口上限必须走用户「模型覆盖」：`AiEngine.callAI` 不再做静态表预截断，未显式传 `maxTokens` 时使用 `settings.maxOutput`；`AIApiClient#resolveMaxOutput` / `#resolveMaxContext` 与 `calculateTokenBudget(..., limits)` 均优先取覆盖值，再回退 `shared/model-capabilities.ts`。未登记模型静态兜底为 8192 输出 / 32768 上下文，仍建议在「模型覆盖」里配置真实值。
- `finish_reason=length` 时 `AIApiClient` 会在模型上限内自动扩容一次并重试（4096 → 8192 → …），避免「生成一半 → 校验失败 → 二次调用」的浪费。
- 创意类 AI 调用（新建项目「🎲 AI 随机构思」、文笔预设「🪄 AI 生成内容」）必须传 `{ bypassCache: true }` 并在 prompt 中加入随机种子；否则 prompt 五元组缓存会稳定返回上一次结果。
- 批量建章必须消费上一个步骤产出的全书规划：`readMergedVolumeOutline`（v4 卷文件优先，旧版单文件仅兜底）→ `shared/volume-plan.ts#parseVolumePlan`，`hasBlockingIssues` 为真时禁止落盘；建章后按实际写入路径 `adapter.stat` 校验非空。
- 章节分配表解析必须统一走 `shared/chapter-table.ts`：不得使用「表头后固定跳过两行」的假设（生成端可能省略 `|---|`）；`outline-contract` 与 `volume-plan` 共用表头 / 分隔行 / 章号单元格识别，避免生成端与建章端两套算法漂移。
- 章节表落盘前必须经 `consolidateChapterTable` 规范化成「表头 + 分隔行 + 升序数据行」；生成端省略分隔行或把分隔行写在末尾时，直接落盘会导致 Markdown 表格无法渲染。
- `extractFieldValue` 的字段结束边界只认行首 `- **字段**`；缩进子项（`  - **沈渊**：…`）属于字段值，不能当作新字段，否则 `人物弧光` / `三幕结构` 会被误判为空并触发整卷重生成。
- 跨卷转折点校验按「预期卷或更早卷出现过即满足」；转折点只发生一次，不能因蓝图 `expectedVolume` 偏差要求后续卷重复书写。
- 全书规划的「降级生成提示」必须以最终卷内容重新执行 `validateVolumeStructure` 后判定，不能沿用生成阶段的旧标记（跨卷修复/全局补全可能已修好）。
- 长卷章节批次并发上限为 3（`OUTLINE_BATCH_CONCURRENCY`）；批次上下文必须传 `buildBatchContext` 的结构化卷级字段，不能只截取概览前 3000 字。
- 章节步骤校验必须先经 `engine/step-validator.ts#normalizeStepMarkup`：AI 输出常用 `**标签**：`，且场景标题可能为 `### sceneN:`、情绪等级可能为小数 `6.5/10`；校验器只按 `## 标签` / 整数等级匹配会把已生成内容误判为未完成。
- 规划步骤的必填字段必须与提示词一致（`plotDistill = 场景节奏设计 / 情节节点规划 / 爽点设计 / 冲突升级路径 / 信息密度指标`）；改提示词字段时同步改 `validatePlotDistill`。
- 规划步骤全部完成后必须推进到 `currentStepIndex = 7`（正文写作）：`engine/planning-step-advance.ts#calcStepIndexAfterPlanning` 是唯一判定入口，`StepRunner` 与视图侧都复用它，避免两套推进规则漂移。
- `characterSoul` 只有在拿到非空角色灵魂层时才允许落盘并标记完成；空数据写空文件会让后续规划与正文失去灵魂层上下文。
- 协同写作本地 AI 调用必须带 `options.numCtx = CO_WRITE_NUM_CTX`（`shared/thresholds.ts`）：不传 `num_ctx` 时 Ollama 按模型自身上下文（deepseek-r1=131072）分配 KV，prefill 实测从 55 秒劣化到 104 秒。
- 质量评分的「维度总分权重 / 维度内子项权重 / 标定乘数 / 理想区间」统一放 `shared/thresholds.ts` 第十二节（`WQE_*` / `QSE_*`）：`WritingQualityEngine` 与 `QualityScoreEngine` 内禁止再写 `0.3`、`* 8`、`15-30 字`这类内联系数。改数值等于改评分，必须同步跑两个引擎的测试；`tests/unit/shared/quality-calibration.test.ts` 会校验每组权重和为 1、引擎权重确实引用阈值表。
- 同人设定的「AI 生成提示词」必须使用 `ui/full-writer/fanfic-settings-utils.ts#buildFanficSettingsContent` 生成的骨架，不得另写一套输出格式：校验器 `validateFanficSettings` 要求 9 个字段**实质填写**（占位「（待补充）」不算）＋两张时间线表各 ≥1 行**真实数据**（口径与 `parseFanficTimeline` 一致：表头、分隔行、整行占位都不算），提示词少一项就会生成失败。向导表单只收集 9 个字段，它的保存与步骤回读统一走 `isFanficSettingsContentValidEnough`（内部 `requireTimelineData: false`）：两侧口径不一致会让「向导保存成功 → 重启 → 步骤被骨架占位行判成未完成」。绑定项目/回读统一走 `.project` 的「## 同人设定路径」，`.project` 缺失时用 `attachFanficPathToProject` 补建并写 `## 类型\nfanfic`。
- 同人约束注入协同写作必须同时给「核心设定（世界观类型/力量体系/核心规则）」与「创作规则」：只注入三条红线时模型知道不许 OOC，却不知道原作力量体系边界，长篇续写会写出体系外能力。统一由 `shared/fanfic-rules.ts#formatFanficRulesForPrompt` 格式化（单条超 `FANFIC_RULE_ITEM_MAX_CHARS` 截断），engine 侧读取走 `readFanficRulesFromFS` 而不是直接拿 `App`；prompt 片段 key 为 `fanfic`（priority 98，高于本章简报、低于剧情节点）。
- 同人项目的实体生成（人物/势力/地点/物品）必须把同人约束前置到「用户描述」之前，统一走 `shared/fanfic-rules.ts#mergeFanficRequirement(fanficBlock, extra)`，禁止各弹窗自己拼字符串：实体卡会成为后续 OOC / 设定矛盾检测的比对基准，漏注入会生成违反原作力量体系的人物，并被长篇流程持续放大。覆盖入口：`generate-character/faction/location/item-modal`、`unified-entity-generate-modal`、`ai-builder-modal`（批次 4 起只保留世界观与人物，单个 + 批量人物按 2 个/批循环时仍携带；势力/地点/物品已统一到 `unified-entity-generate-modal`）。原创项目块为空串，必须原样透传用户描述，不得留下同人痕迹。读取约束块必须走 `ui/fanfic-prompt-notice.ts#readFanficPromptBlockWithNotice`（内部 `Notice(…, 8000)` 提示设定缺失/为空），禁止再直接写 `formatFanficRulesForPrompt(await readFanficRules(...))`：空串与「同人项目本应有约束」在界面上无法区分。全文写作的模板变量（`ui/full-writer/template-vars-builder.ts#buildTemplateVars` 的 `fanficRules`）同样必须走该入口，否则 11 步流水线会在「零同人约束」下渲染模板且不提示。`tests/unit/ui/fanfic-read-entry-guard.test.ts` 是这条不变量的源码守卫：它扫描 `ui/**/*.ts`（剥离注释后）并禁止上述调用形态，新增 ui 入口若绕过会被直接测红。
- 同人设定文件覆盖保存必须走 `ui/full-writer/fanfic-settings-utils.ts#saveFanficSettingFile`（存在则 `vault.modify`），禁止 `delete` + `create`：中间态失败会既丢旧设定、又让 `.project` 指向不存在路径，`readFanficRules` 随后静默返回空规则，全部同人约束失效且用户无感知。
- `.project` 的「## 同人设定路径」只允许由 `shared/fanfic-rules.ts#parseProjectMeta` 解析，禁止在 UI/engine 各写正则（历史上 6 处副本，其中一处只认 `\n`，CRLF 文件解析不到路径）。新增读取方必须复用该函数。
- 同人设定文件的定位必须以 `.project` 记录的**完整路径**为准（`ContextManager#resolveFanficSettingsFile`）：禁止再把该值当文件名传给 `pjFanficFile` 拼 `05-同人设定库`——那会得到「项目/05-同人设定库/项目_05-同人设定库_名字.md」，上下文面板的原作时间线/OOC 规则对同人项目永远为空。旧数据只写文件名时回退到项目自己的同人设定库。面板展示用的 `parseCanonTimelineTable` / `parseFanTimelineTable` / `loadFanficRules` 必须与 prompt 侧同口径丢弃整行占位与占位规则，禁止出现「面板说有约束、prompt 里没有」。
- `finishReason === 'length'` 必须走 `StepRunner#warnIfTruncated` 给用户可见提示：自动续写 3 次后仍截断时，结果可能只有半章；只在 ai-api-client 写 warning 会让用户把半章当完整章节保存。
- 同人设定的「运行时失效」必须在会话中重新提示（`CoWritingView#warnFanficRulesOnce`）：引擎 `syncFanficRules` 每次生成前都会重读并把 `loadError` 写进 `lastFanficRules`，但界面只在 `initEngine` 后提示一次；会话中删除/移走设定文件后 prompt 会静默变成零同人约束。复查点必须覆盖生成收口（`showKnowledgeInjectionNotice`，建议/迭代/改写/流式共用）与两条联想路径（`handleAssociationSuggest` / `refreshGhostAssociation`）。去重键为「项目 + 文案」，警告消失时必须清空，否则同一文案第二次失效不再提示。
- 「同人设定文件存在且可读」不等于「有约束」：`parseFanficRules` 会丢弃占位，全骨架文件解析后六字段/人物/势力/时间线全空。`formatFanficRulesLoadWarning` 必须在无 `loadError` 时也判断有无可注入内容（口径与 `formatFanficRulesForPrompt` 是否输出约束块一致，作品名与路径不算），否则用户只看到「绑定成功」、协同却在零约束下写作。改动该判定时必须同步跑 `fanfic-rules-load-warning.test.ts` 的不变量用例（注入块为空 ⇔ 必给警告）。
- 协同视图的「📚 已注入 N 条知识库片段」提示必须读本次生成写入的 `lastKnowledgeCount`，且 N 是「预算裁剪后完整保留的条数」而不是检索条数：每个会调用 `showKnowledgeInjectionNotice()` 的生成路径（建议三方向 / 迭代 / 改写 / 流式）都要在构造 prompt 之后调用 `recordKnowledgeInjection`，用 `countRetainedPromptParts` 对最终 prompt 文本计数；检索失败或 knowledge 段被整段丢弃写 0。被裁剪的条数写入 `lastKnowledgeDroppedCount`，提示文案必须带上「另 M 条因预算不足未注入」。流式路径漏写会让提示显示上一条建议的旧数字（面板与 prompt 不同口径）；`directionKnowledgeCounts` 仍保留检索总数，用于「知识库未拆解」判定，不能改写成保留数。
- 协同写作的实时质量必须按节流写入 `质量历史.json`（`CoWritingView#persistLiveQualityIfDue`）：只在顶栏显示会让基线/趋势只统计仪表盘手动评估。节流口径：≥300 字、同项目同章 10 分钟一条、在途去重；禁止每次 2.5s 评估都落盘。落盘必须复用本次监控评估的 `QualityScore.v1Result`，不得再调一次 `qualityKernel.evaluate`：重复评估会往 WQE `scoreHistory` 多记一条，污染趋势窗口。没有 `v1Result`（quality 子任务失败 / 评估被取消）时必须跳过本次落盘并记 `warn`，禁止用「再算一次」补偿：此时顶栏显示「质量 --」，补偿出来的分数与 UI 口径不一致，还会额外污染内核历史。生产链路注入 `v1Engine`，成功路径必然带 `v1Result`。
- 异步质量评估返回后必须先经 `isSameQualityEvalTarget` 校验发起/返回时的「项目 + 章号 + 正文路径」：评估期间切章/切项目时，旧正文的分数既不能显示到新章节，也不能写进新章节历史（`persistLiveQualityIfDue` 用的是当前章节字段，不校验就会把上一章分数记到新章）。
- 质量基线必须忽略维度 0 占位，并按 `minSamples` 过滤维度：`parseQualityHistoryRecord` 会把缺失维度补 0，若直接参与均值，所有维度基线会变成 0、当前分恒判「高于基线」。`compareToBaseline` 对样本不足的维度直接不出结论。
- 质量基线的样本单位必须是「章」：`renderBaselineComparison` 先经 `aggregateQualityHistoryByChapter`（同章取最后一次）并排除当前章。直接用原始记录会让协同写作的 10 分钟节流记录把长章节权重放大，且当前章等于和自己比；UI 文案「近N章」必须与统计口径一致。基线样本必须取磁盘全量历史（`baselineHistory`），不能用只保留近 20 条的展示数组 `qualityHistory`，否则按章聚合后样本不足、基线行消失。章节键必须先经 `normalizeChapterKey` 归一化为「第N章」：仪表盘写 `${project}-${chapterName}`、协同写 `第N章`，不统一会把同一章算成两章。
- 内存里的基线样本数组也必须按章收敛，不能只在磁盘写入口收敛：`MonitorPanelB#baselineHistory` 是基线比较与章级趋势唯一的样本源，面板 B 每次打字停顿都会评估并追加一条；只追不合并时 `QUALITY_HISTORY_MAX_RECORDS`（200）会被同一章约 200 次停顿灌满，`slice(-200)` 把其他章挤掉，排除当前章后基线为空、「高于/低于基线」行消失。`addToQualityHistory` 必须先按 `normalizeChapterKey` 找同章旧样本、移除后再追加（配额语义 = 200 章）；展示用的 `qualityHistory` 保持按评估次数，两者口径不同但磁盘与基线必须一致。
- 质量趋势的统计单位必须是「章」，不是「评估次数」：`WritingQualityEngine#calculateTrend` / `QualityScoreEngine#calculateTrend` 取的是最近 5 次评估，协同实时评估约 2.5s 一次，箭头只反映十几秒内的打字波动；协同内核还不随切章清空，方向会跨章串用。展示与落盘统一走 `shared/quality-history.ts#computeChapterTrend`（排除同章记录、前序章按 `aggregateQualityHistoryByChapter` 各取最后一次、至少 2 章才判定、差值 5 分内为平稳）。落盘只在 `services/quality-history-store.ts#appendQualityHistory` 这一处重算并覆盖调用方传入的 `trend`，禁止两个写入口各算一套。
- 协同写作实时质量顶栏在切章时必须清空并中止在途评估（`CoWritingView#resetQualityMonitorForChapterSwitch`）：顶栏文本只在评估返回时更新，而切章不产生评估结果，不清空会让新章加载期间显示上一章分数；新章正文不足 `QUALITY_MIN_EVALUABLE_CHARS` 时评估会直接早退，旧分数会永久停留。短正文分支同样要清空文本与 title 并 `cancel()`，否则删空正文后仍显示旧分数。新增展示实时质量的入口必须复用该重置口径。评估返回 `cancelled` 时必须直接丢弃，不写顶栏也不落盘：取消结果没有有效结论，用它写「质量 --」会把刚清空的空状态变成伪状态。
- 面板 B 的质量展示必须以「可评估」为前提：正文 < `QUALITY_MIN_EVALUABLE_CHARS`（100 字）时 `WritingQualityEngine` 返回 0 分 / D 的空结果，这是「无法评估」而不是「写得差」。`renderQualitySummary` 必须先短路到 `renderQualityNoData`（显示「综合质量 --」+ 原因），不得渲染分数、不得进入 `renderBaselineComparison`；`renderQualityDetail` 同样不得渲染六维 0 分。展示门槛（100）低于落盘门槛（`QUALITY_LIVE_PERSIST_MIN_CHARS` 300），两者不能合并：300 字以下仍需显示分数，只是不入历史。
- 协同实时质量的早退门槛必须与引擎共用 `QUALITY_MIN_EVALUABLE_CHARS`，禁止在视图层另写 50/100：`WritingQualityEngine` 与 `QualityScoreEngine` 在不足该长度时只返回 0 分空结果，视图若用更低的门槛放行，顶栏就会显示「质量 0」，把「无法评估」当「写得差」，还会多跑一次偏离检测。不足门槛时统一清空顶栏并 `cancel()` 在途评估。
- 评估上下文必须真正到达算分的那一层，否则「已加载的数据」等于没加载：`QualityScoreEngine` 注入 `v1Engine` 后六维与总分全部取自 `WritingQualityEngine`，而它的 `evaluate(text)` 只接收文本——`EvaluationContext#characterNames/characterInfos/chapterOutline` 若不在这里同步进内核，人物维度只能走「X说 / X道」正则估算（`details.estimation`），视图刚读完的人物档案完全没用上。现由 `QualityScoreEngine#syncV1Context` 在**读取任何缓存之前**统一注入（`characterNames ?? characterInfos.map(name)` / `chapterOutline` / `mainlineKeywords`），`evaluate` 与 `evaluateDimension` 共用；三样上下文都缺席时不得修改内核，避免把调用方构造时配置的名单覆盖成空。
- 缓存键必须覆盖「会影响结果的上下文」：`dimensionCache` / `fullCache` 只按 `textHash` 建键，人物名单或大纲变化后同一段正文会命中旧分，补了上下文也看不到变化。`syncV1Context` 以「名单 + 大纲 + 主线词」组成签名，签名变化时清空两份缓存；不要把上下文塞进 key（`invalidateCache(text)` 按文本哈希失效，key 变复杂后会让失效逻辑对不上）。
- 协同视图的 `qualityContext` 必须与偏离检测共用同一份上下文对象：`evaluateRealtimeQuality` 只构建一次 `buildDeviationContext()`，再把 `chapterId/chapterOutline/characterInfos` 作为 `qualityContext` 传给 `monitor.evaluate`。分开各读一次会让人物档案/前文缓存被重复读盘，且质量与偏离可能基于不同版本的大纲。新增实时评估入口直接复用该结果，禁止再单独 `await buildDeviationContext()`。
- 质量评分只有一套口径：`QualityScoreEngine` 注入 `v1Engine` 后，六维与总分全部来自 `WritingQualityEngine`，`rhythmAnalyzer` / `emotionAnalyzer` / `characterChecker` 与 `QSE_CALIBRATION` 的 fallback 校准在该路径不可达。因此生产入口（`quality-worker` / `heavy-task-worker-manager` / 协同视图 / 仪表盘）只注入 `v1Engine`，不得再注入这三个分析器：注入了也不会生效，却会让后续维护者以为「逐人物比对已接入质量评分」。`QualityScoreEngine` 构造时若同时收到 `v1Engine` 与分析器会打一次 warn 点名被忽略项；新增入口若触发该 warn，应删掉多余注入而不是删 warn。人物逐条比对（OOC / 外貌矛盾）的职责在 `DeviationDetector`，质量分的「人物一致性」只是内核启发式分，两者不得互相替代。
- 六维展示不能有两轴同源：`readability` 取 `v1.languageQuality.score`，`languageTexture` 必须由 `languageQuality.details` 的 `vocabRichness` / `rhetoricCount` 派生（权重 `QSE_SUB_WEIGHTS.languageTextureFromV1`，系数复用 `QSE_CALIBRATION`），禁止再直接复用同一个 score——否则雷达图把语言质量算两遍，用户会以为两个维度独立变化。派生结果只能来自 V1 已产出的子项，不得在 QSE 内另写一套文本评分；V1 未产出子项（<100 字）时回退原值并在 `basis` 标注。
- 看板（`QualityDashboardModal`）的评估必须与协同视图同源传上下文：人物名册走 `ctxManager.gatherCharacterState` → `toCharacterContextInfos` 并按项目缓存 60s，章节大纲读步骤目录「大纲摘要」（`pjStepDir` + `findChapterFile`），缺失时传 `undefined` 而不是空字符串。评估缓存键必须带 `file.stat.mtime`（`path:mtime`），否则同一弹窗内改稿后刷新仍命中旧分；导出读取缓存也必须用同一键。看板总分取各章 `overallScore`（WQE 加权）的均值，不得把六维再平均一次——六维里 `readability` / `languageTexture` 都源自语言质量，二次平均会放大该维度权重。
- 增量评估的 `changedRange` 必须只影响「人物一致性」维度：变更范围内出现人物名（`canSkipDimension` 为 false）时绕过 `dimensionCache` 重算，变更范围不含人物名时复用缓存；未提供 `changedRange` 时与普通评估完全一致。禁止写出「`if (canSkip) {查缓存} else {查缓存}」这类行为相同的分支——语义没落地却让注释看起来已实现。注意 `dimensionCache` 仍按整段正文哈希建键，因此复用只可能发生在同一正文的重复评估上；注入 `v1Engine` 的生产链路在 `evaluateDimensionInternal` 开头即返回派生结果，不经过该分支。
- V1 内核不是无状态纯函数，禁止跨上下文并发调用：`syncV1Context` 会直接 `updateOptions` 修改注入的 `WritingQualityEngine` 实例，该实例由调用方共享。`QualityScoreEngine` 的 `evaluate` / `evaluateDimension` 必须经 `enqueueEvaluation` 串行执行，新增公开评估入口也一律走该队列，不得直接调用 `evaluateInternal` 或在队列外触碰内核。不要用「按上下文克隆内核」绕过：V1 实例持有 `scoreHistory` 与趋势状态，克隆会切断历史与趋势；队列是单实例下的正确解法。
- 面板 B 的质量历史/基线项目名必须由协同写作同步注入（`MonitorPanelB#setActiveProject` → `resolveProject()`，优先级「注入 > activeFile」）：协同视图没有 activeFile，首次切章时取不到项目，会跳过历史恢复（整章无基线）或沿用上一本书的项目名（跨书污染基线）。新增读取项目名的面板逻辑一律走 `resolveProject()`，禁止再直接拼 `getActiveProject() || ...`。
- UI 弹窗的项目必须由调用方显式传入，禁止在弹窗里回落到 `getActiveProject()`：`PolishAIPolishModal` 曾用 `projectPath || plugin.getActiveProject()` 兜底，而工作台/协同视图不是 Markdown 文件，兜底会取到 null 或别的书，把错误书的指纹风格套到本章正文。现在构造函数第 6 参 `projectPath: string` 为必传（类型检查保证调用方不漏传），由 `PolishEditor.render(..., project, ...)` 传入当前章节所属项目；新增需要项目上下文的弹窗沿用「构造必传」而不是「内部猜 activeFile」。
- 协同写作视图是单例，无显式章节上下文的入口必须调用 `CoWritingView#clearChapterBinding()`：`activateCoWritingView()` 无参时只 `revealLeaf` 会让 `project/chapterNum` 停在上一本书，自动保存、建议与面板继续按旧身份工作。`clearChapterBinding` 先按旧身份冲刷排队保存（失败则中止），再清空身份、编辑器、建议、指标与 `tractionEngine` 并显示「未绑定章节」；`main.ts` 与 `core/command-registry.ts` 两份入口必须保持一致。
- 面板 B 的切章冲刷必须显式指定「记录所属项目」（`persistQualityHistory(true, currentBaselineProject || resolveProject())`）：切书时调用方已把 `activeProject` 换成新书，`qualityHistory` 里的最后一条仍属于旧书；若冲刷用 `resolveProject()`，旧书记录会被写进新书的 `质量历史.json`。凡是在身份切换前冲刷待写数据的地方，都要用「数据产生时的身份」而不是「当前身份」。
- 面板类视图的 `onClose()` 必须「先冲刷、再释放、后走基类」：`MonitorPanelB#onClose` 先 `persistQualityHistory(true, currentBaselineProject || resolveProject())`（节流窗口内的最后一条不再丢，且写回记录产生的项目——A 书写作后切到 B 书文件再关闭面板，不能把 A 书记录写进 B 书），再 `dispose()`（停掉防抖计时器，避免回调持有已脱离 DOM 的引用），最后 `await super.onClose()`（摘 document 监听 + 保存布局）。新增面板若定义了 `dispose()` 而没有 `onClose()` 调用它，等于没有生命周期管理。
- `qualityContent.empty()` 会连带移除详情面板，`qualityDetailPanel` 引用却仍非空：任何清空摘要区的路径之后都必须调用 `ensureQualityDetailPanel()`（已挂载则复用、已脱离则重建），否则展开的详情在每次评估后消失。新增详情面板的创建点同样只能走该函数，禁止再直接 `createDiv` 建第二个 `nw-quality-detail`。
- 面板 B 的完成度 / 偏离展示同样必须以「可评估」为前提：正文 < `PLOT_COMPLETION_MIN_EVALUABLE_CHARS`（50 字）时 `PlotCompletionEngine` 返回六维全 0 的空结果，展示成「0分 · 待开始」；正文 < `DEVIATION_MIN_EVALUABLE_CHARS`（100 字）时 `PlotDivergenceEngine` 返回 `0% / normal`，展示成「无偏离」——空章会被读成「完全贴合大纲」。两条路径都必须先短路到 `render*NoData`（显示「--」+ 原因），且不得写入 `history` / `divergenceHistory`、不得触发偏离预警；`render*Detail` 也要有同样的守卫，禁止渲染全 0 的假维度。门槛只允许在 `shared/thresholds.ts` 定义，引擎与面板共用。
- `completionContent.empty()` / `divergenceContent.empty()` 与质量同理：必须经 `ensureCompletionDetailPanel()` / `ensureDivergenceDetailPanel()` 重新挂载详情，禁止在 `show*Detail` 里另建第二个面板。
- 用户可见通知只能用 `new Notice(...)`（`import { Notice } from 'obsidian'`）：Obsidian 没有 `app.notice.addNotice` 这个 API，写成 `(this.app as any).notice?.addNotice?.(...)` 时可选链让调用恒为 `undefined`，类型检查也不会报错，功能会静默失效（面板 B 的偏离预警、质量提醒、里程碑曾全部只写日志）。新增通知一律复用该 API，并保留应有的冷却/去重。
- 会调用 AI 的「实时」检测必须有触发门槛，且触发源不能被合并：协同写作的设定守卫（OOC / 实体状态变更）在 `input` 路径每次停顿 8 秒就触发，而 `EntityStateManager.detectStateChanges` 每次都把正文前 6000 字发给 AI。现要求 `input` 触发满足「正文新增 ≥ `GUARD_INPUT_MIN_GROWTH_CHARS`（300 字）或距上次 ≥ `GUARD_INPUT_COOLDOWN_MS`（5 分钟）」，`insert` / `save` / `manual` 不限制；检查失败也要记录时间戳，避免失败后每次停顿重试。`GuardTrigger` 必须包含 `'input'`——曾把 input 写成 `trigger === 'save' ? 'save' : 'insert'`，导致任何按触发源节流的逻辑都无法生效。新增实时 AI 检测入口先回答「多久触发一次、每次发多少字」。
- 协同写作派生的 AI 检测必须走协同模型通道，不得固定 `settings.flashModel`：`EntityStateManager#detectStateChanges` 的模型由调用方通过 `options.model` / `options.callOptions` 指定，`CoWriterEngine#trackEntityStates` 必须传 `getCoWriteModel()` 与 `getCoWriteOptions()`（含 `disableFallback` / `numCtx` / 本地 endpoint）。用户把协同切到本地 Ollama 后，OOC 检测走本地、实体状态检测却仍打云端，是「以为全本地、实际在计费/联网」的隐性依赖；离线时该路径直接失败，角色档案静默不更新。未配置协同模型时才回退 `flashModel`（保持旧行为）。新增任何「由协同正文派生」的 AI 子任务（实体状态、伏笔提取、场景摘要等）都按此口径传模型与调用选项。
- 高频「按时间」重复发同样内容的 AI 请求必须改成「按内容变化」触发：协同侧边栏的剧情完成度此前只按「距上次 ≥10 秒」节流，`autoPlotEvaluation` 默认开启时打字期间每分钟最多 6 次 `evaluatePlotComplete`，每次都把整章正文拼成约 9.6k token 的 prompt，而正文往往只多了几十字。现统一走 `shared/plot-eval-throttle.ts#shouldRunPlotEval`：同一章节正文签名（章节身份 + 长度 + FNV-1a）未变直接跳过；有变化时要求「新增 ≥ `PLOT_EVAL_MIN_GROWTH_CHARS`（300）或距上次 ≥ `PLOT_EVAL_COOLDOWN_MS`（2 分钟）」，且两次请求至少间隔 `PLOT_EVAL_MIN_INTERVAL_MS`（30 秒）；换章与 `force`（手动重试、生成完成）不受限。新增「实时评估」入口先回答「输入不变时会不会再请求一次」。
- 实时监控里的分析器默认必须本地可算，AI 只能作为显式开启的增强项：`MonitorPanelA#refreshWithBody` 在每次「输入停顿 2.5 秒 / 插入建议 / 保存」时都会整章重算，`EmotionCurveAnalyzer` 曾对每个 800 字片段无条件调用一次 AI（`flashModel`），4000 字正文 ≈ 每 2.5 秒 5 次请求、长章更多，且串行 await 会让面板持续卡顿。现情绪曲线统一走本地关键词词典，并按片段内容哈希缓存（正文尾部增长只重算变化片段）；`RhythmAnalyzer#estimateTension` 同样只用关键词规则。此前的 `enableDetailedAnalysis` 开关没有任何 UI 写入方、两处 AI 分支不可达，已连同开关一起删除（`EmotionCurveAnalyzer` / `RhythmAnalyzer` 构造不再接收 `aiEngine`）。新增任何「随打字重算」的分析器，先确认它在最坏情况（整章正文 × 每次停顿）下的请求数：默认路径不得含 AI；若确需可选的 AI 增强，必须同时提供 UI 写入方、片段缓存与单次预算，否则不要写分支。分析器实例由 `MonitorPanelA` 自己持有（`facade.createEmotionCurveAnalyzer` / `createRhythmAnalyzer`）；`CoWritingView` 不得再创建仅写不读的同名实例（Rev 104 已删除 `emotionCurveAnalyzer` / `rhythmAnalyzer` 两个字段，它们只被赋值、从未被读取）。
- 面板/卡片展示的状态必须来自真实数据源：面板 B 曾创建 `StyleLearner` / `PreferenceMemory` 却从不读取，`refreshStyle` / `refreshPref` 全仓无调用方，两张卡永远停在「写作中自动学习/记录」。这类占位卡会使用户误判功能已生效；要么接线到唯一实例并渲染真实状态，要么删除。注意 `PreferenceMemory` 在 `CoWriterEngine` 内另有实例，面板自行 `new` 一个只能看到空数据，不能作为数据源。风格学习与偏好记忆的实际消费在 `CoWriterEngine` / `PromptBuilder`。
- 同一能力只能保留一个展示点与一个引擎实例：面板 B 曾自建 `EndingTractionEngine` 并 `initialize(project)` 渲染「🏁 结局牵引」卡，但刷新方法 `refreshTraction` 全仓无调用方、卡面永远停在占位；协同主视图已有自己的 `tractionEngine`（`facade.createEndingTractionEngine`）并由 `ui/cowrite/live-analysis-controller.ts#renderTractionPanel` 真实渲染「🎯 情节牵引」。重复建引擎不仅多一份内存，规则解析失败时还会多打一次 AI `parseThreadsWithAI`。判断「某个卡/引擎是不是死的」必须先 grep 全部消费方（包括其他视图），确认真实展示点在别处后再删重复实现，不能把唯一的真实实现一起删掉。
- 知识库技巧注入必须按 `category` 去重且最多 5 类（`KnowledgeInjector#buildKbTechniqueInjection`）：写成 `!has(category) || length < 5` 会恒为真，同一技巧重复占满 prompt 预算；缺 `category` 的样本统一归「通用技巧」。
- `KnowledgeSearchResult.position` 是分块数组下标（0 基），不是 0–1 相对位置：任何展示/注入都必须走 `shared/knowledge-position.ts#formatKnowledgeChunkLabel`，禁止 `position * 100`（会产生「位置4500%」并挤占本地小窗口预算）。
- 指纹强度配置（`projectFingerprintIntensityFile`）必须先读盘再使用：`StyleFingerprintLibrary#getIntensityConfig` 只查内存 Map，任何读取方（`PromptBuilder#getFingerprintPromptParts`、强度弹窗打开处）都必须先 `await loadIntensityConfigs()`，否则重启后一律回落默认 1.0。`set/removeIntensityConfig` 也必须先读盘再写，否则会把其他指纹已保存的强度整份覆盖。`loadIntensityConfigs` 禁止做实例内缓存：强度弹窗与协同引擎各自持有库实例，缓存会导致「弹窗改完、协同 prompt 仍用旧强度」。配置写入异常必须上抛到调用方，禁止 `catch` 后正常返回：否则 UI 会提示「已保存」，用户重启才发现设置丢失。
- 「禁用指纹」有两条判定源，过滤样本时必须同时满足：`StyleFingerprint.enabled`（列表开关）与强度配置 `previewIntensity(config).disabled`（`globalIntensity === 0`，界面语义为「完全禁用」）。只查 `enabled` 会让强度 0 的指纹在全局层描述消失后，其向量样本继续以「参考片段」注入——正文仍受该指纹影响。过滤点在 `PromptBuilder#getFingerprintPromptParts`（`disabledFpIds`）；`fingerprintId` 缺失的旧数据无法判定归属，保持放行。
- 指纹启用状态的唯一真相源是指纹库（`listProject()` / `listGlobal()` + `isGlobalEnabledForProject()`），禁止读 `WritingProfile.fingerprint.enabledProject/enabledGlobal`：这两个数组在全仓没有写入方（默认 `[]`，只能手改画像文件），只读它会让注入永远为空。消费点必须同时按强度 0 过滤：`KnowledgeInjector#getEnabledFingerprintsFromLibrary`（正文/大纲/情绪/润色的风格段）与 `PolishAIPolishModal#loadFingerprintStyleHint` 均已按此口径；新增消费点照抄该形状，不要另建一套 id 列表。这两个字段已从 `FingerprintConfig` 删除（Rev 100）：旧画像文件里的同名键在 `normalizeFingerprint` 中被忽略、再次保存不会写回；`templateInherited` 与 `injectionStrength` 保留（注入链仍在消费）。若要重新引入「启用副本」，必须先证明存在唯一真相源之外的合法需求，并同时补写入方与多实例同步，否则只会再次制造「开关永远不生效」。
- 指纹风格段不得嵌在 `buildStyleInjection` 的风格详略分支里：`injectionStrength` 默认 0.5，而详略分支是 `<0.3 / <0.7 / else` 三段，写在 `else` 里等于默认配置永不注入。指纹是否生效由指纹库的 enabled + 强度配置决定，详略只控制「整体风格/视角/用词倾向」这些描述的行数；两者必须解耦（现为 `buildFingerprintLines()`，在三分支之后统一追加）。
- `template` 层指纹是「来源库」而非注入层：三个 UI 入口（`ui/views/writing-fingerprint-view.ts`、`ui/settings-tab.ts`、`ui/mini-settings-modal.ts`）都必须用 `ui/fingerprint-utils.ts#isSourceOnlyFingerprintScope(scope)` 判定并隐藏「启用/禁用」「强度调节」——这两个状态对 template 没有任何消费方（注入链只取 project/global，`copyFingerprint` 固定 `enabled: true`）。列表项改为显示「来源库 · 复制到项目后生效」，详情弹窗不传 `onToggle` / `onOpenIntensity`；新增入口禁止再给模板挂这两个控件。
- 指纹向量检索结果必须携带 `fingerprintId`（`VectorStore#search`）：`LocalVectorStore` 的 `vectors` 是 `Map<fingerprintId, samples>`，遍历时必须回填 Map 键。丢弃归属会让 `DynamicSampleSelector` 把所有样本当成同一指纹，触发「同一指纹最多 2 条」上限，请求 topN=3 实际只返回 2 条；同时上游无法过滤已禁用指纹的向量（禁用只改标记、不删向量文件，样本仍会注入 prompt，禁用等于无效）。新增向量存储实现同样必须回填。
- `LocalVectorStore` 禁止把「首次读盘」当永久缓存：指纹库 UI 与协同引擎各持一个实例，前者新增/重建指纹只更新磁盘。`ensureLoaded` 必须按「embedding 指纹 + 路径 + mtime + size」签名判断是否需要重载（Rev 157）；目录不可读时保留内存旧向量而不是清空，重载成功前才 `clear()`。
- `LocalVectorStore` 的向量文件同样必须记录 `modelId`：加载时模型不一致只跳过该指纹（不删文件，重新提取即可重建，`getModelMismatches()` 可查），模型未知时不落 `'unknown'`；`search` 必须跳过维度与查询向量不一致的样本。`cosineSimilarity` 在长度不等时会 `throw`，而 `PromptBuilder#getFingerprintPromptParts` 会 catch 成空数组——不跳过时的表现是「换 embedding 模型后写作指纹风格参考整段静默消失」，不是报错。
- 所有 embedding 客户端必须经 `EmbeddingProviderFactory` 构造（高频路径 `fromSettings`，启动期 `createWithFallback`），禁止在业务代码里 `new OllamaEmbeddingClient(...)`：插件支持 Ollama / OpenAI / 豆包 / 通义四种向量提供商，硬编码 Ollama 会让「写入向量的模型」与「查询向量的模型」不一致——用户没开本地 Ollama 时检索直接失败，开着时维度/模型不一致（Rev 106/107 之后被跳过，表现为注入静默消失）。新增消费 embedding 的引擎/视图一律把 `plugin.settings` 交给 `fromSettings`；具体 provider 只允许出现在工厂与测试里。
- 指纹提取/重提的 UI 入口（设置页、mini 设置、小说分析、`RefillModal`）必须经 `ui/fingerprint-embedding.ts#createFingerprintEmbedding(app, scope, settings, project)` 成对构造 provider 与 `LocalVectorStore`，禁止再出现 `new LocalVectorStore(app, scope, new OllamaEmbeddingClient(...))` 或手抄一长串工厂参数：`LocalVectorStore` 的 provider 决定写入向量用哪个模型，漏传/写死会让 UI 写本地、检索读云端，被模型治理跳过（表现为新增的指纹永远不生效）。`RefillModal` 缺少 `embeddingSettings` 时必须提示并中止，不得回退默认 Ollama；`template` 作用域映射为 `global` 存储的规则集中在调用点。
- 「重向量化」必须与「重新拆解 / 重新提取指纹」分离：`services/vector-rebuild-service.ts#rebuildAllVectors` 只把已有样本文本按当前 embedding 模型重算，禁止在其中触发 AI 拆解或重新采样。指纹重算必须先 `delete` 再 `add`——`LocalVectorStore#add` 是追加语义，直接重算会让同一样本翻倍。单条失败只记入报告、不得中断其余条目；`DeconstructionScheduler#revectorizeBook` 在向量存储缺失时必须抛错，不能沿用拆解流程的静默跳过，否则 UI 会把「没做成」报成成功。两个入口（设置页 / mini 设置）必须共用 `ui/vector-rebuild-action.ts`，禁止各写一份。
- 伏笔告警必须优先按「计划回收章」分层：`ForeshadowTracking.expectedRecoverChapterNum` 由 `engine/foreshadow-context.ts#applyPlannedRevealChapters` 从伏笔库「回收章节」补齐（按规范化名称最长匹配、已有值不覆盖），没有计划章时才回退全局 `foreshadowRecoverChapters`。已逾期 → critical，剩余 ≤ `FORESHADOW_APPROACHING_CHAPTERS` → warning，当前章早于埋设章必须跳过。`DeviationIssue.degree` 必须与 severity 单调：warning 封顶 59、critical 从 60 起——禁止再写 `35 + distance * 3` 这类在大阈值下会越过 critical 下限的公式。新增伏笔读取入口同样必须合并追踪器与伏笔库两份数据，只读其中一份会让分层失真。
- `StyleFingerprintLibrary` 的指纹列表同样不能只在 `init` 加载一次：新增/删除/启用/禁用都由指纹库 UI 的另一个实例写盘。`CoWriterEngine` 必须在每个生成入口经 `syncFingerprints` → `reloadIfChanged`（全局指纹 + 项目指纹 + 项目启用状态的文件签名）刷新；不刷新时新指纹会被「按启用状态过滤」误杀，禁用也不会生效。
- `KnowledgeVectorStore` 同样不能只认一次 `loaded`：拆解调度器写入的是 `EngineRegistry` 单例，协同引擎持有另一个实例。`init` / `ensureLoaded` 必须走「embedding 指纹 + 路径 + mtime + size」签名（排除 `index.json`，Rev 157）；重载成功前不得清空内存旧向量。
- `KnowledgeVectorStore#loadIndex` 必须校验书籍是否仍在知识库（`kbBookDir(bookName)` 是否存在），缺失则跳过该向量文件：`deleteBook` 只覆盖经管理器的删书，重新导入会换 `bookId`、用户在文件管理器直接删目录也不触发清理，遗留的 `kb_*.json` 会继续被检索并把已删除的书注入 prompt。校验只在知识库根目录存在时生效——整个知识库被移动/重命名时保持旧行为，避免把有效向量全判成孤儿。只跳过加载、不删文件。
- `KnowledgeVectorStore` 的向量文件必须记录生成时使用的 embedding 模型（`modelId` / `dimensionCount`），`loadIndex` 与 `rebuildIndex` 共用同一套一致性判断：模型不一致（且当前模型已知）只跳过该书、不删文件——知识库原文仍在，重新拆解即可按新模型重建；旧文件没有 `modelId` 时按兼容策略加载（重建后补齐）。`search` 必须跳过维度与查询向量不一致的样本：`cosineSimilarity` 在长度不等时会直接 `throw`，不跳过会让一个旧向量把整次知识检索打成异常。禁止为了「换模型后立即可用」而删除旧向量文件或用默认向量占位。
- `DeconstructionScheduler#vectorizeBook` 的原文分块与拆解报告维度必须**取并集**，禁止二选一：风格/节奏/技巧/结构/人物/伏笔只存在于报告文件里，原文只提供句法质感。只写 `original` 会让「风格参考 / 节奏参考 / 技巧参考」三轮注入整段消失；只写报告维度会让「原文片段」恒空。各 `extract*Samples` 读不到文件时返回空数组，缺失场景无需额外分支。
- 拆解完成 ≠ 检索可用（A5）：`BreakdownTask` 与 `BookBasicInfo` 必须分别记录 `vectorStatus`（`pending / done / failed`）与 `vectorError`，向量化结果只能经 `DeconstructionScheduler#recordVectorOutcome` 写回（成功 `done`、失败 `failed` + 原因）；失败必须发 `vector` 降级事件并让完成 Notice 明确提示「向量化失败，可在知识库详情重试」。`breakdownStatus` 保持 `completed`（拆解本身确实完成），禁止用「拆解完成」掩盖向量失败；`revectorizeBook` 是唯一重试入口，成功后写 `done`、失败写 `failed` 后继续抛错。旧数据没有 `vectorStatus` 时显示「未记录」，不得默认当成 `pending` 或 `failed`。
- 文风注入（`KnowledgeInjector#buildKbStyleInjection`）中 `style` 与 `original` 必须分维度检索并按配额合并：两者样本量差 20 倍以上（原文每本最多 120 块、风格每本约 5 条），同一次 topN 里原文必然占满、风格分析样本归零。风格配额 `max(1, round(topN/3))`，原文占其余并照旧做相邻去重；某一维度为空时用另一维度补齐，保证总条数不缩水。
- 知识库检索只允许使用拆解真实产出的维度（`style / rhythm / technique / structure / character / foreshadow / original`）：`search({ dimensions })` 传未产出维度（如 `worldview`）会恒返回空，且 `dimensions?: string[]` 不会报类型错误。新增注入段必须复用已有维度，或先给拆解增加对应维度与向量提取。
- 原文分块注入必须先经 `shared/knowledge-position.ts#dedupeAdjacentChunks`：原文按 400 字 / 40 字重叠分块，同一本书 position 相邻的块含重复文本，同时注入等于重复占预算。检索量要按目标条数的 2 倍取，再去重截断，避免去重后条数不足。该规则同时适用于 `KnowledgeInjector#buildKbStyleInjection` 与 `PromptBuilder#getKnowledgePromptParts` 的「原文片段」段（后者曾直接 `slice(0, 3)`）。
- 知识库各注入段的检索维度必须互斥：`buildKbTechniqueInjection` 只取 `technique`，`structure` 只由设定段消费。混在一起会让「起/承/转/合」占满技巧的 5 个类别名额，并让同一段结构文本重复进入 prompt。`PromptBuilder#getKnowledgePromptParts` 同理：技巧参考的检索与消费都只允许 `technique`，不允许把 `structure` 并入 `techniqueResults`（默认方向会直接 `slice(0, 3)`，结构类别会以「技巧：起」的形式进入 prompt 并挤掉真实技巧）；某本书没有技巧样本时该段为空，不得拿结构冒充。
- 协同必保前文长度必须走 `shared/prompt-budget.ts#resolvePrecedingCharLimit(maxInputTokens?)`，禁止再写死 `slice(-800)`：快照保留 2000 字，写死 800 会在本地 8K 窗口下丢掉 1200 字且无日志。取值按输入预算 20%、中文 1.5 字符/token 换算并夹在 `[800, 2000]`；无预算时保持 800，避免改变旧调用行为。新增协同入口若带「已写内容」必保片段，同样走该函数。
- `DynamicSampleSelector#select` 的「同一 fingerprintId 最多 2 条」只对**有归属**的样本生效：`fpId` 缺失时不计数，否则所有未知来源样本会互相挤占名额，返回条数少于 topN。
- 所有向量检索必须经 `shared/retrieval-filter.ts#filterRetrievalResults` 再做 `slice(0, topN)`，禁止「排序后直接截断」：`minScore` 在生产链路没有调用方，低分样本会照样进入 prompt，在本地 8K 窗口下挤占真正相关的内容。口径为「最高分 × `RETRIEVAL_RELATIVE_MIN_SCORE`(0.85)」与绝对下限 `RETRIEVAL_ABSOLUTE_MIN_SCORE`(0.15) 取大者；`score` 非有限值先剔除（NaN 参与排序不可靠），最高分低于绝对下限整体返回空，至少保留最高分。**多维度合并检索（style/rhythm/technique 一次查出）必须用 `filterRetrievalResultsByScope(results, 'perDimension')`**：全局阈值会让 0.45 的 rhythm 被 0.6 的 style × 0.85 整段丢弃。新增检索入口（含未来的重排/混合检索）同样要走该函数或显式说明例外。
- 偏离总评（`DeviationDetector#calculateOverallScore`）只能取「最严重单条 `issue.degree`」：各类型分数本身就是该类最严重一条 issue 的 degree，任何按类型加权平均都恒 ≤ 最严重单条，再与最严重单条取 max 后加权平均永不生效（恒等变换，等于死代码）。禁止重新引入「类型权重表」制造虚假精度；「面」（多类型同时偏离）由 `listDeviatedTypes(typeScores, unevaluatedTypes)` 在 UI 单独展示（协同顶栏「N类异常」+ title 列出类型），不计入分数。无问题时最严重值为 0，空报告不得因此变成非 0。
- 缺数据源的偏离类型必须同时列入 `DeviationReport.unevaluatedTypes`，禁止只用 `typeScores = 0` 表示：没有人物档案时人物 OOC、没有伏笔数据时伏笔遗忘、没有期望节奏时节奏偏离、没有大纲/主线关键词时主线偏离，检测方法都会返回空数组。UI 不得把这类 0 分显示成「已检查且无问题」——协同顶栏必须显示「N类未评估」并在 title 列出具体类型。新增偏离类型时同步扩展 `getUnevaluatedTypes` 的数据源判定；正文不足 100 字仍是整份报告不成立（`unevaluatedTypes` 为空，由「暂不检测」路径处理）。
- 质量基线的 0 占位口径必须总分与维度一致：`computeQualityBaseline` 的总分与各维度都排除 `0`（旧记录/空评估的占位值），只保留有限正数；剔除 0 后有效样本不足 `minSamples` 时返回 `null`，宁可不出结论。只过滤非有限值会让 0 分旧记录拉低基线，当前章节恒判「高于基线」，且样本数虚高更容易越过门槛。
- 人物相关的本地检测（OOC 行为词、外貌/设定矛盾）必须按「包含人物名的段落」判定共现，禁止整章 `text.includes(name) && text.includes(keyword)`：中文网文常用单换行分段，段落切分必须是 `/\r?\n+/`（只按空行切等于把整章当一段）。新增检测项若需要人物上下文，统一走 `extractCharacterParagraphs` / `findCharacterKeywordSnippet`，否则「配角金发」会被算到主角头上。`DeviationDetector` 与 `CharacterConsistencyChecker` 两份同名实现必须同为 `/\r?\n+/`：V1 checker 的结果会同时进入偏离 UI 与质量分，只修一处等于误报仍在另一条链路生效。人物性格解析必须同时接受标签与关键词（`resolveConfiguredTraits`）：`PERSONALITY_TRAITS` 的键是「沉稳/内向/聪明」，用户常写「冷静/沉默/机智」，只匹配键会让性格与行为检测整类静默。情绪断层（`detectEmotionBreak`）的段落统计同样必须用 `/\r?\n+/`：它按「连续 N 段无情绪元素」判定，只按空行切会把整章当成 1 段并在 `<3 段` 处直接返回，情绪断层在真实正文里永远为 0 条且不会进入 `unevaluatedTypes`（等于用 0 冒充无问题）。
- 设定矛盾在「当前章 + 多章前文」范围内必须按「人物 + 矛盾词」去重：前文窗口扩到 3 章后，同一人物同一反义外貌词若连续几章出现，逐章各报一条会把 1 个问题显示成 3 个严重问题。去重顺序为当前章优先，其次按章号降序取最近的前文证据；不同人物或不同矛盾词必须各自保留，禁止用「人物名」或「矛盾词」单键去重。去重集合必须建在**人物维度**、跨 `APPEARANCE_CONTRADICTIONS` 各组共用，且当前章与前文两条路径都要先查集合再查证据：设定同时提到「黑发」「金发」时，两个组都把「白发/银发/红发」列为反义词，组内各自去重会产出 id 相同的重复 issue。
- 协同实时监控与 `quality-worker` / `heavy-task-worker` 必须给 `DeviationDetector` 注入同一组纯计算引擎（`PlotDivergenceEngine` + `CharacterConsistencyChecker`）：不注入会退化为简化关键词回退，同一段正文在实时顶栏与 worker/分析路径得到不同 OOC/主线结论；`rhythmAnalyzer` 依赖主线程 AI 能力，三处都不注入。新增监控入口时按此接线，并保住「同一文本同一结论」的不变量。
- V1 人物 OOC 的 `degree` 必须不低于其 issue 严重度对应的阈值：`CharacterConsistencyChecker` 的角色分是「多问题累计扣分」（单条 high 只扣 `15 × confidence`），由 `100 - score` 推出的偏离度会远低于 critical 阈值，而 `mapV1Severity` 按 `inc.severity` 直接判 critical。`detectCharacterOOC` 的 V1 路径必须按 high → `severityThresholds.critical`、medium → `severityThresholds.warning` 设下限（low 不抬升、上限夹紧 100），保证 `severity` 与 `degree` 单调一致，否则顶栏会出现「偏离 15 · 严重」这种自相矛盾的展示。调整 `calculateCharacterScore` 的惩罚权重不会让该下限失效；新增 OOC 来源（如未来的同人一致性）必须遵守同一映射，禁止只给 severity 不给 degree 下限。
- V1 不一致自带的定位信息必须保留到 `DeviationIssue`：`CharacterConsistencyChecker` 在每条 `InconsistencyItem` 上写 `location`（「第N段附近」），`detectCharacterOOC` 必须把它落进 `evidence`，`location.character` 只放人物名。禁止写 `inc.location ? { character: name } : { character: name }` 这类恒等三元——它会让位置信息被静默丢弃，报告无法溯源到段落，也掩盖了「字段存在却没使用」的事实。
- 实时监控的失败必须显式告知，禁止把「没测成」显示成「没问题」：`RealtimeMonitor` 的 `failures` 必须在**任何**失败时返回（含质量与偏离都失败），不能只在 `partialFailure` 时给出；协同顶栏必须在 `deviations` 缺失且有失败时追加「偏离检测失败」，两项都失败时显示「质量评估失败（…）」而不是「质量 --」——后者与「正文不足 100 字、暂不评估」同形，用户无法区分。面板 B 不走 `RealtimeMonitor`，其 `runCompletionEval` / `runDivergenceEval` / `runQualityEval` 的 `catch` 必须经 `renderEvalFailure` 清空卡片并显示「--」+「本次评估失败」，禁止只写日志而保留上一次的分数（切章后会被误读成当前正文的结论）；三张卡必须同口径，只修其中一张等于另外两张仍在误导。新增监控消费方（未来的批量分析视图）同样必须区分「未评估」「评估失败」「真实结论」三种状态。
- 跨章设定一致性只由 `DeviationDetector#detectSettingContradictions` 负责；`CharacterConsistencyChecker#check(chapterText, characterInfos)` 只做「当前章 vs 人物档案」，禁止再接收 `historyTexts` 这类无实现承诺的参数（曾接收但函数体内从未使用，三处调用方仍在传，等于 API 假装支持跨章 OOC）。**接口层同样不得声明**：`QualityScoreEngine` 的 `ICharacterChecker.check` 曾保留 `historyTexts?: string[]`，实现类早已删参，属于「实现已诚实、接口还在撒谎」，任何新增声明都会让调用方误以为可以传前文。`EvaluationContext.previousChapterText` 已随该参数删除；若将来要做跨章人物行为对比，应新建显式维度并给出不误报的回归用例，而不是恢复该参数。
- 协同写作的 `refreshStaticContext` 禁止直接整体替换 snapshot：`buildSnapshot` 会把 `fanficRulesContext` / `longTermMemoryContext` / `crossVolumeContext` 置空、`relationshipStates` 置空数组，而这些字段由 `init` 阶段单独加载。刷新必须保留这四个字段，否则同人约束与长篇记忆会静默消失直到重新加载章节。
- 同人约束必须覆盖协同的**全部**生成入口：续写（`buildSuggestionPrompt`）、选区改写（`buildRewritePrompt`）、建议迭代（`buildIteratePrompt`）、联想（`buildAssociationPrompt`），统一由 `getFanficRulesPromptParts` 提供 priority 98 片段。新增协同入口必须一起接，否则同人项目会出现「续写守规则、迭代/联想不守」的不一致。
- 同人设定文件里出现的结构必须能被读取侧消费：模板与生成骨架都有「## 主要人物」「## 势力组织」，`parseFanficCharacters` / `parseFanficFactions` 必须解析它们、`formatFanficRulesForPrompt` 必须分别注入「【原作主要人物】」「【原作势力组织】」（各最多 6 条、单字段 60 字），否则用户填了人物/势力表，模型仍只知道规则不知道谁是谁，同人正文照样 OOC。占位「（待补充）」必须在解析阶段丢弃，禁止让它变成 prompt 里的真实条目：人物/势力条目在 `parseFanficEntrySection` 丢弃，六个字符串字段（世界观类型 / 力量体系 / 核心规则 / 三条创作规则）在 `parseFanficRules` 的 `pick` 里丢弃；整份设定全是占位时 `formatFanficRulesForPrompt` 必须返回空串，不能输出「【同人创作约束（最高优先级，违反即返工）】」空壳。向导回填仍走 `extractFanficRuleValue` 保留原文占位，不能用过滤后的值覆盖输入框。新增同人设定小节时，同步补解析、注入与「占位不注入」的回归用例，禁止只改模板。「## 原作剧情时间线」「## 故事背景时间线（你的同人）」两张表格同理：模板表头写明「全量输入」，读取侧必须经 `parseFanficTimeline` 解析（丢弃表头、`|---|` 分隔行、整行「待补充」），`formatFanficRulesForPrompt` 分两段注入「【原作剧情时间线】」「【同人时间线】」，上限 `FANFIC_MAX_INJECTED_TIMELINE_ROWS`(8) 行 / 单行 `FANFIC_TIMELINE_ROW_MAX_CHARS`(120) 字——「全量输入」指数据源不截断到样本，不等于可以无视本地 8K 窗口把整张表塞进 prompt。
- 同人设定必须在每次生成前经 `CoWriterEngine#syncFanficRules` 重读（读 `.project` + 设定文件两个小文件），不得只在 `init` 时缓存：用户在会话中编辑设定后不切章也应立即生效。读不到时按无约束处理并清除旧块，禁止保留已失效的原作规则。
- 同人设定加载失败不得静默：`FanficRules.loadError` 必须区分 `missing-path` / `missing-file` / `read-failed`（`readFanficRules` 与 `readFanficRulesFromFS` 同口径，FS 版先 `exists` 再 `read`），由纯函数 `formatFanficRulesLoadWarning` 生成提示，协同视图在 `initEngine` 后调用一次 `warnFanficRulesOnce()`（按「项目 + 文案」去重）。空规则意味着「无原作约束」，只写 `log.info` 会让用户误以为约束仍生效。新增读取入口不得省略 `loadError`。
- 同人设定的绑定只有一条写入口 `attachFanficPathToProject`：任何「绑定已有文件」的 UI 必须先确认文件存在且非空，再回写 `.project`；候选筛选统一走 `shared/fanfic-binding.ts#listFanficSettingCandidates`（只收本项目 `05-同人设定库` 与全局 `元文件/05-同人设定库` 下的 `.md`，归一化反斜杠与冗余斜杠、去重、排除当前已绑定文件）。允许绑定字段不完整的文件（用户随后在向导补全并覆盖保存），但必须提示缺失字段；禁止把不存在的路径写进 `.project`，否则会落到 `missing-file` 静默无约束。入口不限于向导：命令面板 / 全本工作台打开的 `AddFanficSettingModal` 同样必须提供「使用已有设定文件」区（候选与绑定共用同一纯函数与写入口），否则用户只能重新生成或手改元信息。
- 同人设定字段的解析只能走 `shared/fanfic-rules.ts#extractFanficRuleValue`：正文 `- **字段**：…` 优先，保留多行续行（遇到下一条 `- **` 规则、Markdown 标题或空行停止），正文没有该字段时回退 frontmatter `字段: 值`。向导回填（`wizard-step-renderers.ts`）与 prompt 注入（`parseFanficRules`）必须共用这一函数，禁止在 UI 或解析层另写单行正则——两套口径会让手写多行规则出现「向导里完整、prompt 里只剩第一行」，只写 frontmatter 时 prompt 则完全拿不到规则。每条规则注入时仍受 `FANFIC_RULE_ITEM_MAX_CHARS`（160 字）截断。
- 同人时间线的**面板展示与 prompt 注入必须共用** `shared/fanfic-rules.ts#parseFanficTimelineRows`（原始单元格二维数组，列位置与文件一一对应）：`parseFanficTimeline` 只负责过滤占位并拼「｜」行，`shared/template-validator.ts` 的 `parseCanonTimelineTable` / `parseFanTimelineTable` 只负责把同一行按列名映射。禁止在任一侧 `filter(c => c.length > 0)` 后再映射——中间空单元格会让后续列整体左移，面板把「章节参考」显示在「涉及人物」下、prompt 与面板对不上同一行。原创「纪元 / 时间轴」（`parseMarkdownTable`）同样只能去掉首尾竖线、保留中间空单元格。上下文面板的规则展示（`loadFanficRules`）也必须经 `extractFanficRuleValue` 读取，禁止另写单行正则：用户把规则写成续行时，面板会漏掉后半段而 prompt 完整。
- 同人时间线注入不得永远取「前 8 行」：同人时间线是本书自己的进度，行序即时间顺序，超上限时必须取**最近 8 行**（`selectFanficTimeline`）；原作时间线是 canon 顺序，超上限时先用同人时间线最近 3 条的「对应原作时间」在 canon 行里定位锚点（精确匹配优先、再包含匹配、取最近一次），取「锚点前 2 行」起的连续 8 行（`selectCanonTimeline`），找不到锚点才回退前 8 行。截断时必须补一行「共 N 行，以上为第 X–Y 行 / 最近 8 行」说明：不说明会让模型把「没注入」误读成「时间线到此结束」。上限（`FANFIC_MAX_INJECTED_TIMELINE_ROWS` 8 / 单行 120 字）不变，新增时间线数据源必须走同一选择函数。
- 同人「原作主要人物」「原作势力组织」超过注入上限（`FANFIC_MAX_INJECTED_CHARACTERS` 6）时不得永远取前 6 条：按 `formatFanficRulesForPrompt(rules, { focusText })` 的 `focusText` 中名字出现次数排序，同分保持原顺序；没有 `focusText` 才回退前 6（只填资料、尚未写正文的场景行为不变）。截断时必须补「共 N 人/个，以上为与当前章节相关的 6 人/个」说明，无上下文时写「以上为前 6 人」。协同的五个生成入口必须向 `CoWriterEngine#syncFanficRules(project, focusText)` 传本次实际文本（续写/流式传已写正文、改写传选中文本、迭代传前文、联想传光标前 500 字），focus 内部再拼上本章大纲前 600 字；新增协同入口不得省略 focus，否则该入口又会退化成「只看前 6 条」。
- 协同预览区（`CoWritingView#refreshPreview`）每次输入都会 `empty()` + 全量重渲染，必须在 `empty()` 前经 `shared/preview-scroll.ts#captureScrollSnapshot` 记录滚动锚点、渲染与高亮后经 `resolveRestoredScrollTop` 恢复：预览区是 `overflow-y: auto`，DOM 重建会让 `scrollTop` 归零，用户向下翻看前文时一打字就被拉回顶部。贴底（距底部 32px 内）要恢复到新的最大滚动值以继续跟随最新正文；非贴底保持原绝对位置；内容变短时夹紧上限。新增任何「清空容器再重建」的实时预览路径都不得省掉这一步。
- 自动联想（幽灵建议）必须经 `shared/ghost-trigger.ts#shouldRequestGhostAssociationByInterval` 限频（`GHOST_ASSOCIATION_MIN_INTERVAL_MS` = 4 秒）：输入停顿 1.5 秒就会触发，而尾部 160 字种子只要多一个字就算「变了」，慢速打字时等于每分钟约 30 次 AI 请求。限频判断要放在「正文长度 / 光标在尾部 / 在途请求 / 已有建议」之后，未到间隔直接返回且**不更新** `lastGhostSeed`（否则同一段落后不再重试）；发请求前记录 `lastGhostRequestAt`（失败也计入，避免失败风暴）；切章重置为 0，首次输入不受限。新增自动联想入口不得绕过该限频。自动联想还必须受 `settings.autoGhostAssociation` 控制（设置页与 mini 设置两处开关，缺省 `true`）：关闭时 `scheduleGhostAssociationRefresh` 清空建议并**不排**防抖，`refreshGhostAssociation` 清空建议后直接返回，`await` 返回后再次校验（请求在途时关闭设置也不得写回界面）。开关必须作用在请求与回写两处，只藏 UI 或只挡入口等于没关。
- 编辑器的光标位置必须经 `shared/cursor-position.ts#resolveCursorPosition` 归一化，禁止写 `selectionStart || value.length`：光标在正文最开头时 `selectionStart` 是 `0`，`||` 会把它当成「没有光标信息」回退到文末，导致插入建议/技巧片段落到文末、自动联想按文末取种子（正文 ≥40 字就让「光标在尾部」成立）、`getContextBeforeCursor` 取成整章。`0` 必须保持 0；只有 `null` / `undefined` / 非有限数才按显式 `fallback` 回退；选区结束位置用 `max(起点, 结束)` 计算，不得再用 `||`。新增协同编辑入口一律走该函数。
- 协同写作的提示横幅必须挂到目标区域容器，不能挂 `contentEl` 末尾：`contentEl` 首个子节点是占满高度的 `.nw-cowrite-root`，挂在其后的横幅实际排在三栏布局下方（视口外）。前置规划警告经 `this.editorWrapEl` 插到编辑器容器首位并设 `flex:0 0 auto`；每次检查开始时**无条件**移除旧横幅（只在「仍有缺口」分支移除会让规划补齐后的旧节点残留）；淡出后必须 `remove()`，不能只设 `opacity:0` 继续占位。缺口文案统一由 `shared/prereq-check.ts#describePrerequisiteGaps` 生成（不存在 / 读取失败 / 内容过短三态）。
- 监控面板 A 的 `refreshWithBody` 并发可重入（输入 2.5s 防抖、插入/保存 0.5s，内部对情绪与节奏各 `await` 一次）：每次调用必须推进 `analysisSeq`，每个 `await` 之后（含 `catch`）比对代次，过期直接返回、不写 DOM；短正文分支也要推进代次，使在途请求失效。否则慢的旧请求会覆盖新正文的分析结果，或在面板被清空后把旧内容写回来。新增异步分析路径一律加代次守卫。
- 设定守卫（`LiveAnalysisController#inspectSettingGuard`）是异步 AI 调用，切章是同步的：发起时必须快照正文并推进 `guardSeq`，`await` 之后与 `catch` 中比对代次，过期直接返回；`finally` 只在代次仍匹配时释放 `isInspectingGuard` 并记录 `lastGuardCheck`（否则旧请求会解开新请求的锁）。`openChapter` 必须调用 `resetForChapterSwitch()`（推进代次 + 清空长度基准 + 释放锁），`clearTimers()`（关闭视图）同样推进代次。`lastGuardCheck` 是跨章无效的长度基准：不清空时新章若比上一章短，`grew` 恒为负，输入触发的检查会被长期跳过。手动检查遇到在途检查要给出 `Notice`，不能静默 `return`。情节牵引面板（`renderTractionPanel`）同源：必须推进 `tractionSeq` 并在 `await`/`catch` 后校验，`resetForChapterSwitch()` 一并清空 `tractionContainer`，`openChapter` 在牵引引擎就绪后主动重渲染一次（否则清空后会一直空白到下一次输入）。
- 剧情完成度（`CoWritingView#refreshMetrics`）同样是异步 AI 评估：发起时必须记录「项目|章号」，`await` 之后与 `catch` 中比对，身份不符直接返回（不 `syncPlotCompletion`、不渲染、不写 error）；`openChapter` 必须调用 `resetPlotMetricsForChapterSwitch()`（abort 在途请求 + `metricsStatus` 复位 `idle`），否则旧章结果会写进新章、新章顶部一直显示「评估中」。切章在 `initEngine` 之前不得用 `facade.getSession().currentMetrics` 渲染，会话仍是上一章的。
- 预览区渲染（`CoWritingView#refreshPreview`）调用 `MarkdownRenderer.renderMarkdown` 是异步的，而容器是常驻的：必须先 `++previewSeq` 取代次，把内容渲染到 `ownerDocument.createElement('div')` 的 detached staging 容器，`await` 之后校验代次再 `empty()` 并一次性搬入；禁止直接把常驻容器交给渲染器。否则同一容器会被两次渲染同时写入，出现新旧段落混排；切章后旧章的在途渲染还会把上一章内容写回新章预览。代次校验失败必须直接返回（不 `empty()`，避免把新渲染的内容清掉）。
- 预览刷新的节流（`CoWritingView#refreshPreview` 的 500ms 窗口）**只能延迟、不能丢弃**：窗口内的刷新必须用 `schedulePreviewFlush(剩余时间)` 排一次尾随渲染，且连续输入只保留最后一次；`force=true`（切章、插入建议、质检高亮、`openChapter`）要取消挂起尾随并立即渲染，`onClose` 必须清理定时器。直接 `return` 会丢掉「停手前最后一次输入」——用户打完最后一个字停手后，预览会一直落后，直到下一次按键才补上。
- 批量 N 章的失败步骤必须自动重试一次（`ui/full-writer/batch-step-retry.ts#shouldRetryBatchStep`）：整章重跑对本地模型的偶发空输出代价过高；取消与已达上限不重试。重试策略必须放在叶子模块，`batch-pipeline-runner.ts` 会间接拉起 `main.ts`，单测直接导入会报 `Cannot find module 'obsidian'`。步骤异常要转成带 `completedSteps` / `failedStep` 的失败结果，不能冒泡到 `run()` 兜底（会清空已完成步骤信息）。
- 偏离检测的缓存键必须包含上下文指纹（`DeviationDetector#hashContext`）：键只有 `textHash` 时，「大纲还没加载就评估」的旧结论会在 TTL 内被相同正文命中。指纹要覆盖 `chapterId` / `chapterNum` / `chapterOutline` / `expectedRhythm` / `mainlineKeywords` / 人物（名+性格+外貌+能力）/ 前文（章节号+字数）/ 伏笔；前文只取长度，禁止每次评估都哈希两万字。`invalidateCache(text)` 必须用 `deleteByPrefix` 清理同一正文的所有上下文变体。
- 节奏偏离的 `expectedRhythm` 只能由 `shared/rhythm-intent.ts#parseExpectedRhythm` 从规划文本的**显式标注**解析（`节奏：快/中/慢`、`快节奏`、`节奏偏慢`、`慢热`、`中等节奏` 等）：没有标注必须返回 `undefined`（节奏偏离保持静默），快慢同时出现也返回 `undefined`（单值字段表达不了）。禁止从「战斗 / 爽点 / 日常」等语义猜测节奏——误报比不报更伤信任。接入点是 `CoWritingView#buildDeviationContext`，文本取本章简报大纲、快照 `chapPlan` 与场景目标/冲突/名场面。
- 协同实时监控必须向偏离检测传 `characterInfos`（`CoWritingView#loadCharacterInfosForDeviation`）：不传时 `detectCharacterOOC` / `detectSettingContradictions` 直接返回空，「人物 OOC」「设定矛盾」两类偏离形同虚设。人物档案按项目缓存 `DEVIATION_CHARACTER_INFO_TTL_MS`（60s，`shared/thresholds.ts`），TTL 到期重读，避免设定改动被永久忽略。
- `RealtimeMonitor.evaluate` 的 `busy:` 异常是并发守卫而非失败：调用方必须识别并静默跳过，不能展示「质量评估失败」。但不能直接丢弃本次触发：必须挂起重评（`qualityMonitorPending`），由真正释放 monitor 的那次评估在 `finally` 里补跑一次。否则评估慢于防抖间隔时，用户停手前的最后一次输入永远不会被评估，顶栏长期停在旧正文的分数上。`busy` 分支不得自己消费待办，否则两个并发调用会互相重试形成递归。
- `RealtimeMonitor.evaluate` 收到外部 `AbortSignal` 时，`addEventListener('abort', …)` 必须与 `removeEventListener` 成对：`once: true` 只在真的 abort 时自动摘除，正常结束不会。监听句柄存 `externalAbortListener`，由 `detachExternalAbort()` 在 `cleanup()` / `reset()` / `dispose()` 三处统一摘除；外部 signal 已 abort 的早退分支必须先清 `currentAbort` 再返回取消结果。视图级 controller 会跨多次评估复用，漏摘会让闭包（含旧 `internalAbort`）线性累积。新增收尾路径必须调用 `cleanup()` 或显式 `detachExternalAbort()`。
- 偏离检测的前文缓存必须按「候选路径列表」失效（含项目/卷/章号），不能只比 `chapterNum`：不同书的同章号会串用前文正文，产生时间线/设定矛盾误报；扩窗后缓存键必须覆盖全部候选路径，否则切章后仍命中旧窗口。
- 前文窗口必须跨卷解析（`shared/previous-chapter-window.ts#selectPreviousChapterFiles`）：章号跨卷连续（实测第 2 卷 131–290 章、第 3 卷从 291 章起），禁止再用「同卷路径替换 `第N章 → 第N-1章`」拼路径——卷首章必然读不到前文，跨章外貌矛盾与伏笔 frontmatter 全部失效。窗口固定取最近 `PREVIOUS_CHAPTER_WINDOW_SIZE`（3）章；进入检测的正文必须先 `stripFrontmatterBlock`（元数据不参与矛盾检测），再由 `buildPreviousChapterWindow` 按单章 12000 / 合计 30000 字预算、最近优先裁剪。前文 frontmatter 只能取 `metadataCache.getFileCache(file).frontmatter` 的结构化对象，禁止用正则键值解析（数组会被压成首项）。
- 前文章节缓存的键必须包含文件签名（路径 + `stat.mtime` + `stat.size`），禁止只按路径缓存、也不要用「无失效的长 TTL」：用户会在同一次协同会话里改完上一章再回来写本章，路径不变但正文已变，只按路径命中的缓存会让「设定矛盾 / 时间线矛盾」一直比对旧正文（改过的设定看不到、已解决的不消失）。文件被移走时键要落到 `:missing`，不能继续命中旧列表；首次解析出的 `TFile` 应复用给读取循环，避免为做签名重复 `getAbstractFileByPath`。人物档案与伏笔追踪可继续用 60s TTL（不随打字变化），前文正文不行。
- 趋势类告警的样本单位必须与时间维度一致：`PlotDivergenceEngine#divergenceHistory` 记录的是**评估次数**（面板 B 每 500ms 就可能评估一次），不能当成「章序列」。判定「持续上升」必须交给 `shared/divergence-trend.ts#isRisingDivergence`，同时满足「相邻样本涨幅 > 5 至少两次」与 `DIVERGENCE_RISING_MIN_WINDOW_MS`（2 分钟）时间窗；告警文案只能写「近 3 次评估」，禁止写「连续多章」。`divergenceHistoryAt` 必须与 `divergenceHistory` 同步 push / 截断，`clearHistory()` 必须两个数组一起清空，否则时间戳错位会让窗口判定失真。
- 协同写作的四条生成链路（主续写 / 联想 / 选区改写 / 句级迭代）都必须传 `getCoWriteInputBudget()`：本地模型按 `num_ctx` 从 prompt 尾部硬截断，而「上下文 / 选中文本 / 迭代指令 / 输出约束」正好在末尾，不裁剪就会把任务本身切掉。末尾任务片段必须作为 `assemblePromptWithinBudget` 的 `tailParts`（永不裁剪），记忆/知识库/驱动按 priority 20 → 25 → 60 先截断再丢弃。新增链路也必须走同一个预算内核，不允许只拼字符串。
- `systemPrompt` 只允许放静态硬规则（视角 / 文体 / 输出语言 / 格式契约）：`assemblePromptWithinBudget` 不裁剪 system 与 `tailParts`，任何增强内容拼进 system 都会绕过预算。场景知识注入（`injectForBodyGeneration` 六段）必须作为 `knowledgeInjection` section（priority 70、shrinkable）参与裁剪；项目写作规则与文笔风格（`writingStyle` 在协同快照里无长度上限）必须作为 `projectStyle` section（priority 85、shrinkable）。否则注入/风格一长就会把整段 prompt 顶过窗口，本地模型从尾部截断时正好切掉「已写内容 / 写作方向 / 输出约束 / 选中文本 / 联想提示」。
- 人物 frontmatter → 检测上下文的映射只允许走 `engine/character-context.ts#toCharacterContextInfos`：协同主视图（OOC/设定矛盾）与浮窗逻辑检查共用同一口径，字段回退顺序为 `name` → `姓名` → `fileName`；非字符串值降级为空串，无姓名的记录丢弃。禁止在视图层再写第二份 `性格标签/外貌特征` 映射。
- 协同写作内的所有质量写入口（面板 B 实时评估、`persistLiveQualityIfDue` 实时落盘）必须用 `shared/quality-history.ts#buildQualityChapterKey` 构造章键，落盘前再经 `normalizeChapterKey`：`normalizeChapterKey` 只能从「第N章」形式提取章号，章节名若是「初始之痕」这类纯标题，直接拼 `${project}-${chapterName}` 会产生 `书-初始之痕` 与 `第3章` 两种 key，基线把同一章算成两章、样本被稀释。章键必须带项目前缀（面板 B 用它判断切章并重置历史），落盘键必须归一化为「第N章」。
- 「伏笔遗忘」偏离必须由调用方传 `foreshadows`（`CoWritingView#loadForeshadowsForDeviation` → `engine/foreshadow-context.ts#toForeshadowTrackings`）：检测器虽然会回退解析 `previousChapters[].frontmatter`，但追踪器里才有「计划回收章」，因此协同视图必须以追踪器为准、frontmatter 解析只作兜底（前文窗口已从 `metadataCache` 传入结构化 frontmatter）。映射必须跳过已回收、低重要度、`plantedChapter` 缺失/非法的条目（否则 `distance = 当前章 - 0` 让每条都判 critical）；关键词只取 4–16 字片段，过短会把未回收误判成已回收。
- 质量历史的追加只能走 `services/quality-history-store.ts#appendQualityHistory`：它是「读-改-写」，必须按项目排队串行执行。协同实时落盘与面板 B 节流落盘是两个独立触发源，并发时会双双读到旧文件、后写覆盖先写而丢记录（已用并发用例复现）。禁止绕过该函数直接 `loadQualityHistory` + `writeQualityHistory` 实现追加。
- 质量历史**落盘口径是「章」而不是「条」**：`appendQualityHistory` 在合并后必须经 `aggregateQualityHistoryByChapter` 收敛再写盘（一章一条、保留最后一次评估）。面板 B 每 30s 落盘、协同每 10 分钟落盘，若按条累积，`QUALITY_HISTORY_MAX_RECORDS = 200` 会在同一章写约 100 分钟后被单章灌满，裁剪把前面所有章的样本挤掉——结果是「写得越久，基线/章级趋势越失效」。新增写入口不得绕过该收敛；会话内展示（`qualityHistory`）仍可按评估次数累积。
- 主角识别只允许走 `shared/protagonist.ts`（`roleIndicatesProtagonist` / `findProtagonistName`），必须从人物 frontmatter 的「身份」字段解析（字符串/数组均支持，兼容「主角」「主人公」）。`plugin._workbenchState` 已在 Rev 102 整体删除（长期无写入方、恒为 null），不得再新增同类的「工作台内存快照」捷径；场景兜底、协同正文模板等入口统一两级回退：人物列表 → 默认值。
- 任何写质量历史 / 基线的入口都必须先过 `shared/quality-history.ts#isQualitySampleUsable(wordCount)`（门槛 `QUALITY_LIVE_PERSIST_MIN_CHARS`）：`WritingQualityEngine` 在 <100 字时返回总分与六维全 0 的空结果，直接入库会拉低基线、把「高于/低于基线」判反，并挤占 200 条历史配额。新增写入口不得绕过该判断。
- 质量历史的「落盘」与「恢复」都不允许丢弃数据：`persistQualityHistory(force=true)`（切章/关闭）不得因为上一次落盘在途就 `return`——串行化与去重由 `appendQualityHistory` / `mergeQualityHistory` 负责，面板层自行拦截会让「清空 `qualityHistory` 前的那条记录」永久丢失；`restoreQualityHistory` 必须用 `mergeQualityHistory(records, 会话增量)` 合并而不是直接覆盖，否则加载期间新评估的样本会从基线与趋势里消失。基线是项目级样本：换项目时必须清空 `baselineHistory`，避免上一本书的记录混入。
- 11 步流水线的 prompt 必须整体过 `shared/prompt-budget.ts#fitPromptToContext`：token 估算要包含 system、user 与追加的知识注入（三者缺一都会漏判本地窗口），超预算的处理顺序固定为「丢增强尾部（知识注入，写预算日志）→ 主体头尾保留截断（中间资料让路）」。禁止再出现「拼接时加了注入、估算时没算」或「截断时重建 prompt 把注入静默丢掉」的写法。**章节正文、场景展开、大纲扩写同样必须过闸门**（Rev 157）：章节正文走 `ai-prompt-builder#buildChapterPrompts`（知识＝user 可裁剪层），场景展开走 `generateSceneExpansion(..., budget)`（知识＝`extraTail`），大纲扩写走 `OutlineToTextExpander#callAI` 的 `extraTail`。禁止任何 `systemPrompt += knowledge`：`tests/unit/engine/prompt-injection-guard.test.ts` 会扫描 `engine/**` 拦截。
- `fitPromptToContext` 的窗口/输出上限必须按「本步实际模型」取，禁止直接传 `settings.maxContext` / `maxOutput`：设置是全局单值（默认 128000/32768），而每一步按 `modelStrategy` 切到不同模型，本地模型常见只有 8K 窗口。用设置值算闸门 → 永不触发裁剪 → 请求被 `ai-api-client` 判「输入过长」或由 Ollama 按 `num_ctx` 尾部硬截（先丢输出约束）。统一走 `shared/prompt-budget.ts#clampBudgetToModelLimits(settings, plugin.resolveModelLimits(stepModel))`：两者取小（模型能力是硬上限，设置值是成本上限），模型值缺失/非法时回退设置值。
- 指纹注入上限统一由 `engine/style/fingerprint-selection.ts#selectFingerprintsForInjection` 决定（`MAX_INJECTED_STYLE_FINGERPRINTS = 3`），协同与 11 步共用，禁止各自实现一份：`PromptBuilder#getFingerprintPromptParts` 与 `KnowledgeInjector#getEnabledFingerprintsFromLibrary` 都必须调用它。检索必须用 `fingerprintIds` 限定在**启用指纹**内排名：候选若包含禁用指纹或 template 来源库，它们会先占满 topN，与启用集合取交集后为空 → 回退，上限形同虚设。回退策略按链路区分：协同用 `'all'`（风格约束不能丢），11 步用 `'firstN'`（守住 system 预算），两者都必须发一次 `vector/style` 降级事件且每实例只报一次，禁止静默回退。启用数 ≤3 时不发起检索，避免为 3 个指纹白付一次 embedding 请求。合并特征每字段必须截断到 200 字（单指纹直通同样截断），超出时注明「已合并 N 个指纹」。
- 批量断点续跑必须用 `ui/full-writer/batch-targets.ts#isBodySettled` 判断结算状态：结算流程对伏笔库 / 实体互信息 / 时间线都是**追加**写入，已结算章节再结算一次会产生重复行。`resume !== false` 且「步骤齐全 + status=settled」时整章返回 `skipped`，不得再调 `SettlementEngine.settle`；只有 `resume=false`（用户显式强制重跑）才允许重新结算。
- 「生成前守卫」一律用 `plugin.hasAiCredentials`（`shared/ai-credentials.ts#hasUsableAiCredentials`），不得直接判断 `settings.apiKey`：本地推理端点（Ollama / LM Studio / vLLM）无需密钥，`AIApiClient` 已对 local 端点豁免；UI 层硬检查密钥会把本地模型用户挡在所有生成入口之外。该判定优先读 provider 的显式 `sourceType`，其次按 id/endpoint 启发式，避免 `localhost.example.com` 这类云端代理被误判。
- 所有步骤（不只正文）调用 AI 都必须传 `AbortSignal`（`StepRunner.callAIWithRetry` 的可选 `signal`）：非正文步骤不传会导致取消批量后大纲/规划请求继续跑完。批量取消器只在 `BatchPipelineRunner.run()` 绑定一次外部 signal，按「当前章」桥接，禁止在 `getAbortController()` 内重复 `addEventListener`。
- 协同写作正文必须经 `sanitizeStoryText`（`shared/api-response-utils.ts`）：`stripThinkingBlock` 剥离 `<think>`，`stripModelMeta` 剥离首尾元叙述；`isPlanningOutput` 命中的「分析/规划」候选直接丢弃，不得展示或插入正文。所有候选链路都要过滤——主按钮 `suggestNext → generateDirectionalCandidate`、单句 `suggestStream`、段落 `suggestParaStream`、改写 `rewriteSelection`；漏掉任一链路都会把「世界观底层规则 / 设定库」当成场景建议展示。
- 后台保存与后台 AI 调用不得弹口令框：`SettingsService#encryptIfPlain` 无会话口令时保持明文；后台分析类调用必须传 `allowKeyPrompt: false`（走 `decryptKeyWithoutPrompt`）。只有用户主动生成内容时才允许按需解锁。
- `AIApiClient` 对 `Failed to fetch` / `ECONNREFUSED` / `ENOTFOUND` 必须快速失败：同一端点上重试与切换模型都不会自愈，继续重试会在降级链里放大成几十次请求，表现为「一直停在生成中」。
- 协同写作切换章节时必须先清空编辑器再读取正文，避免 `onClose` 自动保存把上一章内容写入新章节。
- 从协同写作返回工作台时，`main.ts#openFullWriterView` 会调用 `FullWriterView.refreshChapterStateFromDisk()`；复用视图不触发 `onOpen`，不刷新会一直显示旧的「正文未完成」。
- `ChapterStateManager.restoreChapterState` 以磁盘为权威：步骤文件缺失或未达 complete 时必须从 `stepCompleted` 移除，否则删除正文后仍会显示已完成。
- 完成性识别必须同时清理 `stepResults`：文件缺失或校验为 empty/skeleton 时旧实现只删 `stepCompleted/stepLevels`，残留结果会让导航按 `Boolean(stepResults[key])` 继续显示「◐ 部分完成」。
- `settlement` 没有独立步骤文件（`StepResultSaver` 的 fileMap 无该映射），恢复时必须以正文 frontmatter `status: settled / 已完稿` 作为完成证据；不得以「文件不存在」直接判 empty。
- 步骤校验的 Markdown 规范化必须保守：短标签升标题需同时满足「≤20 字、不含 `。！？，；、`、命中结构标签白名单」，否则真实正文里的导语（如 `**全书定位**：` 下一行「本章是全书……功能：」）会被误升成标题，导致该节被判为空。`extractSectionAfterHeading` 只能被同级或更高级标题截断，`###` 子节不得提前终止整节。
- 角色灵魂自动提取必须落盘（`saveStepResult('characterSoul', …)`），且保存成功后再过 `validateStepResult('characterSoul')` 才标 complete；只写内存会在下次 `restoreChapterState` 被磁盘模板骨架覆盖为 empty。完成度按 `【角色名】` 块判定，字段值需非占位（`>-`、`暂无`）且去标点 ≥4 字，兼容 `欲望：…` / `## 欲望` / 紧凑 `欲>/惧>/底>`。工作台 `onOpen` 与切章路径必须先 `restoreChapterState()` 再 `loadContext()`，并且磁盘已有真实灵魂文件或内存已有恢复内容时不得覆盖。
- 步骤完成态唯一来源是 `validateStepResult(stepKey, content).level === 'complete'`：保存成功、文件存在、字符数够都不算。`StepRunner` 单步保存后必须按校验结果决定是否 `stepCompleted.add`，不完整时撤销完成态并提示缺失模块；合并规划（`evaluateCombinedPlanning`）必须传 `isValid` 谓词，残缺模块不得计入 generated。
- 模板骨架按「有效行」判定，不得只看字符数或 `${}` 占位：`engine/step-validator.ts#stripPlaceholderLines` 会剔除空标签行（`- 节点1：`）、空表格行（`| 1 | | | | | |`）、斜杠枚举值（`高/中/低`、`悬念式/反转式/…`）与方括号模板说明（`[开端/发展/…]`）；`hasMeaningfulContent` 与 `isTemplateSkeleton` 必须共用该清洗，后者忽略 Markdown 标题后有效长度 <30 即骨架。
- 上下文加载（context）不是开关：完成态由 `engine/context-readiness.ts#assessContextReadiness` 决定（必做 = 人物、大纲、世界观或设定库、非首章的前章摘要），缺失时 `partial` + 点名；`ChapterStateManager.restoreChapterState` 不得再无条件把 context 写 complete，否则会覆盖 loadContext 的真实判定。上下文步骤页必须渲染 17 项输入清单（条数/字数/必做/是否加载）与重新加载入口。
- 章节标签页身份必须含卷：`chapterKey = 项目/卷/章`；`TabController.selectChapter` 复用旧标签页时必须同步 `chapterName/volume/chapterNum/chapDir`（磁盘真实卷目录），切换后校验 `state.chapterName` 并在未生效时给明确 Notice。只按 `项目/第N章` 匹配会让跨卷同名章串用旧上下文。
- 章节列表口径 = 正文 ∪ 骨架：`ui/project-utils.ts#getChaptersForProject` 返回 `ChapterListEntry`（`file: TFile | null`、`hasBody`），骨架来源为 `03-大纲与章节/步骤结果/第N卷/第M章` 目录；去重键为章名（全书连续章号），正文优先。**出口已用 `sortChaptersByNumber` 统一升序**，消费方不要再各自排序（重复调用是 no-op，但新增代码不得依赖未排序顺序）。任何消费方不得假设 `file` 非空——质量仪表盘必须过滤无正文者，顶部下拉/项目页「全部章节」/协同入口必须允许 `file=null` 继续切换（`WriterTab.file` 本就可选）。
- 时间线/伏笔不得只平铺注入：`engine/story-linkage.ts#buildStoryLinkage` 产出按章关联索引（到期/逾期/3 章内即将到期 + 设定条目互链 + 全书规划定位 + 去重告警）；`buildUserPrompt` 在 `ctx.storyLinkage` 非空时必须用它替代 `【未揭示伏笔】`/`【时间线事件】`，否则同一批数据被注入两次、预算浪费在重复行上；为空时才回退旧平铺。
- 关联回写只动标记块：`engine/story-linkage-writer.ts#upsertLinkageBlock` 仅替换 `NW-LINKAGE:BEGIN/END` 之间内容，无标记则追加，残缺标记不得删除用户内容；解析伏笔库/时间线看板前必须 `stripLinkageBlock`，否则回写表格会被再次解析成事件、块内容不再幂等。
- 时间线看板解析必须同时兼容 7 列富表（`# | 事件名称 | 时间 | 地点 | 涉及人物 | 章节 | 类型`）与 4 列简表（`时间 | 对应章节 | 事件 | 影响`），不得再用固定列数阈值直接丢弃真实数据行。
- 关联看板章节选择器必须用 DOM 自绘下拉（`ui/story-linkage-modal.ts#openChapterPanel`：搜索框 + 章节行，点击行即 `selectChapter`），禁止回退原生 `<select>`：400 章长列表在部分主题/缩放下点击选项不生效。`selectChapter` 不得对「点的是当前章」提前 return——任何点击都必须走 `scan()`，否则表现为「点一下没反应」；同章点击也要重新扫描。弹窗宽度必须加在 `this.modalEl`（`.modal.novel-writer-linkage-modal`）而非 `contentEl`，否则 Obsidian 的 `.modal` 仍为 560px、内容横向溢出；切章 `scan()` 必须用 `scanSeq` 丢弃过期结果，避免慢请求覆盖新章节。
- 关联索引弹窗的章节列表不得用 `display: flex; flex-direction: column` 承载 400 项：默认 `flex-shrink: 1` 会把每项压到 12px 高（padding 被吃掉），文字只剩一条横条、视觉上互相重叠（Rev 191 实测）。`.novel-writer-linkage-chapter-list` 必须保持块级布局，用 `max-height: 200px` + `overflow-y: auto` 滚动；`.novel-writer-linkage-chapter-item` 需保留 `flex: 0 0 auto` 作为双保险。
- 关联索引弹窗的章节选择区必须在 header 内流内展开（`.novel-writer-linkage-chapter-panel` 为静态流、`width: 100%`、列表限高 200px），禁止回到 `position: absolute` 浮层：实测浮层 340×354 会盖住正文 322px，用户看到的就是「重叠」。弹窗内容区必须用纵向 flex（`.modal-content` 上 `display:flex`、header/footer `flex-shrink: 0`、body `flex: 1 1 auto; min-height: 0` 滚动），否则正文超高会把底部按钮挤出视口。表格必须 `table-layout: fixed` 并按列给百分比宽度（`.novel-writer-linkage-table--foreshadow` / `--timeline`）：中文长文本在 auto 布局下会把其他列压到 1–2 字宽竖排。面板移出 picker 后，document 的 mousedown 外部点击判断必须同时检查 `pickerEl` 与 `panelEl`。
- 上下文面板刷新必须移除真实类名 `.novel-writer-fw-context-panel`：`ui/full-writer/entity-state-controller.ts#refreshContextBar` 曾移除不存在的 `.novel-writer-fw-context-card`，旧面板没删、`ContextPanel.render` 又 append，`.novel-writer-fw-workspace` 多出第 4 个 grid 子元素，`grid-template-rows` 变成 `0px 692px`，章节页整体塌陷。保存设置（`MiniSettingsModal.saveAllSettings` → `refreshFullWriterContextPanel`）、模式切换等所有刷新路径都依赖这次移除；禁止改用 `.novel-writer-fw-context-card`，也不得假设 `render` 会自行清空。
- 命令层章节上下文只有一个解析入口：`shared/chapter-target.ts#resolveActiveChapterTarget`（工作台上下文 > activeFile 正文 > 步骤结果目录）。任何从快捷工具/命令面板触发的章节级 Modal 必须调用 `plugin.getActiveChapterTarget()`，禁止各自读 `workspace.getActiveFile()`；`getActiveProject()` 在工作台/项目页无活动文件时回退 `_workbenchContext.project`。
- 工作台每次 `renderTabContent` 与项目页项目卡片选中都必须回写 `plugin.setWorkbenchContext(...)`，`onClose` 清空；否则右侧快捷工具会拿到空项目、表现为「前端有按钮但点进去没功能」。
- 快捷工具产物落点只有三类：作品目录内（`pj*` 路径函数）、章节步骤目录、`元文件/` 全局层。禁止 `vault.create('xxx.md')` 写 vault 根目录：平台级报告走 `GLOBAL_RANK_DIR`（`元文件/06-榜单分析`），写作风格预设走 `元文件/00-系统模板`。新增入口必须同时通过 `tests/unit/ui/quick-tools-three-layer.test.ts` 的三层对账。
- 任何「向正文插入生成块」的功能必须幂等：用 HTML 注释标记圈定块边界，写入前先 `strip` 再 `upsert`（参考 `shared/auto-context-block.ts`）。禁止无条件 `content.slice(0, x) + block + content.slice(x)` 追加，否则重复操作会在同一文件累积 N 段。
- 工作台入口分两种语义，不得混用：`openFullWriterView()` = 打开/聚焦并静默刷新（热重载恢复、协同写作返回）；`openFullWriterHome()` = 快捷工具与左侧 ribbon 的「项目与章节」入口，必须保证切页或刷新并给 Notice。复用视图时只调静默刷新会表现为「点击没有任何反应」。
- 向导中 `status === 'skipped'` 的步骤再次前进时直接放行，不重复 `validateWizardStepContent`，避免用户被重新拉回「内容不完整」。
- 存量实体修复走 `shared/entity-audit.ts`：审计跳过模板文件，`overwriteEntityIfComplete` 复检不通过时保持原文件不变（不产生「名称（2）」副本）。
- 场景标题解析必须走 `engine/scene-expander.ts#parseSceneHeadings` / `#splitSceneSections`（正则常量 `SCENE_HEADING_SOURCE`）：不得再写死 `^##`，AI 实际输出常为 `### sceneN:`，只认 `##` 会让解析结果为 0 个场景。
- 任何「解析 → 拼接 → 整文件覆盖」的保存路径必须有空写保护：解析结果为 0 且原文件非空时拒绝 `vault.modify`。`SceneOutlineController.saveScenes` 返回 `boolean`，调用方只有拿到 `true` 才允许提示成功 / 标记步骤完成。
- 协同写作必须承接规划阶段成果：`CoWritingView.openChapter` 从磁盘读取 `信息规划 / 情节蒸馏 / 大纲摘要 / 情绪规划 / Scene展开` + 正文，经 `engine/chapter-brief.ts#buildChapterBrief` 生成 `ChapterBrief`，再 `facade.setChapterBrief` 注入引擎。章节上下文只能由 `openChapter` 显式绑定（`openCoWritingFromActiveContext` 只认当前正文文件路径反解），不得引入工作台内存快照，否则上个截断步骤的成果会丢失。
- `ChapterBrief` 是协同写作 UI（左栏「本章简报」）与提示词的唯一规划来源：有简报时 `PromptBuilder` 跳过 `chapPlan / sceneExpansion` 的整段注入（旧逻辑固定 `slice(0,3000)` 会丢掉当前场景），当前场景 8 要素必须完整注入。
- 空正文冷启动规则：正文为空且 `ChapterBrief` 有场景/大纲时，`suggestNext('')` / `suggestAssociation` 必须放行，主按钮显示「✍️ 生成开头」；两者都缺失时必须提示先完成步骤 6「Scene 展开」。
- 实体摘要必须走 `chapter-brief.ts#formatEntityBrief`：实体文件是中文 frontmatter（`姓名/名称`、`人物背景/描述`、`当前状态`），只读 `name/description/state` 会让提示词里的实体总览退化为 `"："`。
- 智能扩写弹窗切换模式必须 `this.headerEl?.remove()` / `this.footerEl?.remove()` 后重建再 `prepend`，禁止 append-only（曾出现 1→2→3 层标题栏堆叠）。
- 扩写来源为空且带 `chapterContext` 时，必须回退读取 `第N章_Scene展开.md` 并用 `splitSceneSections` 本地填充场景列表，不能直接拿空字符串调 AI。
- 协同写作保存正文必须走 `engine/body-writer.ts#BodyWriter.write`：前端不再各自解析 / 拼装 frontmatter。`status` 不降级（`settled` 永远保持），`complete` → `step_status=generated` + `status=written`，否则回落 `draft` 并撤销 `step_status`，保证返回工作台时步骤状态与磁盘一致。
- **正文落盘唯一入口**：协同写作、步骤流水线（`StepResultSaver`）、修正回写、整章生成、自动写作器、批量写正文、续写都必须调用 `BodyWriter`。它统一保证 4 条不变量：
  1. 旧 frontmatter 原文按文本块保留，不经 YAML 重新序列化 → 块列表与自定义字段不丢；
  2. 标题行由写入器生成，模型自带的 `# 第X章` 一律剥离；
  3. 正文按项目「写作规则.md」推导的格式契约规整（见 `shared/body-format.ts`）；
  4. `status` 不降级、`word_count / writing_mode / 卷 / 章 / tags` 统一维护。
- **正文写入必须按路径串行**：`BodyWriter.write` 内部经 `engine/write-lock.ts#withWriteLock(req.path, ...)` 排队，原逻辑在 `writeLocked` 中执行。写入语义是「读旧 frontmatter → 整篇覆盖」，同一章同时存在协同自动保存、流水线、润色回写、修正回写等多个写入者时，不串行会出现「后写覆盖前写」且两次读到的旧 frontmatter 互相覆盖。任何新增写入者只要走 `BodyWriter` 即自动获得该保护，禁止绕过它直接 `vault.modify`。
- **协同保存必须入口快照章节身份**：`CoWritingView#saveBody` 在入口固定 `{ project, volume, chapterNum, chapterName, bodyPath }`，后续 `getChapterTitle / getStepFilePath / writer.write / 状态更新` 一律只用快照，`await` 之后不得再读 `this.project / this.chapterNum` 等可变字段；写盘后用 `isSameChapterIdentity(identity)` 判断是否已切章，已切章则不再回写旧章的 UI 状态。否则「生成/保存 await 期间用户切章」会把上一章正文写到新章路径，造成静默串章。
- **切章前必须冲刷排队正文**：`CoWritingView#openChapter` 首行调用 `flushPendingBodySaveBeforeChapterSwitch()`，先用**旧身份** `cancel('auto-save')` 并 `saveBody(false)` 落盘；返回 `false` 时提示「上一章正文未能保存，已取消切章」并中止切章。禁止直接 `cancel` 丢掉排队内容，也禁止先切 `this.chapterNum` 再保存。
- **所有插件数据目录 IO 必须能覆盖索引外路径**：`ObsidianFileSystem` 对 `vault.getAbstractFileByPath` 未命中的路径必须回退 `vault.adapter`（`read / write / exists / listFiles / listFolders / mkdir / delete`）。插件数据目录 `.obsidian/plugins/<id>/data` 不在 vault 索引里，`vault.getFiles` / `getAbstractFileByPath` 对它恒为空：只用 vault 索引会让知识向量 / 指纹向量 / 版本目录的加载静默变成 0，`exists` 门禁还会让改名同步、索引加载直接跳过。vault 内文件必须继续走 `vault.read / modify / create` 以保留索引与事件语义；索引外列表返回的虚拟 `TFile` 只保证 `path / name / basename / extension / stat` 字段。
- **写 vault 内 `.md` 必须走 `writeVaultText`（2026-10-31 批次 13）**：`shared/file-system-port.ts#writeVaultText(app, path, content)` 是 UI 层写项目内文本的唯一出口。它先补父目录，再按 `ObsidianFileSystem.write` 四路分流（索引内 `TFile` → `vault.modify`；路径是文件夹 → 抛错；配置目录 / 索引外已存在 → `adapter.write`；其余 → `vault.create`）。**不要再写 `app.vault.adapter.write(项目内 .md)`**：那条路径不触发 `metadataCache` 重解析、绕过写锁，移动端（无外部文件监听）新建文件会长时间不出现在文件浏览器 / 双链。只有以下三类允许直连 adapter：
  1. 索引外路径：`.project` 隐藏文件、`shared/plugin-cache.ts` 的 JSON 缓存、agent 会话 / 溢出数据；
  2. 需要绝对路径的 `vault.adapter.basePath`；
  3. engine 层拆解器对 `写作知识库/` 的批量后台写入——这些是插件自管数据、读取同走 adapter 闭环，改走索引会在拆解期间引发大量 `metadataCache` 重解析与 `vault.on` 抖动，收益为负（改动前先看这条约定）。
- **知识向量写入必须全局串行**：`KnowledgeVectorStore.STATE_LOCK` 被 `ensureLoaded`（`reloadIfChanged`）与 `addBookSamples / replaceBookSamples / updateBookSamples / removeBook / clear` 共用；写操作在锁内完成「reload → 逐条 embed → set → saveBook → saveIndex」。禁止改回 per-book 锁：`loadIndex` 会 `samples.clear()`，书级并行会与跨实例 reload 互相清空内存样本。新增任何写向量入口也必须走这把锁（或走上述方法），不得直接 `samples.set` + `saveBook`。
- **同一本书只允许一个在途拆解任务**：`DeconstructionScheduler.addTask` 对同书 `pending / running / paused` 任务直接返回既有 taskId，禁止并发拆解同一本书（会各自「读现有 → embed → 覆盖」）。删除书籍必须先 `cancelByBook(bookId)`；且 `vectorizeBook / saveSegmentedDimensionResult / appendBreakdownLog` 写盘前必须用 `getBook(bookId)` 二次校验，书已删除则跳过，避免重建已删除的书目录与向量。
- **知识向量存活判定必须按 `bookId`**：向量文件名是 `${bookId}.json`，`KnowledgeVectorStore` 只能通过构造第 4 参 `{ isBookAlive }` 回调（生产入口为 `KnowledgeBaseManager#hasBook`）判断书目是否还在；`bookName` 只用于展示，不得再用它拼 `knowledge-base/{bookName}` 目录做孤儿判定（改过名的旧向量会被永久跳过，重启后检索恒为空）。`isBookAlive` 缺失时（测试/单机场景）才回退旧的目录判定。
- **书目改名必须同步向量产物**：`KnowledgeBaseManager.updateBook` 改名分支在 `fs.rename` 之后必须调用 `renameVectorArtifacts(bookId, newName)`，重写 `${bookId}.json` 与 `index.json` 中对应条目的 `bookName`（含 `samples[].bookName`）；文件缺失/损坏只 warn 不抛错，改名本身不能失败。
- **正文格式契约唯一事实源**：`shared/body-format.ts`。`deriveBodyFormat()` 从项目写作规则推导（空两格 / Tab / 无缩进、单换行 / 空行），`normalizeBodyText()` 落盘前规整，`describeBodyFormat()` 生成提示词里的格式说明。禁止再手写「Tab 缩进 / 禁止空行 / 空两格」等互相矛盾的条目。
- **所有正文类 prompt 必须走契约**，不得硬编码分段/缩进：
  - 整章草稿：`engine/ai-prompt-builder.ts`（`AIEngine.generateChapter / generateChapterStream` 用 `BodyWriter.resolveContract(context.project)` 解析后传入）；
  - 步骤流水线：`engine/prompts/chapter-pipeline-prompts.ts`（V1）与 `body-v2-prompts.ts`（V2）使用 `${bodyFormat}` 模板变量，由 `ui/full-writer/template-vars-builder.ts` 注入（整章模板 `allowTitle: true`）；
  - 批量 / 自动 / 续写 / 场景扩写 / 场景正文：`batch-chapters-modal`、`auto-writer-modal`、`continue-chapters-modal`、`outline-to-text-expander`、`ai-scene-expander`、`scene-body-generator` 均调用 `describeBodyFormat()`。
- 扩写结果的分段解析必须与 prompt 契约一致：`outline-to-text-expander.ts#splitParagraphsByContract(content, separator)`。`\n` 契约下每个非空行一段，`\n\n` 契约下空行分段；禁止写死只认空行的解析器。
- 正文类展示容器（建议卡、历史、流式、浮动面板）必须声明 `white-space: pre-wrap`：卡片用单个文本节点写入 `\n`，默认 `normal` 会把换行折叠成空格，表现为「生成时分段、完成瞬间变一行」。
- 工作台步骤状态只有一套失效传播：`ChapterStateManager.invalidateSteps(keys)` 同步维护 `stepCompleted / stepLevels / staleSteps`。禁止只删 `stepCompleted` 或在别处手写 delete 列表。正文/修正被改写时（工作台保存、润色自动保存、消痕/精修/逐轮选择）统一传 `BODY_CHANGE_INVALIDATED_STEPS`（`engine/step-definitions.ts`），不得各写一份下游列表。
- **步骤完成度只有一个判定入口**：`validateStepResult(stepKey, content).valid`；需要排除模板骨架的场景（断点续跑、磁盘恢复）用 `isStepResultComplete(stepKey, content)`。落盘 `step_status` 只有 `complete` 才写 `generated`，其余写 `partial`。禁止再出现「文件非空即完成」「手动保存强制 complete」「`generated` 直接判完成」三种旁路；恢复时只有人工审阅过的 `reviewed` 可信。
- **批量取消必须真正停止写入**：`BatchChaptersModal` 持有 `AbortController`，`onClose` 必须 `abort()`；每章/每步/每次 `callAI` 与正文落盘前都要检查取消状态。`StepRunner.executeCurrentStep` 在 `finishReason === 'aborted'` 或 signal 已取消时必须直接返回，不保存、不标记完成；调用方不得只判 `result.error`（abort 没有 `error`）。
- 规划类步骤（`infoPlan / plotDistill / outline / emotionPlan / sceneExpand`）变更时，必须通过 `downstreamStepsAfterPlanningChange(stepKey, hasBody)` 失效 `bodyGeneration / qualityControl / analysisReport / settlement`；正文尚未生成时该函数返回空数组，避免把空正文标成「待重做」。AI 完成路径在 `StepRunner` 内统一调用，手动保存路径（通用结果区与 Scene 编辑器）各自调用。
- 阶段导航表由 `ALL_FULL_STEPS` 派生（`streamlined-nav-presenter.ts`），禁止手写 index；模块加载时会检查是否有步骤未被任何阶段覆盖。阶段点击定位「第一个未完成步骤」，不是最后一个已完成步骤。**阶段完成口径**：阶段内 `required` 步骤全部完成即算完成，可选步骤不阻塞（title 显示「可选 x/y」）；全可选阶段（质量审查）做过任意一步即完成。步骤级状态（✅/◐/○/⚠️ + 必做标记）由 `step-render-controller` 逐条渲染，子项只在阶段可点击时绑定跳转。
- **章节创作 prompt 必须吃向导产物**：INFO_PLAN / PLOT_DISTILL / OUTLINE / 合并规划 / 正文 V1/V2 都要从 `template-vars-builder` 取 `worldView` / `settingLib` / `writingStyleContent`，不得出现「向导生成了但章节步骤读不到」。新增占位符必须同时在 `buildTemplateVars` 末尾做空串兜底，否则上下文缺失时 `${...}` 会以字面量漏进 prompt。
- **正文文笔指纹只有一个注入口**：11 步流水线的 `bodyGeneration` 经 `step-prompt-assembly` 的 `loadBodyKnowledge` 调用 `KnowledgeInjector.injectForBodyGeneration`，作为可丢弃 `extraTail`；不要再在别处直拼 system（会绕过预算闸门）。
- **跨章承接**：规划与正文模板必须带 `prevChapEnding`（上一章结尾原文）与 `prevChaptersSummary`；OUTLINE/SCENE_EXPAND 必须声明「第一场景承接上一章结尾、跳时间/地点写清过渡、禁止无过渡换场」。合并规划 `executePlanningCombined` 必须过 `fitPromptToContext`，补齐资料后不允许绕过预算闸门。
- **合一规划成功判定只有一个入口**：`planning-combined.ts#evaluateCombinedPlanning`（本次有效产出 / 仍缺失 / `infoPlan + outline` 最低条件）；禁止在 `executePlanningCombined` 内再写 `successCount >= 3` 或另一套缺失判断。模块有效产出的最小长度统一为 `COMBINED_PLANNING_MIN_MODULE_CHARS`。
- **信息可用性约束（Rev 177）**：`required` 只是「最低可交付」标记，**不代表下游不消费**——`outline / plotDistill / emotionPlan / sceneExpand` 都被正文模板真实消费。任何被消费的数据缺失时，`template-vars-builder` 必须写入显式缺失标记 + 禁令（如「不得自行新增情节节点/反转/信息释放」），禁止用空串或「自由发挥」；新增消费面时必须同时在 V1/V2 模板与 `scene-expander.ts`（实际生成模板，`soul-driven-prompts.ts` 只服务 UI 路由）补齐。prompt 裁剪必须走 `fitPromptToContext({ sectionAware: true })`，低优先段整段丢弃而不是腰斩关键资料；实体注入走 `scoreAndFilterEntitiesByType` 分类预算，主角强制保留。角色灵魂层只认 `hasSoul` 的 9 字段，禁止再用 `personality / background` 之类不存在的字段冒充。
- 正文被其他入口覆写后 `BodyWriter` 会广播 `novel-writer:body-written`；工作台只在该路径等于当前章节正文时重新 `restoreChapterState` + 重渲染，避免展示旧状态。
- 章节结算步骤（`settlement`）参与磁盘恢复（`stepFileMap` 映射到 `结算表`），不再出现「重启后结算永远未完成」。
- 读取规划文件喂给 `ChapterBrief` 前必须剥离 YAML frontmatter（`loadChapterBriefInput.read` + `chapter-brief#stripFrontmatter` 双层）：大纲与情节蒸馏拼接后，第二份 frontmatter 位于文本中间，只剥离开头会让简报直接显示 `step_status: ...`。
- 程序化写入 `editor.value`（接受建议、插入扩写等）不会触发 `input` 事件，写完后必须显式刷新依赖正文的 UI 状态（至少调用 `updateStartButtonState()`），否则主按钮会停留在「✍️ 生成开头」。
- 插件启动若 API Key 启用了口令加密，`settingsService.loadSettings()` 会等待口令弹窗；未处理时 Phase 6 之后的引擎（含 `coWriterEngine`）不会注册。排查「协同写作无建议」时先确认口令弹窗与 `engineRegistry.lazyFactories` 是否为空。

回归命令：

```bash
npx vitest run tests/unit/shared/template-validator.test.ts tests/unit/shared/entity-persistence.test.ts tests/unit/shared/entity-audit.test.ts tests/unit/ui/wizard-step-validators.test.ts tests/unit/ui/writing-style-presets.test.ts
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
npm run build          # 生产构建（同步版本号 + 生成内置模板资源 + 拼接样式）
npm run build:release  # 发布构建：先跑 preflight，再 build
npm run preflight      # typecheck + test + check:templates + check:styles + check:css/内联样式 + 两道架构守卫（基线门）
npm run dev            # 开发模式（watch，前置同样生成模板与样式）
npm run typecheck      # 类型检查
npm run version:sync   # 同步版本号
npm run gen:templates  # 由 assets/template-scaffold 重新生成内置模板模块
npm run check:templates # 校验生成物与资源目录一致（CI 使用）
npm run build:styles   # 由 styles-src/*.css 拼接生成根 styles.css
npm run check:styles   # 校验 styles.css 与 styles-src 源文件一致（CI 使用）
npm run check:release  # 发布前资产与版本一致性校验
```

### 样式源文件（styles-src/）

- 根目录 `styles.css` 是**自动生成产物**，不要直接编辑；源文件在 `styles-src/`（`00-header.css` … `15-late-fixes.css` 共 16 个）。
- 文件名顺序（`localeCompare('en')`）就是拼接顺序，也就是层叠顺序；新增文件按编号插入，不要打乱既有文件顺序。
- 修改样式：编辑 `styles-src/` 对应文件 → `npm run build:styles` → `npm run check:css`。`preflight` 内置 `check:styles`，只改根 `styles.css` 会以「产物漂移」失败。
- 拼接是**纯文本**（不压缩、不合并选择器），保证与拆分前逐字节等价；头部注释由脚本自动生成，不要手写。

### 构建产物压缩约束（2026-10-31 批次 12）

`scripts/build.js` 对三个入口（`main.ts` + 两个 worker）开启 `minify: true` 与 `charset: 'utf8'`（`main.js` 9,089,917 → 4,798,890 字节，-47.2%）。`charset` 必须显式设为 `utf8`：esbuild 默认 `ascii` 会把中文提示词 / 模板转成 `\uXXXX`，实测多出约 1.6 MB。

压缩带来两条硬约束，改代码时先看：

1. **禁止对 `main.js` 断言非字符串内容**。模块路径注释、顶层变量名、函数名都会被压缩掉。需要校验产物内含某模块，只能断言**字符串字面量**（模板 key、版本号等），见 `scripts/check-release.mjs` 的 `markers` 实现。
2. **禁止依赖标识符反射**。`constructor.name`、`Function.name`、`fn.toString()` 在压缩后不可靠（本项目已核：`createWorkerFromHandlers` 这类 `handler.toString()` 方案无任何调用点）。

产物是 CJS（`format: 'cjs'`，`external: ['obsidian']`），压缩后仍需保留 `module.exports` 与版本字面量；构建后用 `node --check main.js` 与 `npm run check:release` 验证。

### 异步等待原语（2026-10-31 批次 14）

`shared/yield.ts` 是唯一的等待原语来源，业务代码里**禁止裸写 `await new Promise(r => setTimeout(r, 0|16))`**：

| 场景 | 用法 |
|---|---|
| 长同步循环中让出事件循环（批量处理的进度刷新） | `await yieldToUI()` —— `setTimeout(0)`，只保证让出当前 tick，不等渲染 |
| 刚改完 DOM 就要测量 / 聚焦 / 滚动 / 让动画先画出来 | `await nextFrame()` —— 双重 `requestAnimationFrame`，等一帧绘制完成 |

`nextFrame()` 内部已处理两个历史坑，不要在调用处再写：**后台窗口 / 最小化时 rAF 可能长时间不触发**（P0-2 事故：流程永久挂起），内部与 50ms 超时竞速；**jsdom 单测无 rAF**，退化为 `setTimeout(16)`。

以下 `setTimeout` 形态**不要**改成 await，改了会变语义：debounce 合并刷新（`knowledge-base-view` 的 `completeRefreshTimer`）、限流器队列调度（`token-bucket-rate-limiter`）、`window.setTimeout(cb, 0)` 同步回调（自动尺寸计算、聚焦，如 `manage-providers-modal` / `rename-project-modal`）。

### catch 日志分级（2026-10-31 批次 14）

每条 `catch` 写日志时必须能回答三件事：**失败对象**（哪个实体 / 维度 / 文件）、**场景**（正在做什么）、**可重试性**（可重试 / 不可重试 / 可降级继续）。级别按失败性质选，不按习惯选：

| 失败性质 | 级别 | 处理 |
|---|---|---|
| 业务失败（结果不可用，用户需要知道） | `error` | 上抛或弹 Notice / 返回明确失败结果 |
| 可重试失败（网络抖动、限流、超时） | `warn` | 走统一重试（见 `shared/http-request.ts`），日志记尝试次数 |
| 可降级失败（可选增强、可选统计） | `warn` | 写明降级去向，如「降级为纯统计结果」，不重试 |

样例（可降级失败）：`engine/deconstructors/foreshadow-deconstructor.ts` 的 LLM 增强与向量增强两处 `catch`，日志带 `维度=foreshadow 文本长度=N 可重试=否`。

现状：全库 `catch` 1,504 次（排除 `node_modules` 实测），未做全量分级。新增 / 修改代码按本约定写；存量按「改到哪里、顺手改到哪里」增量推进。

架构守卫使用 `.arch-baseline.json` 做棘轮（`dependencyLayerViolations` / `dependencyCycles` / `engineBypass` / `engineOverLimit`）：只有**新增**违规才失败，消除违规后用 `--update-baseline` 收紧；`--update-baseline` 在有新增时会拒绝写入，避免把新债记进基线。

**口径（2026-10-31 批次 3 修正，先看这里再看数字）**：`scripts/check-dependencies.mjs` 只把**运行时**依赖计入门禁——`import type X from '…'`、`import { type A } from '…'` 编译后整句擦除，不计入分层违规、不参与成环；解析前先剥离注释，避免文档里的 import 示例被当成真实依赖（曾造成 `write-lock.ts` / `entity-models.ts` 两个假自环）。类型耦合以 `ℹ️` 提示单独列出，不参与棘轮。因此「53 个循环」其实只有 9 个运行时循环，「64 条分层违规」其实是 55 条运行时 + 9 条类型。引用这两个数字时必须说明口径，不要拿旧口径和当前基线对比。

**引擎名称常量**：唯一来源是 `shared/engine-names.ts` 的 `ENGINE_NAMES`。`engine/engine-registry.ts` 只做再导出以兼容旧引用；**新代码与既有代码都直接从 `shared/engine-names` 引入**，禁止再从 `engine-registry` 取常量——那会给 `core` / `engine` 各模块拉出指向注册表的运行时边，与「注册表 → 具体引擎」的构造依赖闭合成环（批次 3 已经因为这条边产生 3 个循环）。

**EngineRegistry 的 UI 能力注入**：engine 层禁止 import `ui/`。口令弹窗与模板管理器通过 `initialize(plugin, { settingsWriter, passwordPort, createTemplateManager })` 由 `main.ts` 注入；新增类似能力时同样走 `InitializeOptions` 端口，不在 engine 内 `new` UI 组件。

### 测试命令

```bash
npm test               # 单元测试
npm run test:cov       # 单元测试 + 覆盖率门禁（engine/services/core 分域阈值）
npm run test:e2e       # E2E：真实 Electron 链路，需 OBSIDIAN_PATH
npm run test:e2e:ui    # E2E 测试（UI 模式）
npm run test:e2e:report # 查看 E2E 测试报告
npm run check:deps     # 依赖分层/循环依赖扫描（存量问题见输出）
npm run audit:deps     # 生产依赖安全审计
```

E2E（FR-E-10）使用 Playwright `_electron` 启动本机 Obsidian，临时 vault 中安装构建产物并启用插件，覆盖「创建项目 → 打开完整写作工作台」。未设置 `OBSIDIAN_PATH` 或路径不存在时用例显式 skip；CI 中的 `e2e-obsidian` job 仅在配置该仓库变量后运行。详见 `tests/e2e/README.md`。

覆盖率口径（FR-E-05）：统计 `engine/` `services/` `core/`，排除 `*.d.ts`、测试与 `*-worker.ts` 入口；阈值分域设定，低于阈值时 Vitest 以非零码退出，CI 的 `test:cov` 步骤据此阻断合并。

### 当前验证状态

最新基线与用例数只写在 `docs/progress/program-status.json`（报告：[`progress/PROGRAM-STATUS.md`](progress/PROGRAM-STATUS.md)）。本节不再记录具体数字，避免多份口径漂移。

- `npm run preflight`：本地总门禁（类型、Lint、全量测试、模板/样式/CSS/分层/引擎/文档/JSDoc、构建、发布资产）。
- `npm run test:cov`：覆盖率门禁（口径与阈值见 `vitest.config.ts`）。
- `npm run test:e2e`：未配置 `OBSIDIAN_PATH` 时 Electron 用例显式跳过；配置后覆盖真实 Obsidian 旅程。
- `npm run check:release -- --tag vX.Y.Z`：发布资产与版本一致性。
- CI / 发布流水线位于 `.github/workflows/`（PR 全量门禁；`v*` tag 自动发布；E2E 为条件 job）。
- `check:deps` / `check-engines` 为棘轮：存量违规记入 `.arch-baseline.json`，只允许减少，新增即失败。

### 发布流程

1. 修改 `package.json` 的 `version`，执行 `npm run version:sync` 同步 `manifest.json`。
2. 本地执行全量 Gate：`npm run build:release`（内部先跑 `preflight`：typecheck / test / check:templates / 两道架构守卫）→ `check:release`。
3. 合并到 `master` 后打 annotated tag（`vX.Y.Z`）。
4. 推送 tag：`.github/workflows/release.yml` 会重新执行 Gate 并创建/更新 GitHub Release（核心文件 + `workers/*.js` + 含 Worker 的 zip；任一资产缺失即中止）。

> 构建产物策略（FR-E-04）：`main.js`、`workers/`、`.hotreload` 一律不入仓，由 `npm run build` 生成；CI 会校验这些文件未被 Git 跟踪。

### 内置模板资源

- 资源源文件位于 `assets/template-scaffold/`；修改后执行 `npm run gen:templates` 更新 `shared/template-scaffold-assets.generated.ts`。
- 生成物随 `main.js` 打包，保证仅安装 3 个发布文件时也能自举 `元文件/`。
- 禁止在资源中放置示例项目数据或第三方作品原文（单测会校验受限内容）。

### 引擎合规检查

```bash
npm run check-engines  # 检查引擎实例化合规性
npm run check-engines -- --baseline .arch-baseline.json  # 只对新增违规失败
```

---

## 七、相关文档

- [架构视图](./ARCHITECTURE.md) — 分层架构与设计决策
- [性能优化指南](./PERFORMANCE.md) — 缓存策略与性能监控
- [API 文档](./API.md) — 完整 API 参考
- [Repository 迁移指南](../engine/repository/MIGRATION.md) — 旧代码渐进式迁移