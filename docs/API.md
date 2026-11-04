# API 文档

> **版本**: v4.27.1
> **最后更新**: 2026-11-02
> **状态**: 活跃可信 · 签名参考（契约规则见 [handbook/04-interface-contracts.md](handbook/04-interface-contracts.md)）
> **说明**: 本文是签名索引，不定义兼容承诺；公开/内部边界与废弃策略以 handbook 04 为准。

本文档列出 Novel Writer AI 插件的核心 API，重点覆盖 Repository、Store、流式、缓存和性能监控模块。
所有 API 均基于实际代码，导入路径相对于 `engine/` 或 `shared/` 目录。

---

## 一、Repository 层 API

### 导入

```typescript
// 核心接口和实现
import {
    IRepository,
    IBulkRepository,
    BaseMarkdownRepository,
    LruCache,
    CharacterRepository,
    ChapterRepository,
    ProjectRepository,
    FactionRepository,
    LocationRepository,
    ItemRepository,
} from './repository';

// 领域类型
import {
    BaseEntity,
    Character,
    Chapter,
    Project,
    Faction,
    Location,
    Item,
    EntityFactory,
    FrontmatterSerializer,
} from './repository/domain';
```

---

### 1.1 IRepository<T, TId> 接口

泛型数据访问核心接口。
**定义**: `engine/repository/interfaces.ts`

```typescript
export interface IRepository<T, TId> {
    findById(id: TId): Promise<T | null>;
    findAll(): Promise<T[]>;
    save(entity: T): Promise<T>;
    delete(id: TId): Promise<boolean>;
    exists(id: TId): Promise<boolean>;
}
```

| 方法 | 说明 |
|------|------|
| `findById(id)` | 根据 ID 查找，不存在返回 null |
| `findAll()` | 查找所有实体 |
| `save(entity)` | 保存（新增或更新） |
| `delete(id)` | 删除，返回是否成功 |
| `exists(id)` | 检查是否存在 |

---

### 1.2 IBulkRepository<T, TId> 接口

批量操作扩展接口。
**定义**: `engine/repository/interfaces.ts`

```typescript
export interface IBulkRepository<T, TId> extends IRepository<T, TId> {
    saveAll(entities: T[]): Promise<BulkResult<T>>;
    deleteAll(ids: TId[]): Promise<BulkResult<TId>>;
    findAllById(ids: TId[]): Promise<T[]>;
}

export interface BulkResult<T> {
    success: T[];
    failures: BulkFailure<T>[];
    successCount: number;
    failureCount: number;
}

export interface BulkFailure<T> {
    item: T | unknown;
    error: Error;
    index: number;
}
```

| 方法 | 说明 |
|------|------|
| `saveAll(entities)` | 批量保存，失败记录到 failures |
| `deleteAll(ids)` | 批量删除 |
| `findAllById(ids)` | 批量查找，未找到的不包含在结果中 |

---

### 1.3 BaseMarkdownRepository 抽象类

Markdown + Frontmatter 的持久化基类。
**定义**: `engine/repository/base-markdown-repository.ts`

```typescript
export abstract class BaseMarkdownRepository<T, TId = string>
    implements IBulkRepository<T, TId>
```

**构造函数**:
```typescript
constructor(
    fs: FileSystemPort,
    options?: BaseMarkdownRepositoryOptions,
)
```

**配置选项**:
```typescript
export interface BaseMarkdownRepositoryOptions {
    cacheMaxSize?: number;          // 默认 100
    cacheTtlMs?: number;            // 默认 5 分钟
    cacheEnabled?: boolean;          // 默认 true
    multiLayerCache?: MultiLayerCache;  // L2 缓存
    cacheKeyPrefix?: string;         // 默认 ''
}
```

**抽象方法（子类必须实现）**:
| 方法 | 说明 |
|------|------|
| `idFromEntity(entity): TId` | 从实体提取 ID |
| `filePathFromId(id): string` | ID → 文件路径 |
| `deserialize(content, filePath): T` | Markdown → 实体 |
| `serialize(entity): string` | 实体 → Markdown |

**可覆盖的辅助方法**:
| 方法 | 说明 |
|------|------|
| `getBasePath(): string` | 基础目录路径（用于 findAll 扫描） |
| `idFromFilePath(filePath): TId` | 文件路径 → ID |
| `sampleId(): TId` | 示例 ID（用于创建 basePath） |
| `ensureParentDir(filePath)` | 确保父目录存在 |

**缓存管理方法**:
| 方法 | 说明 |
|------|------|
| `clearCache()` | 清除所有缓存（L1+L2） |
| `invalidateCache(id)` | 失效指定 ID 的缓存 |
| `invalidateCacheByPrefix(prefix)` | 按前缀失效缓存 |
| `pruneExpiredCache(): number` | 清理过期条目，返回清理数量 |
| `cacheSize: number` | 当前 L1 缓存条目数（只读） |

---

### 1.4 ProjectRepository（全局单例）

项目元数据持久化。
**定义**: `engine/repository/project-repository.ts`

```typescript
export class ProjectRepository extends BaseMarkdownRepository<Project, string>
```

**构造函数**: `constructor(fs: FileSystemPort, options?: BaseMarkdownRepositoryOptions)`

**特定查询方法**:
| 方法 | 说明 |
|------|------|
| `getMeta(projectId): Promise<ProjectMeta \| null>` | 获取项目元数据 |
| `updateMeta(projectId, meta): Promise<Project \| null>` | 更新项目元数据 |
| `findByGenre(genre): Promise<Project[]>` | 按题材查找 |
| `findByType(type): Promise<Project[]>` | 按类型查找 |
| `findByAuthor(author): Promise<Project[]>` | 按作者查找 |

---

### 1.5 ChapterRepository（项目级）

章节持久化，章节 ID 格式：`v{volN}-c{chapN}`（如 `v1-c1`）。
**定义**: `engine/repository/chapter-repository.ts`

```typescript
export class ChapterRepository extends BaseMarkdownRepository<Chapter, string>
```

