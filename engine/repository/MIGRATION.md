# Repository 模式迁移指南

## 概述

本文档说明如何将现有引擎从直接文件访问模式迁移到 Repository 模式。

Repository 模式提供了以下好处：
- **统一数据访问层**：所有数据访问通过 Repository 接口，底层存储可替换
- **内置缓存**：LRU 缓存 + TTL 过期策略，减少重复文件读取
- **类型安全**：领域模型类型化，避免 frontmatter 字段拼写错误
- **可测试性**：Repository 接口可 Mock，便于单元测试
- **关注点分离**：业务逻辑与数据访问逻辑分离

---

## 迁移前准备

### 1. 确认 Repository 已注册

在 `engine-registry.ts` 中，所有 Repository 已在 Phase 3 注册：

```typescript
// 全局单例 Repository
const projectRepository = new ProjectRepository(new ObsidianFileSystem(plugin.app));
this.register(ENGINE_NAMES.PROJECT_REPOSITORY, projectRepository);

// 项目级 Repository（按需创建，缓存实例）
const charRepo = engineRegistry.getCharacterRepository(project);
```

### 2. 可用的 Repository

| Repository | 类型 | 说明 | 获取方式 |
|-----------|------|------|---------|
| `ProjectRepository` | 全局单例 | 项目元数据管理 | `engineRegistry.get<ProjectRepository>(ENGINE_NAMES.PROJECT_REPOSITORY)` |
| `CharacterRepository` | 项目级 | 人物数据管理 | `engineRegistry.getCharacterRepository(project)` |
| `ChapterRepository` | 项目级 | 章节数据管理 | `engineRegistry.getChapterRepository(project)` |
| `FactionRepository` | 项目级 | 势力数据管理 | `engineRegistry.getFactionRepository(project)` |
| `LocationRepository` | 项目级 | 地点数据管理 | `engineRegistry.getLocationRepository(project)` |
| `ItemRepository` | 项目级 | 物品功法数据管理 | `engineRegistry.getItemRepository(project)` |

---

## 迁移步骤

### 步骤 1：识别直接文件访问的代码

找出引擎中直接操作文件的代码，常见模式：

```typescript
// ❌ 迁移前：直接读文件
const file = this.app.vault.getAbstractFileByPath(path);
if (file instanceof TFile) {
    const content = await this.app.vault.cachedRead(file);
    const fm = parseFrontmatter(content);
    // ... 处理数据
}

// ❌ 迁移前：直接遍历目录
const files = this.app.vault.getFiles().filter(f => f.path.startsWith(dir));
for (const file of files) {
    // ... 逐个读取
}
```

### 步骤 2：注入 Repository 依赖

根据引擎的生命周期，选择合适的注入方式：

#### 方式 A：构造函数注入（推荐）

如果引擎是在 `EngineRegistry` 中创建的，通过构造函数传入：

```typescript
// 在 engine-registry.ts 中
const myEngine = new MyEngine({
    characterRepository: this.getCharacterRepository(project),
    // ...
});
```

#### 方式 B：通过 EngineRegistry 获取

如果引擎需要跨项目访问，通过 `engineRegistry` 按需获取：

```typescript
class MyEngine {
    private engineRegistry: EngineRegistry;

    constructor(opts: { engineRegistry: EngineRegistry }) {
        this.engineRegistry = opts.engineRegistry;
    }

    async doSomething(project: string) {
        const charRepo = this.engineRegistry.getCharacterRepository(project);
        const characters = await charRepo.findAll();
        // ...
    }
}
```

#### 方式 C：ContextManager 模式

参考 `ContextManager` 的做法，支持多种模式并保留 fallback：

```typescript
class MyEngine {
    private characterRepo: CharacterRepository | null = null;
    private engineRegistry: EngineRegistry | null = null;

    constructor(opts: {
        characterRepository?: CharacterRepository;
        engineRegistry?: EngineRegistry;
    }) {
        this.characterRepo = opts.characterRepository || null;
        this.engineRegistry = opts.engineRegistry || null;
    }

    private getCharacterRepo(project: string): CharacterRepository | null {
        if (this.characterRepo) return this.characterRepo;
        if (this.engineRegistry) {
            try {
                return this.engineRegistry.getCharacterRepository(project);
            } catch {
                return null;
            }
        }
        return null;
    }
}
```

