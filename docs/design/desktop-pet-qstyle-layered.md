# 桌面宠物视觉规范 · Q 版人类分层设计

> 版本：v1.1 · 定稿：2026-11-02
> 适用：`ui/writing-pet.ts`、`styles-src/16-writing-stats-pet.css`、`core/settings-service.ts`
> 状态：**分层/状态/窗口部分有效**；造型、比例与配色已被 [`desktop-pet-art-v2.md`](desktop-pet-art-v2.md) 取代（见该文 §2–§4）。
> 设计画布：v2 为 `viewBox="0 0 160 180"`，渲染基准宽 150px；本文 §2–§4 的 120×136 坐标仅作历史记录。

---

## 0. 设计目标与原则

当前宠物是单层墨色猫（1 个 `<svg>` + 平铺的 `.nw-pet-*` 元素），只有 `idle/happy/sleep` 三个整只动画。问题有三：形态无法按状态重组、动效只能整只播放、深色/浅色主题下只有一个 `--nw-accent` 可调。

新设计改为 **Q 版人类 + 五层独立控制**：

| 原则 | 具体做法 |
|---|---|
| 分层可独立控制 | 每层是独立的 `<g class="nw-pet-layer">`，显隐 / 透明度 / 偏移 / 时长 / 幅度各自独立 |
| 动效不干扰定位 | 定位在根节点，偏移在外层 `<g>`，动画在内层 `<g>`（三层分离，避免 `transform` 互相覆盖） |
| 任何主题都能认出 | 剪影描边 + 主题反色光晕；马卡龙配色随浅/深色微调 |
| 不挡操作 | 根节点 `pointer-events:none`，只有舞台可交互；默认避让 ribbon / 状态栏；弹窗出现时自动变暗 |
| 性能可控 | 只动 `transform` / `opacity`；SVG 形状静态；`prefers-reduced-motion` 全部停 |

---

## 1. 视觉分层结构

### 1.1 五个层级（三档，可扩展到 5 档）

| 序号 | 层 ID | 中文名 | 档位 | 默认可见 | 职责 |
|---|---|---|---|---|---|
| L0 | `shadow` | 底层投影层 | 必需（底层） | ✅ | 地面接触阴影 + 呼吸式环境阴影，提供“落地感” |
| L1 | `aura` | 氛围光层 | 可选（背景装饰） | ❌ 默认关 | 光晕/虚线环/星点，提供状态氛围；关闭不影响识别 |
| L2 | `body` | 主体形态层 | 必需（主体） | ✅ | 头发后片、头、躯干、四肢、腿脚 —— 决定剪影 |
| L3 | `detail` | 细节装饰层 | 必需（细节） | ✅ | 呆毛、刘海、五官、腮红、衣领、笔、记事本 |
| L4 | `fx` | 状态特效层 | 可选（前景） | ✅ | Zzz、墨点、省略号、彩纸、汗滴、进度环 |

> `shadow / body / detail` 是需求要求的三个必需层；`aura / fx` 是可选增强层，可整层关闭而不破坏形态。

### 1.2 DOM / SVG 骨架

```html
<div class="nw-pet" data-nw-pet data-pet-state="idle">
  <div class="nw-pet-bubble">…</div>          <!-- 不参与分层 -->
  <div class="nw-pet-stage" role="button" tabindex="0">
    <svg class="nw-pet-svg" viewBox="0 0 120 136" aria-hidden="true">
      <!-- 每层 = 外层定位 <g> + 内层动画 <g> -->
      <g class="nw-pet-layer nw-pet-layer--shadow" data-layer="shadow">
        <g class="nw-pet-anim nw-pet-anim--shadow">…</g>
      </g>
      <g class="nw-pet-layer nw-pet-layer--aura" data-layer="aura">
        <g class="nw-pet-anim nw-pet-anim--aura">…</g>
      </g>
      <g class="nw-pet-layer nw-pet-layer--body nw-is-layer-visible" data-layer="body">
        <g class="nw-pet-anim nw-pet-anim--body">…</g>
      </g>
      <g class="nw-pet-layer nw-pet-layer--detail nw-is-layer-visible" data-layer="detail">
        <g class="nw-pet-anim nw-pet-anim--detail">…</g>
      </g>
      <g class="nw-pet-layer nw-pet-layer--fx" data-layer="fx">
        <g class="nw-pet-anim nw-pet-anim--fx">…</g>
      </g>
    </svg>
  </div>
  <div class="nw-pet-card">…</div>            <!-- 不参与分层 -->
</div>
```

