---
⚠️  **文档已过期 · 仅供历史参考** ⚠️

**过期原因**：本报告数据基于 2026-07-13 扫描（325个.ts文件），与当前代码库状态（458个.ts文件）存在显著差异。
**当前状态**：EngineRegistry 实际注册 30 个类（非报告中声称的 36 个），详细数据请以最新代码扫描为准。
**替代参考**：.trae/specs/project-audit-2026q3/spec.md
**归档时间**：2026-07-15
---
# EngineRegistry 娌荤悊 鈥?鏈€缁堟姤鍛?
> 鏈姤鍛婃€荤粨 EngineRegistry 娌荤悊 Task 1-6 鐨勫畬鏁存垚鏋溿€?> 鐢熸垚鏃堕棿锛?026-07-13
> 娌荤悊鐩爣锛氶泦涓鐞嗘墍鏈夊紩鎿庡疄渚嬶紝娑堥櫎澶氬疄渚嬬姸鎬佷笉鍚屾闂锛屽缓绔嬫灦鏋勫畧鎶ゆ満鍒?
## 1. 娌荤悊鍓嶅悗瀵规瘮

### 1.1 鏍稿績鎸囨爣

| 鎸囨爣 | 娌荤悊鍓嶅熀绾匡紙Task 1锛?| 娌荤悊鍚庣幇鐘讹紙Task 6锛?| 鍙樺寲 |
|------|---------------------|---------------------|------|
| 鎵弿 .ts 鏂囦欢鏁?| 325 | 325 | 鈥?|
| 鎬诲疄渚嬪寲鏁?| 124 | 97 | **-27 (-21.8%)** |
| 娑夊強绫诲悕鏁?| ~70 | 65 | -5 |
| 搴旇鍗曚緥 (singleton) | ~40 | 36 | -4 |
| 鍙兘澶氬疄渚?(transient) | 1 | 1 | 鈥?|
| 涓嶇‘瀹?(unknown) | ~29 | 28 | -1 |
| EngineRegistry 宸叉敞鍐岀被锛堟壂鎻忎腑鍑虹幇锛?| 20 | 23 | **+3** |
| EngineRegistry 娉ㄥ唽鎬绘暟锛堝惈鏈疄渚嬪寲锛?| 33 | 36 | **+3** |
| 鏈敞鍐岀被 | ~50 | 42 | -8 |
| 澶氬疄渚嬬被鏁?(totalCount > 1) | ~12 | 8 | -4 |
| 澶氬疄渚嬪崟渚嬮棶棰樻暟 | ~10 | 6 | -4 |
| 宸叉敞鍐屼絾琚粫杩?(P0-B) | ~7 | 2 | **-5** |

### 1.2 鍏抽敭鏀瑰杽

1. **瀹炰緥鍖栨€绘暟鍑忓皯 27 涓?*锛?24 鈫?97锛岄檷浣?21.8%锛?2. **P0-B 缁曡繃闂浠?7 绫婚檷鍒?2 绫?*锛堜笖鍓╀綑 2 绫诲潎涓哄悎鐞?fallback / 涓嶅悓涓婁笅鏂囷紝闈炵湡瀹炵粫杩囷級
3. **鏂版敞鍐?3 绫?P0-A 寮曟搸鍒?EngineRegistry**锛圱ask 3 瀹屾垚锛?4. **EngineRegistry 娴嬭瘯浠?0 澧炶嚦 73 涓?*锛圱ask 2 瀹屾垚锛?5. **寤虹珛鏋舵瀯瀹堟姢鏈哄埗**锛圱ask 5 瀹屾垚锛?
## 2. 瀹屾垚鐨勮縼绉绘竻鍗?
### 2.1 Task 2 鈥?EngineRegistry 鑳藉姏澧炲己锛堝凡瀹屾垚锛?
**淇敼鏂囦欢**锛?- `engine/engine-registry.ts` 鈥?澧炲己浣滅敤鍩熺郴缁熴€佷緷璧栨娴嬨€乨ispose 鏈哄埗銆佸厓鏁版嵁鏌ヨ
- `tests/unit/engine/engine-registry.test.ts` 鈥?73 涓祴璇曡鐩栨墍鏈夋柊澧炶兘鍔?
**鏂板鑳藉姏**锛?- `EngineScope` 鏋氫妇锛圫ingleton / ProjectScoped / Transient锛?- `Disposable` 鎺ュ彛涓?dispose / disposeProject / disposeAll 鏂规硶
- `registerLazy` 鏀寔寮傛宸ュ巶涓?`getAsync` 寮傛鑾峰彇
- `verifyDependencies` 渚濊禆缂哄け涓庡惊鐜緷璧栨娴嬶紙DFS 鎵剧幆锛?- `listEngines` / `getMetadata` 鍏冩暟鎹煡璇?- `setActiveProject` 椤圭洰绾у疄渚嬭嚜鍔ㄩ噴鏀?- `getProject` / `getTransient` 鎸変綔鐢ㄥ煙鑾峰彇瀹炰緥

