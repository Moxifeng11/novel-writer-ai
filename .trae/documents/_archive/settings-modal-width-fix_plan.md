---
📦 **已归档 · 临时计划文档** 📦

**说明**：本文档为历史计划/方案记录，仅供回溯参考，不代表当前项目状态。
**归档时间**：2026-07-15
---
# 璁剧疆寮圭獥瀹藉害淇 - 瀹炴柦璁″垝

## 闂鍒嗘瀽

**鏍规湰鍘熷洜**锛欳SS 閫夋嫨鍣ㄤ笌绫诲悕娣诲姞浣嶇疆涓嶅尮閰嶃€?
Obsidian Modal 鐨?DOM 缁撴瀯锛?```html
<div class="modal">           <!-- this.modalEl -->
  <div class="modal-content"> <!-- contentEl.parentElement -->
    <div class="modal-body">  <!-- this.contentEl -->
```

褰撳墠浠ｇ爜锛?- `nw-scope` 娣诲姞鍒?`modalEl`锛坄.modal` 鍏冪礌锛夆€?绗?72 琛?- `nw-modal-xl` 娣诲姞鍒?`contentEl.parentElement`锛坄.modal-content` 鍏冪礌锛夆€?绗?77 琛?
浣?CSS 閫夋嫨鍣ㄨ姹?`.modal` 鍏冪礌鍚屾椂鎷ユ湁杩欎袱涓被锛?```css
.nw-scope .modal.nw-modal-xl { ... }
```

**涓や釜绫讳笉鍦ㄥ悓涓€涓厓绱犱笂锛屾墍浠ラ€夋嫨鍣ㄦ案杩滃尮閰嶄笉鍒帮紒**

## 淇鏂规

### 姝ラ 1锛氫慨鏀圭被鍚嶆坊鍔犱綅缃?灏?`nw-modal-xl` 浠?`contentEl.parentElement` 鏀逛负 `modalEl`锛屼笌 `nw-scope` 鍦ㄥ悓涓€涓厓绱犱笂銆?
**鏂囦欢**锛歚ui/mini-settings-modal.ts`锛堢 72-79 琛岋級

**淇敼鍓?*锛?```typescript
this.modalEl.addClass('nw-scope');
const wrapper = contentEl.parentElement as HTMLElement;
if (wrapper) {
    wrapper.addClass('nw-modal-xl');
    wrapper.style.setProperty('margin', 'auto', 'important');
}
```

**淇敼鍚?*锛?```typescript
this.modalEl.addClass('nw-scope', 'nw-modal-xl');
this.modalEl.style.setProperty('margin', 'auto', 'important');
```

### 姝ラ 2锛氭洿鏂?CSS fallback 鍊?绗?848-851 琛岀殑 CSS fallback 鍊间粛涓烘棫鍊硷紝闇€瑕佸悓姝ユ洿鏂般€?
**鏂囦欢**锛歚styles.css`锛堢 848-851 琛岋級

**淇敼鍓?*锛?```css
.nw-scope .modal.nw-modal-xl {
    width: var(--nw-modal-xl, clamp(800px, 92vw, 1120px));
    max-width: 1120px;
}
```

**淇敼鍚?*锛?```css
.nw-scope .modal.nw-modal-xl {
    width: var(--nw-modal-xl, clamp(900px, 92vw, 2000px));
    max-width: 2000px;
}
```

### 姝ラ 3锛氶獙璇佹瀯寤?杩愯 `npm run build` 纭繚鏋勫缓鎴愬姛銆?
## 椋庨櫓涓庢敞鎰忎簨椤?
- **椋庨櫓**锛氫慨鏀圭被鍚嶆坊鍔犱綅缃彲鑳藉奖鍝嶅叾浠栦緷璧?`.modal-content` 绫荤殑鏍峰紡
- **娉ㄦ剰**锛氫繚鐣?`margin: auto` 鐨勮缃紝纭繚寮圭獥灞呬腑
- **娉ㄦ剰**锛氫繚鎸?`contentEl.style.width = '100%'` 涓嶅彉锛岀‘淇濆唴瀹瑰尯濉弧寮圭獥

## 楠岃瘉鏂瑰紡

1. 鏋勫缓鎴愬姛
2. 閲嶆柊鍔犺浇鎻掍欢鍚庢墦寮€宸ヤ綔鍙拌缃脊绐?3. 妫€鏌ュ脊绐楀搴︽槸鍚︽槑鏄惧澶э紙鏈€澶?2000px锛?4. 妫€鏌ュ脊绐楁槸鍚﹀眳涓樉绀?5. 妫€鏌ユ墍鏈夊唴瀹规甯告樉绀?