**为什么是「外层 + 内层」两层 `<g>`**

- 外层负责 `translate(var(--nw-pet-<layer>-dx), var(--nw-pet-<layer>-dy))` 和 `opacity`；
- 内层负责 `@keyframes` 的 `transform`；
- 若合并到同一个节点，CSS 动画的 `transform` 会整体覆盖偏移，拖动/偏移设置就失效。这与浮窗「动效必须放内层」的既有教训一致。

### 1.3 层级绘制顺序

`shadow → aura → body → detail → fx`（SVG 后绘制者在最上层）。`detail` 必须在 `body` 之后，`fx` 最后；`aura` 放在 `body` 之前，避免光晕盖住五官。

---

## 2. 形态与比例

### 2.1 头身比

- 头高：`ry 24 × 2 = 48`（含头发后片约 50）
- 全身高：发梢 `y≈10` → 脚底 `y≈126`，约 116
- **头身比 ≈ 2.4**，落在 2–3 头身区间；头部宽度（`rx 26`）略大于肩宽（48），符合 Q 版“头大身小”。

### 2.2 画布坐标表（实现基准）

| 部件 | 形状 | 坐标 / 尺寸 | 所属层 |
|---|---|---|---|
| 地面阴影 | ellipse | `cx 60 cy 127 rx 32 ry 6` | shadow |
| 环境阴影 | ellipse + blur | `cx 60 cy 124 rx 26 ry 9`，`opacity .35` | shadow |
| 光晕环 | circle | `cx 60 cy 66 r 52`，虚线 `stroke-dasharray 6 10` | aura |
| 星点 | 4 角星 ×3 | `(18,28) (104,42) (94,18)`，边长 4/3/2.5 | aura |
| 背景发片 | path | 覆盖头部后侧 + 两侧垂发至 `y=78` | body |
| 头 | ellipse | `cx 60 cy 42 rx 26 ry 24` | body |
| 躯干 | rect (rounded) | `x 36 y 66 w 48 h 36 rx 17` | body |
| 左臂 | path (stroke 9, round) | `M 40 74 C 34 82 31 89 32 96` | body |
| 右臂 | path (stroke 9, round) | `M 80 74 C 87 80 90 85 92 88` | body |
| 手 | circle r 5 | `(32,96)`、`(92,88)` | body |
| 腿 | path (stroke 9, round) | `M 53 99 L 53 118`、`M 67 99 L 67 118` | body |
| 鞋 | ellipse | `cx 53 cy 121 rx 8 ry 4`、`cx 67 cy 121 …` | body |
| 呆毛 | path (stroke 2.5) | `M 60 18 C 58 10 64 8 67 12` | detail |
| 刘海 | path | 覆盖额头，发梢在 `y 30–36` 锯齿 | detail |
| 眼 | ellipse ×2 | `cx 50 / 70 cy 44 rx 4.4 ry 5.8` | detail |
| 眼高光 | circle ×2 | `r 1.6`，眼内左上 | detail |
| 眉 | path ×2 | `y 36` 上方短弧 | detail |
| 腮红 | ellipse ×2 | `cx 39 / 81 cy 51 rx 4.6 ry 2.8` | detail |
| 嘴 | path | `M 56 53 Q 60 56 64 53` | detail |
| 衣领 | path | 领口白边 + 蝴蝶结，中心 `(60,69)` | detail |
| 笔 | path | `M 91 84 L 101 72`，笔尖 3px | detail |
| 记事本 | rect | `x 18 y 90 w 12 h 15 rx 2`，绕 `(24,97)` 旋转 `-12°`，书脊带 `y 95 h 3` | detail |
| 特效粒子 | text / circle | 由状态决定（见 §6） | fx |
| 进度环 | circle | `r 56`，`stroke-dasharray` 由 `--nw-pet-progress` 控制 | fx |