**构造函数**:
```typescript
constructor(
    fs: FileSystemPort,
    project: string,
    options?: BaseMarkdownRepositoryOptions,
)
```

**特定查询方法**:
| 方法 | 说明 |
|------|------|
| `findByVolume(volN): Promise<Chapter[]>` | 按卷查找 |
| `findByStatus(status): Promise<Chapter[]>` | 按状态查找（pending/written/settled） |
| `findByWordCountRange(min, max): Promise<Chapter[]>` | 按字数范围查找 |
| `findByVolChap(volN, chapN): Promise<Chapter \| null>` | 按卷章号查找 |
| `countByVolume(volN): Promise<number>` | 获取某卷章节总数 |
| `getAllVolumes(): Promise<number[]>` | 获取所有卷号 |
| `getRelatedCharacterNames(chapterId): Promise<string[]>` | 获取章节涉及人物 |
| `getRelatedLocationNames(chapterId): Promise<string[]>` | 获取章节涉及地点 |
| `getRelatedFactionNames(chapterId): Promise<string[]>` | 获取章节涉及势力 |
| `getRelatedItemNames(chapterId): Promise<string[]>` | 获取章节涉及物品法术 |
| `findChaptersByCharacter(name): Promise<Chapter[]>` | 查找某人出现的所有章节 |
| `findChaptersByLocation(name): Promise<Chapter[]>` | 查找某地点出现的所有章节 |
| `findChaptersByFaction(name): Promise<Chapter[]>` | 查找某势力出现的所有章节 |
| `findChaptersByItem(name): Promise<Chapter[]>` | 查找某物品出现的所有章节 |
| `getProjectName(): string` | 获取项目名称 |

---

### 1.6 CharacterRepository（项目级）

人物持久化。
**定义**: `engine/repository/character-repository.ts`

**特定查询方法**:
| 方法 | 说明 |
|------|------|
| `findByFaction(factionName): Promise<Character[]>` | 按所属势力查找 |
| `findByStatus(status): Promise<Character[]>` | 按状态查找（active/inactive/dead/hidden） |
| `findByIdentity(identity): Promise<Character[]>` | 按身份查找（主角/配角/反派/路人） |
| `findByName(name): Promise<Character[]>` | 按姓名模糊查找 |
| `findByCurrentLocation(location): Promise<Character[]>` | 按当前位置查找 |
| `getProjectName(): string` | 获取项目名称 |

---

### 1.7 FactionRepository（项目级）

势力持久化。
**定义**: `engine/repository/faction-repository.ts`

**特定查询方法**:
| 方法 | 说明 |
|------|------|
| `findByLeader(leaderName): Promise<Faction[]>` | 按首领查找 |
| `findByType(type): Promise<Faction[]>` | 按类型查找 |
| `findByStatus(status): Promise<Faction[]>` | 按状态查找 |
| `findByName(name): Promise<Faction[]>` | 按名称模糊查找 |

---

### 1.8 LocationRepository（项目级）

地点持久化。
**定义**: `engine/repository/location-repository.ts`

**特定查询方法**:
| 方法 | 说明 |
|------|------|
| `findByRegion(region): Promise<Location[]>` | 按区域/世界查找 |
| `findByImportance(importance): Promise<Location[]>` | 按重要程度查找 |
| `findByType(type): Promise<Location[]>` | 按类型查找 |
| `findByStatus(status): Promise<Location[]>` | 按状态查找 |
| `findByName(name): Promise<Location[]>` | 按名称模糊查找 |

---

### 1.9 ItemRepository（项目级）

物品法术持久化。
**定义**: `engine/repository/item-repository.ts`

**特定查询方法**:
| 方法 | 说明 |
|------|------|
| `findByOwner(ownerName): Promise<Item[]>` | 按所有者查找 |
| `findByGrade(grade): Promise<Item[]>` | 按品级/等级查找 |
| `findByType(type): Promise<Item[]>` | 按类型查找 |
| `findByStatus(status): Promise<Item[]>` | 按状态查找 |
| `findByName(name): Promise<Item[]>` | 按名称模糊查找 |

---

### 1.10 EntityFactory（实体工厂）

提供 fromMarkdown / toMarkdown 工厂方法。
**定义**: `engine/repository/domain/serializers/entity-factory.ts`

```typescript
export class EntityFactory {
    static characterFromMarkdown(content: string, filePath?: string): Character;
    static characterToMarkdown(character: Character): string;
    static factionFromMarkdown(content: string, filePath?: string): Faction;
    static factionToMarkdown(faction: Faction): string;
    static locationFromMarkdown(content: string, filePath?: string): Location;
    static locationToMarkdown(location: Location): string;
    static itemFromMarkdown(content: string, filePath?: string): Item;
    static itemToMarkdown(item: Item): string;
    static chapterFromMarkdown(content: string, filePath?: string): Chapter;
    static chapterToMarkdown(chapter: Chapter): string;
    static projectFromMarkdown(content: string, filePath?: string): Project;
    static projectToMarkdown(project: Project): string;
}
```

---

### 1.11 BaseEntity（实体基类）

**定义**: `engine/repository/domain/aggregates/base-entity.ts`

```typescript
export abstract class BaseEntity {
    protected constructor(props: BaseEntityProps);

    get id(): string;
    get name(): string;
    get filePath(): string;
    get tags(): string[];
    get entityStatus(): EntityStatus | null;
    get createdAt(): string | null;
    get lastChangedAt(): string | null;
    get lastChangedReason(): string | null;
    get frontmatter(): Frontmatter;
    get body(): string;
    get content(): MarkdownContent | null;

    abstract get category(): EntityCategory;
    abstract withStatus(status: EntityStatus): BaseEntity;
    abstract withName(name: string): BaseEntity;

    addTag(tag: string): string[];
    removeTag(tag: string): string[];
    hasTag(tag: string): boolean;
    toJSON(): Record<string, any>;
    equals(other: BaseEntity): boolean;
}
```

