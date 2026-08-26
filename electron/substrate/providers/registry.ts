import type {
  SubstrateDriverKind,
  SubstrateInstanceId,
  SubstrateProviderDriver,
  SubstrateProviderInstance,
  SubstrateProviderRegistryStatus,
} from "./types";

export class SubstrateProviderRegistryError extends Error {
  override readonly name = "SubstrateProviderRegistryError";
}

/**
 * In-memory T3-shaped ProviderDriver registry.
 * Materializes instances on demand; reconciles by disposing replaced scopes.
 */
export class SubstrateProviderDriverRegistry {
  private readonly drivers = new Map<SubstrateDriverKind, SubstrateProviderDriver>();
  private readonly instances = new Map<SubstrateInstanceId, SubstrateProviderInstance>();
  private readonly flagEnabled: boolean;

  constructor(flagEnabled: boolean) {
    this.flagEnabled = flagEnabled;
  }

  get enabled(): boolean {
    return this.flagEnabled;
  }

  register(driver: SubstrateProviderDriver): void {
    this.assertEnabled("register");
    if (this.drivers.has(driver.driverKind)) {
      throw new SubstrateProviderRegistryError(
        `Driver '${driver.driverKind}' is already registered in the substrate provider registry.`,
      );
    }
    this.drivers.set(driver.driverKind, driver);
  }

  listDrivers(): ReadonlyArray<SubstrateProviderDriver> {
    this.assertEnabled("listDrivers");
    return [...this.drivers.values()];
  }

  getDriver(driverKind: SubstrateDriverKind): SubstrateProviderDriver | undefined {
    this.assertEnabled("getDriver");
    return this.drivers.get(driverKind);
  }

  resolveDriver(driverKind: SubstrateDriverKind): SubstrateProviderDriver {
    this.assertEnabled("resolveDriver");
    const driver = this.drivers.get(driverKind);
    if (!driver) {
      throw new SubstrateProviderRegistryError(
        `No substrate provider driver registered for '${driverKind}'.`,
      );
    }
    return driver;
  }

  async materialize(input: {
    readonly driverKind: SubstrateDriverKind;
    readonly instanceId?: SubstrateInstanceId;
    readonly displayName?: string;
    readonly accentColor?: string;
    readonly enabled?: boolean;
    readonly config?: Readonly<Record<string, unknown>>;
  }): Promise<SubstrateProviderInstance> {
    this.assertEnabled("materialize");
    const driver = this.resolveDriver(input.driverKind);
    const instanceId = input.instanceId ?? input.driverKind;
    const existing = this.instances.get(instanceId);
    if (existing) {
      await existing.dispose();
      this.instances.delete(instanceId);
    }

    const instance = await driver.create({
      instanceId,
      displayName: input.displayName,
      accentColor: input.accentColor,
      enabled: input.enabled ?? true,
      config: input.config ?? driver.defaultConfig(),
    });
    this.instances.set(instanceId, instance);
    return instance;
  }

  getInstance(instanceId: SubstrateInstanceId): SubstrateProviderInstance | undefined {
    this.assertEnabled("getInstance");
    return this.instances.get(instanceId);
  }

  listInstances(): ReadonlyArray<SubstrateProviderInstance> {
    this.assertEnabled("listInstances");
    return [...this.instances.values()];
  }

  async disposeInstance(instanceId: SubstrateInstanceId): Promise<boolean> {
    this.assertEnabled("disposeInstance");
    const existing = this.instances.get(instanceId);
    if (!existing) {
      return false;
    }
    await existing.dispose();
    this.instances.delete(instanceId);
    return true;
  }

  async disposeAll(): Promise<void> {
    if (!this.flagEnabled) {
      return;
    }
    const live = [...this.instances.values()];
    this.instances.clear();
    await Promise.all(live.map((instance) => instance.dispose()));
  }

  getStatus(): SubstrateProviderRegistryStatus {
    return {
      flagId: "cozea.substrate.providers",
      enabled: this.flagEnabled,
      registeredDrivers: this.flagEnabled
        ? [...this.drivers.values()].map((driver) => ({
            driverKind: driver.driverKind,
            displayName: driver.metadata.displayName,
            implementation: driver.metadata.implementation,
          }))
        : [],
      liveInstances: this.flagEnabled
        ? [...this.instances.values()].map((instance) => ({
            instanceId: instance.instanceId,
            driverKind: instance.driverKind,
            phase: instance.snapshot.getState().phase,
          }))
        : [],
    };
  }

  private assertEnabled(operation: string): void {
    if (!this.flagEnabled) {
      throw new SubstrateProviderRegistryError(
        `Substrate provider registry is disabled (cozea.substrate.providers). Cannot ${operation}.`,
      );
    }
  }
}