### 2.3 线条规则

- 所有外轮廓 `stroke: var(--nw-pet-ink)`，`stroke-width 1.6`，`stroke-linejoin: round`；
- 肢体末端（手臂/腿）用 `stroke-linecap: round` 的 path，不用矩形拼接；
- 圆角半径下限 `rx ≥ 4`，禁止尖角；呆毛是唯一允许的锐角，用于性格识别。

---

## 3. 各层元素定义

### L0 `shadow` — 底层投影层

| 元素 | class | 填充 / 描边 | 动画 | 说明 |
|---|---|---|---|---|
| 接触阴影 | `.nw-pet-shadow-contact` | `fill: var(--nw-pet-shadow)` | `nw-pet-shadow-breathe`，`4.2s` | 随主体起伏缩放 `0.94–1.04` |
| 环境阴影 | `.nw-pet-shadow-ambient` | `fill: var(--nw-pet-shadow)` + `blur(3px)`，`opacity .35` | 同上，延迟 `-0.4s` | 给主体“离地高度” |

- 配置后：`--nw-pet-shadow-opacity` 同时作用于两个元素；隐藏该层时地面感消失但不报错。
- 阴影层不接受颜色自定义（始终由主题推导），避免用户在浅色主题设成白色导致看不见。

### L1 `aura` — 氛围光层

| 元素 | class | 填充 / 描边 | 动画 |
|---|---|---|---|
| 光晕环 | `.nw-pet-aura-ring` | `stroke: var(--nw-pet-accent)`，`opacity .25`，`dasharray 6 10` | `nw-pet-aura-spin`，`12s linear infinite` |
| 星点 | `.nw-pet-aura-spark` ×3 | `fill: var(--nw-pet-paper)`，`opacity .8` | `nw-pet-twinkle`，`3s` 交错 |

- 默认关闭（`visible: false`），只在 `happy / celebrate / thinking` 状态自动淡入（见 §6 的 `autoLayers`）。

### L2 `body` — 主体形态层

| 元素 | class | 填充 | 说明 |
|---|---|---|---|
| 背景发片 | `.nw-pet-hair-back` | `var(--nw-pet-hair)` | 必须在头之前绘制 |
| 头 | `.nw-pet-head` | `var(--nw-pet-skin)` | 带 1.6 ink 描边 |
| 躯干 | `.nw-pet-torso` | `var(--nw-pet-cloth)` | 圆角矩形，下摆略宽 |
| 左/右臂 | `.nw-pet-arm` | `stroke: var(--nw-pet-skin)` | 手部圆点同色 |
| 腿 | `.nw-pet-leg` | `stroke: var(--nw-pet-skin)` | 与手臂同宽 |
| 鞋 | `.nw-pet-shoe` | `var(--nw-pet-cloth-shade)` | 与衣服同色系深一档 |

### L3 `detail` — 细节装饰层

| 元素 | class | 填充 / 描边 | 说明 |
|---|---|---|---|
| 呆毛 | `.nw-pet-ahoge` | `stroke: var(--nw-pet-hair)` | 独立动画轴（`happy` 时抖动） |
| 刘海 | `.nw-pet-hair-front` | `var(--nw-pet-hair)` | 压在额头之上 |
| 眼白 | `.nw-pet-eye-white` | `var(--nw-pet-paper)` | 深色主题下也保持高对比 |
| 瞳孔 | `.nw-pet-eye-pupil` | `var(--nw-pet-ink)` | 眨眼只缩瞳孔，不缩眼白 |
| 高光 | `.nw-pet-eye-shine` | `var(--nw-pet-paper)` | `opacity .9` |
| 眉 | `.nw-pet-brow` | `stroke: var(--nw-pet-hair-shade)` | 表情主要靠眉与嘴 |
| 腮红 | `.nw-pet-blush` | `var(--nw-pet-blush)`，`opacity .55` | 柔化 Q 版观感 |
| 嘴 | `.nw-pet-mouth` | `stroke: var(--nw-pet-ink)` | `stroke-width 1.6` |
| 衣领/蝴蝶结 | `.nw-pet-collar` / `.nw-pet-bow` | paper / accent | 状态色点缀 |
| 笔 | `.nw-pet-pen` | `stroke: var(--nw-pet-ink)` + accent 笔尖 | `writing` 时摆动 |
| 记事本 | `.nw-pet-notebook` | paper + accent 书脊 | 可整件隐藏（用户只想要人） |