---

## 二、Store API

### 导入

```typescript
import {
    createStore,
    subscribeWithSelector,
    compose,
    applyMiddleware,
    shallow,
    logger,
    devtools,
    persist,
    thunk,
    createObsidianSettingStorage,
    createIndexedDbStorage,
} from '../shared/store';
```

---

### 2.1 createStore / subscribeWithSelector

**定义**: `shared/store/createStore.ts`

```typescript
export function createStore<T extends State>(
    initialState: T | (() => T),
): StoreApi<T>;

export function subscribeWithSelector<T extends State>(
    store: StoreApi<T>,
): SubscribeWithSelector<T>;
```

**StoreApi 接口**:
```typescript
export interface StoreApi<T extends State> {
    getState: () => T;
    setState: (partial: PartialState<T>, replace?: boolean) => void;
    subscribe: (listener: StateListener<T>) => () => void;
    destroy: () => void;
}
```

**基本用法**:
```typescript
interface MyState {
    count: number;
    name: string;
}

const store = createStore<MyState>({ count: 0, name: 'test' });

// 读取
console.log(store.getState().count);  // 0

// 更新（合并）
store.setState({ count: 1 });

// 函数式更新
store.setState((prev) => ({ count: prev.count + 1 }));

// 订阅
const unsubscribe = store.subscribe((state, prevState) => {
    console.log('状态变化:', prevState, '→', state);
});

// 取消订阅
unsubscribe();

// 销毁
store.destroy();
```

**选择器订阅**:
```typescript
const storeWithSelector = subscribeWithSelector(store);

storeWithSelector.subscribe(
    (state) => state.count,
    (count, prevCount) => {
        console.log('count 变化:', prevCount, '→', count);
    },
    {
        equalityFn: shallow,
        fireImmediately: false,
    },
);
```

---

### 2.2 中间件：logger / devtools / persist / thunk

#### logger 中间件
**定义**: `shared/store/middleware/logger.ts`

```typescript
logger(options?: LoggerOptions): Middleware<T>
```

```typescript
import { logger } from '../shared/store';

const store = compose(
    logger({ name: 'MyStore' }),
)(createStore({ count: 0 }));
```

#### devtools 中间件
**定义**: `shared/store/middleware/devtools.ts`

```typescript
devtools(options?: DevtoolsOptions): Middleware<T>
```

```typescript
import { devtools } from '../shared/store';

const store = compose(
    devtools({ name: 'MyStore', enabled: true }),
)(createStore(initialState));
```

#### persist 中间件
**定义**: `shared/store/middleware/persist.ts`

```typescript
persist(options: PersistOptions<T, PersistedState>): Middleware<T>
```

```typescript
import {
    persist,
    createObsidianSettingStorage,
    createIndexedDbStorage,
} from '../shared/store';

// 方式 1：Obsidian 插件设置（小数据）
const store = compose(
    persist({
        name: 'my-store',
        storage: createObsidianSettingStorage({
            plugin: pluginInstance,
            key: 'myStore',
        }),
        version: 1,
        partialize: (state) => ({ count: state.count }),
    }),
)(createStore({ count: 0, name: 'test' }));

// 方式 2：IndexedDB（大数据）
const store2 = compose(
    persist({
        name: 'edit-history',
        storage: createIndexedDbStorage({
            dbName: 'novel-writer-store',
            storeName: 'persist',
            version: 1,
        }),
    }),
)(createStore({ history: [] }));

// 持久化 API
const persistStore = store as PersistApi<typeof initialState>;
await persistStore.persist.rehydrate();
persistStore.persist.hasHydrated();
persistStore.persist.onHydrate(fn);
persistStore.persist.onFinishHydration(fn);
```

**PersistOptions 完整接口**:
```typescript
export interface PersistOptions<T, PersistedState extends State = T> {
    name: string;
    storage?: PersistStorage<PersistedState>;
    partialize?: (state: T) => PersistedState;
    version?: number;
    migrate?: (persistedState: unknown, version: number) => PersistedState | Promise<PersistedState>;
    merge?: (persistedState: PersistedState, currentState: T) => T;
    onRehydrateStorage?: (state: T) => ((state: T, error?: unknown) => void) | void;
}
```

#### thunk 中间件
**定义**: `shared/store/middleware/thunk.ts`

```typescript
thunk(): Middleware<T>
```

```typescript
import { thunk } from '../shared/store';

const store = compose(
    thunk(),
)(createStore(initialState));

// 异步 action
const fetchUser = (userId: string) => {
    return async (set, get) => {
        set({ isLoading: true });
        try {
            const user = await api.fetchUser(userId);
            set({ user, isLoading: false });
        } catch (e) {
            set({ error: e, isLoading: false });
        }
    };
};

// dispatch 异步 action
await store.dispatch(fetchUser('user1'));
```

#### compose / applyMiddleware

**定义**: `shared/store/compose.ts`

```typescript
export function compose<T extends State>(
    ...middlewares: Array<(store: StoreApi<T>) => StoreApi<T>>
): (store: StoreApi<T>) => StoreApi<T>;

export function applyMiddleware<T extends State>(
    ...middlewares: Array<(store: StoreApi<T>) => StoreApi<T>>
): (initialState: T | (() => T)) => StoreApi<T>;
```

```typescript
// 方式 1：组合后应用
const store = compose(
    logger(),
    persist({ name: 'my-store' }),
    thunk(),
)(createStore({ count: 0 }));

// 方式 2：创建带中间件的 createStore
const createStoreWithMiddleware = applyMiddleware(
    logger(),
    persist({ name: 'my-store' }),
);
const store2 = createStoreWithMiddleware({ count: 0 });
```

---

### 2.3 CoWritingSessionStore（协同写作 Store 工厂）
**定义**: `engine/co-writer/create-session-store.ts`

