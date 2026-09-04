import { useCallback, useEffect, useState } from "react";
import {
  defineNativeDevApp,
  useDevAppContext,
  type DevAppJsonValue,
  type NativeDevAppSurfaceProps,
} from "@cozea/devapp-api/native";

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
    <section data-native-counter>
      <p className="counter-eyebrow">COZEA NATIVE DEVAPP</p>
      <h1>Counter</h1>
      <output aria-live="polite">{count}</output>
      <div className="counter-actions">
        <button type="button" onClick={() => commitCount(count - step)}>
          Subtract {step}
        </button>
        <button type="button" onClick={() => commitCount(0)}>
          Reset
        </button>
        <button type="button" onClick={() => commitCount(count + step)}>
          Add {step}
        </button>
      </div>
      <small>
        {host.identity.appId} · {host.surface.instanceId}
      </small>
    </section>
  );
}

export default defineNativeDevApp({
  components: { Counter },
});
