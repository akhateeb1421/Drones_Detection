import { useTranslation } from "react-i18next";
import { useRole } from "../contexts/RoleContext";

/**
 * Header role indicator — purely informational, no interactive elements.
 * The Sign-In / Sign-Out controls live in the sidebar bottom.
 */
export function RoleToggle() {
  const { t } = useTranslation();
  const { role } = useRole();
  if (role === "admin") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="badge bg-accent text-black font-semibold">{t("auth.role_admin")}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      {/* badge-muted is already theme-aware (light-mode override in
          index.css) so the Operator text reads in both modes. */}
      <span className="badge badge-muted font-semibold">{t("auth.role_viewer")}</span>
    </div>
  );
}
