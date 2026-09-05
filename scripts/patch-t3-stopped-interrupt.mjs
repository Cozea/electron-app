/** Stopping work must never resurrect it. Keep this alongside the maintained
 * native authority overlay rather than changing the pinned fork in place. */
function once(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`[cozea-workspace-authority] Native patch anchor changed: ${label}.`);
  return source.replace(before, after);
}

export function patchNonresurrectingInterrupt(source) {
  return once(source,
    'operation: "ProviderService.interruptTurn",\n          allowRecovery: true,\n        });\n        metricProvider',
    'operation: "ProviderService.interruptTurn",\n          allowRecovery: false,\n        });\n        // Interrupt stays available after revocation, but cannot start work.\n        if (!routed.isActive) return;\n        metricProvider',
    "non-resurrecting native interrupt");
}

export function patchStoppedInterruptRegression(source) {
  const anchor = "const routing = makeProviderServiceLayer();";
  const test = `// Cozea regression: retained provider routing must not make Stop a launch API.
const stoppedInterruptRouting = makeProviderServiceLayer();
stoppedInterruptRouting.layer("Cozea non-resurrecting native interrupt", (it) => {
  it.effect("does not recover a stopped provider and still interrupts an unrelated active provider", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderService.ProviderService;
      const stopped = asThreadId("cozea-stopped-interrupt");
      const active = asThreadId("cozea-unrelated-active-interrupt");
      for (const threadId of [stopped, active]) {
        yield* provider.startSession(threadId, {
          provider: CODEX_DRIVER,
          providerInstanceId: codexInstanceId,
          threadId,
          cwd: "/tmp/cozea-interrupt-regression",
          runtimeMode: "full-access",
        });
      }
      yield* provider.stopSession({ threadId: stopped });
      const directory = yield* ProviderSessionDirectory.ProviderSessionDirectory;
      assert.equal(Option.isSome(yield* directory.getBinding(stopped)), true);
      stoppedInterruptRouting.codex.startSession.mockClear();
      stoppedInterruptRouting.codex.interruptTurn.mockClear();
      yield* provider.interruptTurn({ threadId: stopped });
      yield* provider.interruptTurn({ threadId: stopped });
      assert.equal(stoppedInterruptRouting.codex.startSession.mock.calls.length, 0);
      assert.equal(stoppedInterruptRouting.codex.interruptTurn.mock.calls.length, 0);
      assert.deepEqual((yield* provider.listSessions()).map(session => session.threadId), [active]);
      yield* provider.interruptTurn({ threadId: active });
      assert.deepEqual(stoppedInterruptRouting.codex.interruptTurn.mock.calls, [[active, undefined]]);
      assert.equal(stoppedInterruptRouting.codex.startSession.mock.calls.length, 0);
      yield* provider.stopSession({ threadId: active });
    }),
  );
});

`;
  return "// Cozea native workspace authority overlay v1\n" + once(source, anchor, test + anchor, "native stopped interrupt regression");
}
