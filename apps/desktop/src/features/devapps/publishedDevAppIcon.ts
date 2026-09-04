import defaultIconSrc from "@/features/devapps/apps/published/icon.png";
import { resolveProjectDevAppDisplayLogoDataUrl } from "@/features/devapps/projectDevAppLogo";
import type { DevAppIconDefinition } from "@/features/devapps/registry/types";

export function buildPublishedDevAppIconDefinition(
  name: string,
  logoDataUrl: unknown,
): DevAppIconDefinition {
  const resolvedLogoDataUrl = resolveProjectDevAppDisplayLogoDataUrl(logoDataUrl);

  return {
    src: resolvedLogoDataUrl ?? defaultIconSrc,
    alt: `${name} DevApp`,
    className: "scale-[1.25]",
  };
}
