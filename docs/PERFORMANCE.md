---
⚠️  **文档需核实 · 可能与当前代码不符** ⚠️

**注意**：本文档最后更新时间较早，部分描述可能与当前代码实现存在差异。
**建议**：引用前请先对照源代码核实，以实际代码为准。
**最新审计**：.trae/specs/project-audit-2026q3/spec.md
**核实状态**：待更新 · 2026-07-15
---
# 鎬ц兘浼樺寲鎸囧崡

鏈枃妗ｈ鏄?Novel Writer AI 鎻掍欢鐨勭紦瀛樼瓥鐣ャ€佹€ц兘鐩戞帶浣跨敤鏂规硶鍜屼紭鍖栨鏌ユ竻鍗曪紝甯姪寮€鍙戣€呰瘑鍒€ц兘鐡堕骞堕噰鍙栦紭鍖栨帾鏂姐€?
---

## 涓€銆佺紦瀛樼瓥鐣ヨ鏄?
### 缂撳瓨鍒嗗眰鏋舵瀯

```
璇锋眰 鈫?L1 鍐呭瓨缂撳瓨锛圠RU + TTL锛夆啋 L2 鏂囦欢缂撳瓨 鈫?L3 婧愭枃浠讹紙Markdown锛?            鍛戒腑 鈫?杩斿洖 鈫?             鍛戒腑 鈫?鍥炲～ L1 鈫?杩斿洖 鈫?                                                    鏈懡涓?鈫?璇诲彇婧愭枃浠?鈫?鍥炲～ L1 + L2 鈫?杩斿洖
```

### L1 鍐呭瓨缂撳瓨锛圠ruCache锛?
**閫傜敤鍦烘櫙**锛?- 楂橀璇诲彇鐨勬暟鎹紙濡傚綋鍓嶇珷鑺傘€佹椿璺冧汉鐗╋級
- 鍗曡繘绋嬪唴鐨勬暟鎹叡浜紙Repository 缂撳瓨锛?- 棰戠箒璁块棶鐨勯鍩熸ā鍨?
**瀹归噺闄愬埗**锛?- 榛樿鏈€澶?100 鏉＄洰锛堝彲鍦?Repository 鏋勯€犳椂璋冩暣锛?- 姣忔潯鐩粯璁?TTL 5 鍒嗛挓
- 瓒呰繃 maxSize 鏃舵寜 LRU 绛栫暐娣樻卑
- 鍐呭瓨鍘嬪姏澶ф椂涓诲姩椹遍€愶紙`adjustForMemoryPressure`锛?
**鍏抽敭 API**锛?```typescript
import { LruCache } from '../shared/lru-cache';

const cache = new LruCache<string, MyData>({
    maxSize: 100,
    ttlMs: 5 * 60 * 1000,
});

cache.set('key', data);
const value = cache.get('key');  // 鍛戒腑杩斿洖鍊硷紝鏈懡涓繑鍥?undefined
cache.delete('key');
cache.deleteByPrefix('user:');
cache.clear();
cache.pruneExpired();  // 娓呯悊杩囨湡鏉＄洰锛岃繑鍥炴竻鐞嗘暟閲?```

**浣曟椂浣跨敤**锛?- 鉁?Repository 鍐呯疆缂撳瓨锛堣嚜鍔ㄧ鐞嗭級
- 鉁?鐭湡鐑偣鏁版嵁锛堢敤鎴峰綋鍓嶄細璇濓級
- 鉁?瑙ｆ瀽鍚庣殑棰嗗煙瀵硅薄锛堥伩鍏嶉噸澶嶅弽搴忓垪鍖栵級
- 鉂?澶ф暟鎹噺锛堝簲璧?L2锛?- 鉂?璺ㄨ繘绋嬪叡浜暟鎹紙鐢?L2锛?
---