### 步骤 3：编写领域模型转换

Repository 返回的是领域模型（如 `Character`），而现有代码可能使用 frontmatter 格式。需要添加转换层：

```typescript
/**
 * 将 Character 领域对象转换为 CharacterFrontmatter 格式
 */
private characterToFrontmatter(character: Character): CharacterFrontmatter {
    const fm = character.frontmatter.toObject();
    const fileName = character.filePath.split('/').pop() || '';
    return {
        ...fm,
        name: fm.name || fm['姓名'] || character.name,
        姓名: fm['姓名'] || character.name,
        fileName,
        filePath: character.filePath,
    } as CharacterFrontmatter;
}
```

### 步骤 4：添加 Fallback 机制

为了保证向后兼容，Repository 不可用时回退到直接读文件：

```typescript
async getCharacters(project: string): Promise<CharacterData[]> {
    const startTime = Date.now();
    const repo = this.getCharacterRepo(project);

    // 优先使用 Repository
    if (repo) {
        try {
            const chars = await repo.findAll();
            const result = chars.map(c => this.characterToFrontmatter(c));
            console.debug(`[MyEngine] via Repository | count=${result.length} | time=${Date.now() - startTime}ms`);
            return result;
        } catch (e) {
            console.warn('[MyEngine] Repository 不可用，回退到直接读文件:', e);
        }
    }

    // Fallback：直接读文件（原有逻辑）
    const characters: CharacterData[] = [];
    // ... 原有文件读取逻辑
    return characters;
}
```

### 步骤 5：添加性能埋点

记录 Repository 命中率和加载耗时，便于优化：

```typescript
private perfStats = {
    totalAccesses: 0,
    repoHits: 0,
    fallbackHits: 0,
    totalLoadTimeMs: 0,
    repoLoadTimeMs: 0,
    fallbackLoadTimeMs: 0,
};

private recordPerf(useRepo: boolean, loadTimeMs: number): void {
    this.perfStats.totalAccesses++;
    this.perfStats.totalLoadTimeMs += loadTimeMs;
    if (useRepo) {
        this.perfStats.repoHits++;
        this.perfStats.repoLoadTimeMs += loadTimeMs;
    } else {
        this.perfStats.fallbackHits++;
        this.perfStats.fallbackLoadTimeMs += loadTimeMs;
    }
}

// 输出统计
getPerfStats() {
    const total = this.perfStats.totalAccesses || 1;
    return {
        repoHitRate: ((this.perfStats.repoHits / total) * 100).toFixed(1) + '%',
        avgLoadTimeMs: (this.perfStats.totalLoadTimeMs / total).toFixed(2),
    };
}
```

---

## 迁移示例：EntityContextEngine

以下是将 `EntityContextEngine` 迁移到 Repository 模式的完整示例：

### 迁移前

```typescript
class EntityContextEngine {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    async getCharacters(project: string): Promise<CharacterData[]> {
        const dir = `${project}/01-世界架构/人物`;
        const files = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(dir) && f.extension === 'md');

        const characters: CharacterData[] = [];
        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            const fm = parseFrontmatter(content) as CharacterData;
            fm.fileName = file.name;
            fm.filePath = file.path;
            characters.push(fm);
        }
        return characters;
    }
}
```

### 迁移后

