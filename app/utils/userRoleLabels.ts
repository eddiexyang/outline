import i18n from "i18next";
import type { TFunction } from "i18next";
import { UserRole } from "@shared/types";

/**
 * Returns whether the current locale is a Chinese locale.
 *
 * @returns `true` if current locale starts with `zh`, otherwise `false`.
 */
export function isChineseLocale(): boolean {
  const language = i18n.resolvedLanguage ?? i18n.language;
  return language ? language.toLowerCase().startsWith("zh") : false;
}

/**
 * Returns the localized singular role label used in the UI.
 *
 * @param role the user role.
 * @param t the translation function.
 * @returns the localized singular role label.
 */
export function userRoleLabel(role: UserRole, t: TFunction): string {
  const zh = isChineseLocale();

  switch (role) {
    case UserRole.Admin:
      return t("Admin", {
        defaultValue: zh ? "管理员" : "Admin",
      });
    case UserRole.Manager:
      return t("Manager", {
        defaultValue: zh ? "主管" : "Manager",
      });
    case UserRole.Editor:
      return t("Editor");
    case UserRole.Viewer:
      return t("Viewer");
  }
}

/**
 * Returns the localized plural role label used in the UI.
 *
 * @param role the user role.
 * @param t the translation function.
 * @returns the localized plural role label.
 */
export function userRoleLabelPlural(role: UserRole, t: TFunction): string {
  const zh = isChineseLocale();

  switch (role) {
    case UserRole.Admin:
      return t("Admins", {
        defaultValue: zh ? "管理员" : "Admins",
      });
    case UserRole.Manager:
      return t("Managers", {
        defaultValue: zh ? "主管" : "Managers",
      });
    case UserRole.Editor:
      return t("Editors");
    case UserRole.Viewer:
      return t("Viewers");
  }
}