### L2 鏂囦欢缂撳瓨锛團ileCache锛?
**閫傜敤鍦烘櫙**锛?- 鏄傝吹璁＄畻缁撴灉锛堝鍒嗘瀽鎶ュ憡銆丄I 鐢熸垚缁撴灉锛?- 澶ф暟鎹噺锛堝瀹屾暣涓婁笅鏂囧揩鐓э級
- 璺ㄤ細璇濇寔涔呭寲鏁版嵁锛堝椋庢牸鍒嗘瀽妯″紡锛?- 椤圭洰绾у叡浜暟鎹?
**澶辨晥绛栫暐**锛?- **TTL 杩囨湡**锛氶粯璁?24 灏忔椂锛坄ttlMs`锛?- **婧愭枃浠?mtime 澶辨晥**锛氭簮鏂囦欢淇敼鍚庯紝鐩稿叧缂撳瓨鑷姩澶辨晥
- **鎵嬪姩澶辨晥**锛氭寜 key / 鎸夊墠缂€ / 鎸夋簮鏂囦欢璺緞
- **LRU 娣樻卑**锛氳秴杩?`maxFiles` 鏃舵寜 `accessedAt` 娣樻卑

**鍏抽敭 API**锛?```typescript
import { FileCache } from '../engine/cache';
import { ObsidianFileSystem } from '../shared/file-system-port';

const fileCache = new FileCache(new ObsidianFileSystem(app), {
    cacheDir: '.cache',
    ttlMs: 24 * 60 * 60 * 1000,
    maxFiles: 1000,
});

// 鍐欏叆缂撳瓨锛堝彲鍏宠仈婧愭枃浠讹級
await fileCache.set('analysis:ch1', result, {
    sourcePath: 'project/03-澶х翰涓庣珷鑺?姝ｆ枃/绗?鍗?绗?绔燺姝ｆ枃.md',
    sourceMtime: Date.now(),
});

// 璇诲彇缂撳瓨
const cached = await fileCache.get('analysis:ch1');

// 澶辨晥缂撳瓨
await fileCache.delete('analysis:ch1');                    // 鍗曟潯
await fileCache.deleteByPrefix('analysis:');               // 鍓嶇紑
fileCache.invalidateBySourcePath('path/to/source.md');      // 鎸夋簮鏂囦欢
await fileCache.clear();                                    // 娓呯┖
await fileCache.pruneExpired();                             // 娓呯悊杩囨湡

// 缁熻
console.log('鏂囦欢鏁?', fileCache.size);
console.log('鎬诲瓧鑺?', fileCache.totalSizeBytes);
```

**浣曟椂浣跨敤**锛?- 鉁?AI 鍒嗘瀽鎶ュ憡锛堣绠楁垚鏈珮锛?- 鉁?瀹屾暣涓婁笅鏂囧揩鐓э紙鏁版嵁閲忓ぇ锛?- 鉁?璺ㄤ細璇濆叡浜殑缂撳瓨鏁版嵁
- 鉂?棰戠箒鍙樺寲鐨勬暟鎹紙搴旇蛋 L1锛?- 鉂?鍗曟浣跨敤鐨勬暟鎹紙鐩存帴璁＄畻鏇村揩锛?
---

### 澶氬眰缂撳瓨锛圡ultiLayerCache锛夆€?鎺ㄨ崘鏂瑰紡

**閫傜敤鍦烘櫙**锛?- Repository 鏁版嵁璁块棶灞傦紙鑷姩闆嗘垚锛?- 闇€瑕佹櫤鑳界紦瀛樼瓥鐣ョ殑鍦烘櫙
- 澶у瀷椤圭洰锛?200 瀹炰綋锛夎嚜鍔ㄥ惎鐢?L2

**鍔ㄦ€佽嚜閫傚簲绛栫暐**锛?
| 椤圭洰瑙勬ā | 瀹炰綋鏁?| L1 澶у皬 | L2 鍚敤 |
|---------|--------|---------|---------|
| small | < 50 | 100 | 鍚?|
| medium | 50-200 | 300 | 鍚?|
| large | > 200 | 500 | 鏄?|

**鍏抽敭 API**锛?```typescript
import { MultiLayerCache } from '../engine/cache';

const cache = new MultiLayerCache({
    l1MaxSize: 100,
    l1TtlMs: 5 * 60 * 1000,
    l2Enabled: false,  // 榛樿鍏抽棴锛屽ぇ鍨嬮」鐩嚜鍔ㄥ惎鐢?    autoAdapt: true,
});