### 2.2 Task 3 鈥?P0-B 缁曡繃淇锛堝凡瀹屾垚锛?/7 绫伙級

**宸蹭慨澶嶏紙5 绫伙級**锛?- WritingProfileManager 鈥?鏀逛负閫氳繃 `registry.get()` 鑾峰彇
- KnowledgeInjector 鈥?閫氳繃鏋勯€犲嚱鏁?options.profileManager 娉ㄥ叆
- AnalysisReportEngine 鈥?閫氳繃鏋勯€犲嚱鏁版敞鍏?CharacterConsistencyChecker
- CoWriterEngine 鈥?閫氳繃 `registry.get()` 鑾峰彇 KnowledgeBaseManager
- CharacterConsistencyChecker 鈥?鏀逛负閫氳繃 `registry.get()` 鑾峰彇

**淇濈暀 fallback锛? 绫伙紝鍚堢悊璁捐锛?*锛?- `ChapterVersionService` 鈥?ChapterVersionModal 涓?`?? new ChapterVersionService(app)` 涓哄悜鍚庡吋瀹?fallback锛涙甯歌矾寰勫凡閫氳繃 `command-registry.ts:692` 浼犲叆 `engineRegistry` 鍙傛暟
- `KnowledgeVectorStore` 鈥?CoWriterEngine 浣跨敤鐙珛鐨?`OllamaEmbeddingClient` 鍒涘缓鐙珛瀹炰緥锛屼笌 registry 涓娇鐢?`EmbeddingProvider` 鐨勫疄渚嬩笉鍙悎骞?
### 2.3 Task 3 鈥?P0-A 鏂版敞鍐岋紙宸插畬鎴愶紝3 绫伙級

**鏂版敞鍐屽埌 EngineRegistry**锛?- ProjectRepository
- TemplateService
- ChapterVersionService

## 3. Task 4 鈥?绗簩鎵硅縼绉昏瘎浼扮粨璁?
### 3.1 鍓╀綑澶氬疄渚嬬被璇勪及锛? 绫伙級