### L4 `fx` — 状态特效层

| 元素 | class | 触发状态 | 动画 |
|---|---|---|---|
| Zzz ×3 | `.nw-pet-fx-sleep` | `sleep` | 上浮 + 淡出，3.4s 循环 |
| 墨点 ×3 | `.nw-pet-fx-ink` | `writing` | 向右上方飞散，1.6s |
| 省略号 | `.nw-pet-fx-dots` | `thinking` | 依次亮起，1.8s |
| 彩纸 ×6 | `.nw-pet-fx-confetti` | `happy` / `celebrate` | 抛洒 + 旋转，1.6s |
| 汗滴 | `.nw-pet-fx-sweat` | `error` | 滑落，1.2s |
| 进度环 | `.nw-pet-fx-progress` | 常驻（可关） | 静态，`stroke-dasharray` 由今日目标比例驱动 |

- `fx` 层默认 `pointer-events: none`，不参与命中测试。
- 特效粒子只允许 6 个以内，避免每帧大量重绘。

---

## 4. 配色系统（马卡龙）

### 4.1 令牌

| 令牌 | 浅色（默认） | 深色覆盖 | 用途 |
|---|---|---|---|
| `--nw-pet-ink` | `#4B4453` | `#2E2938` | 描边、瞳孔、嘴 |
| `--nw-pet-skin` | `#FFE9D6` | `#F3D9C6` | 头、手臂、腿 |
| `--nw-pet-skin-shade` | `#F6D3BC` | `#E3C3AE` | 颈部阴影（可选） |
| `--nw-pet-hair` | `#C9B6F2` | `#B7A4E8` | 头发（薰衣草） |
| `--nw-pet-hair-shade` | `#B49DE6` | `#9E88D6` | 眉毛、发梢 |
| `--nw-pet-cloth` | `#A8E6CF` | `#8FD8BE` | 衣服（薄荷） |
| `--nw-pet-cloth-shade` | `#8FD8BE` | `#76C7AA` | 鞋、衣褶 |
| `--nw-pet-accent` | `#FFB7B2` | `#F5A29C` | 蝴蝶结、笔尖、光晕（蜜桃） |
| `--nw-pet-blush` | `#FFAFC5` | `#F79CB4` | 腮红（樱花粉） |
| `--nw-pet-paper` | `#FFFDF8` | `#FFF9F0` | 眼白、高光、记事本 |
| `--nw-pet-shadow` | `rgba(75,68,83,.18)` | `rgba(0,0,0,.42)` | 阴影 |
| `--nw-pet-halo` | `rgba(255,255,255,.65)` | `rgba(255,255,255,.35)` | 主题反色光晕 |

### 4.2 主题适配

```css
.nw-pet {
    /* 浅色默认：马卡龙 */
    --nw-pet-ink: #4B4453;
    /* …其余令牌… */
}
.theme-dark .nw-pet {
    --nw-pet-ink: #2E2938;
    /* 深色下整体降饱和 6–10%，避免在深底上“发光刺眼” */
}

/* 剪影保证：任何主题下都有 1.6px 墨色描边 + 反色光晕 */
.nw-pet-svg { filter: drop-shadow(0 0 2px var(--nw-pet-halo)); }
.nw-pet-head, .nw-pet-torso, .nw-pet-arm, .nw-pet-leg {
    stroke: var(--nw-pet-ink);
    stroke-width: 1.6;
    stroke-linejoin: round;
}
```

**辨识度策略（对 4 类背景验证）**

| 背景 | 手段 |
|---|---|
| 浅色（白/米） | 墨色描边 + 阴影层 |
| 深色（#1e1e1e） | 浅色皮肤 + 白色光晕 + 降饱和衣服 |
| 高饱和（图片/彩色主题） | 描边始终存在，颜色不参与识别 |
| 高对比/强制色（Windows 高对比） | `@media (forced-colors: active)` 下只保留描边，关闭渐变与光晕 |