```typescript
export type CoWritingSessionStore =
    & StoreApi<CoWritingSessionState>
    & PersistApi<CoWritingSessionState>
    & ThunkApi<CoWritingSessionState>
    & DevtoolsApi<CoWritingSessionState>
    & SubscribeWithSelector<CoWritingSessionState>
    & {
        actions: AllActionCreators;
        thunks: ReturnType<typeof createThunkActions>;
    };

export function createCoWritingSessionStore(
    options?: CreateCoWritingSessionStoreOptions,
): CoWritingSessionStore;
```

**配置选项**:
```typescript
export interface CreateCoWritingSessionStoreOptions {
    plugin?: {
        settings: Record<string, unknown>;
        saveSettings: () => Promise<void> | void;
        loadSettings: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    };
    storage?: PersistStorage<PersistedCoWritingState>;
    persistName?: string;          // 默认 'co-writing-session'
    persistVersion?: number;        // 默认 1
    enableLogger?: boolean;         // 默认 false
    enableDevtools?: boolean;       // 默认 false
    devtoolsName?: string;          // 默认 'CoWritingSession'
    deps?: ThunkDependencies;
    initialState?: Partial<CoWritingSessionState>;
}
```

**使用示例**:
```typescript
import { createCoWritingSessionStore } from '../engine/co-writer';

const store = createCoWritingSessionStore({
    plugin: pluginInstance,
    enableLogger: isDev,
    enableDevtools: isDev,
    deps: {
        chapterRepository: { /* ... */ },
        coWriterEngine: { /* ... */ },
    },
});

store.setState(store.actions.setRightPanelTab('metrics'));
await store.dispatch(store.thunks.fetchChapter('project1', 1, 1));

store.subscribe(
    (state) => state.suggestions,
    (suggestions) => render(suggestions),
    { equalityFn: shallow },
);
```

---

### 2.4 持久化存储适配器

#### createObsidianSettingStorage
**定义**: `shared/store/middleware/persist.ts`

```typescript
createObsidianSettingStorage<S extends State>(
    options: ObsidianPluginSettingStorageOptions,
): PersistStorage<S>
```

适用于小数据量（用户偏好、当前项目等），数据存储在 `data.json` 中。

```typescript
import { createObsidianSettingStorage } from '../shared/store';

const storage = createObsidianSettingStorage({
    plugin: pluginInstance,
    key: 'myStore',
});
```

#### createIndexedDbStorage
**定义**: `shared/store/middleware/persist.ts`

```typescript
createIndexedDbStorage<S extends State>(
    options?: IndexedDbStorageOptions,
): PersistStorage<S>
```

适用于大数据量（编辑历史、缓存数据等），不支持 IndexedDB 时自动降级为内存存储。

```typescript
import { createIndexedDbStorage } from '../shared/store';

const storage = createIndexedDbStorage({
    dbName: 'novel-writer-store',
    storeName: 'persist',
    version: 1,
});
```

---

## 三、流式 API

### 导入

```typescript
// 流式解析
import {
    StreamParser,
    parseSSERaw,
    parseOpenAISSE,
    parseOllamaLine,
    detectStreamFormat,
    parseReadableStream,
} from '../streaming';

// 模拟流式
import {
    createSimulatedStream,
    createSimulatedStreamWithSignal,
    splitTextIntoChunks,
} from '../streaming';
```

---

### 3.1 callAIAsyncIterator

**定义**: `engine/ai-api-client.ts` / `engine/ai-engine.ts`

```typescript
class AIApiClient {
    async *callAIAsyncIterator(
        systemPrompt: string,
        userPrompt: string,
        model?: string,
        temperature?: number,        // 默认 0.7
        maxTokens?: number,          // 默认 4096
        options?: {
            isWritingTask?: boolean;
            signal?: AbortSignal;
            endpoint?: string;
            apiKey?: string;
            disableFallback?: boolean;
            forceSimulated?: boolean;
        },
    ): AsyncGenerator<string, APIResponse, unknown>;
}
```

**三阶段降级策略**:
1. **原生 SSE 流式**：调用 API 流式接口
2. **模拟流式**：一次性请求后分段输出
3. **完整响应**：非流式调用

```typescript
import { AIApiClient } from '../engine/ai-api-client';

const client = new AIApiClient(plugin);
const iterator = client.callAIAsyncIterator(
    systemPrompt,
    userPrompt,
    'gpt-4',
    0.7,
    4096,
    { isWritingTask: true, signal: controller.signal },
);

for await (const chunk of iterator) {
    renderToUI(chunk);
}

const result = await iterator.next();
// result.value = { content, usage?, error? }
```

---

### 3.2 suggestStream（CoWriterEngine）
**定义**: `engine/co-writer-engine.ts`

```typescript
class CoWriterEngine {
    async *suggestStream(
        precedingText: string,
        cursorHint: string,
        mode: string,
        directionIndex: number,
        signal?: AbortSignal,
    ): AsyncGenerator<string, SuggestionRecord | null, unknown>;
}
```

**通过 Facade 调用**:
```typescript
const facade = new CoWriteFacade({ plugin });

const stream = facade.suggestStream(
    precedingText,
    cursorHint,
    'default',
    0,
    signal,
);

for await (const chunk of stream) {
    editor.insertText(chunk);
}
```

---

### 3.3 模拟流式
**定义**: `engine/streaming/simulated-stream.ts`

```typescript
export function createSimulatedStream(
    fullText: string,
    options?: SimulatedStreamOptions,
): AsyncGenerator<string, string, unknown>;

export function createSimulatedStreamWithSignal(
    fullText: string,
    signal?: AbortSignal,
    options?: SimulatedStreamOptions,
): AsyncGenerator<string, string, unknown>;

export interface SimulatedStreamOptions {
    chunkDelayMs?: number;      // 默认 40
    minDelayMs?: number;       // 默认 20
    maxDelayMs?: number;       // 默认 60
    splitBy?: 'sentence' | 'paragraph' | 'char';  // 默认 'sentence'
    chunkSize?: number;        // 默认 1（splitBy='char' 时）
}
```

---

### 3.4 StreamParser（流式格式解析器）
**定义**: `engine/streaming/stream-parser.ts`