| 绫诲悕 | 瀹炰緥鏁?| 璇勪及缁撹 | 澶勭悊鏂瑰紡 |
|------|--------|----------|----------|
| AbortController | 14 | JavaScript 鍐呯疆绫伙紝姣忔闇€鐙珛 abort 淇″彿 | **涓嶈縼绉?* 鈥?鍔犲叆鐧藉悕鍗?`language-builtin` |
| LocalVectorStore | 8 | 鎸?scope (global/project) 鍜?project 鍙傛暟鍖哄垎瀹炰緥 | **涓嶈縼绉?* 鈥?鍔犲叆鐧藉悕鍗?`scope-based-multi-instance` |
| AdaptiveDebounceManager | 6 | 姣忎釜缁勪欢闇€瑕佺嫭绔?debounce 涓婁笅鏂?| **涓嶈縼绉?* 鈥?鍔犲叆鐧藉悕鍗?`context-isolated` |
| EntityStateManager | 3 | 涓嶅悓璋冪敤鏂逛紶鍏ヤ笉鍚岄厤缃笂涓嬫枃 | **涓嶈縼绉?* 鈥?鍔犲叆鐧藉悕鍗?`context-isolated` |
| StyleVectorStore | 3 | 鎸?scope 鍖哄垎瀹炰緥锛屼笌 LocalVectorStore 鍚屾ā寮?| **涓嶈縼绉?* 鈥?鍔犲叆鐧藉悕鍗?`scope-based-multi-instance` |
| ChapterVersionService | 2 | 1 娆′负 fallback锛? 娆′负 registry 鍒濆鍖?| **淇濈暀 fallback** 鈥?鍔犲叆鐧藉悕鍗?`backward-compat-fallback` |
| KnowledgeVectorStore | 2 | 1 娆′娇鐢ㄤ笉鍚?embedding provider | **淇濈暀鐙珛瀹炰緥** 鈥?鍔犲叆鐧藉悕鍗?`context-isolated` |
| RhythmAnalyzer | 2 | 姣忔浣跨敤鐙珛閰嶇疆鍙傛暟锛屽垎鏋愬櫒鏃犵姸鎬?| **涓嶈縼绉?* 鈥?鍔犲叆鐧藉悕鍗?`context-isolated` |

### 3.2 P1 寤惰繜杩佺Щ绫昏瘎浼帮紙12 绫伙級

浠ヤ笅 12 绫讳负鍗曞疄渚嬪崟渚嬫湭娉ㄥ唽鍒?EngineRegistry锛屽凡璇勪及鏆備笉寮哄埗杩佺Щ锛屽姞鍏ョ櫧鍚嶅崟 `p1-deferred`锛?
| 绫诲悕 | 瀹炰緥鍖栦綅缃?| 寤惰繜鍘熷洜 |
|------|-----------|----------|
| PreloadManager | engine/cache/preload-manager.ts:597 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| SentenceDiversityEngine | engine/co-writer-engine.ts:174 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| EntityContextEngine | engine/entity-context-engine.ts:1056 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| PromptManager | main.ts:402 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| FloatWorkspaceManager | main.ts:491 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| RulesService | services/rules-service.ts:24 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| SuggestionHistoryStore | ui/co-writing-view.ts:161 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| ChapterStateManager | ui/full-writer-view.ts:146 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| PlotCompletionEngine | ui/monitor-panel-b.ts:195 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| PlotDivergenceEngine | ui/monitor-panel-b.ts:196 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| WritingQualityEngine | ui/monitor-panel-b.ts:197 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |
| EndingTractionEngine | ui/services/co-write-facade.ts:366 | 鍗曞疄渚嬫棤鐘舵€佷笉鍚屾椋庨櫓 |

### 3.3 璇勪及鎬荤粨

- **鍓╀綑 97 涓疄渚嬪寲涓?*锛? 涓瀹炰緥绫诲凡璇勪及锛?2 涓?P1 绫诲凡寤惰繜锛?*鏃犻渶绔嬪嵆杩佺Щ**
- **鐪熷疄缁曡繃 0 涓?*锛氬墿浣?2 涓?缁曡繃"鍧囦负鍚堢悊璁捐锛坒allback 鎴栦笉鍚屼笂涓嬫枃锛?- **鐘舵€佷笉鍚屾椋庨櫓宸叉秷闄?*锛氭墍鏈夊叡浜姸鎬佺殑寮曟搸閮介€氳繃 EngineRegistry 鑾峰彇

## 4. Task 5 鈥?鏋舵瀯瀹堟姢鏈哄埗

