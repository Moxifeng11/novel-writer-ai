---
⚠️  **文档已过期 · 仅供历史参考** ⚠️

**过期原因**：本报告数据基于 2026-07-13 扫描（325个.ts文件），与当前代码库状态（458个.ts文件）存在显著差异。
**当前状态**：EngineRegistry 实际注册 30 个类（非报告中声称的 36 个），详细数据请以最新代码扫描为准。
**替代参考**：.trae/specs/project-audit-2026q3/spec.md
**归档时间**：2026-07-15
---
# EngineRegistry 娌荤悊 鈥?杩佺Щ鍓嶅熀绾?
> 鏈枃妗ｈ褰?EngineRegistry 娌荤悊鍓嶇殑寮曟搸瀹炰緥鍖栫姸鎬侊紝浣滀负杩佺Щ鍩虹嚎銆?> 鐢熸垚宸ュ叿锛歚scripts/scan-engine-instances.mjs`

鐢熸垚鏃堕棿锛?026-07-13T05:40:23.542Z

## 1. 鎬昏

| 鎸囨爣 | 鍊?|
|------|-----|
| 鎵弿 .ts 鏂囦欢鏁?| 325 |
| 鎬诲疄渚嬪寲鏁?| 97 |
| 娑夊強绫诲悕鏁?| 65 |
| 搴旇鍗曚緥 (singleton) | 36 |
| 鍙兘澶氬疄渚?(transient) | 1 |
| 涓嶇‘瀹?(unknown) | 28 |
| 宸叉敞鍐屽埌 EngineRegistry | 23 |
| 鏈敞鍐?| 42 |
| 澶氬疄渚嬬被鏁?| 8 |
| 澶氬疄渚嬪崟渚嬮棶棰樻暟 | 6 |
| 宸叉敞鍐屼絾浠嶈鐩存帴瀹炰緥鍖栵紙缁曡繃 registry锛?| 2 |

## 2. 宸茬煡鐨勭姸鎬佷笉鍚屾闂

鏍规嵁 `engine/engine-registry.ts` 椤堕儴娉ㄩ噴锛屾不鐞嗙洰鏍囧寘鎷細

1. 寮曟搸瀹炰緥鍖栧垎鏁ｅ湪 main.ts onload 鍚勫
2. UI 缁勪欢鐩存帴 `new` 寮曟搸瀵艰嚧澶氬疄渚嬬姸鎬佷笉鍚屾
3. 缂轰箯缁熶竴鍒濆鍖栭『搴忕鐞?
### 2.1 宸叉敞鍐屼絾浠嶈鐩存帴瀹炰緥鍖栫殑绫伙紙缁曡繃 EngineRegistry锛?
浠ヤ笅绫?*宸叉敞鍐?*鍒?EngineRegistry锛屼絾鍦ㄤ唬鐮佷腑浠嶈鐩存帴 `new` 瀹炰緥鍖栵紙鎺掗櫎 registry 鑷韩鍒濆鍖栵級锛?缁曡繃浜嗘敞鍐岃〃锛岃繖鏄姸鎬佷笉鍚屾鐨勭洿鎺ヨ瘉鎹€傝繖浜涘疄渚嬪寲鐐归渶瑕佹敼涓洪€氳繃 `registry.get()` 鑾峰彇銆?
| 绫诲悕 | 缁曡繃瀹炰緥鍖栨鏁?| 鏂囦欢鏁?| 鍒嗙被 |
|------|---------------|--------|------|
| `ChapterVersionService` | 1 | 2 | singleton |
| `KnowledgeVectorStore` | 1 | 2 | singleton |

> 娉細缁曡繃瀹炰緥鍖栨鏁?= 鎬诲疄渚嬪寲娆℃暟 - registry 鍐呴儴鍒濆鍖栨鏁帮紙engine-registry.ts 涓殑 `new` 璋冪敤锛夈€?> 浠呰 registry 澶栭儴鐨勭洿鎺?`new` 璋冪敤锛岃繖浜涙墠鏄湡姝ｇ殑缁曡繃琛屼负銆?
## 3. 宸叉敞鍐屽埌 EngineRegistry 鐨勫紩鎿庡垪琛?
鏉ユ簮锛歚engine/engine-registry.ts` 涓墍鏈?`new Xxx(` 璋冪敤锛堝搴?ENGINE_NAMES 娉ㄥ唽椤癸級