```typescript
export type StreamFormat = 'openai-sse' | 'ollama' | 'auto';

export class StreamParser {
    constructor(format?: StreamFormat);
    feed(chunk: string): StreamParseResult[];
    flush(): StreamParseResult[];
    reset(): void;
    getFormat(): StreamFormat;
}

export interface StreamParseResult {
    content: string;
    done: boolean;
    raw?: any;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
}

export function parseSSERaw(buffer: string): { events: SSEEvent[]; remaining: string };
export function parseOpenAISSE(event: SSEEvent): StreamParseResult | null;
export function parseOllamaLine(line: string): StreamParseResult | null;
export function detectStreamFormat(firstChunk: string): StreamFormat;

export async function* parseReadableStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    format?: StreamFormat,
    signal?: AbortSignal,
): AsyncGenerator<string, { content: string; usage?: StreamParseResult['usage'] }, unknown>;
```

---

## 四、缓存 API

### 导入

```typescript
import {
    MultiLayerCache,
    FileCache,
    PreloadManager,
    preloadManager,
} from '../cache';

import { LruCache } from '../repository';
```

---

### 4.1 MultiLayerCache
**定义**: `shared/multi-layer-cache.ts`（批次 5 从 `engine/cache/` 下沉，engine 侧 `engine/cache/index.ts` 保留再导出）

```typescript
export class MultiLayerCache {
    constructor(options?: MultiLayerCacheOptions, fs?: FileSystemPort);

    async get<T>(key: string): Promise<T | null>;
    async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void>;
    async invalidate(key: string): Promise<void>;
    async invalidateByPrefix(prefix: string): Promise<number>;
    async invalidateBySourcePath(sourcePath: string): Promise<number>;
    async clear(): Promise<void>;

    setEntityCount(count: number): void;
    getEntityCount(): number;
    getProjectSizeTier(): ProjectSizeTier;
    adjustForMemoryPressure(memoryUsageRatio: number): number;

    getStats(): CacheStats;
    resetStats(): void;

    getL1Cache(): LruCache<string, unknown>;
    getL2Cache(): FileCache | null;
    isL2Enabled(): boolean;

    async flush(): Promise<void>;
}
```

**配置选项**:
```typescript
export interface MultiLayerCacheOptions {
    l1MaxSize?: number;             // 默认 100
    l1TtlMs?: number;              // 默认 5 分钟
    l2Enabled?: boolean;           // 默认 false
    l2CacheDir?: string;
    l2TtlMs?: number;              // 默认 24 小时
    l2MaxFiles?: number;           // 默认 1000
    slowWarnThresholdMs?: number;  // 默认 500
    autoAdapt?: boolean;           // 默认 true
    entityCount?: number;
}

export interface CacheSetOptions {
    sourcePath?: string;
    sourceMtime?: number;
    ttlMs?: number;
    tier?: CacheTier | 'all';
}
```

---

### 4.2 FileCache
**定义**: `shared/file-cache.ts`（批次 5 从 `engine/cache/` 下沉）

```typescript
export class FileCache {
    constructor(fs: FileSystemPort, options?: FileCacheOptions);

    async get<T>(key: string): Promise<T | null>;
    async set<T>(key: string, value: T, options?: {
        sourcePath?: string;
        sourceMtime?: number;
    }): Promise<void>;
    async delete(key: string): Promise<boolean>;
    async has(key: string): Promise<boolean>;
    async clear(): Promise<void>;
    async deleteByPrefix(prefix: string): Promise<number>;
    invalidateBySourcePath(sourcePath: string): number;
    async pruneExpired(): Promise<number>;

    get size(): number;
    get totalSizeBytes(): number;
    keys(): string[];

    async flush(): Promise<void>;
}
```

**配置选项**:
```typescript
export interface FileCacheOptions {
    cacheDir?: string;             // 默认 '.cache'
    ttlMs?: number;                // 默认 24 小时
    maxFiles?: number;             // 默认 1000
    slowWarnThresholdMs?: number;  // 默认 500
}
```

---

### 4.3 PreloadManager
**定义**: `engine/cache/preload-manager.ts`

```typescript
export class PreloadManager {
    constructor(options?: PreloadManagerOptions);

    setOptions(options: Partial<PreloadManagerOptions>): void;
    getOptions(): PreloadManagerOptions;
    enable(): void;
    disable(): void;
    isEnabled(): boolean;
    setChapterRepository(repo: ChapterRepository): void;

    async preloadAdjacentChapters(currentChapterId: string): Promise<string[]>;
    getCachedChapter(chapterId: string): Chapter | null;
    cacheChapter(chapter: Chapter): void;
    invalidateChapter(chapterId: string): void;

    registerEntityLoader<T>(
        entityType: string,
        loader: (id: string) => Promise<T | null>,
        cacheSize?: number,
    ): void;
    async lazyLoadEntity<T>(entityType: string, entityId: string): Promise<T | null>;
    async lazyLoadEntities<T>(entityType: string, entityIds: string[]): Promise<T[]>;
    invalidateEntity(entityType: string, entityId: string): void;
    invalidateEntityType(entityType: string): void;

    enqueueIdleTask(task: Omit<IdleTask, 'createdAt'>): string;
    cancelIdleTask(taskId: string): boolean;
    clearIdleQueue(): void;
    getIdleQueueSize(): number;

    recordBehavior(behavior: Omit<UserBehavior, 'timestamp'>): void;
    async predictNextAction(currentBehavior: Omit<UserBehavior, 'timestamp'>): Promise<{
        predicted: string[];
        prewarmed: string[];
    }>;

    getStats(): PreloadStats;
    getChapterCacheStats(): { size: number; maxSize: number; hitRate: number };
    getEntityCacheStats(entityType: string): { size: number; hitRate: number } | null;
    resetStats(): void;
}

export const preloadManager: PreloadManager;
```