// 鏍囧噯鎿嶄綔
await cache.set('key', value, { sourcePath: '...' });
const data = await cache.get<Type>('key');
await cache.invalidate('key');
await cache.invalidateByPrefix('user:');
await cache.clear();

// 鑷€傚簲鎺у埗
cache.setEntityCount(250);  // 瑙﹀彂鑷姩璋冩暣涓?large 妯″紡
cache.adjustForMemoryPressure(0.8);  // 鍐呭瓨鍘嬪姏 80% 鏃堕┍閫?25%

// 缁熻
const stats = cache.getStats();
console.log('L1 鍛戒腑鐜?', (stats.l1.hitRate * 100).toFixed(1) + '%');
console.log('L2 鍛戒腑鐜?', (stats.l2.hitRate * 100).toFixed(1) + '%');
console.log('鎬讳綋鍛戒腑鐜?', (stats.overall.hitRate * 100).toFixed(1) + '%');
console.log('鎱㈡搷浣?', stats.slowOperations);
```

---

### 浣曟椂璇ョ敤鍝眰缂撳瓨锛?
| 鍦烘櫙 | 鎺ㄨ崘绛栫暐 | 鐞嗙敱 |
|------|---------|------|
| Repository 鏁版嵁璁块棶 | 鑷姩锛圠1+L2锛?| 閫氳繃 `multiLayerCache` 鍙傛暟鑷姩绠＄悊 |
| 褰撳墠绔犺妭楂橀璇诲彇 | L1锛堥粯璁わ級 | 鍐呭瓨璁块棶鏈€蹇紝TTL 5 鍒嗛挓瓒冲 |
| AI 鍒嗘瀽缁撴灉缂撳瓨 | L2锛團ileCache锛?| 璁＄畻鎴愭湰楂橈紝璺ㄤ細璇濆彲澶嶇敤 |
| 瀹屾暣涓婁笅鏂囧揩鐓?| L2锛團ileCache锛?| 鏁版嵁閲忓ぇ锛岄伩鍏嶅唴瀛樺崰鐢?|
| 鐢ㄦ埛鍋忓ソ璁剧疆 | Store persist | 閫氳繃 `createObsidianSettingStorage` |
| 缂栬緫鍘嗗彶 | Store persist + IndexedDB | 澶ф暟鎹噺锛岄€氳繃 `createIndexedDbStorage` |
| 瀹炴椂璁＄畻缁撴灉 | L1锛堢煭 TTL锛?| 1 鍒嗛挓 TTL锛屽钩琛″疄鏃舵€т笌鎬ц兘 |
| 椤圭洰绾у叡浜暟鎹?| L2锛團ileCache锛?| 璺?Repository 鍏变韩 |

---

## 浜屻€佹€ц兘鐩戞帶浣跨敤

### PerformanceMonitor 鍗曚緥

`PerformanceMonitor` 鏄?engine 灞傜殑鎬ц兘鐩戞帶宸ュ叿锛屼笓涓哄煁鐐硅璁★細

```typescript
import { performanceMonitor, PerformanceMonitor } from '../services/performance-monitor';

// 鑾峰彇鍗曚緥锛堣嚜鍔ㄥ垱寤猴級
const monitor = PerformanceMonitor.getInstance();

// 閰嶇疆
monitor.updateOptions({
    enabled: true,
    slowOperationThresholdMs: 500,
    maxHistorySize: 1000,
});

// 鍚敤/绂佺敤
monitor.enable();
monitor.disable();
monitor.setSlowOperationThreshold(1000);
```

### 鍩烘湰鍩嬬偣

```typescript
// 鏂瑰紡 1锛歴tartMark / endMark锛堟帹鑽愶級
const markId = monitor.startMark('my-operation', {
    userId: 'user1',
    chapterId: 'v1-c1',
});

try {
    // ... 鎵ц涓氬姟閫昏緫
    await someExpensiveOperation();
} finally {
    const duration = monitor.endMark(markId);
    if (duration !== null) {
        console.log(`鎿嶄綔鑰楁椂: ${duration.toFixed(2)}ms`);
    }
}
```

### 鍖呰９鍑芥暟鎵ц锛堜究鎹锋柟寮忥級

```typescript
// 鍚屾鍑芥暟鍖呰９
const result = monitor.wrap('compute-hash', () => {
    return computeExpensiveHash(data);
});

