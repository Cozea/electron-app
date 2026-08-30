import { DevAppIcon } from "@/features/devapps/components/DevAppIcon";
import { buildPublishedDevAppIconDefinition } from "@/features/devapps/publishedDevAppIcon";

interface PublishedDevAppIconProps {
  name: string;
  logoDataUrl?: string | null;
  className?: string;
}

export function PublishedDevAppIcon({
  name,
  logoDataUrl,
  className,
}: PublishedDevAppIconProps) {
  return (
    <DevAppIcon
      app={{
        name,
        icon: buildPublishedDevAppIconDefinition(name, logoDataUrl),
      }}
      className={className}
    />
  );
}