**配置选项**:
```typescript
export interface PreloadManagerOptions {
    enabled?: boolean;                  // 默认 true
    chapterCacheSize?: number;          // 默认 20
    entityCacheSize?: number;           // 默认 100
    idleQueueMaxSize?: number;          // 默认 50
    adjacentChapterCount?: number;      // 默认 1
    behaviorHistoryMaxSize?: number;    // 默认 50
}
```

---

### 4.4 LruCache
**定义**: `shared/lru-cache.ts`（批次 3 从 `engine/repository/lru-cache.ts` 下沉）

```typescript
export class LruCache<K, V> {
    constructor(options?: LruCacheOptions);

    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    deleteByPrefix(prefix: string): number;
    has(key: K): boolean;
    clear(): void;
    pruneExpired(): number;
    keys(): K[];
    values(): V[];
    entries(): Array<[K, V]>;

    get size(): number;
    get maxSize(): number;
}

export interface LruCacheOptions {
    maxSize?: number;          // 默认 100
    ttlMs?: number;            // 默认 5 分钟，0 表示永不过期
}
```

---

## 五、性能 API

### 导入

```typescript
import {
    PerformanceMonitor,
    performanceMonitor,
} from '../services/performance-monitor';
```

---

### 5.1 PerformanceMonitor
**定义**: `services/performance-monitor.ts`（唯一实现；原 `engine/performance/` 重复实现已删除）

```typescript
export class PerformanceMonitor {
    static getInstance(options?: Partial<PerformanceMonitorOptions>): PerformanceMonitor;

    updateOptions(options: Partial<PerformanceMonitorOptions>): void;
    getOptions(): PerformanceMonitorOptions;
    setEnabled(enabled: boolean): void;
    isEnabled(): boolean;

    start(name: string, category?: PerformanceCategory, parentId?: string, metadata?: Record<string, unknown>): string | null;
    end(markId: string | null, metadata?: Record<string, unknown>): number | null;
    wrap<T>(name: string, fn: () => T, category?: PerformanceCategory, metadata?: Record<string, unknown>): T;
    wrapAsync<T>(name: string, fn: () => Promise<T>, category?: PerformanceCategory, metadata?: Record<string, unknown>): Promise<T>;
    /** 以已有 start 的起点结算一次耗时；会消费该 start mark，不会泄漏 activeMarks */
    measure(name: string, startMarkId: string, category?: PerformanceCategory, metadata?: Record<string, unknown>): number | null;

    getLog(limit?: number, category?: PerformanceCategory): PerformanceLogEntry[];
    getStats(operationName: string, category?: PerformanceCategory): PerformanceStats | null;
    getAllStats(): Record<string, PerformanceStats>;
    getSlowOperations(threshold?: number): SlowOperation[];
    getCategoryStats(): Record<PerformanceCategory, { count: number; totalDuration: number; avgDuration: number }>;
    getMemoryInfo(): { current?: number; peak: number; avg?: number };
    getTrend(operationName: string, category?: PerformanceCategory, windowSize?: number): { recent: number[]; trend: 'improving' | 'degrading' | 'stable' } | null;

    generateReport(cacheStats?: { hitRate: number; totalEntries: number; totalSize: number }): PerformanceReport;
    generateTextReport(cacheStats?: { hitRate: number; totalEntries: number; totalSize: number }): string;

    clearLog(): void;
    exportLog(): string;
    importLog(json: string): void;
}

export const performanceMonitor: PerformanceMonitor;
```

**配置选项**:
```typescript
export interface PerformanceMonitorOptions {
    enabled: boolean;                    // 默认 true
    maxLogEntries: number;               // 默认 1000
    slowOperationThresholdMs: number;    // 默认 1000
    enableMemoryTracking: boolean;       // 默认 true
}
```

**容量上限（长跑不增长）**:
- 日志条目：`maxLogEntries`（默认 1000）
- 统计 key：`MAX_STATS_KEYS = 500`，超出淘汰最旧 key
- 结束/结算埋点会同步从 `activeMarks` 与父节点 `children` 中摘除

**分类与统计类型**:
```typescript
export type PerformanceCategory =
    | 'projectLoad' | 'chapterGeneration' | 'knowledgeDeconstruction'
    | 'vectorCalculation' | 'viewRender' | 'cacheRead' | 'cacheWrite'
    | 'apiCall' | 'fileIO' | 'other';

export interface PerformanceStats {
    count: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
    p50: number;
    p95: number;
    p99: number;
}

export interface SlowOperation {
    name: string;
    duration: number;
    timestamp: number;
    category: PerformanceCategory;
    threshold: number;
}
```

---

## 六、Facade API

### CoWriteFacade
**定义**: `ui/services/co-write-facade.ts`

```typescript
export class CoWriteFacade {
    constructor(options: CoWriteFacadeOptions);

    get engine(): CoWriterEngine;
    get registry(): EngineRegistry | null;
    get pluginRef(): NovelWriterPlugin;

    getStore(): CoWritingSessionStore | null;
    subscribe(listener: StateListener<CoWritingSessionState>): (() => void) | null;

    async initEngine(project, chapterName, volume, chapterNum): Promise<void>;
    updateSnapshot(confirmedText: string): void;
    setCursorHint(hint: string): void;
    setPrecisionMode(enabled: boolean): void;
    getPrecisionMode(): boolean;
    getSession(): any;
    getSnapshot(): any;
    getHistory(): SentenceEditRecord[];

    async suggestNext(
        precedingText: string,
        cursorHint: string,
        mode: string,
        count: number,
        signal?: AbortSignal,
    ): Promise<SuggestionRecord[]>;

    async *suggestStream(
        precedingText: string,
        cursorHint: string,
        mode: string,
        directionIndex: number,
        signal?: AbortSignal,
    ): AsyncGenerator<string, SuggestionRecord | null, unknown>;

    async iterateSuggestion(
        suggestion: SuggestionRecord,
        instruction: string,
        precedingText: string,
        cursorHint: string,
        signal?: AbortSignal,
    ): Promise<SuggestionRecord | null>;
}
```