```typescript
import { CharacterRepository } from './repository';
import { EngineRegistry } from './engine-registry';
import type { CharacterData } from './context/context-types';

class EntityContextEngine {
    private engineRegistry: EngineRegistry;

    constructor(opts: { engineRegistry: EngineRegistry }) {
        this.engineRegistry = opts.engineRegistry;
    }

    private getCharacterRepo(project: string): CharacterRepository | null {
        try {
            return this.engineRegistry.getCharacterRepository(project);
        } catch {
            return null;
        }
    }

    private characterToFrontmatter(character: {
        id: string;
        name: string;
        filePath: string;
        frontmatter: { toObject(): Record<string, any> };
    }): CharacterData {
        const fm = character.frontmatter.toObject();
        const fileName = character.filePath.split('/').pop() || '';
        return {
            ...fm,
            name: fm.name || fm['姓名'] || character.name,
            姓名: fm['姓名'] || character.name,
            fileName,
            filePath: character.filePath,
        } as CharacterData;
    }

    async getCharacters(project: string): Promise<CharacterData[]> {
        const repo = this.getCharacterRepo(project);

        if (repo) {
            try {
                const chars = await repo.findAll();
                return chars.map(c => this.characterToFrontmatter(c));
            } catch (e) {
                console.warn('[EntityContextEngine] 回退到直接读文件:', e);
            }
        }

        // Fallback：原有逻辑
        const dir = `${project}/01-世界架构/人物`;
        const files = this.app.vault.getFiles()
            .filter(f => f.path.startsWith(dir) && f.extension === 'md');
        // ... 保持不变
    }
}
```

---

## 最佳实践

### 1. 渐进式迁移

不要一次性迁移所有引擎，按以下顺序逐步迁移：

1. **Phase 1**: ContextManager（已完成）
2. **Phase 2**: 实体相关引擎（EntityContextEngine, CharacterConsistencyChecker 等）
3. **Phase 3**: 章节相关引擎（ChapterContextBuilder, OutlineToTextExpander 等）
4. **Phase 4**: 其他引擎

### 2. 保持公开接口不变

迁移时只改内部实现，公开方法的签名和返回值保持不变。

```typescript
// ✅ 好：接口不变，内部切换
async gatherCharacterState(project: string): Promise<ContextData> {
    // 内部使用 Repository，但返回值格式不变
}
```

### 3. 必须保留 Fallback

Repository 可能因为各种原因不可用，必须保留 fallback 路径：

- 插件初始化早期（EngineRegistry 尚未就绪）
- 测试环境（未配置 Repository）
- 数据格式不兼容

### 4. 利用缓存优化性能

Repository 内置 LRU 缓存，合理配置缓存参数：

```typescript
// 默认配置（适用于大多数场景）
cacheMaxSize: 100,    // 最大缓存条目
cacheTtlMs: 300000,   // 5 分钟过期

// 读多写少的场景（如世界观设定）
cacheMaxSize: 200,
cacheTtlMs: 600000,   // 10 分钟过期

// 实时性要求高的场景（如章节正文）
cacheMaxSize: 50,
cacheTtlMs: 60000,    // 1 分钟过期
```

### 5. 及时失效缓存

当数据修改时，主动使缓存失效：

```typescript
// 保存后失效缓存
await characterRepository.save(character);
contextManager.invalidateContextCache(project);
```

### 6. 监控性能指标

定期检查性能统计，确保 Repository 模式确实带来了性能提升：

```typescript
const stats = contextManager.getPerfStats();
console.log('Repository 命中率:', stats.repoHitRate);
console.log('平均加载时间:', stats.avgLoadTimeMs + 'ms');
```

---

## 扩展：状态管理迁移步骤

### 背景

协同写作会话需要复杂的状态管理。新架构提供了基于轻量级 Store 的会话状态模型（`CoWritingSessionState`），现有引擎可以逐步迁移到该模型。

### 步骤 1：识别需要迁移的状态

找出散落在各处的 UI 状态：

```typescript
// ❌ 迁移前：状态散落在各引擎实例
class MyEngine {
    private currentChapter: string = '';
    private isGenerating: boolean = false;
    private suggestions: Suggestion[] = [];
    // ... 各种 UI 状态字段
}
```

### 步骤 2：通过 Facade 获取 SessionStore

```typescript
import { CoWriteFacade } from '../ui/services/co-write-facade';

class MyEngine {
    private facade: CoWriteFacade;

    constructor(opts: { facade: CoWriteFacade }) {
        this.facade = opts.facade;
    }

    private getStore() {
        return this.facade.getStore();
    }
}
```

### 步骤 3：替换状态读写

