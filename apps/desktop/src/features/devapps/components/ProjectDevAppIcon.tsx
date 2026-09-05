import { DevAppIcon } from "@/features/devapps/components/DevAppIcon";
import { devServerDevAppManifest } from "@/features/devapps/apps/dev-server/manifest";
import { useLocalProjectDevAppStore } from "@/features/devapps/localProjectDevAppStore";

interface ProjectDevAppIconProps {
  publicationId: string;
  name: string;
  className?: string;
}

/**
 * Resolve the publication's machine-local logo without duplicating its data URL
 * into every persisted workbench tile. Legacy entries fall back to the bundled
 * local-runtime artwork.
 */
export function ProjectDevAppIcon({ publicationId, name, className }: ProjectDevAppIconProps) {
  const logoDataUrl = useLocalProjectDevAppStore((state) => {
    const entry = state.entries.find(
      (candidate) => String(candidate.publication._id) === publicationId,
    );
    return entry?.logoDataUrl?.trim() || null;
  });

  return (
    <DevAppIcon
      app={{
        name,
        icon: logoDataUrl
          ? { src: logoDataUrl, alt: `${name} DevApp`, className: "scale-[1.25]" }
          : {
              ...devServerDevAppManifest.icon,
              alt: `${name} DevApp`,
            },
      }}
      className={className}
    />
  );
}