// 寮傛鍑芥暟鍖呰９
const data = await monitor.wrapAsync('fetch-chapter', async () => {
    return await chapterRepo.findById(id);
});
```

### 鏌ヨ缁熻

```typescript
// 鑾峰彇鎵€鏈夋搷浣滅粺璁?const stats = monitor.getStats();
console.log('鎬绘搷浣滄暟:', stats.totalOperations);
console.log('鎬昏€楁椂:', stats.totalDuration);
console.log('骞冲潎鑰楁椂:', stats.avgDuration);

// 鏌ョ湅姣忎釜鎿嶄綔鐨勭粺璁?for (const [key, opStats] of Object.entries(stats.operations)) {
    console.log(`${key}: 骞冲潎 ${opStats.avgDuration.toFixed(2)}ms (璋冪敤 ${opStats.count} 娆?`);
}

// 鏌ョ湅鏈€鎱㈢殑 10 涓搷浣?console.log('鏈€鎱㈡搷浣?');
stats.slowestTop10.forEach(op => {
    console.log(`  ${op.key}: ${op.avgDuration.toFixed(2)}ms 脳 ${op.count}`);
});

// 鏌ョ湅鎱㈡搷浣滃巻鍙诧紙瓒呰繃闃堝€肩殑锛?const slowOps = monitor.getSlowOperations();
slowOps.forEach(op => {
    console.log(`  ${op.key}: ${op.duration}ms (闃堝€? ${op.threshold}ms)`);
});
```

### 鍗曚釜鎿嶄綔缁熻

```typescript
// 鏌ヨ鐗瑰畾鎿嶄綔鐨勭粺璁?const chapterLoadStats = monitor.getOperationStats('fetch-chapter');
if (chapterLoadStats) {
    console.log('绔犺妭鍔犺浇缁熻:');
    console.log(`  璋冪敤娆℃暟: ${chapterLoadStats.count}`);
    console.log(`  骞冲潎: ${chapterLoadStats.avgDuration.toFixed(2)}ms`);
    console.log(`  鏈€蹇? ${chapterLoadStats.minDuration.toFixed(2)}ms`);
    console.log(`  鏈€鎱? ${chapterLoadStats.maxDuration.toFixed(2)}ms`);
    console.log(`  鎬昏€楁椂: ${chapterLoadStats.totalDuration.toFixed(2)}ms`);
}
```

### 閲嶇疆涓庢竻鐞?
```typescript
// 閲嶇疆鎵€鏈夌粺璁?monitor.reset();

// 浠呮竻鐞嗘參鎿嶄綔鍘嗗彶
monitor.clearSlowOperations();
```

### 瀹炴垬绀轰緥锛氱洃鎺?Repository 鎬ц兘

```typescript
class MonitoredCharacterRepository extends CharacterRepository {
    async findById(id: string): Promise<Character | null> {
        const markId = performanceMonitor.startMark('character.findById', { id });
        try {
            return await super.findById(id);
        } finally {
            performanceMonitor.endMark(markId);
        }
    }

    async findAll(): Promise<Character[]> {
        const markId = performanceMonitor.startMark('character.findAll');
        try {
            return await super.findAll();
        } finally {
            performanceMonitor.endMark(markId);
        }
    }

    async save(entity: Character): Promise<Character> {
        const markId = performanceMonitor.startMark('character.save', {
            id: entity.id,
        });
        try {
            return await super.save(entity);
        } finally {
            performanceMonitor.endMark(markId);
        }
    }
}