```typescript
// ❌ 迁移前：内部状态
this.currentChapter = chapterId;
this.isGenerating = true;

// ✅ 迁移后：通过 Store
const store = this.getStore();
if (store) {
    store.setState({
        currentProject: project,
        currentVolume: vol,
        currentChapter: chap,
        isGenerating: true,
    });
} else {
    // Fallback：原有逻辑
    this.currentChapter = chapterId;
}
```

### 步骤 4：使用 Action Creators

```typescript
const store = this.getStore();
if (store) {
    // 使用预定义的 action creators
    store.setState(store.actions.updateChapterContent(content));
    store.setState(store.actions.setGenerating(true));
}
```

### 步骤 5：使用选择器订阅

```typescript
// UI 组件订阅状态变化
const store = this.facade.getStore();
if (store) {
    store.subscribe(
        (state) => state.suggestions,
        (suggestions) => this.renderSuggestions(suggestions),
        { equalityFn: shallow },
    );
}
```

### 步骤 6：使用 Thunk 处理异步流程

```typescript
const store = this.getStore();
if (store) {
    // 使用预定义的 thunk
    await store.dispatch(store.thunks.fetchChapter(project, vol, chap));
    await store.dispatch(store.thunks.generateSuggestions(context, direction));
}
```

### 状态管理迁移检查清单

- [ ] 识别所有需要迁移的状态字段
- [ ] 确认字段属于持久化切片还是内存态切片
- [ ] 通过 Facade 获取 SessionStore
- [ ] 替换状态读写为 Store API
- [ ] 使用 Action Creators 替代直接 setState
- [ ] UI 组件改为选择器订阅
- [ ] 异步流程改用 Thunk
- [ ] 保留 Fallback 路径
- [ ] 验证持久化数据正确恢复

---

## 扩展：流式生成迁移步骤

### 背景

新架构提供了完善的流式生成体系，支持原生 SSE、模拟流式和三阶段降级。现有一次性响应的代码可逐步迁移到流式生成。

### 步骤 1：识别一次性响应的代码

```typescript
// ❌ 迁移前：一次性获取全部响应
const result = await aiEngine.callAI(
    systemPrompt,
    userPrompt,
    model,
    temperature,
    maxTokens,
);
// 用户需要等待全部响应完成才能看到结果
renderToUI(result.content);
```

### 步骤 2：替换为流式生成

```typescript
// ✅ 迁移后：流式生成
const signal = controller.signal;
const iterator = aiEngine.callAIAsyncIterator(
    systemPrompt,
    userPrompt,
    model,
    temperature,
    maxTokens,
    { isWritingTask: true, signal },
);

let fullContent = '';
for await (const chunk of iterator) {
    fullContent += chunk;
    renderToUI(chunk);  // 逐 chunk 渲染
    updateProgressBar(chunk.length);
}

const result = await iterator.next();
// result.value 包含完整响应和 usage 信息
```

### 步骤 3：通过 Facade 使用流式 API

```typescript
import { CoWriteFacade } from '../ui/services/co-write-facade';

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

### 步骤 4：使用模拟流式（降级或测试）

```typescript
import { createSimulatedStream } from '../engine/streaming';

// 模拟流式输出
const stream = createSimulatedStream(
    fullResponseText,
    {
        splitBy: 'sentence',
        minDelayMs: 20,
        maxDelayMs: 60,
    },
);