- 禁止把颜色作为唯一识别手段：剪影（头大身小 + 呆毛 + 笔）必须在灰度下仍可辨认。

### 4.3 用户自定义

- 仅开放 4 个色相槽位：`hair / cloth / accent / blush`，其余（皮肤、墨色、纸色）由主题锁定，防止对比度被破坏。
- 提供 4 套预设：`macaron`（默认）、`mint`、`sakura`、`theme`（跟随 Obsidian 强调色）。

---

## 5. 层级配置接口

### 5.1 设置类型

```ts
export type PetLayerId = 'shadow' | 'aura' | 'body' | 'detail' | 'fx';

export interface PetLayerConfig {
    visible: boolean;
    /** 0–1 */
    opacity: number;
    /** 层内偏移，单位 px（SVG 用户坐标），范围 -12–12 */
    offsetX: number;
    offsetY: number;
    /** 0 = 不播放动画（静态该层）；其余为单次/循环周期 */
    durationMs: number;
    delayMs: number;
    /** 动效幅度倍率，0–2 */
    amplitude: number;
    /** 可选：覆盖该层的缓动 */
    easing?: string;
}

export interface PetVisualSettings {
    enabled: boolean;
    scale: number;                 // 0.6–1.6，默认 1
    scheme: 'macaron' | 'mint' | 'sakura' | 'theme';
    customHues?: Partial<Record<'hair' | 'cloth' | 'accent' | 'blush', string>>;
    dock: 'free' | 'bottom-left' | 'bottom-right';
    avoidControls: boolean;        // 默认 true
    dimOnModal: boolean;           // 默认 true
    layers: Record<PetLayerId, PetLayerConfig>;
}
```

### 5.2 默认值

| 层 | visible | opacity | offset | duration | delay | amplitude |
|---|---|---|---|---|---|---|
| shadow | ✅ | 0.90 | 0,0 | 4200 | 0 | 1.0 |
| aura | ❌ | 0.35 | 0,0 | 12000 | 0 | 0.6 |
| body | ✅ | 1.00 | 0,0 | 4200 | 0 | 1.0 |
| detail | ✅ | 1.00 | 0,0 | 4200 | 0 | 1.0 |
| fx | ✅ | 0.90 | 0,0 | 1600 | 0 | 1.0 |

> `durationMs` 控制该层的**主运动周期**（呼吸/浮动/旋转/粒子）；`body` 与 `detail` 默认同为 4200ms，保证默认状态下脸跟随身体、不脱节。
> 眨眼是 `detail` 层内部的固定节奏（`.nw-pet-eyes`，5.2s），不随层周期变化；用户把 `detail` 周期调成别的值，等于主动接受「细节层与主体层错拍」。

### 5.3 CSS 变量契约

根节点上按层写入：

```
--nw-pet-scale
--nw-pet-<layer>-opacity
--nw-pet-<layer>-dx
--nw-pet-<layer>-dy
--nw-pet-<layer>-dur
--nw-pet-<layer>-delay
--nw-pet-<layer>-amp
```

对应规则：

```css
.nw-pet { scale: var(--nw-pet-scale, 1); }
.nw-pet-layer {
    opacity: var(--nw-pet-layer-opacity, 1);
    transform: translate(var(--nw-pet-layer-dx, 0px), var(--nw-pet-layer-dy, 0px));
    transform-box: fill-box;
}
.nw-pet-anim {
    animation-duration: var(--nw-pet-layer-dur, 0ms);
    animation-delay: var(--nw-pet-layer-delay, 0ms);
    animation-iteration-count: infinite;
    animation-timing-function: var(--nw-pet-layer-ease, ease-in-out);
}
.nw-pet-layer:not(.nw-is-layer-visible) { opacity: 0; pointer-events: none; }
.nw-pet-layer[data-layer="shadow"] { --nw-pet-layer-opacity: var(--nw-pet-shadow-opacity, .9); }
/* …每层一组… */
```

- 变量用 `element.style.setProperty()` 写入，不拼 `style="…"` 字符串（`check:inline-styles` 只管字符串形态，但仍建议统一走 `setProperty`）。
- `durationMs = 0` 时写入 `--nw-pet-layer-dur: 0ms` 并给内层加 `.nw-is-static`（`animation: none`），比 `animation-duration: 0s` 更省。

