import { createProviderAuthBrowserFlow, googleAuthorizationUrl } from "./providerAuthBrowserFlow";
import compatibility from "@shared/provider-compatibility.json";
import { useT3CutoverActive } from "@/substrate/t3CutoverStore";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ServerConfig,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import type {
  ProviderAuthState,
  ProviderInstallState,
} from "@shared/assistant-contracts/providerSetup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readNativeApi } from "@/lib/nativeApi";
import {
  SettingsGroup,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "./ui/SettingsChrome";

function configRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function AntigravitySetup() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const runtimeActive = useT3CutoverActive();
  const api = runtimeActive ? readNativeApi() : undefined;
  useEffect(() => {
    if (!api) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void api.server
      .getConfig()
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => undefined);
    void api.server
      .onConfigUpdated?.((value) => {
        if (active) setConfig(value);
      })
      .then((stop) => {
        if (active) unsubscribe = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api]);
  const [selectedId, setSelectedId] = useState("antigravity");
  const providers =
    config?.providers.filter(
      (provider) => (provider.driver ?? provider.provider) === "antigravity",
    ) ?? [];
  const selected = providers.find((provider) => String(provider.instanceId) === selectedId);
  return (
    <section>
      <details className="mb-6 rounded-lg border p-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Provider compatibility diagnostics</summary>
        <p className="my-2">
          Adapter {compatibility.adapterRevision.slice(0, 9)}. Unverified versions remain usable;
          protocol errors retain the original conversation for repair and retry.
        </p>
        {config?.providers.map((entry) => {
          const record = compatibility.providers.find(
            (item) => item.driver === (entry.driver ?? entry.provider),
          );
          const verified = Boolean(
            entry.version &&
            record?.testedRuntimeVersions.some((version: string) => version === entry.version),
          );
          return (
            <p key={entry.instanceId}>
              {entry.displayName ?? entry.driver} · {entry.version ?? "version unavailable"} ·{" "}
              {verified ? "Qualified" : "Unverified runtime version"}
            </p>
          );
        })}
      </details>
      <SettingsSectionTitle>Antigravity</SettingsSectionTitle>
      <SettingsSectionDescription>
        Set up a local Google account. Each account has its own provider instance and conversations.
      </SettingsSectionDescription>
      <SettingsGroup>
        {!api?.providerSetup ? (
          <p className="p-4 text-sm text-muted-foreground">
            Provider setup is available when connected to this device’s local chat runtime.
          </p>
        ) : null}
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Antigravity account"
              className="h-8 min-w-40 rounded-md border bg-background px-2 text-sm"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {!providers.some((provider) => provider.instanceId === selectedId) ? (
                <option value={selectedId}>
                  {selectedId === "antigravity" ? "Antigravity" : "New account"}
                </option>
              ) : null}
              {providers.map((provider) => (
                <option key={provider.instanceId} value={provider.instanceId}>
                  {provider.displayName ?? provider.instanceId}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedId(`antigravity-${crypto.randomUUID()}`)}
            >
              Add account
            </Button>
          </div>
          <AntigravityInstanceSetup key={selectedId} instanceId={selectedId} provider={selected} />
        </div>
      </SettingsGroup>
    </section>
  );
}

function AntigravityInstanceSetup({
  instanceId,
  provider,
}: {
  instanceId: string;
  provider?: ServerProvider;
}) {
  const [name, setName] = useState(provider?.displayName ?? "Antigravity");
  const [binaryPath, setBinaryPath] = useState("");
  const [configuration, setConfiguration] = useState<ProviderInstanceConfig | null>(null);
  const [auth, setAuth] = useState<ProviderAuthState | null>(null);
  const [install, setInstall] = useState<ProviderInstallState | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const api = readNativeApi();
  const setup = api?.providerSetup;
  const browserFlow = useMemo(
    () =>
      createProviderAuthBrowserFlow(async (url) => {
        if (!api) throw new Error("The local runtime is unavailable.");
        await api.shell.openExternal(url);
      }),
    [api],
  );
  const personalAccount =
    configRecord(configuration?.config).authMethod === undefined ||
    configRecord(configuration?.config).authMethod === "oauth-personal";

  const run = async (operation: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Provider setup failed. Retry the operation.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.server
      .getSettings()
      .then((settings) => {
        if (!active) return;
        const entry = settings.providerInstances[instanceId];
        setConfiguration(entry ?? null);
        if (entry?.displayName) setName(entry.displayName);
        setBinaryPath(
          typeof configRecord(entry?.config).binaryPath === "string"
            ? String(configRecord(entry?.config).binaryPath)
            : "",
        );
      })
      .catch(() => {
        if (active) setError("Could not load provider settings.");
      });
    return () => {
      active = false;
    };
  }, [api, instanceId]);

  useEffect(() => {
    if (!setup || !provider?.enabled) return;
    let active = true;
    const cleanup: Array<() => Promise<void>> = [];
    const add = (unsubscribe: () => Promise<void>) => {
      if (active) cleanup.push(unsubscribe);
      else void unsubscribe();
    };
    void setup
      .subscribeAuth(instanceId, (state) => {
        if (active) setAuth(state);
      })
      .then(add)
      .catch(() => {
        if (active) setError("Sign-in status disconnected. Reopen setup after reconnecting.");
      });
    void setup
      .subscribeInstall(instanceId, (state) => {
        if (active) setInstall(state);
      })
      .then(add)
      .catch(() => {
        if (active) setError("Installation status disconnected. Reopen setup after reconnecting.");
      });
    return () => {
      active = false;
      for (const unsubscribe of cleanup) void unsubscribe();
    };
  }, [setup, instanceId, provider?.enabled]);

  useEffect(() => {
    if (!api || !auth) return;
    if (auth.phase === "succeeded") void api.server.refreshProviders().catch(() => undefined);
    void browserFlow
      .observe(auth)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not open provider sign-in."),
      );
  }, [api, auth, browserFlow]);

  useEffect(() => {
    if (install?.phase === "succeeded") void api?.server.refreshProviders().catch(() => undefined);
  }, [api, install?.operationId, install?.phase]);

  const save = async (enabled: boolean) => {
    if (!api) throw new Error("Reconnect the local chat runtime before setting up Antigravity.");
    const settings = await api.server.getSettings();
    const existing = settings.providerInstances[instanceId];
    const entry: ProviderInstanceConfig = {
      ...existing,
      driver: ProviderDriverKind.makeUnsafe("antigravity"),
      displayName: name.trim() || "Antigravity",
      enabled,
      config: {
        ...configRecord(existing?.config),
        authMethod: "oauth-personal",
        binaryPath: binaryPath.trim(),
      },
    };
    await api.server.updateSettings({
      providerInstances: { ...settings.providerInstances, [instanceId]: entry },
    });
    setConfiguration(entry);
    await api.server.refreshProviders();
  };
  const installing =
    install?.phase === "downloading" ||
    install?.phase === "extracting" ||
    install?.phase === "verifying";
  const authenticating =
    auth?.phase === "starting" || auth?.phase === "waiting" || auth?.phase === "verifying";
  const enabled = provider?.enabled ?? configuration?.enabled ?? false;
  return (
    <div className="space-y-3">
      <Input
        aria-label="Account name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy}
        placeholder="Account name"
      />
      <Input
        aria-label="Antigravity binary path"
        value={binaryPath}
        onChange={(event) => setBinaryPath(event.target.value)}
        disabled={busy || installing || authenticating}
        placeholder="Binary path (leave empty for managed installation)"
      />
      {!personalAccount ? (
        <p className="text-sm text-muted-foreground">
          This instance uses an externally configured sign-in method. Create a separate account for
          Google browser sign-in.
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {provider?.message ??
          (enabled ? "Provider enabled" : "Disabled until you enable this account")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={
            !setup ||
            busy ||
            installing ||
            authenticating ||
            !personalAccount ||
            provider?.availability === "unavailable"
          }
          onClick={() => void run(() => save(true))}
        >
          {enabled ? "Save settings" : "Enable account"}
        </Button>
        {enabled ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || installing || authenticating}
            onClick={() => void run(() => save(false))}
          >
            Disable
          </Button>
        ) : null}
        {enabled && provider?.setup?.canInstall ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || installing || authenticating || Boolean(binaryPath.trim())}
            onClick={() =>
              void run(async () => {
                setInstall(await setup!.startInstall(instanceId));
              })
            }
          >
            Install / update runtime
          </Button>
        ) : null}
        {installing && install?.operationId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setInstall(await setup!.cancelInstall(instanceId, install.operationId!));
              })
            }
          >
            Cancel installation
          </Button>
        ) : null}
        {enabled && personalAccount && provider?.setup?.canAuthenticate ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || installing || authenticating || !provider.installed}
            onClick={() =>
              void run(async () => {
                const state = await setup!.startAuth(instanceId);
                setAuth(state);
                await browserFlow.begin(state);
              })
            }
          >
            Sign in with Google
          </Button>
        ) : null}
        {authenticating && auth?.flowId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setAuth(await setup!.cancelAuth(instanceId, auth.flowId!));
              })
            }
          >
            Cancel sign-in
          </Button>
        ) : null}
        {auth?.authorizationUrl && authenticating ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void run(() =>
                api!.shell.openExternal(googleAuthorizationUrl(auth.authorizationUrl!)),
              )
            }
          >
            Open sign-in again
          </Button>
        ) : null}
        {enabled && provider?.auth.status === "authenticated" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || authenticating}
            onClick={() =>
              void run(async () => {
                setAuth(await setup!.logout(instanceId));
                await api!.server.refreshProviders();
              })
            }
          >
            Sign out
          </Button>
        ) : null}
        {install?.canRemove ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || installing || authenticating}
            onClick={() =>
              void run(async () => {
                setInstall(await setup!.removeInstall(instanceId));
                await api!.server.refreshProviders();
              })
            }
          >
            Remove managed runtime
          </Button>
        ) : null}
      </div>
      {install && install.phase !== "idle" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Installation: {install.phase}
          {install.totalBytes
            ? ` — ${Math.round((100 * install.downloadedBytes) / install.totalBytes)}%`
            : ""}
          {install.message ? ` · ${install.message}` : ""}
        </p>
      ) : null}
      {auth && auth.phase !== "idle" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Sign-in: {auth.phase}
          {auth.message ? ` · ${auth.message}` : ""}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