| 绫诲悕 | 鍦ㄦ壂鎻忎腑鏄惁鍑虹幇 | 瀹炰緥鍖栨鏁?|
|------|------------------|------------|
| `StyleLearner` | 浠呭湪 registry 涓?| 0 |
| `CharacterRepository` | 浠呭湪 registry 涓?| 0 |
| `ChapterRepository` | 浠呭湪 registry 涓?| 0 |
| `FactionRepository` | 浠呭湪 registry 涓?| 0 |
| `LocationRepository` | 浠呭湪 registry 涓?| 0 |
| `ItemRepository` | 浠呭湪 registry 涓?| 0 |
| `PluginCacheManager` | 鏄?| 1 |
| `InternalRegistry` | 浠呭湪 registry 涓?| 0 |
| `CryptoService` | 鏄?| 1 |
| `ProviderManager` | 鏄?| 1 |
| `ThemeManager` | 鏄?| 1 |
| `SettingsService` | 鏄?| 1 |
| `ProjectRepository` | 浠呭湪 registry 涓?| 0 |
| `ContextManager` | 鏄?| 1 |
| `ForeshadowManager` | 鏄?| 1 |
| `ReviewAgent` | 浠呭湪 registry 涓?| 0 |
| `WorldviewCacheService` | 鏄?| 1 |
| `TemplateService` | 鏄?| 1 |
| `ChapterVersionService` | 鏄?| 2 |
| `TemplateManager` | 鏄?| 1 |
| `CommandRegistry` | 浠呭湪 registry 涓?| 0 |
| `KnowledgeTagManager` | 鏄?| 1 |
| `KnowledgeBaseManager` | 鏄?| 1 |
| `KnowledgeVectorStore` | 鏄?| 2 |
| `VectorEnhancer` | 浠呭湪 registry 涓?| 0 |
| `DeconstructionScheduler` | 浠呭湪 registry 涓?| 0 |
| `BatchImportManager` | 鏄?| 1 |
| `WritingProfileManager` | 鏄?| 1 |
| `KnowledgeInjector` | 浠呭湪 registry 涓?| 0 |
| `CharacterConsistencyChecker` | 鏄?| 1 |
| `AIEngine` | 鏄?| 1 |
| `CoWriterEngine` | 鏄?| 1 |
| `AnalysisReportEngine` | 鏄?| 1 |
| `SettlementEngine` | 鏄?| 1 |
| `CharacterGenerator` | 鏄?| 1 |
| `UpdateChecker` | 鏄?| 1 |

## 4. 鏈敞鍐屼絾鏈夊娆″疄渚嬪寲鐨勫紩鎿庡垪琛?
浠ヤ笅绫绘湭琚?EngineRegistry 娉ㄥ唽锛屼絾瀛樺湪澶氭瀹炰緥鍖栵紙鍙兘瀵艰嚧鐘舵€佷笉鍚屾锛夛細

| 绫诲悕 | 瀹炰緥鍖栨鏁?| 鏂囦欢鏁?| 鍒嗙被 |
|------|-----------|--------|------|
| `AbortController` | 14 | 9 | unknown |
| `LocalVectorStore` | 8 | 6 | singleton |
| `AdaptiveDebounceManager` | 6 | 5 | singleton |
| `EntityStateManager` | 3 | 3 | singleton |
| `StyleVectorStore` | 3 | 2 | singleton |
| `RhythmAnalyzer` | 2 | 2 | unknown |