// 瀹氭湡杈撳嚭鎬ц兘鎶ュ憡锛堝紑鍙戠幆澧冿級
if (process.env.NODE_ENV === 'development') {
    setInterval(() => {
        const stats = performanceMonitor.getStats();
        console.log('=== 鎬ц兘鎶ュ憡 ===');
        console.log(`鎬绘搷浣滄暟: ${stats.totalOperations}`);
        console.log(`骞冲潎鑰楁椂: ${stats.avgDuration.toFixed(2)}ms`);
        console.log('Top 5 鎱㈡搷浣?');
        stats.slowestTop10.slice(0, 5).forEach(op => {
            console.log(`  ${op.key}: ${op.avgDuration.toFixed(2)}ms 脳 ${op.count}`);
        });
    }, 60_000);
}
```

---

## 涓夈€佹€ц兘浼樺寲妫€鏌ユ竻鍗?
鍦ㄦ彁浜や唬鐮佸墠锛岃閫愰」妫€鏌ワ細

### Repository 鐩稿叧

- [ ] **鏄惁浣跨敤浜?Repository 缂撳瓨**锛氶€氳繃 `multiLayerCache` 鍙傛暟鍚敤 L2 缂撳瓨
  ```typescript
  // 鉁?鎺ㄨ崘
  new CharacterRepository(fs, project, {
      multiLayerCache: cache,
      cacheKeyPrefix: 'char:',
  });

  // 鉂?閬垮厤锛氱鐢ㄧ紦瀛?  new CharacterRepository(fs, project, { cacheEnabled: false });
  ```

- [ ] **鏄惁閬垮厤閲嶅璇诲彇鍚屼竴鏂囦欢**锛氫娇鐢?`findById` 鑰岄潪姣忔 `fs.read`
  ```typescript
  // 鉁?鎺ㄨ崘锛歊epository 鑷姩缂撳瓨
  const character = await repo.findById(id);

  // 鉂?閬垮厤锛氭瘡娆￠兘璇绘枃浠?  const content = await fs.read(filePath);
  ```

- [ ] **鏄惁浣跨敤鎵归噺鎿嶄綔鑰岄潪寰幆鍗曟潯**锛氭壒閲忔搷浣滃噺灏?IO 寰€杩?  ```typescript
  // 鉁?鎺ㄨ崘锛氭壒閲忎繚瀛?  await repo.saveAll(characters);

  // 鉂?閬垮厤锛氬惊鐜崟鏉′繚瀛?  for (const c of characters) await repo.save(c);
  ```

- [ ] **鏁版嵁淇敼鍚庢槸鍚﹀け鏁堢紦瀛?*锛氶伩鍏嶈剰璇?  ```typescript
  await repo.save(updatedCharacter);
  // 濡傛灉鍏朵粬寮曟搸鎸佹湁寮曠敤锛屼富鍔ㄥけ鏁?  contextManager.invalidateContextCache(project);
  ```

### 缂撳瓨鐩稿叧

- [ ] **澶ф暟鎹槸鍚﹁蛋 L2 缂撳瓨**锛氶伩鍏嶅唴瀛樼垎鐐?  ```typescript
  // 鉁?澶ф暟鎹敤 FileCache
  await fileCache.set('full-context-snapshot', largeData);

  // 鉂?澶ф暟鎹敤 L1
  lruCache.set('large-data', hugeObject);  // 鍗犵敤鍐呭瓨
  ```

- [ ] **鏄惁浣跨敤棰勫姞杞藉噺灏戠瓑寰?*锛氱敤鎴峰垏鎹㈢珷鑺傛椂棰勫姞杞界浉閭荤珷鑺?  ```typescript
  // 鐢ㄦ埛杩涘叆 v1-c5 鏃讹紝棰勫姞杞?v1-c4 鍜?v1-c6
  await preloadManager.preloadAdjacentChapters('v1-c5');
  ```

- [ ] **鏄惁鍚堢悊閰嶇疆缂撳瓨 TTL**锛氭牴鎹暟鎹彉鍖栭鐜囪皟鏁?  ```typescript
  // 瀹炴椂鎬ц姹傞珮锛? 鍒嗛挓
  { cacheTtlMs: 60 * 1000 }

  // 榛樿锛? 鍒嗛挓
  { cacheTtlMs: 5 * 60 * 1000 }

  // 璇诲鍐欏皯锛?0 鍒嗛挓
  { cacheTtlMs: 10 * 60 * 1000 }
  ```

### 鎬ц兘鍩嬬偣鐩稿叧

- [ ] **鏄惁娣诲姞浜嗘€ц兘鍩嬬偣**锛氬叧閿搷浣滃繀椤诲煁鐐?  ```typescript
  const markId = performanceMonitor.startMark('operation-name');
  try {
      // ... 涓氬姟閫昏緫
  } finally {
      performanceMonitor.endMark(markId);
  }
  ```

- [ ] **鏄惁浣跨敤 wrapAsync 绠€鍖栧煁鐐?*锛氬紓姝ユ搷浣滄帹鑽愮敤 wrapAsync
  ```typescript
  // 鉁?鎺ㄨ崘
  const result = await performanceMonitor.wrapAsync('fetch-data', () => {
      return fetchData();
  });

  // 绛変环浜庢墜鍔ㄥ煁鐐癸紝浣嗘洿绠€娲?  ```

