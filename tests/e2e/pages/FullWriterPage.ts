import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * 完整写作工作台页面对象
 */
export class FullWriterPage extends BasePage {
  // 选择器
  private readonly NEW_PROJECT_BUTTON = 'button:has-text("新建项目")';
  private readonly PROJECT_NAME_INPUT = 'input[placeholder*="项目名称"], input[type="text"]';
  private readonly CREATE_PROJECT_BUTTON = 'button:has-text("创建"), button[type="submit"]';
  private readonly PROJECT_LIST = '.project-list, [data-testid="project-list"]';
  private readonly EMPTY_STATE = 'text=当前没有项目';

  constructor(page: Page) {
    super(page);
  }

  /**
   * 导航到完整写作工作台
   */
  async goto() {
    await this.page.goto('app://obsidian.md');
    await this.waitForLoad();
  }

  /**
   * 检查是否显示空状态（没有项目）
   */
  async isEmptyState(): Promise<boolean> {
    const emptyState = this.page.locator(this.EMPTY_STATE);
    return await emptyState.isVisible();
  }

  /**
   * 点击新建项目按钮
   */
  async clickNewProject() {
    await this.page.click(this.NEW_PROJECT_BUTTON);
    await this.page.waitForTimeout(500);
  }

  /**
   * 填写项目名称
   */
  async fillProjectName(name: string) {
    await this.page.fill(this.PROJECT_NAME_INPUT, name);
  }

  /**
   * 点击创建项目按钮
   */
  async clickCreateProject() {
    await this.page.click(this.CREATE_PROJECT_BUTTON);
    await this.page.waitForTimeout(1000);
  }

  /**
   * 创建新项目（完整流程）
   */
  async createProject(name: string) {
    if (await this.isEmptyState()) {
      await this.clickNewProject();
    }
    await this.fillProjectName(name);
    await this.clickCreateProject();
    
    // 等待项目创建完成
    await this.page.waitForSelector(this.PROJECT_LIST, { timeout: 10000 });
  }

  /**
   * 验证项目列表中存在指定项目
   */
  async verifyProjectExists(projectName: string) {
    const projectItem = this.page.locator(`${this.PROJECT_LIST} .project-item:has-text("${projectName}")`);
    await expect(projectItem).toBeVisible({ timeout: 5000 });
  }

  /**
   * 获取所有项目列表
   */
  async getProjectList(): Promise<string[]> {
    const projects = await this.page.locator(`${this.PROJECT_LIST} .project-item`).allTextContents();
    return projects.map(p => p.trim()).filter(p => p.length > 0);
  }
}