## 5. 鏈敞鍐屼絾浠呭疄渚嬪寲涓€娆＄殑绫?
浠ヤ笅绫绘湭琚?EngineRegistry 娉ㄥ唽锛屼絾浠呭疄渚嬪寲涓€娆★紙鍙綔涓哄悗缁縼绉诲€欓€夛級锛?
| 绫诲悕 | 瀹炰緥鍖栦綅缃?| 鍒嗙被 |
|------|-----------|------|
| `BatchEntityGenerator` | engine/ai-engine.ts:69 | unknown |
| `ChapterStateManager` | ui/full-writer-view.ts:146 | singleton |
| `ContextLoaderController` | ui/full-writer-view.ts:313 | unknown |
| `CoverPickerController` | ui/full-writer-view.ts:181 | unknown |
| `EmotionCurveAnalyzer` | ui/services/co-write-facade.ts:350 | unknown |
| `EndingTractionEngine` | ui/services/co-write-facade.ts:366 | singleton |
| `EntityContextEngine` | engine/entity-context-engine.ts:1056 | singleton |
| `EntityGenerator` | engine/ai-engine.ts:68 | unknown |
| `EntityStateController` | ui/full-writer-view.ts:280 | unknown |
| `FloatWorkspaceManager` | main.ts:491 | singleton |
| `InterventionController` | ui/full-writer-view.ts:245 | unknown |
| `LiveAnalysisController` | ui/co-writing-view.ts:160 | unknown |
| `NovelAnalyzer` | ui/novel-analysis-modal.ts:26 | unknown |
| `OutlineGenerator` | engine/ai-engine.ts:66 | unknown |
| `OutlineTreeController` | ui/full-writer-view.ts:180 | unknown |
| `ParallelSuggestionGenerator` | engine/co-writer-engine.ts:951 | unknown |
| `PlotCompletionEngine` | ui/monitor-panel-b.ts:195 | singleton |
| `PlotDivergenceEngine` | ui/monitor-panel-b.ts:196 | singleton |
| `PreloadManager` | engine/cache/preload-manager.ts:597 | singleton |
| `ProjectSelectorController` | ui/full-writer-view.ts:231 | unknown |
| `PromptBuilder` | engine/co-writer-engine.ts:522 | transient |
| `PromptManager` | main.ts:402 | singleton |
| `RulesService` | services/rules-service.ts:24 | singleton |
| `SceneOutlineController` | ui/full-writer/step-render-controller.ts:250 | unknown |
| `SentenceDiversityEngine` | engine/co-writer-engine.ts:174 | singleton |
| `SettingLibController` | ui/full-writer-view.ts:182 | unknown |
| `StatusBarController` | ui/full-writer-view.ts:305 | unknown |
| `StepModalController` | engine/step-runner.ts:78 | unknown |
| `StepRenderController` | ui/full-writer-view.ts:188 | unknown |
| `SuggestionHistoryStore` | ui/co-writing-view.ts:161 | singleton |
| `TabController` | ui/full-writer-view.ts:263 | unknown |
| `TitleBarController` | ui/full-writer-view.ts:291 | unknown |
| `WizardChecker` | ui/full-writer-view.ts:179 | unknown |
| `WizardController` | ui/full-writer-view.ts:224 | unknown |
| `WorldviewGenerator` | engine/ai-engine.ts:65 | unknown |
| `WritingQualityEngine` | ui/monitor-panel-b.ts:197 | singleton |

## 6. 杩佺Щ浼樺厛绾у缓璁?
### P0-A 鈥?绔嬪嵆杩佺Щ锛堝瀹炰緥 + 搴旇鍗曚緥 + 鏈敞鍐岋級

杩欎簺绫诲簲璇ュ崟渚嬶紝浣嗘湭娉ㄥ唽鍒?EngineRegistry锛屼笖瀛樺湪澶氭瀹炰緥鍖栵紝瀛樺湪鐘舵€佷笉鍚屾椋庨櫓銆?闇€瑕侊細1) 娉ㄥ唽鍒?EngineRegistry锛?) 鏇挎崲鎵€鏈夌洿鎺?`new` 涓?`registry.get()`銆?
- **LocalVectorStore** 鈥?8 娆? 6 涓枃浠?- **AdaptiveDebounceManager** 鈥?6 娆? 5 涓枃浠?- **EntityStateManager** 鈥?3 娆? 3 涓枃浠?- **StyleVectorStore** 鈥?3 娆? 2 涓枃浠?
### P0-B 鈥?绔嬪嵆淇锛堝凡娉ㄥ唽浣嗕粛琚洿鎺ュ疄渚嬪寲锛岀粫杩?EngineRegistry锛?
杩欎簺绫?*宸叉敞鍐?*鍒?EngineRegistry锛屼絾浠ｇ爜涓粛鐩存帴 `new` 瀹炰緥鍖栵紙鎺掗櫎 registry 鑷韩鍒濆鍖栵級锛岀粫杩囦簡娉ㄥ唽琛ㄣ€?杩欐槸鐘舵€佷笉鍚屾鐨勭洿鎺ヨ瘉鎹?鈥?瀛樺湪涓?registry 涓疄渚嬩笉鍚岀殑"閲庣敓"瀹炰緥銆?闇€瑕侊細灏嗘墍鏈夌洿鎺?`new` 鏇挎崲涓?`registry.get()`锛堟敞鍐屽凡瀛樺湪锛屼粎闇€鏀硅皟鐢ㄦ柟锛夈€?
- **ChapterVersionService** 鈥?1 娆＄粫杩囧疄渚嬪寲, 2 涓枃浠?(鍒嗙被: singleton)
- **KnowledgeVectorStore** 鈥?1 娆＄粫杩囧疄渚嬪寲, 2 涓枃浠?(鍒嗙被: singleton)