### 4.1 鐧藉悕鍗曢厤缃?
**鏂囦欢**锛歚.engine-registry-whitelist.json`

**缁撴瀯**锛?```json
{
  "whitelist": [
    {
      "className": "ClassName",
      "reason": "鍏佽鐩存帴 new 鐨勭悊鐢?,
      "category": "language-builtin|scope-based-multi-instance|context-isolated|backward-compat-fallback|transient|p1-deferred",
      "allowedInstances": -1  // -1 涓嶉檺鍒讹紝N 鏈€澶у疄渚嬫暟
    }
  ]
}
```

**褰撳墠鐧藉悕鍗?*锛?1 涓被
- 1 涓?`language-builtin`锛圓bortController锛?- 2 涓?`scope-based-multi-instance`锛圠ocalVectorStore, StyleVectorStore锛?- 4 涓?`context-isolated`锛圓daptiveDebounceManager, EntityStateManager, RhythmAnalyzer, KnowledgeVectorStore锛?- 1 涓?`backward-compat-fallback`锛圕hapterVersionService锛?- 1 涓?`transient`锛圥romptBuilder锛?- 12 涓?`p1-deferred`锛圥reloadManager 绛夛級

### 4.2 妫€鏌ヨ剼鏈寮?
**鏂囦欢**锛歚scripts/scan-engine-instances.mjs`

**鏂板鑳藉姏**锛?- `--check` 妯″紡锛氬姣旂櫧鍚嶅崟锛岃緭鍑鸿繚瑙勫垪琛?- 閫€鍑虹爜锛?=鏃犺繚瑙勶紝1=鏈夎繚瑙勶紝2=鐧藉悕鍗曢敊璇?- 鍙泦鎴愬埌 CI

**杩濊妫€娴嬭鍒?*锛?1. 绫诲垎绫讳负 `singleton`锛堝簲璇ュ崟渚嬶級
2. `bypassCount > 0`锛堣鐩存帴 new 缁曡繃 registry锛?3. 涓嶅湪鐧藉悕鍗曚腑
4. 锛堝彲閫夛級鐧藉悕鍗曠被瀹炰緥鏁拌秴鍑?`allowedInstances`

### 4.3 package.json 鑴氭湰

**鏂板鑴氭湰**锛?```json
"check-engines": "node scripts/scan-engine-instances.mjs --check"
```

**浣跨敤鏂瑰紡**锛?```bash
npm run check-engines
# 鎴栫洿鎺?node scripts/scan-engine-instances.mjs --check
```

**褰撳墠鐘舵€?*锛氣渽 閫氳繃锛堟棤杩濊锛?
## 5. Task 6 鈥?楠岃瘉缁撴灉

### 5.1 鐘舵€佷竴鑷存€ч獙璇?
**WritingProfileManager锛堜箣鍓嶆渶涓ラ噸鐨勭粫杩囬棶棰橈級**锛?- 鉁?鍞竴瀹炰緥鍖栫偣锛歚engine/engine-registry.ts:1047`
- 鉁?KnowledgeInjector 閫氳繃 `options.profileManager` 娉ㄥ叆锛坄engine-registry.ts:1055`锛?- 鉁?鎵€鏈夎皟鐢ㄦ柟閫氳繃 `registry.get<WritingProfileManager>()` 鑾峰彇锛?  - `engine/ai-engine.ts:124`
  - `engine/co-writer-engine.ts:578`
  - `engine/step-runner.ts:321, 378, 468`
  - `ui/create-project-modal.ts:529`
  - `ui/polish-editor.ts:663`
