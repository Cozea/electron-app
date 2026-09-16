import { DevAppIcon } from "@/features/devapps/components/DevAppIcon";
import { devServerDevAppManifest } from "@/features/devapps/apps/dev-server/manifest";

interface ProjectDevAppIconProps {
  name: string;
  className?: string;
}

/**
 * Publication artwork. The machine-local logo catalog is gone; every tile
 * uses the bundled local-runtime artwork.
 */
export function ProjectDevAppIcon({ name, className }: ProjectDevAppIconProps) {
  return (
    <DevAppIcon
      app={{
        name,
        icon: {
          ...devServerDevAppManifest.icon,
          alt: `${name} DevApp`,
        },
      }}
      className={className}
    />
  );
}
