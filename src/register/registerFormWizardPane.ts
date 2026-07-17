import type { Locator, Page } from "playwright";

/** Aktif wizard adımının görünür paneli (gizli adım select'lerini elemek için). */
export function activeRegisterWizardPane(page: Page): Locator {
  return page
    .locator(
      ".wizard-tab-container:visible, div[role='tabpanel']:visible, .tab-pane.active, .wizard-pane.active",
    )
    .first();
}

export async function resolveVisibleRegisterSelect(
  page: Page,
  selectName: string,
): Promise<Locator> {
  const pane = activeRegisterWizardPane(page);
  const scoped = pane.locator(`select[name='${selectName}']`).first();

  if ((await scoped.count()) > 0) {
    const visible = await scoped.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) {
      return scoped;
    }
  }

  const visibleGlobal = page.locator(`select[name='${selectName}']:visible`).first();
  if ((await visibleGlobal.count()) > 0) {
    return visibleGlobal;
  }

  return page.locator(`select[name='${selectName}']`).first();
}