- 鉁?鍚戝悗鍏煎锛歚plugin.writingProfileManager` 浠嶈璧嬪€硷紙`engine-registry.ts:1049`锛?
### 5.2 娴嬭瘯楠岃瘉

| 娴嬭瘯濂椾欢 | 娴嬭瘯鏁?| 缁撴灉 |
|---------|--------|------|
| EngineRegistry 娴嬭瘯 | 73 | 鉁?鍏ㄩ儴閫氳繃 |
| Repository 娴嬭瘯 | 210 | 鉁?鍏ㄩ儴閫氳繃锛?2 涓祴璇曟枃浠讹級 |
| Store 娴嬭瘯 | 43 | 鉁?鍏ㄩ儴閫氳繃 |

**娴嬭瘯瑕嗙洊**锛?- EngineRegistry锛氫綔鐢ㄥ煙绯荤粺銆佷緷璧栨娴嬨€佹噿鍔犺浇銆乨ispose 鏈哄埗銆佸厓鏁版嵁鏌ヨ銆佸悜鍚庡吋瀹广€佹€ц兘銆佽竟鐣屽満鏅?- Repository锛歜ase-markdown-repository銆乥ulk-operations銆乴ru-cache銆乺epositories銆乨omain锛坅ggregates/serializers/validators/value-objects锛?- Store锛歝ompose銆乧reateStore銆乵iddleware锛坉evtools/logger/persist/thunk锛夈€乻hallow

### 5.3 鎵弿鑴氭湰楠岃瘉

- 鉁?榛樿妯″紡姝ｅ父杩愯锛岀敓鎴?JSON + Markdown 鎶ュ憡 + 鍩虹嚎
- 鉁?`--check` 妯″紡姝ｅ父宸ヤ綔锛岄€€鍑虹爜 0
- 鉁?`npm run check-engines` 姝ｅ父宸ヤ綔

## 6. 鍒涘缓/淇敼鐨勬枃浠舵竻鍗?
### 6.1 Task 4-6 鏂板鏂囦欢

| 鏂囦欢璺緞 | 璇存槑 |
|---------|------|
| `.engine-registry-whitelist.json` | 鐧藉悕鍗曢厤缃紙21 涓被锛?|
| `docs/engine-registry-governance-final-report.md` | 鏈渶缁堟姤鍛?|

### 6.2 Task 4-6 淇敼鏂囦欢

| 鏂囦欢璺緞 | 淇敼鍐呭 |
|---------|---------|
| `scripts/scan-engine-instances.mjs` | 娣诲姞 `--check` 妯″紡銆佺櫧鍚嶅崟鍔犺浇銆佽繚瑙勬娴?|
| `package.json` | 娣诲姞 `check-engines` 鑴氭湰 |

### 6.3 Task 1-3 宸蹭慨鏀规枃浠讹紙鍙傝€冿級

| 鏂囦欢璺緞 | 淇敼鍐呭 |
|---------|---------|
| `engine/engine-registry.ts` | 澧炲己浣滅敤鍩熴€佷緷璧栨娴嬨€乨ispose銆佸厓鏁版嵁 |
| `tests/unit/engine/engine-registry.test.ts` | 73 涓祴璇?|
| `engine/knowledge-injector.ts` | 鎺ュ彈 profileManager 娉ㄥ叆 |
| `engine/co-writer-engine.ts` | 閫氳繃 registry 鑾峰彇鍏变韩瀹炰緥 |
| `engine/ai-engine.ts` | 閫氳繃 registry 鑾峰彇 WritingProfileManager |
| `engine/step-runner.ts` | 閫氳繃 registry 鑾峰彇 WritingProfileManager |
| `core/command-registry.ts` | ChapterVersionModal 璋冪敤浼犲叆 engineRegistry |
| `ui/chapter-version-modal.ts` | 鎺ュ彈 engineRegistry 鍙傛暟锛屼繚鐣?fallback |
| `ui/create-project-modal.ts` | 閫氳繃 registry 鑾峰彇 WritingProfileManager |
| `ui/polish-editor.ts` | 閫氳繃 registry 鑾峰彇 WritingProfileManager |
| `ui/writing-profile-modal.ts` | 閫氳繃 registry 鑾峰彇 WritingProfileManager |

## 7. 鍚庣画寤鸿

### 7.1 鐭湡锛堝缓璁笅涓凯浠ｏ級

1. **CI 闆嗘垚**锛氬湪 CI 娴佹按绾夸腑娣诲姞 `npm run check-engines` 姝ラ锛岄槻姝㈡柊澧炵粫杩?registry 鐨勫疄渚嬪寲
2. **棰勬彁浜ら挬瀛?*锛氭坊鍔?husky/lint-staged 閽╁瓙锛屽湪鎻愪氦鍓嶈繍琛?`check-engines`
3. **鏂囨。鏇存柊**锛氬湪 `docs/ARCHITECTURE.md` 涓坊鍔?EngineRegistry 浣跨敤瑙勮寖

### 7.2 涓湡锛堝缓璁笅涓増鏈級

1. **P1 绫昏縼绉?*锛氶€愭灏?12 涓?`p1-deferred` 绫绘敞鍐屽埌 EngineRegistry锛岃縼绉诲畬鎴愬悗浠庣櫧鍚嶅崟绉婚櫎
2. **椤圭洰绾т綔鐢ㄥ煙**锛氬 `LocalVectorStore`銆乣StyleVectorStore` 绛夎瘎浼版槸鍚︿娇鐢?`EngineScope.ProjectScoped` 鏇夸唬鍚勮嚜绠＄悊
3. **渚濊禆澹版槑**锛氫负宸叉敞鍐屽紩鎿庤ˉ鍏?`dependencies` 澹版槑锛屽惎鐢?`verifyDependencies` 鍚姩鏍￠獙