- [ ] **鎱㈡搷浣滄槸鍚﹀憡璀?*锛氱洃鎺ф參浜庨槇鍊肩殑鎿嶄綔
  ```typescript
  // 鑷姩鍛婅锛堝凡鍐呯疆锛?  // 褰撴搷浣滆€楁椂 > slowOperationThresholdMs 鏃讹紝console.warn
  ```

### 娴佸紡鐢熸垚鐩稿叧

- [ ] **鏄惁浣跨敤娴佸紡鑰岄潪涓€娆℃€у搷搴?*锛氶暱鏂囨湰鐢熸垚蹇呴』娴佸紡
  ```typescript
  // 鉁?鎺ㄨ崘锛氭祦寮忕敓鎴?  for await (const chunk of engine.suggestStream(...)) {
      renderToUI(chunk);
  }

  // 鉂?閬垮厤锛氫竴娆℃€ц幏鍙栧叏閮紙鐢ㄦ埛绛夊緟鏃堕棿闀匡級
  const result = await engine.suggestNext(...);
  ```

- [ ] **鏄惁鎻愪緵鍙栨秷鑳藉姏**锛氶暱浠诲姟蹇呴』鍙彇娑?  ```typescript
  const controller = new AbortController();
  const stream = engine.suggestStream(..., controller.signal);
  // 鐢ㄦ埛鐐瑰嚮鍙栨秷鏃?  cancelButton.onclick = () => controller.abort();
  ```

### 鐘舵€佺鐞嗙浉鍏?
- [ ] **鏄惁浣跨敤閫夋嫨鍣ㄨ闃?*锛氶伩鍏嶄笉蹇呰鐨勬覆鏌?  ```typescript
  // 鉁?鎺ㄨ崘锛氶€夋嫨鍣ㄨ闃?  store.subscribe(
      (state) => state.suggestions,
      (suggestions) => renderSuggestions(suggestions),
      { equalityFn: shallow },
  );

  // 鉂?閬垮厤锛氳闃呮暣涓?state
  store.subscribe((state) => render(state));
  ```

- [ ] **鎸佷箙鍖栫瓥鐣ユ槸鍚︽纭?*锛氬唴瀛樻€?vs 鎸佷箙鍖栧瓧娈垫槑纭垎绂?  ```typescript
  // 鎸佷箙鍖栵細chapter / metrics / ui锛堢敤鎴峰亸濂斤級
  // 鍐呭瓨鎬侊細suggestion / editor锛堝疄鏃跺彉鍖栵級
  ```

### 鍐呭瓨绠＄悊鐩稿叧

- [ ] **澶ф暟鎹粨鏋勬槸鍚﹀畾鏈熸竻鐞?*锛氶伩鍏嶅唴瀛樻硠婕?  ```typescript
  // 瀹氭湡娓呯悊杩囨湡缂撳瓨
  setInterval(() => {
      lruCache.pruneExpired();
  }, 60_000);
  ```

- [ ] **鏄惁閬垮厤寰幆寮曠敤**锛氱姸鎬佸璞′笉搴斿寘鍚惊鐜紩鐢?  ```typescript
  // 鉂?閬垮厤锛氬惊鐜紩鐢ㄥ鑷?JSON.stringify 澶辫触
  state.entity.parent = state;
  ```

- [ ] **缁勪欢閿€姣佹椂鏄惁鍙栨秷璁㈤槄**锛氶槻姝㈠唴瀛樻硠婕?  ```typescript
  class MyView {
      private unsubscribe: (() => void) | null = null;

      onload() {
          this.unsubscribe = store.subscribe(listener);
      }

      onunload() {
          this.unsubscribe?.();
          this.unsubscribe = null;
      }
  }
  ```

