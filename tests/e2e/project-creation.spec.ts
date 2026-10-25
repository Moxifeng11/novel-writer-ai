import { test, expect } from '@playwright/test';
import { FullWriterPage } from './pages/FullWriterPage';

// Chromium 无法加载 app://obsidian.md，浏览器模拟链路已停用；
// 真实链路见 obsidian-plugin.spec.ts（Electron + OBSIDIAN_PATH）。
test.describe.skip('项目创建功能（浏览器模拟，已停用）', () => {
  let fullWriterPage: FullWriterPage;

  test.beforeEach(async ({ page }) => {
    fullWriterPage = new FullWriterPage(page);
    await fullWriterPage.goto();
  });

  test('应该显示空状态当没有项目时', async ({ page }) => {
    // 验证空状态显示
    const isEmpty = await fullWriterPage.isEmptyState();
    
    if (isEmpty) {
      await expect(page.locator(fullWriterPage['EMPTY_STATE'])).toBeVisible();
    }
  });

  test('应该能够创建新项目', async ({ page }) => {
    const projectName = `测试项目_${Date.now()}`;
    
    // 创建项目
    await fullWriterPage.createProject(projectName);
    
    // 验证项目创建成功
    await fullWriterPage.verifyProjectExists(projectName);
  });

  test('应该显示新建项目按钮', async ({ page }) => {
    await expect(page.locator(fullWriterPage['NEW_PROJECT_BUTTON'])).toBeVisible();
  });

  test('项目名称输入框应该可用', async ({ page }) => {
    const input = page.locator(fullWriterPage['PROJECT_NAME_INPUT']);
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
  });

  test('创建项目后应该显示项目列表', async ({ page }) => {
    const projectName = `测试项目列表_${Date.now()}`;
    
    // 创建项目
    await fullWriterPage.createProject(projectName);
    
    // 验证项目列表存在
    await expect(page.locator(fullWriterPage['PROJECT_LIST'])).toBeVisible();
    
    // 获取项目列表并验证包含新创建的项目
    const projects = await fullWriterPage.getProjectList();
    expect(projects).toContain(expect.stringContaining(projectName));
  });
});
