import { Page } from '@playwright/test';

export async function waitForElementVisible(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'visible' as const, timeout });
}

export async function waitForElementHidden(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: 'hidden' as const, timeout });
}

export async function waitForText(page: Page, text: string, timeout = 5000) {
  await page.waitForSelector(`text=${text}`, { timeout });
}

export async function clickAndWait(page: Page, selector: string, waitMs = 500) {
  await page.click(selector);
  await page.waitForTimeout(waitMs);
}

export async function fillAndWait(page: Page, selector: string, value: string, waitMs = 300) {
  await page.fill(selector, value);
  await page.waitForTimeout(waitMs);
}

export async function selectOptionAndWait(page: Page, selector: string, value: string, waitMs = 300) {
  await page.selectOption(selector, value);
  await page.waitForTimeout(waitMs);
}

export async function getElementText(page: Page, selector: string): Promise<string | null> {
  const element = page.locator(selector);
  return await element.textContent();
}

export async function getElementAttribute(page: Page, selector: string, attribute: string): Promise<string | null> {
  const element = page.locator(selector);
  return await element.getAttribute(attribute);
}

export async function isElementVisible(page: Page, selector: string): Promise<boolean> {
  const element = page.locator(selector);
  return await element.isVisible();
}

export async function isElementEnabled(page: Page, selector: string): Promise<boolean> {
  const element = page.locator(selector);
  return await element.isEnabled();
}

export async function pressKeyAndWait(page: Page, key: string, waitMs = 300) {
  await page.keyboard.press(key);
  await page.waitForTimeout(waitMs);
}

export async function typeAndWait(page: Page, selector: string, text: string, waitMs = 300) {
  await page.type(selector, text);
  await page.waitForTimeout(waitMs);
}

export async function scrollToElement(page: Page, selector: string) {
  await page.locator(selector).scrollIntoViewIfNeeded();
}

export async function takeScreenshot(page: Page, name: string, directory = 'test-results/screenshots') {
  await page.screenshot({ path: `${directory}/${name}.png` });
}

export async function waitForNetworkIdle(page: Page, timeout = 10000) {
  await page.waitForLoadState('networkidle', { timeout });
}

export async function waitForNavigation(page: Page, timeout = 10000) {
  await page.waitForNavigation({ timeout });
}

export async function executeScript<T>(page: Page, script: string): Promise<T> {
  return await page.evaluate(script) as T;
}

export async function dragAndDrop(page: Page, sourceSelector: string, targetSelector: string) {
  const source = page.locator(sourceSelector);
  const target = page.locator(targetSelector);
  
  await source.hover();
  await page.mouse.down();
  await target.hover();
  await page.mouse.up();
}

export async function getDropdownOptions(page: Page, selector: string): Promise<string[]> {
  const options = await page.locator(`${selector} option`).allTextContents();
  return options.map(o => o.trim()).filter(o => o.length > 0);
}

export async function waitForToast(page: Page, message: string, timeout = 5000) {
  const toast = page.locator(`.toast:has-text("${message}"), .notice:has-text("${message}")`);
  await toast.waitFor({ state: 'visible', timeout });
}

export async function waitForToastDisappear(page: Page, timeout = 5000) {
  const toast = page.locator('.toast, .notice');
  await toast.waitFor({ state: 'hidden', timeout });
}