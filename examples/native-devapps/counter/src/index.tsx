import { useCallback, useEffect, useState } from "react";
import {
  defineNativeDevApp,
  useDevAppContext,
  type DevAppJsonValue,
  type NativeDevAppSurfaceProps,
} from "@cozea/devapp-api/native";
import { Button, Panel, PanelToolbar } from "@cozea/devapp-api/ui";

function countFromState(value: DevAppJsonValue | undefined): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return typeof value.count === "number" ? value.count : 0;
}

export function Counter({
  instanceState,
  setInstanceState,
}: NativeDevAppSurfaceProps) {
  const host = useDevAppContext();
  const [count, setCount] = useState(() => countFromState(instanceState));
  const [step, setStep] = useState(1);

  useEffect(() => {
    let active = true;
    void host.settings.get<number>("counter.step").then((value) => {
      if (active && typeof value === "number" && Number.isFinite(value)) {
        setStep(value);
      }
    });
    const subscription = host.settings.subscribe("counter.step", (value) => {
      if (typeof value === "number" && Number.isFinite(value)) setStep(value);
    });
    return () => {
      active = false;
      void subscription.dispose();
    };
  }, [host.settings]);

  const commitCount = useCallback(
    (next: number) => {
      setCount(next);
      setInstanceState({ count: next });
      void host.storage.set("last-count", next);
    },
    [host.storage, setInstanceState],
  );

  return (
    <Panel data-native-counter>
      <PanelToolbar
        title="Counter"
        description={`${host.identity.appId} · ${host.surface.instanceId}`}
      />
      <p className="counter-eyebrow">COZEA NATIVE DEVAPP</p>
      <output aria-live="polite">{count}</output>
      <div className="counter-actions">
        <Button onClick={() => commitCount(count - step)}>Subtract {step}</Button>
        <Button onClick={() => commitCount(0)}>Reset</Button>
        <Button onClick={() => commitCount(count + step)}>Add {step}</Button>
      </div>
    </Panel>
  );
}

export default defineNativeDevApp({
  components: { Counter },
});