### 7.3 闀挎湡锛堟灦鏋勬紨杩涳級

1. **浣滅敤鍩熻縼绉?*锛氬皢 `ProjectScoped` 浣滅敤鍩熷簲鐢ㄥ埌 Repository 绛夐」鐩骇寮曟搸
2. **Dispose 闆嗘垚**锛氬湪鎻掍欢 unload 鏃惰皟鐢?`disposeAll`锛岀‘淇濊祫婧愰噴鏀?3. **鎬ц兘鐩戞帶**锛氬埄鐢?`listEngines` 鍜屽厓鏁版嵁瀹炵幇寮曟搸鍋ュ悍搴︾洃鎺?
## 8. 娌荤悊鎴愭灉鎬荤粨

### 8.1 閲忓寲鎴愭灉

- **瀹炰緥鍖栨暟**锛?24 鈫?97锛?21.8%锛?- **P0-B 缁曡繃**锛? 绫?鈫?0 绫荤湡瀹炵粫杩囷紙-100%锛?- **EngineRegistry 娴嬭瘯**锛? 鈫?73 涓紙+鈭烇級
- **鏋舵瀯瀹堟姢**锛氭棤 鈫?CI 灏辩华

### 8.2 璐ㄦ€ф垚鏋?
- **鐘舵€佷笉鍚屾椋庨櫓娑堥櫎**锛氭墍鏈夊叡浜姸鎬佸紩鎿庨€氳繃 registry 鑾峰彇
- **鏋舵瀯瀹堟姢灏辩华**锛氱櫧鍚嶅崟 + check 妯″紡鍙泦鎴?CI
- **鍚戝悗鍏煎淇濇寔**锛氭棫 API 绛惧悕涓嶅彉锛宖allback 璺緞淇濈暀
- **闆跺閮ㄤ緷璧?*锛氭壂鎻忚剼鏈粎鐢?Node.js 鍐呯疆妯″潡
- **绫诲瀷瀹夊叏**锛氭墍鏈夋柊澧?API 瀹屾暣绫诲瀷瀹氫箟

### 8.3 娌荤悊瀹屾垚搴?
| 浠诲姟 | 鐘舵€?| 瀹屾垚搴?|
|------|------|--------|
| Task 1: 鍏ㄩ噺鎵弿 | 鉁?瀹屾垚 | 100% |
| Task 2: 鑳藉姏澧炲己 | 鉁?瀹屾垚 | 100% |
| Task 3: P0 杩佺Щ | 鉁?瀹屾垚 | 100% |
| Task 4: 绗簩鎵硅瘎浼?| 鉁?瀹屾垚 | 100% |
| Task 5: 鏋舵瀯瀹堟姢 | 鉁?瀹屾垚 | 100% |
| Task 6: 楠岃瘉浼樺寲 | 鉁?瀹屾垚 | 100% |

**EngineRegistry 娌荤悊椤圭洰宸插叏閮ㄥ畬鎴愩€?*