---

## 鍥涖€佸父瑙佹€ц兘闂鎺掓煡

### 闂 1锛歊epository.findAll() 寰堟參

**鍙兘鍘熷洜**锛?- 棣栨璋冪敤鏈懡涓紦瀛?- 瀹炰綋鏂囦欢杩囧
- 鍙嶅簭鍒楀寲寮€閿€澶?
**瑙ｅ喅鏂规**锛?```typescript
// 1. 鍚敤 L2 缂撳瓨
const repo = new CharacterRepository(fs, project, {
    multiLayerCache: cache,  // 鍚敤 L2
});

// 2. 鍑忓皯涓嶅繀瑕佺殑 findAll
// 浣跨敤 findByXxx 绛夌壒瀹氭煡璇㈡柟娉?
// 3. 娣诲姞鎬ц兘鍩嬬偣纭鐡堕
const markId = performanceMonitor.startMark('findAll');
try {
    return await repo.findAll();
} finally {
    performanceMonitor.endMark(markId);
}
```

### 闂 2锛氬唴瀛樺崰鐢ㄨ繃楂?
**鍙兘鍘熷洜**锛?- L1 缂撳瓨杩囧ぇ
- 澶ф暟鎹瓨鍏ュ唴瀛?- 鏈竻鐞嗚繃鏈熸潯鐩?
**瑙ｅ喅鏂规**锛?```typescript
// 1. 鍑忓皬 L1 缂撳瓨
new CharacterRepository(fs, project, {
    cacheMaxSize: 50,  // 榛樿 100
});

// 2. 澶ф暟鎹蛋 L2
await fileCache.set('large-data', data);

// 3. 瀹氭湡娓呯悊杩囨湡
lruCache.pruneExpired();

// 4. 鐩戞帶鍐呭瓨鍘嬪姏
const cache = new MultiLayerCache({ autoAdapt: true });
cache.adjustForMemoryPressure(0.8);  // 鍐呭瓨 80% 鏃堕┍閫?25%
```

### 闂 3锛氭祦寮忕敓鎴愬崱椤?
**鍙兘鍘熷洜**锛?- 缃戠粶寤惰繜楂?- 鍗曟璇锋眰 token 杩囧
- 鏈娇鐢?AbortSignal

**瑙ｅ喅鏂规**锛?```typescript
// 1. 鎻愪緵鍙栨秷鑳藉姏
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

// 2. 妫€鏌ユ參鎿嶄綔
const slowOps = performanceMonitor.getSlowOperations(1000);
console.log('鎱㈡搷浣?', slowOps);
```

### 闂 4锛歎I 鍗￠】

**鍙兘鍘熷洜**锛?- 璁㈤槄浜嗘暣涓?state
- 棰戠箒瑙﹀彂 setState
- 鏈娇鐢?shallow 姣旇緝

**瑙ｅ喅鏂规**锛?```typescript
// 1. 浣跨敤閫夋嫨鍣ㄨ闃?store.subscribe(
    (state) => state.suggestions,
    (suggestions) => render(suggestions),
    { equalityFn: shallow },
);

// 2. 鍚堝苟澶氫釜 setState
store.setState({
    field1: value1,
    field2: value2,
    field3: value3,
});

// 3. 浣跨敤 debounce 鍑忓皯棰戠巼
import { AdaptiveDebounceManager } from '../shared/adaptive-debounce-manager';
```

---

## 浜斻€佺浉鍏虫枃妗?
- [鏋舵瀯鎬昏](./ARCHITECTURE.md) 鈥?鍒嗗眰鏋舵瀯涓庤璁″喅绛?- [寮€鍙戞寚鍗梋(./DEVELOPMENT.md) 鈥?濡備綍鏂板鍔熻兘
- [API 鏂囨。](./API.md) 鈥?瀹屾暣 API 鍙傝€?- [Repository 杩佺Щ鎸囧崡](../engine/repository/MIGRATION.md) 鈥?鏃т唬鐮佽縼绉绘楠?