for await (const chunk of stream) {
    renderToUI(chunk);
}
```

### 流式生成迁移检查清单

- [ ] 识别所有一次性响应的代码
- [ ] 替换为 `callAIAsyncIterator` 或 Facade 流式 API
- [ ] 添加取消能力（AbortSignal）
- [ ] UI 添加进度反馈
- [ ] 处理流式异常
- [ ] 保留 Fallback（流式失败时回退到一次性响应）
- [ ] 添加性能埋点监控流式耗时

---

## 扩展：缓存接入步骤

### 背景

新架构提供了多层缓存体系（L1 内存 + L2 文件 + 预加载）。现有引擎可以直接接入这套缓存体系，提升性能。

### 步骤 1：识别需要缓存的昂贵操作

```typescript
// ❌ 迁移前：每次都重新计算
class MyEngine {
    async analyzeChapter(chapter: Chapter): Promise<AnalysisResult> {
        // 昂贵的分析操作，每次都重新计算
        return performExpensiveAnalysis(chapter.body);
    }
}
```

### 步骤 2：选择缓存层

根据数据特性选择：

| 数据特性 | 推荐缓存 |
|---------|---------|
| 高频读取，单进程 | L1（LruCache） |
| 跨会话持久化，大数据 | L2（FileCache） |
| Repository 数据访问 | MultiLayerCache（自动 L1+L2） |
| 用户偏好 | Store persist |
| 编辑历史 | Store persist + IndexedDB |

### 步骤 3：接入 Repository 缓存（推荐）

```typescript
import { MultiLayerCache } from '../cache';
import { CharacterRepository } from '../repository';
import { ObsidianFileSystem } from '../shared/file-system-port';

const fs = new ObsidianFileSystem(app);
const cache = new MultiLayerCache(
    {
        l1MaxSize: 100,
        l1TtlMs: 5 * 60 * 1000,
        l2Enabled: true,
        l2CacheDir: '.cache',
        autoAdapt: true,
    },
    fs,
);

// Repository 自动使用多层缓存
const characterRepo = new CharacterRepository(fs, project, {
    multiLayerCache: cache,
    cacheKeyPrefix: 'char:',
});

// 所有 CRUD 操作自动走缓存
const character = await characterRepo.findById('张三');
// 优先级：L1 → L2 → 文件系统
```

### 步骤 4：独立使用 FileCache

```typescript
import { FileCache } from '../cache';

const fileCache = new FileCache(fs, {
    cacheDir: '.cache/analysis',
    ttlMs: 24 * 60 * 60 * 1000,
});

class MyEngine {
    async analyzeChapter(chapter: Chapter): Promise<AnalysisResult> {
        const key = `analysis:${chapter.id}`;

        // 1. 检查缓存
        const cached = await fileCache.get<AnalysisResult>(key);
        if (cached) return cached;

        // 2. 执行计算
        const result = performExpensiveAnalysis(chapter.body);

        // 3. 写入缓存（关联源文件）
        await fileCache.set(key, result, {
            sourcePath: chapter.filePath,
            sourceMtime: Date.now(),
        });

        return result;
    }

    // 源文件修改时失效缓存
    invalidateCache(filePath: string) {
        fileCache.invalidateBySourcePath(filePath);
    }
}
```

### 步骤 5：使用预加载

```typescript
import { preloadManager } from '../cache';

// 注册实体加载器
preloadManager.registerEntityLoader<Character>(
    'character',
    (id) => characterRepo.findById(id),
);

// 用户切换章节时，预加载相邻章节
preloadManager.setChapterRepository(chapterRepo);
await preloadManager.preloadAdjacentChapters('v1-c5');
// 自动预加载 v1-c4 和 v1-c6

// 记录用户行为以触发预测
preloadManager.recordBehavior({
    action: 'navigate',
    chapterId: 'v1-c5',
});

// 预测下一步操作
const { predicted, prewarmed } = await preloadManager.predictNextAction({
    action: 'navigate',
    chapterId: 'v1-c5',
});
```

### 步骤 6：添加性能监控

```typescript
import { performanceMonitor } from '../performance';

class MyEngine {
    async analyzeChapter(chapter: Chapter): Promise<AnalysisResult> {
        const markId = performanceMonitor.startMark('analyzeChapter', {
            chapterId: chapter.id,
        });

        try {
            // ... 业务逻辑
            return result;
        } finally {
            performanceMonitor.endMark(markId);
        }
    }
}

