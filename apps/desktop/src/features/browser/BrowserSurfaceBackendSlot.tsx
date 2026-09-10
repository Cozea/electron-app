import type { BrowserSurfaceDescriptor } from "@shared/browserSurfaceTypes";
import { expectedBackendForState, migrationStateFor } from "@shared/browserSurfaceMigrationLedger";

import { BrowserSurfaceSlot } from "./BrowserSurfaceSlot";
import { NativeBrowserSurfaceSlot } from "./NativeBrowserSurfaceSlot";
import { useHostedBrowserSurface } from "./browserSurfaceRegistry";

/**
 * Renders a surface through whichever backend its family is migrated to.
 *
 * The choice comes from the migration ledger rather than a prop or an
 * environment check, so a family cannot change backend without an explicit,
 * reviewable ledger edit -- and both backends cannot be live for one family at
 * once.
 *
 * The two backends are separate components on purpose. The legacy path needs
 * `useHostedBrowserSurface`, the native path must not call it, and a single
 * component would have to run that hook conditionally.
 */

export interface BrowserSurfaceBackendSlotProps {
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly visible: boolean;
  readonly borderRadius?: string;
  readonly cornerRadius?: number;
  readonly stackingLayer?: number;
  readonly nativeOrder?: number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
  readonly subscribePositionChanges?: (listener: () => void) => () => void;
}

function LegacyBrowserSurfaceSlot({
  descriptor,
  visible,
  borderRadius,
  stackingLayer,
  className,
  fitSourceContent,
  subscribePositionChanges,
}: BrowserSurfaceBackendSlotProps) {
  // Claims the renderer-wide `<webview>` host for this descriptor.
  useHostedBrowserSurface(descriptor);
  return (
    <BrowserSurfaceSlot
      tabId={descriptor.runtimeTabId}
      visible={visible}
      {...(borderRadius === undefined ? {} : { borderRadius })}
      {...(stackingLayer === undefined ? {} : { stackingLayer })}
      {...(className === undefined ? {} : { className })}
      {...(fitSourceContent === undefined ? {} : { fitSourceContent })}
      {...(subscribePositionChanges === undefined ? {} : { subscribePositionChanges })}
    />
  );
}

export function BrowserSurfaceBackendSlot(props: BrowserSurfaceBackendSlotProps) {
  const backend = expectedBackendForState(migrationStateFor(props.descriptor.kind));

  if (backend === "main-webcontentsview") {
    const { descriptor, visible, cornerRadius, nativeOrder, className, subscribePositionChanges } =
      props;
    return (
      <NativeBrowserSurfaceSlot
        descriptor={descriptor}
        visible={visible}
        {...(cornerRadius === undefined ? {} : { cornerRadius })}
        {...(nativeOrder === undefined ? {} : { nativeOrder })}
        {...(className === undefined ? {} : { className })}
        {...(subscribePositionChanges === undefined ? {} : { subscribePositionChanges })}
      />
    );
  }

  return <LegacyBrowserSurfaceSlot {...props} />;
}
