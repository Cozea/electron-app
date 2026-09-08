import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  _resetGeometrySchedulerForTesting,
  getGeometrySchedulerDiagnostics,
  registerGeometryTask,
  scheduleAfterGeometryFrame,
} from "../../apps/desktop/src/lib/desktopInteraction/geometryScheduler"

describe("geometryScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    _resetGeometrySchedulerForTesting()
  })

  afterEach(() => {
    _resetGeometrySchedulerForTesting()
    vi.useRealTimers()
  })

  it("coalesces 10 invalidations before one rAF into exactly one read and one write", () => {
    let readCount = 0
    let writeCount = 0

    const task = registerGeometryTask({
      name: "test-task",
      read: () => {
        readCount++
        return { width: 100 }
      },
      write: () => {
        writeCount++
      },
    })

    // Invalidate 10 times synchronously
    for (let i = 0; i < 10; i++) {
      task.invalidate()
    }

    expect(readCount).toBe(0)
    expect(writeCount).toBe(0)

    // Advance 1 frame (16ms)
    vi.advanceTimersByTime(16)

    expect(readCount).toBe(1)
    expect(writeCount).toBe(1)

    const diag = getGeometrySchedulerDiagnostics()
    expect(diag.frameCount).toBe(1)
    expect(diag.invalidationCountByTask["test-task"]).toBe(10)
    expect(diag.readCountByTask["test-task"]).toBe(1)
    expect(diag.writeCountByTask["test-task"]).toBe(1)

    task.dispose()
  })

  it("executes all reads before all writes across multiple tasks", () => {
    const callOrder: string[] = []

    const taskA = registerGeometryTask({
      name: "task-A",
      read: () => {
        callOrder.push("read:A")
        return "valA"
      },
      write: () => {
        callOrder.push("write:A")
      },
    })

    const taskB = registerGeometryTask({
      name: "task-B",
      read: () => {
        callOrder.push("read:B")
        return "valB"
      },
      write: () => {
        callOrder.push("write:B")
      },
    })

    const taskC = registerGeometryTask({
      name: "task-C",
      read: () => {
        callOrder.push("read:C")
        return "valC"
      },
      write: () => {
        callOrder.push("write:C")
      },
    })

    taskA.invalidate()
    taskB.invalidate()
    taskC.invalidate()

    vi.advanceTimersByTime(16)

    // Verify all 3 reads ran before any write ran
    expect(callOrder.slice(0, 3)).toEqual(["read:A", "read:B", "read:C"])
    expect(callOrder.slice(3, 6)).toEqual(["write:A", "write:B", "write:C"])

    taskA.dispose()
    taskB.dispose()
    taskC.dispose()
  })

  it("schedules a second frame if a write invalidates itself during flush", () => {
    let frame = 0
    const writesAtFrame: number[] = []

    let task: any
    task = registerGeometryTask({
      name: "self-invalidating-task",
      read: () => ({ frame: ++frame }),
      write: measurement => {
        writesAtFrame.push(measurement.frame)
        if (measurement.frame === 1) {
          // Invalidate during write phase
          task.invalidate()
        }
      },
    })

    task.invalidate()
    expect(writesAtFrame).toEqual([])

    // Frame 1
    vi.advanceTimersByTime(16)
    expect(writesAtFrame).toEqual([1])

    // Frame 2
    vi.advanceTimersByTime(16)
    expect(writesAtFrame).toEqual([1, 2])

    // Frame 3 - should not run again
    vi.advanceTimersByTime(16)
    expect(writesAtFrame).toEqual([1, 2])

    task.dispose()
  })

  it("never executes a disposed task", () => {
    let readCount = 0
    let writeCount = 0

    const task = registerGeometryTask({
      name: "disposed-task",
      read: () => {
        readCount++
        return 42
      },
      write: () => {
        writeCount++
      },
    })

    task.invalidate()
    task.dispose()

    vi.advanceTimersByTime(16)

    expect(readCount).toBe(0)
    expect(writeCount).toBe(0)

    // Further invalidation should also no-op
    task.invalidate()
    vi.advanceTimersByTime(16)
    expect(readCount).toBe(0)
    expect(writeCount).toBe(0)
  })

  it("does not cancel peer tasks if one task throws during read or write", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    let peerRan = false

    const faultyTask = registerGeometryTask({
      name: "faulty",
      read: () => {
        throw new Error("Read explosion")
      },
      write: () => {},
    })

    const peerTask = registerGeometryTask({
      name: "peer",
      read: () => "peer-val",
      write: () => {
        peerRan = true
      },
    })

    faultyTask.invalidate()
    peerTask.invalidate()

    vi.advanceTimersByTime(16)

    expect(peerRan).toBe(true)

    faultyTask.dispose()
    peerTask.dispose()
    errorSpy.mockRestore()
  })

  it("skips write if read returns null", () => {
    let writeCalled = false

    const task = registerGeometryTask({
      name: "null-read-task",
      read: () => null,
      write: () => {
        writeCalled = true
      },
    })

    task.invalidate()
    vi.advanceTimersByTime(16)

    expect(writeCalled).toBe(false)
    task.dispose()
  })

  it("executes after-frame callback strictly after writes have completed", () => {
    const order: string[] = []

    const task = registerGeometryTask({
      name: "order-task",
      read: () => "measurement",
      write: () => {
        order.push("write")
      },
    })

    task.invalidate()
    scheduleAfterGeometryFrame(() => {
      order.push("after-frame")
    })

    vi.advanceTimersByTime(16)

    expect(order).toEqual(["write", "after-frame"])
    task.dispose()
  })
})
