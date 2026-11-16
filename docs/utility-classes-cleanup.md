# 工具类专项（nw-u-）· 清理记录

> 状态：**完成（2026-11-16）**
> 入口：`styles-src/10-entity-and-utilities.css`、`scripts/check-utility-classes.mjs`

## 1. 背景：这批工具类怎么来的

2026-11 之前，项目为消除内联样式，用脚本把 `style` 属性批量转成工具类：
可读名 +「重名加后缀」。生成器有三个缺陷，长期累积成「4860 处历史债」：

1. **整套定义被复制两遍**：同一份声明同时生成 `nw-u-X` 与 `nw-u-X-2`，
   142 条规则纯重复（CSS 体积与类数量翻倍）。
2. **真正撞名时用后缀硬区分，名字与含义脱节**：
   - `nw-u-op-0-2` 实际是 `opacity:0.2`，不是「opacity:0 的第二版」；
   - `nw-u-margintop-4px-2` 实际是 `margin-top:-4px`（负值！）；
   - `nw-u-webkitlineclamp-2` 是「clamp 2 行」，但去掉后缀会撞上语义不同的类，
     于是又出现 `nw-u-webkitlineclamp-2-2` 这种三级后缀。
3. **残留死类**：生成过程中出现了「TS 里引用、CSS 里没定义」的类（如
   `nw-u-flex`、`nw-u-gap-8`、`nw-u-margintop-6px-2`），
   这些元素实际没有样式，属于静默失效。

## 2. 本轮做了什么

### 2.1 按声明合并重复定义（而不是按名字）

名字不可信（见上），所以合并在**声明层面**做：

1. 解析全部 `.nw-u-*` 规则 → `类名 → 声明`；
2. 对每个 `-2` 类：若去掉后缀存在**同声明**的类 → 合并到它；
   否则在「无后缀且同声明」的类里找目标；都不行才新建语义名；
3. 传递闭包处理三级后缀（`webkitlineclamp-2-2 → webkitlineclamp-2 → clamp-2-lines`）；
4. 批量重写 TS 引用，删除重复规则。

结果：**142 条重复定义合并、2679 处引用重写、141 个类消失**，CSS −5.4KB。

### 2.2 修正「名字与含义不符」的问题类

| 原类名 | 原声明 | 新类名 |
| --- | --- | --- |
| `nw-u-op-0-2` | `opacity:0.2` | `nw-u-opacity-20` |
| `nw-u-margintop-4px-2` | `margin-top:-4px` | `nw-u-margin-top-neg-4px` |
| `nw-u-webkitlineclamp-2` | `-webkit-line-clamp:2` | `nw-u-clamp-2-lines` |
| `nw-u-gtc-repeat-auto-fill-minma-2` | `minmax(300px,1fr)` | `nw-u-grid-auto-fill-300` |
| `nw-u-gtc-repeat-auto-fit-minmax-2` | `minmax(200px,1fr)` | `nw-u-grid-auto-fit-200` |
| `nw-u-bg-background-modifier-bo-2` | `--background-modifier-border-hover` | `nw-u-bg-modifier-border-hover` |
| `nw-u-bg-background-modifier-er-2` | 错误色 10% 透明 | `nw-u-bg-modifier-error-soft` |
| `nw-u-bg-linear-gradient-135deg-2` | 绿蓝渐变 | `nw-u-bg-gradient-green-blue` |

### 2.3 清掉死类

修掉 4 处「引用了但没定义」的类：
`nw-u-flex` → `nw-u-d-flex`、`nw-u-gap-8` → `nw-u-gap-8px`、
`nw-u-m-0-0-6px-0-2` → `nw-u-m-0-0-6px`、补定义 `nw-u-margintop-6px`；
另删除 5 条完全无人引用的规则。

### 2.4 硬编码色值 → 主题变量

21 个工具类的声明里写死了颜色（换主题时最容易翻车），全部改为语义名 + 主题变量：

| 原类名 | 新类名 | 新声明 |
| --- | --- | --- |
| `nw-u-c-f59e0b` / `nw-u-bg-f59e0b` | `nw-u-c-warning` / `nw-u-bg-warning` | `var(--text-warning)` |
| `nw-u-c-2ecc71` | `nw-u-c-success` | `var(--text-success)` |
| `nw-u-c-3b82f6` | `nw-u-c-accent` | `var(--text-accent)` |
| `nw-u-c-e74c3c` / `nw-u-c-721c24` | `nw-u-c-error` / `nw-u-c-error-strong` | `var(--text-error)` |
| `nw-u-bg-rgba-255-170-0-0-1` 等 | `nw-u-bg-warning-soft-10` 等 | `color-mix(in srgb, var(--text-warning) 10%, transparent)` |
| `nw-u-bg-linear-gradient-135deg` 等 | `nw-u-bg-gradient-*` | 变量渐变 |

## 3. 门禁（防止长回去）

新增 `scripts/check-utility-classes.mjs`，已接入 `npm run preflight`：

- **A** 禁止出现「同声明 + 后缀」的重名复制类；
- **B** TS 里引用的 `nw-u-*` 必须有定义（防死类）；
- **C** 定义数与使用量不得超基线（只允许下降），基线文件 `.utility-classes-baseline.json`。

## 4. 结果

| 指标 | 清理前 | 清理后 |
| --- | --- | --- |
| 工具类定义数 | 571 | **430** |
| 其中重复定义 | 142 | **0** |
| TS 引用（类数 / 次数） | 571 / 4862 | 430 / **4763** |
| 引用未定义类 | 4 类 8 处 | **0** |
| 含硬编码色值的工具类 | 21 | **0** |
| CSS 字节 | 596,864 | **591,458（−5.4KB）** |
| 唯一类总数 | 3,253 | **3,112（−141）** |
| 硬编码 hex | 169 | **156** |

门禁：`preflight` EXIT=0（974 测试文件；新增 `check:utility` 一道）。

## 5. 没有做的事（以及为什么）

- **没有把 4763 处工具类改成语义组件类**：工具类是项目现有的样式体系，能正常工作；
  全量替换属于视觉回归风险极高、收益不明确的大改，且本轮无法对弹窗做视觉验证。
  本轮只保证它**不再膨胀、不再有重复/死类/硬编码色**。
- **没有合并「重复出现的整条 class 链」**：统计出 16 组重复链（34 个元素），
  收益低于风险，留给后续按模块做的视觉重构。
