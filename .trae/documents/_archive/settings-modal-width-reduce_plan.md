---
📦 **已归档 · 临时计划文档** 📦

**说明**：本文档为历史计划/方案记录，仅供回溯参考，不代表当前项目状态。
**归档时间**：2026-07-15
---
# 寮圭獥瀹藉害缂╁皬 - 瀹炴柦璁″垝

## 闂鍒嗘瀽

褰撳墠寮圭獥瀹藉害璁剧疆杩囧ぇ锛?- **宸ヤ綔鍙拌缃脊绐?*锛歚clamp(900px, 92vw, 2000px)` 鈥?鏈€澶?2000px锛屽唴瀹硅繃浜庡垎鏁?- **蹇嵎宸ュ叿寮圭獥**锛歚clamp(800px, 92vw, 1600px)` 鈥?鏈€澶?1600px锛屽崱鐗囬棿璺濊繃澶?
浠庢埅鍥剧湅锛屽綋鍓嶅搴︽帴杩戝睆骞曞搴︼紝鍐呭鍖哄煙澶┖鏃凤紝瑙嗚浣撻獙涓嶄匠銆?
## 淇鏂规

### 姝ラ 1锛氳皟鏁村伐浣滃彴璁剧疆寮圭獥瀹藉害
灏嗘渶澶у搴︿粠 2000px 璋冩暣涓?1300px锛屼繚鎸佹渶灏忓搴?900px銆?
**鏂囦欢**锛歚ui/mini-settings-modal.ts`锛堢 73-74 琛岋級

**淇敼鍓?*锛?```typescript
this.modalEl.style.setProperty('width', 'clamp(900px, 92vw, 2000px)', 'important');
this.modalEl.style.setProperty('max-width', '2000px', 'important');
```

**淇敼鍚?*锛?```typescript
this.modalEl.style.setProperty('width', 'clamp(900px, 85vw, 1300px)', 'important');
this.modalEl.style.setProperty('max-width', '1300px', 'important');
```

### 姝ラ 2锛氳皟鏁村揩鎹峰伐鍏峰脊绐楀搴?灏嗘渶澶у搴︿粠 1600px 璋冩暣涓?1100px锛屼繚鎸佹渶灏忓搴?800px銆?
**鏂囦欢**锛歚ui/full-writer/tools-modal.ts`锛堢 86-87 琛岋級

**淇敼鍓?*锛?```typescript
this.modalEl.style.setProperty('width', 'clamp(800px, 92vw, 1600px)', 'important');
this.modalEl.style.setProperty('max-width', '1600px', 'important');
```

**淇敼鍚?*锛?```typescript
this.modalEl.style.setProperty('width', 'clamp(800px, 85vw, 1100px)', 'important');
this.modalEl.style.setProperty('max-width', '1100px', 'important');
```

### 姝ラ 3锛氶獙璇佹瀯寤?杩愯 `npm run build` 纭繚鏋勫缓鎴愬姛銆?
## 鍝嶅簲寮忚〃鐜?
| 寮圭獥 | 鏈€灏忓搴?| 鑷€傚簲鑼冨洿 | 鏈€澶у搴?|
|------|----------|-----------|----------|
| 宸ヤ綔鍙拌缃?| 900px | 85vw | 1300px |
| 蹇嵎宸ュ叿 | 800px | 85vw | 1100px |

## 椋庨櫓涓庢敞鎰忎簨椤?
- **椋庨櫓**锛氬搴﹁繃绐勫彲鑳藉鑷存煇浜涘唴瀹规樉绀轰笉鍏?- **娉ㄦ剰**锛氫繚鎸佸搷搴斿紡閫傞厤锛岀獥鍙ｇ缉灏忔椂鑷姩缂╁皬

## 楠岃瘉鏂瑰紡

1. 鏋勫缓鎴愬姛
2. 閲嶆柊鍔犺浇鎻掍欢鍚庢墦寮€涓や釜寮圭獥
3. 妫€鏌ュ搴︽槸鍚﹂€備腑锛屽唴瀹逛笉鎷ユ尋涔熶笉鍒嗘暎
4. 妫€鏌ユ墍鏈夊唴瀹规甯告樉绀?