### 5.4 显隐语义

- 隐藏层用 `nw-is-layer-visible` 的**缺省**表示，不删除 DOM：切换是幂等的，重建代价为零。
- `body` 层隐藏时，`detail` / `fx` 仍保留（用户可以只要“漂浮的五官+特效”）；但 UI 给一次提示「主体已隐藏，是否一并隐藏细节？」。

---

## 6. 动画状态映射表

### 6.1 状态与触发

| 状态 | 触发条件（现有代码挂点） | 退出 |
|---|---|---|
| `idle` | 默认；今日字数 > 0 且未达标 | 任一其他状态 |
| `sleep` | `today <= 0`（`update()` 现有逻辑） | 字数增加 |
| `writing` | 编辑器输入 / 正文写入事件（`novel-writer:body-written`，debounce 1.2s） | 静默 1.2s |
| `thinking` | AI 生成请求开始（执行管线 `running`） | 请求结束/失败 |
| `happy` | `target > 0 && today >= target`（现有逻辑） | 跨天/目标变更 |
| `celebrate` | `notifyDelta(delta > 0)`（现有 600ms pulse 升级） | 1.2s 后回 `happy`/`idle` |
| `error` | 写入/生成失败 catch（Notice error 同级） | 2.4s 后回 `idle` |
| `paused` | 设置关闭 / 弹窗且 `dimOnModal` 开启时动画暂停（不卸载） | 条件解除 |

### 6.2 状态 × 层级参数

| 层 | idle | sleep | writing | thinking | happy | celebrate | error |
|---|---|---|---|---|---|---|---|
| `shadow` | 呼吸 4.2s，amp 1 | 呼吸 7s，opacity 0.7 | 呼吸 3.2s，amp 0.7 | 呼吸 4.2s | 弹跳阴影 1.6s | 冲击 600ms | 收缩 800ms |
| `aura` | 关 | 关 | 脉冲 3.2s，opacity 0.25 | 旋转 3s，opacity 0.45 | 旋转 6s，opacity 0.5 | 闪 600ms | 关 |
| `body` | 浮动 4.2s，±3px | 摇摆 7s，±1.5px | 点头 1.6s，±2px | 歪头 3s，rotate 3° | 跳 1.6s，±7px | 缩放脉冲 600ms | 抖动 400ms，±2px |
| `detail` | 与 body 同运动 + 眨眼 5.2s | 同 body 摇摆 + 闭眼 | 同 body 点头 + 笔摆动 1.2s | 同 body 歪头 + 眼睛上瞟 2.4s | 同 body 跳 + 笑眼 | 同 body 脉冲 + 笑脸 | 同 body 抖动 + 汗滴 + 八字眉 |
| `fx` | 无 | Zzz 3.4s | 墨点 1.6s | 省略号 1.8s | 彩纸 1.6s | 星爆 600ms | 感叹号 1.2s |

> `body` 与 `detail` 默认播放**同一组运动关键帧**（周期同为 4200ms），保证脸和身体一起动；`detail` 上的眨眼、笔摆动、眼神是叠加在子元素上的第二层动画。只有用户主动改 `detail` 层周期时才会错拍——这是独立配置的预期代价。
> 表中「amplitude」均由 `--nw-pet-<layer>-amp` 相乘，例如 `translateY(calc(-3px * var(--nw-pet-body-amp, 1)))`，用户把幅度调到 0 即等价于静态。

### 6.3 关键帧命名

```
nw-pet-shadow-breathe    nw-pet-aura-spin     nw-pet-body-float
nw-pet-body-sway         nw-pet-body-bob      nw-pet-body-hop
nw-pet-body-tilt         nw-pet-body-shake    nw-pet-body-pulse
nw-pet-blink             nw-pet-pen-wiggle    nw-pet-ahoge-bounce
nw-pet-fx-rise           nw-pet-fx-drift      nw-pet-fx-confetti
nw-pet-fx-sweat          nw-pet-twinkle
```

- 全部 `@keyframes` 前缀 `nw-pet-`；新增后必须跑 `check:css`（会比对未定义引用）。
- `prefers-reduced-motion: reduce`：所有 `animation: none`，保留静态姿态与透明度配置。