---

## 七、EngineRegistry API

**定义**: `engine/engine-registry.ts`

### 7.1 类型定义

```typescript
export enum EngineScope {
    Singleton = 'singleton',
    ProjectScoped = 'project-scoped',
    Transient = 'transient',
}

export interface Disposable {
    dispose(): void | Promise<void>;
}

export type EngineStatus = 'active' | 'destroyed' | 'error';
export type LazyState = 'pending' | 'loaded' | 'failed';

export interface EngineMetadata {
    description?: string;
    tags?: string[];
    version?: string;
    status: EngineStatus;
    scope: EngineScope;
    dependencies?: string[];
    lazy: boolean;
    lazyState?: LazyState;
}

export interface EngineRegisterOptions {
    scope?: EngineScope;
    dependencies?: string[];
    description?: string;
    tags?: string[];
    version?: string;
    onInit?: (instance: any) => void | Promise<void>;
}

export interface EngineListFilter {
    tags?: string[];
    scope?: EngineScope;
    status?: EngineStatus;
    lazy?: boolean;
}

export interface DependencyCheckResult {
    ok: boolean;
    missing: Array<{ engine: string; missingDependency: string }>;
    cycles: string[][];
}
```

### 7.2 类 API

```typescript
export class EngineRegistry {
    register<T>(name: string, instance: T, options?: EngineRegisterOptions): void;
    registerLazy<T>(
        name: string,
        factory: () => T | Promise<T>,
        options?: EngineRegisterOptions,
    ): void;
    has(name: string): boolean;
    get<T>(name: string): T;
    getOrNull<T>(name: string): T | null;

    async getAsync<T>(name: string): Promise<T>;
    getProject<T>(name: string, projectKey: string): T;
    getTransient<T>(name: string): T;
    getLazyState(name: string): LazyState | null;
    async setActiveProject(projectKey: string | null): Promise<number>;

    async dispose(name: string): Promise<boolean>;
    async disposeProject(projectKey: string): Promise<number>;
    async disposeAll(): Promise<number>;
    isDestroyed(name: string): boolean;

    verifyDependencies(): DependencyCheckResult;

    getMetadata(name: string): EngineMetadata | null;
    listEngines(filter?: EngineListFilter): Array<{ name: string; metadata: EngineMetadata }>;
    size(): number;

    async getCharacterRepository(project: string): Promise<CharacterRepository>;
    async getChapterRepository(project: string): Promise<ChapterRepository>;
    async getFactionRepository(project: string): Promise<FactionRepository>;
    async getLocationRepository(project: string): Promise<LocationRepository>;
    async getItemRepository(project: string): Promise<ItemRepository>;

    async getStyleLearner(project: string): Promise<StyleLearner>;

    async initialize(plugin: NovelWriterPlugin, options: InitializeOptions): Promise<void>;
}

export const ENGINE_NAMES = {
    CACHE_MANAGER: 'cacheManager',
    CRYPTO_SERVICE: 'cryptoService',
    PROVIDER_MANAGER: 'providerManager',
    THEME_MANAGER: 'themeManager',
    SETTINGS_SERVICE: 'settingsService',
    CONTEXT_MANAGER: 'contextManager',
    AI_ENGINE: 'aiEngine',
    CO_WRITER_ENGINE: 'coWriterEngine',
    CO_WRITING_SESSION_STORE: 'coWritingSessionStore',
    CHARACTER_REPOSITORY: 'characterRepository',
    CHAPTER_REPOSITORY: 'chapterRepository',
    PROJECT_REPOSITORY: 'projectRepository',
    FACTION_REPOSITORY: 'factionRepository',
    LOCATION_REPOSITORY: 'locationRepository',
    ITEM_REPOSITORY: 'itemRepository',
    // ... 完整列表见 engine-registry.ts
} as const;
```

### 7.3 使用示例

```typescript
import { EngineRegistry, ENGINE_NAMES } from '../engine/engine-registry';

const registry = new EngineRegistry();
await registry.initialize(plugin, { settingsWriter });

const aiEngine = registry.get(ENGINE_NAMES.AI_ENGINE); // 类型由 EngineServiceMap 推导

const charRepo = await registry.getCharacterRepository('my-project');
const characters = await charRepo.findAll();

registry.register('myEngine', instance, {
    scope: EngineScope.Singleton,
    tags: ['core', 'ai'],
    dependencies: ['cacheManager'],
});

registry.registerLazy('asyncEngine', async () => {
    const data = await loadConfig();
    return new AsyncEngine(data);
});

const cache = registry.getProject<ProjectCache>('projectCache', 'novel-1');

const w1 = registry.getTransient<Worker>('tempWorker');

const result = registry.verifyDependencies();
if (!result.ok) {
    console.error('缺少依赖:', result.missing);
}

const engines = registry.listEngines({ tags: ['core'] });
for (const { name, metadata } of engines) {
    console.log(`${name}: ${metadata.description}`);
}

await registry.disposeProject('old-project');
```

---

## 八、偏离检测引擎 API（V2）

**定义**: `engine/quality/deviation-detector.ts`

### 8.1 导入

```typescript
import {
    DeviationDetector,
    DEVIATION_TYPES,
    DEVIATION_TYPE_LABELS,
    DEFAULT_SEVERITY_THRESHOLDS,
    getDeviationTypeLabel,
    getDeviationSeverityLabel,
    getDeviationSeverityIcon,
    getDeviationSeverityColor,
} from './quality/deviation-detector';
import type {
    DeviationType,
    DeviationSeverity,
    DeviationIssue,
    DeviationReport,
    DeviationContext,
    DeviationSuggestion,
    ForeshadowTracking,
    PreviousChapterContext,
    SeverityThresholds,
    DeviationDetectorOptions,
} from './quality/deviation-detector';
```

### 8.2 DeviationType 偏离类型

