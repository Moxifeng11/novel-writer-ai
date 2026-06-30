# E2E 端到端测试

本目录包含使用 Playwright 编写的端到端（E2E）测试，用于验证插件的完整用户流程。

## 📦 安装依赖

```bash
npm install --save-dev @playwright/test
npx playwright install
```

## 🚀 运行测试

### 运行所有 E2E 测试

```bash
npm run test:e2e
```

### 运行特定测试文件

```bash
npx playwright test tests/e2e/project-creation.spec.ts
```

### 以 UI 模式运行（推荐调试时使用）

```bash
npx playwright test --ui
```

这将打开 Playwright UI，你可以：
- 实时查看测试执行过程
- 查看每个步骤的截图
- 检查网络请求
- 调试失败的测试

### 以 headed 模式运行（显示浏览器）

```bash
npx playwright test --headed
```

### 生成测试报告

```bash
npx playwright show-report
```

## 📁 目录结构

```
tests/e2e/
├── pages/              # 页面对象模型 (Page Object Model)
│   ├── BasePage.ts     # 基础页面对象
│   └── FullWriterPage.ts # 完整写作工作台页面
├── utils/              # 辅助函数
│   └── helpers.ts      # 通用工具函数
├── fixtures/           # 测试夹具（待扩展）
├── project-creation.spec.ts # 项目创建测试
└── README.md           # 本文档
```

## 🧪 编写新测试

### 1. 创建页面对象

在 `pages/` 目录下创建新的页面对象类：

```typescript
import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class MyNewPage extends BasePage {
  private readonly SOME_SELECTOR = 'your-css-selector';

  constructor(page: Page) {
    super(page);
  }

  async someAction() {
    await this.page.click(this.SOME_SELECTOR);
  }

  async verifySomething() {
    await expect(this.page.locator(this.SOME_SELECTOR)).toBeVisible();
  }
}
```

### 2. 编写测试用例

在 `tests/e2e/` 目录下创建测试文件：

```typescript
import { test, expect } from '@playwright/test';
import { MyNewPage } from './pages/MyNewPage';

test.describe('功能描述', () => {
  let myPage: MyNewPage;

  test.beforeEach(async ({ page }) => {
    myPage = new MyNewPage(page);
    await myPage.goto();
  });

  test('应该执行某个操作', async ({ page }) => {
    await myPage.someAction();
    await myPage.verifySomething();
  });
});
```

## 🔍 调试技巧

### 1. 使用 Playwright Inspector

```bash
npx playwright test --debug
```

### 2. 添加断点

在测试代码中使用 `test.pause()`：

```typescript
test('调试测试', async ({ page }) => {
  await page.pause(); // 执行到这里会暂停，打开调试器
  // ... 其他代码
});
```

### 3. 查看控制台日志

Playwright 会自动捕获页面控制台输出，可以在测试报告中查看。

### 4. 截图调试

```typescript
await page.screenshot({ path: 'debug-screenshot.png' });
```

## ️ 注意事项

1. **Obsidian 环境**：当前测试配置假设 Obsidian 已经启动并加载了插件。如果需要自动化启动 Obsidian，需要额外配置 Electron 应用。

2. **选择器稳定性**：尽量使用稳定的 CSS 选择器或 data-testid 属性，避免使用动态生成的类名或 ID。

3. **等待策略**：使用 Playwright 的自动等待机制，避免硬编码 `waitForTimeout`。优先使用 `waitForSelector`、`waitForResponse` 等语义化等待。

4. **测试隔离**：每个测试应该独立运行，不依赖其他测试的状态。使用 `beforeEach` 和 `afterEach` 进行清理。

5. **并行执行**：默认情况下测试会并行执行。如果测试之间有依赖关系，可以使用 `test.serial()` 或配置 `workers: 1`。

##  测试覆盖率

当前覆盖的功能：
- ✅ 项目创建流程
- ⏳ 世界观生成（待实现）
-  角色生成（待实现）
- ⏳ 章节撰写（待实现）
- ⏳ 协同写作（待实现）

## 🛠️ 未来改进

- [ ] 集成 Electron 自动启动 Obsidian
- [ ] 添加更多测试用例覆盖核心功能
- [ ] 配置 CI/CD 自动运行 E2E 测试
- [ ] 添加视觉回归测试（Visual Regression Testing）
- [ ] 性能测试（页面加载时间、API 响应时间等）

## 📚 参考资料

- [Playwright 官方文档](https://playwright.dev/)
- [Playwright Test API](https://playwright.dev/docs/api/class-test)
- [页面对象模式最佳实践](https://playwright.dev/docs/pom)