---

## 7. 窗口层级与避让

### 7.1 z-index 阶梯

Obsidian 自带 `--layer-*` 变量（`--layer-popover: 30`、`--layer-modal: 50`、`--layer-menu: 65`、`--layer-tooltip: 70`）。宠物取 **比 popover 低 10**，保证菜单、提示、弹窗永远盖住宠物：

```css
.nw-pet {
    position: fixed;
    z-index: var(--nw-pet-z, calc(var(--layer-popover, 30) - 10)); /* = 20 */
    pointer-events: none;   /* 根不拦截，只有舞台可点 */
}
.nw-pet-stage, .nw-pet-card, .nw-pet-close { pointer-events: auto; }
```

| 层 | 典型 z-index | 与宠物关系 |
|---|---|---|
| 工作区 / 编辑器 | 1 | 宠物在其上 |
| 状态栏 | 15 | 宠物避让（不覆盖） |
| **宠物** | **20** | — |
| 弹出菜单 / 选择器 | 30 | 盖住宠物 |
| 弹窗 Modal | 50 | 盖住宠物；开启 `dimOnModal` 时宠物变暗 |
| 通知 / 菜单 / Tooltip | 60–70 | 盖住宠物 |

> 现有实现是 `z-index: 40`，会压住部分 popover，需要改成 20（或直接用上面的 calc）。

### 7.2 指针与命中

- 根 `pointer-events: none`；`.nw-pet-stage`（约 132×150）与气泡/卡片可交互。
- `fx`、`aura`、`shadow` 层 `pointer-events: none`，不参与拖拽与点击。
- 拖拽只在舞台上触发；卡片内按钮 `stopPropagation`（现有逻辑保留）。

### 7.3 安全区与默认停靠

```
EDGE       = 12px
STATUS_BAR = var(--status-bar-height, 24px)
RIBBON     = var(--ribbon-width, 44px)
HEADER     = var(--header-height, 40px)
```

- 可放置矩形：
  - `x ∈ [EDGE, window.innerWidth - petW - EDGE]`
  - `y ∈ [HEADER + EDGE, window.innerHeight - petH - STATUS_BAR - EDGE]`
- 默认停靠 `bottom-left`：`x = EDGE`，`y = innerHeight - petH - STATUS_BAR - EDGE`。
- 若检测到左侧 ribbon 可见，`x` 下限改为 `RIBBON + EDGE`。
- 窗口 resize / 侧栏开合时重新 clamp 到可放置矩形；被挤出的宠物贴最近边缘，不缩放。

### 7.4 控件碰撞回避（`avoidControls: true`）

宠物拖放结束、窗口 resize、布局变化（`ResizeObserver` 监听 `.workspace`）时执行：

1. 取宠物四角 + 中心 5 个点；
2. `document.elementsFromPoint(x, y)`，忽略 `.nw-pet` 内部元素；
3. 命中交互元素（`button / a / input / select / textarea / [role=button] / .clickable-icon / .workspace-tab-header / .menu / .modal`）→ 判定为遮挡；
4. 沿命中元素中心的反方向平移 24px，最多尝试 3 次；
5. 3 次仍遮挡 → 加 `nw-is-avoiding`（`opacity: .45`），移开后自动移除。

> 只做“不遮挡”，不做自动绕行；避免宠物在用户拖动时乱跑。

### 7.5 弹窗与遮挡时的降级

| 条件 | 表现 |
|---|---|
| 存在 `.modal-container` 且 `dimOnModal` | 根加 `nw-is-dimmed`：`opacity .35`、舞台 `pointer-events: none`、动画 `paused` |
| 宠物被拖到编辑器外（侧栏/空白） | 正常显示；不回弹（尊重用户意图），只保证不越出视口 |
| 全屏（F11 / slides） | 宠物保持 fixed；若检测到全屏元素，z-index 提升到 `--layer-popover` 之上 1 档（25）以确保仍可见 |

---

## 8. 状态机与 UI 映射

```
sleep ⇄ idle ⇄ writing
            ↘ thinking → happy ⇄ celebrate
                       ↘ error
```