// 定期检查性能
const stats = performanceMonitor.getStats();
console.log('缓存命中率:', cache.getStats().overall.hitRate);
console.log('慢操作:', stats.slowestTop10);
```

### 缓存接入检查清单

- [ ] 识别需要缓存的昂贵操作
- [ ] 选择合适的缓存层
- [ ] Repository 通过 `multiLayerCache` 参数接入
- [ ] 独立计算结果通过 FileCache 缓存
- [ ] 高频读取数据使用预加载
- [ ] 配置合理的 TTL 和 maxSize
- [ ] 源文件修改时主动失效缓存
- [ ] 添加性能埋点监控缓存命中率
- [ ] 处理缓存失败情况（降级到直接计算）

---

## 相关文档

完整的架构和开发指南：

- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — 分层架构与设计决策
- [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md) — 开发指南（新增 Repository / 状态切片 / 接入新功能）
- [`docs/PERFORMANCE.md`](../../docs/PERFORMANCE.md) — 性能优化指南（缓存策略 / 性能监控 / 检查清单）
- [`docs/API.md`](../../docs/API.md) — 完整 API 参考（Repository / Store / 流式 / 缓存 / 性能）

## 相关文件

- `engine/engine-registry.ts` — 引擎注册表，管理 Repository 实例
- `engine/context-manager.ts` — 上下文管理器（已迁移的参考实现）
- `engine/repository/` — Repository 实现
  - `interfaces.ts` — Repository 接口定义
  - `base-markdown-repository.ts` — 基类实现
  - `character-repository.ts` — 人物仓储
  - `chapter-repository.ts` — 章节仓储
  - `project-repository.ts` — 项目仓储
  - `faction-repository.ts` — 势力仓储
  - `location-repository.ts` — 地点仓储
  - `item-repository.ts` — 物品仓储
- `engine/repository/domain/` — 领域模型
  - `aggregates/` — 聚合根（Character, Chapter, Project 等）
  - `value-objects/` — 值对象（Frontmatter, EntityStatus 等）
  - `serializers/` — 序列化器（EntityFactory, FrontmatterSerializer）
- `engine/co-writer/session-state.ts` — 协同写作会话状态模型
- `engine/co-writer/create-session-store.ts` — 会话 Store 工厂
- `engine/streaming/stream-parser.ts` — 流式解析器
- `engine/streaming/simulated-stream.ts` — 模拟流式
- `shared/multi-layer-cache.ts` — 多层缓存（批次 5 从 `engine/cache/` 下沉）
- `shared/file-cache.ts` — 文件缓存（批次 5 同步下沉）
- `engine/cache/preload-manager.ts` — 预加载管理器
- `engine/performance/performance-monitor.ts` — 性能监控
- `ui/services/co-write-facade.ts` — UI 数据访问门面
- `shared/store/` — 轻量级状态管理

---

## 常见问题

### Q1: Repository 的 findAll 性能如何？

**A**: Repository 的 `findAll()` 会扫描目录下所有文件并逐个反序列化，首次调用可能较慢。但由于内置 LRU 缓存，后续调用会直接返回缓存结果，性能优于每次都读文件。

### Q2: 如何处理自定义 frontmatter 字段？

**A**: 领域模型的 `frontmatter.toObject()` 会返回所有原始字段，包括自定义字段。转换时直接展开即可：

```typescript
const fm = character.frontmatter.toObject();
return {
    ...fm,  // 包含所有自定义字段
    name: character.name,
};
```

### Q3: 如何添加 Repository 特有的查询方法？

**A**: 在对应的 Repository 类中添加方法即可。例如按势力查找人物：

```typescript
// character-repository.ts
async findByFaction(factionName: string): Promise<Character[]> {
    const all = await this.findAll();
    return all.filter(c => c.faction === factionName);
}
```

### Q4: 迁移后如何验证正确性？

**A**: 建议采用双写双读策略验证：

```typescript
async getCharacters(project: string) {
    const repoResult = await repo.findAll();
    const fallbackResult = await this.legacyReadFiles(project);

    // 对比结果（开发环境）
    if (process.env.NODE_ENV === 'development') {
        this.compareResults(repoResult, fallbackResult);
    }

    return repoResult;
}
```

### Q5: 内存占用会不会很高？

**A**: 默认缓存 100 条，按每条平均 10KB 计算，约 1MB 内存占用。如果内存紧张，可以调小 `cacheMaxSize` 或关闭缓存：

```typescript
const repo = new CharacterRepository(fs, project, {
    cacheMaxSize: 20,  // 减少缓存条目
});
```
