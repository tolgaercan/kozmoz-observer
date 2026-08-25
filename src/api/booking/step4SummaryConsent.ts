import type { Page } from "playwright";

import type { AppointmentSettings } from "../../config/settings.js";
import { ensureCheckboxChecked, resolveConsentCheckbox } from "../../portal/consent/consentCheckbox.js";
import {
  resolveConsentScrollContainer,
  scrollUntilCheckboxEnabled,
} from "../../portal/consent/consentScroll.js";
import { logger } from "../../utils/logger.js";

export interface Step4FillResult {
  ok: boolean;
  reason?: string;
}

const SUMMARY_CONSENT_STEPS = [
  {
    labelMatch: /Ön bilgilendirme formunu okudum/i,
    fieldLabel: "Ön bilgilendirme formu onayı",
    headingHint: "ÖN BİLGİLENDİRME FORMU",
  },
  {
    labelMatch: /Mesafeli satış sözleşmesini okudum/i,
    fieldLabel: "Mesafeli satış sözleşmesi onayı",
    headingHint: "MESAFELİ HİZMET SÖZLEŞMESİ",
  },
] as const;

export async function isSummaryConsentStepVisible(page: Page): Promise<boolean> {
  const markers = [
    "text=Hizmet Teminat Bedeli",
    "text=Randevu Bilgileri",
    "text=ÖN BİLGİLENDİRME FORMU",
    "text=MESAFELİ HİZMET SÖZLEŞMESİ",
    "text=Kayıt Özeti",
    "text=Randevu Özeti",
  ];

  for (const selector of markers) {
    try {
      if (await page.locator(selector).first().isVisible({ timeout: 800 })) {
        return true;
      }
    } catch {
      // devam
    }
  }

  const firstCheckbox = resolveConsentCheckbox(page, SUMMARY_CONSENT_STEPS[0]!.labelMatch);
  return firstCheckbox.isVisible({ timeout: 800 }).catch(() => false);
}

/**
 * Step 4 — Hizmet Teminat / özet: her bölümde scroll → checkbox.
 */
export async function fillSummaryConsentStep(
  page: Page,
  settings: AppointmentSettings,
): Promise<Step4FillResult> {
  if (!(await isSummaryConsentStepVisible(page))) {
    return {
      ok: false,
      reason: "Step 4 (Hizmet Teminat / özet) ekranı görünür değil",
    };
  }

  logger.info("[booking] Step 4 — sözleşme onayları (scroll + checkbox).");

  for (const step of SUMMARY_CONSENT_STEPS) {
    const checkbox = resolveConsentCheckbox(page, step.labelMatch);
    try {
      await checkbox.waitFor({ state: "attached", timeout: 12_000 });
    } catch {
      return {
        ok: false,
        reason: `Checkbox bulunamadı: ${step.fieldLabel}`,
      };
    }

    const scrollContainer = await resolveConsentScrollContainer(page, {
      headingText: step.headingHint,
      checkbox,
    });
    if (!scrollContainer) {
      return {
        ok: false,
        reason: `Scroll alanı bulunamadı: ${step.headingHint} (overflow-y scroll div)`,
      };
    }

    const scrolled = await scrollUntilCheckboxEnabled(
      page,
      scrollContainer,
      checkbox,
      { label: step.fieldLabel },
    );
    if (!scrolled) {
      return {
        ok: false,
        reason: `${step.fieldLabel} — scroll sonrası checkbox aktif olmadı`,
      };
    }

    try {
      await ensureCheckboxChecked(page, checkbox, step.fieldLabel, settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: message };
    }

    await page.waitForTimeout(200 + Math.random() * 200);
  }

  logger.info("[booking] Step 4 onay kutuları tamamlandı.");
  return { ok: true };
}