- 状态是**互斥**的单一枚举（`data-pet-state`），层内动画由 CSS 选择器派生，不在 JS 里逐层设 animation。
- 例外：`celebrate` 是 `happy` 的短时覆盖（1.2s 后回到 `happy` 或 `idle`），实现为 `data-pet-state="celebrate"` + 计时器。
- 状态切换的同时更新气泡文案（现有 `bubbleMain/bubbleSub`）与 `aria-label`。

---

## 9. 实现清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `shared/pet-visual.ts`（新增） | 纯函数：`resolvePetState()`、`buildPetLayerVars()`、`computePetDock()`、`clampPetRect()`；便于单测 |
| 2 | `ui/writing-pet.ts` | 用 `buildPetSvg()` 替换 `PET_SVG`；新增 `applyVisualSettings()`、`setState()`；`setMood` 保留为 `setState` 的别名 |
| 3 | `core/settings-service.ts` | 新增 `petVisual` 默认值与深合并迁移（旧 `petEnabled/petPosition` 保留兼容） |
| 4 | `ui/writing-stats-settings.ts` | 「高级 · 分层」折叠区：逐层显隐/透明度/偏移Y/时长/幅度；恢复默认 |
| 5 | `styles-src/16-writing-stats-pet.css` | 层规则、变量、关键帧、`forced-colors` 与 `reduced-motion`；z-index 改 20 |
| 6 | `main.ts` | 状态触发：`body-written` → `writing/celebrate`；生成管线 running → `thinking`；失败 → `error` |
| 7 | `tests/unit/shared/pet-visual.test.ts` | 4 类纯函数 + 状态优先级 + 边界 clamp |
| 8 | `docs/design/desktop-pet-qstyle-layered.md` | 本文件 |

**门禁注意**

- 新增 CSS 后必须 `node scripts/check-css.js --update-baseline` 并在 `.css-baseline.json` 的 `note` 写明「v4.24 桌宠分层」；`hardcodedHex` 允许因宠物固定配色 +10 左右，并在说明里注明是设计令牌而非散落色值。
- 新状态类一律 `nw-is-*` / `nw-pet-*` 前缀。
- 不新增内联 `style="…"` 字符串；用 `setProperty`。
- `prefers-reduced-motion` 与 `forced-colors` 必须各有一条规则，否则算未完成。

---

## 10. 验收清单

- [ ] 五层均可独立隐藏/显示，隐藏 `body` 时 `detail` 仍可见且有提示。
- [ ] 五层透明度独立可调，范围 0–1，互不影响。
- [ ] 五层偏移独立可调，主体偏移后阴影不跟随（除非用户同时调阴影层）。
- [ ] 每层动画时长/延迟/幅度独立可调；时长设 0 时该层静止，其余层继续。
- [ ] `idle/sleep/writing/thinking/happy/celebrate/error` 七态在桌面上有可区分姿态（截图对比）。
- [ ] 深色、浅色、图片背景、高对比四种背景下剪影可辨（灰度检查）。
- [ ] 宠物在编辑器之上、菜单/弹窗之下；`document.elementFromPoint` 检查不与任何按钮重叠。
- [ ] 弹窗打开时宠物变暗且不可点击；关闭后恢复。
- [ ] `prefers-reduced-motion` 下无任何动画；`forced-colors` 下仍有描边。
- [ ] 132px 基准宽度下五官不糊；缩放 0.6 / 1.6 时不重叠。

---

## 附：与现状的差异摘要

| 维度 | 现状 | 新规范 |
|---|---|---|
| 形态 | 猫（单层 SVG） | Q 版人类，2.4 头身 |
| 层数 | 1（全部元素平铺） | 5 层（shadow/aura/body/detail/fx） |
| 动画 | 整只 float / tail / blink | 每层独立关键帧与参数 |
| 状态 | idle / happy / sleep | 7 态 + paused |
| 主题 | 仅 `--nw-accent` | 12 个宠物令牌 + 深浅覆盖 + 反色光晕 |
| z-index | 40（会压 popover） | 20（低于 popover 30） |
| 避让 | 仅视口 clamp | 安全区 + 控件碰撞回避 + 弹窗变暗 |