### P1 鈥?寤鸿杩佺Щ锛堝崟瀹炰緥 + 搴旇鍗曚緥 + 鏈敞鍐岋級

杩欎簺绫诲簲璇ュ崟渚嬶紝浣嗘湭娉ㄥ唽鍒?EngineRegistry锛涜櫧鐒剁洰鍓嶄粎瀹炰緥鍖栦竴娆★紝浣嗗簲缁熶竴绠＄悊浠ラ槻婊ョ敤銆?
- **ChapterStateManager** 鈥?ui/full-writer-view.ts:146
- **EndingTractionEngine** 鈥?ui/services/co-write-facade.ts:366
- **EntityContextEngine** 鈥?engine/entity-context-engine.ts:1056
- **FloatWorkspaceManager** 鈥?main.ts:491
- **PlotCompletionEngine** 鈥?ui/monitor-panel-b.ts:195
- **PlotDivergenceEngine** 鈥?ui/monitor-panel-b.ts:196
- **PreloadManager** 鈥?engine/cache/preload-manager.ts:597
- **PromptManager** 鈥?main.ts:402
- **RulesService** 鈥?services/rules-service.ts:24
- **SentenceDiversityEngine** 鈥?engine/co-writer-engine.ts:174
- **SuggestionHistoryStore** 鈥?ui/co-writing-view.ts:161
- **WritingQualityEngine** 鈥?ui/monitor-panel-b.ts:197

### P2 鈥?璇勪及杩佺Щ锛堝瀹炰緥 + 涓嶇‘瀹氾級

杩欎簺绫诲垎绫讳笉纭畾锛岄渶瑕佷汉宸ヨ瘎浼版槸鍚﹀簲璇ュ崟渚嬨€?
- **AbortController** 鈥?14 娆? 9 涓枃浠?- **RhythmAnalyzer** 鈥?2 娆? 2 涓枃浠?
### P3 鈥?鏃犻渶杩佺Щ锛坱ransient锛?
杩欎簺绫诲厑璁告湁澶氬疄渚嬶紙Builder/Config/DTO 绛夛級锛屾棤闇€杩佺Щ銆?
- **PromptBuilder** 鈥?1 娆?
## 7. 杩佺Щ璺緞寤鸿

1. **P0-A 绫?*锛氭敞鍐屽埌 EngineRegistry锛坄register` / `registerLazy`锛夛紝骞舵浛鎹㈡墍鏈夌洿鎺?`new` 涓?`registry.get()`
2. **P0-B 绫?*锛氭敞鍐屽凡瀛樺湪锛屼粎闇€灏嗘墍鏈夌洿鎺?`new` 鏇挎崲涓?`registry.get()`锛堜慨澶嶇粫杩囬棶棰橈級
3. **P1 绫?*锛氭浼樺厛杩佺Щ锛岀粺涓€閫氳繃 `registry.get()` 鑾峰彇
4. **P2 绫?*锛氫汉宸ヨ瘎浼板悗鍐冲畾
5. **P3 绫?*锛氭棤闇€杩佺Щ

## 8. 鍚庣画 Task 寤鸿

- Task 2: 淇 P0-B 绫伙紙宸叉敞鍐屼絾琚粫杩囷級鈥?灏嗙洿鎺?`new` 鏇挎崲涓?`registry.get()`
- Task 3: 杩佺Щ P0-A 绫伙紙鏈敞鍐岀殑澶氬疄渚嬪崟渚嬶級鍒?EngineRegistry
- Task 4: 杩佺Щ P1 绫?- Task 5: 璇勪及 P2 绫?- Task 6: 杩佺Щ楠岃瘉锛堥噸鏂版壂鎻忥紝纭澶氬疄渚嬮棶棰樺凡瑙ｅ喅锛?