```typescript
type DeviationType =
  | 'mainline'          // 剧情偏离主线
  | 'characterOOC'      // 人物 OOC
  | 'contradiction'     // 前后矛盾
  | 'foreshadowForgot'  // 伏笔遗忘
  | 'rhythm';           // 节奏偏离
```

### 8.3 DeviationSeverity 预警等级

```typescript
type DeviationSeverity = 'info' | 'warning' | 'critical';

const DEFAULT_SEVERITY_THRESHOLDS = {
    critical: 60,
    warning: 30,
    info: 0,
};
```

### 8.4 DeviationDetector 类

```typescript
const detector = new DeviationDetector({
    plotDivergenceEngine: new PlotDivergenceEngine(),
    characterChecker: new CharacterConsistencyChecker(),
    rhythmAnalyzer: new RhythmAnalyzer(...),
    severityThresholds: { critical: 70, warning: 40 },
    foreshadowRecoverChapters: 10,
    cacheSize: 50,
    cacheTtlMs: 60_000,
});

const report = await detector.detect(text, context, signal?);
const issues = await detector.detectByType(text, 'characterOOC', context, signal?);

detector.clearCache();
detector.invalidateCache(text);
```

### 8.5 DeviationContext 检测上下文

```typescript
interface DeviationContext {
    chapterId?: string;
    chapterNum?: number;
    chapterOutline?: string;
    mainlineKeywords?: string[];
    characterInfos?: CharacterContextInfo[];
    previousChapters?: PreviousChapterContext[];
    foreshadows?: ForeshadowTracking[];
    expectedRhythm?: 'fast' | 'medium' | 'slow';
    changedRange?: { start: number; end: number };
}
```

### 8.6 DeviationReport 检测报告

```typescript
interface DeviationReport {
    overallScore: number;
    overallSeverity: DeviationSeverity;
    typeScores: Record<DeviationType, number>;
    issues: DeviationIssue[];
    suggestions: DeviationSuggestion[];
    evaluatedAt: number;
    wordCount: number;
    evalTimeMs: number;
    fromCache: boolean;
    incremental: boolean;
}
```

### 8.7 DeviationIssue 问题结构

```typescript
interface DeviationIssue {
    id: string;
    type: DeviationType;
    severity: DeviationSeverity;
    degree: number;
    description: string;
    location?: DeviationLocation;
    suggestion?: string;
    confidence?: number;
    evidence?: string[];
}
```

### 8.8 ForeshadowTracking 伏笔追踪

```typescript
interface ForeshadowTracking {
    id: string;
    description: string;
    plantedChapterId?: string;
    plantedChapterNum?: number;
    keywords: string[];
    expectedRecoverChapterNum?: number;
    recovered: boolean;
    recoveredChapterId?: string;
    currentChapterNum?: number;
}
```

---

## 九、数据可视化 API（svg-charts.ts）

### 导入

```typescript
import {
    radarChart, barChart, donutChart, lineChart, scatterChart,
    timelineChart, wordCloud, heatmap, treeChart, areaChart,
    attachChartInteractions, createChartContainer, spiralLayout,
    // 类型
    RadarDataItem, RadarOptions, BarDataItem, BarOptions,
    DonutDataItem, DonutOptions, LineChartSeries, LineChartOptions,
    HeatmapCell, HeatmapOptions, TreeNode, TreeOptions,
    AreaSeries, AreaOptions, WordCloudItem, WordCloudOptions,
    ChartContainerOptions, ChartContainerResult,
} from '../ui/svg-charts';
```

### 9.1 图表函数

所有图表函数均为纯函数，返回 SVG 字符串（含 `data-*` 属性和 CSS 类），支持响应式（`viewBox` + `preserveAspectRatio`）和动画过渡（CSS transition）。

| 函数 | 用途 | 关键特性 |
|------|------|---------|
| `radarChart(data, options)` | 雷达图 | 5级网格、极坐标、顶点 hover tooltip |
| `barChart(data, options)` | 柱状图 | 支持水平模式、图例点击筛选 |
| `donutChart(data, options)` | 环形图 | 8色调色板、中心总计、扇区外扩 hover |
| `lineChart(series, options)` | 折线图 | 贝塞尔平滑、十字线 hover、路径绘制动画 |
| `scatterChart(data, options)` | 散点图 | 分类着色、HTML tooltip |
| `timelineChart(data, options)` | 时间线 | 多级标签、类型分类着色 |
| `wordCloud(items, options)` | 词云图 | 阿基米德螺线布局、bounding box 碰撞检测 |
| `heatmap(data, options)` | 热力图 | 行列标签、颜色梯度、单元格 tooltip |
| `treeChart(root, options)` | 树状图 | dendrogram 布局、层级折叠 |
| `areaChart(series, options)` | 面积图 | 渐变填充、路径绘制动画 |

### 9.2 交互能力

```typescript
// 在将图表 SVG 插入 DOM 后调用，启用 hover/tooltip/图例点击
const container = document.createElement('div');
container.innerHTML = lineChart(series, options);
document.body.appendChild(container);
attachChartInteractions(container);
```

`attachChartInteractions(container: HTMLElement)` 会：
- 查找所有 `[data-value]` 和 `[data-label]` 元素
- 添加 mouseenter/mouseleave 事件：显示/隐藏 HTML tooltip overlay
- 为有图例的图表添加图例点击事件：toggle 数据系列显示

### 9.3 ChartContainer 工厂

```typescript
const chart = createChartContainer({
    width: 400, height: 300, title: '分析报告',
    padding: { top: 30, right: 20, bottom: 40, left: 50 },
    showGrid: true, showXAxis: true, showYAxis: true,
});
// chart.svgStart, chart.plotArea, chart.legendArea, chart.svgEnd
```

---

## 十、相关文档

- [架构视图](./ARCHITECTURE.md) — 分层架构与设计决策
- [开发指南](./DEVELOPMENT.md) — 如何新增功能
- [性能优化指南](./PERFORMANCE.md) — 缓存策略与性能监控
- [Repository 迁移指南](../engine/repository/MIGRATION.md) — 旧代码渐进式迁移