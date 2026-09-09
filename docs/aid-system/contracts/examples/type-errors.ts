import {aid, type HostRequest, type Point, type AppQuery, type WireExecutionStatus} from 'aid:runtime';
// These directives MUST be consumed by real compiler errors.
// @ts-expect-error raw points have no coordinate identity
const unframed: Point = {x: 1, y: 2};
// @ts-expect-error PID requires launch identity
const pidOnly: AppQuery = {pid: 42};
// @ts-expect-error app selector variants cannot be mixed
const mixed: AppQuery = {name: 'Safari', bundleId: 'com.apple.Safari'};
// @ts-expect-error old source spelling is rejected
const oldSource: HostRequest = {method: 'exec', params: {apiRevision: '1.1', workspaceId: 'ws_1', idempotencyKey: 'k', cellName: 'x', source: {kind: 'inline', text: ''}}};
// @ts-expect-error this API cannot impersonate the approval host
const owner: HostRequest = {method: 'describe', params: {apiRevision: '1.1', subject: 'pointer', principalId: 'human'}};
// @ts-expect-error close has exactly one discriminated target shape
const twoTargets: HostRequest = {method: 'close', params: {apiRevision: '1.1', target: {kind: 'execution', executionId: 'exec_1', controlId: 'ctl_1'}}};
// @ts-expect-error no unsupported pressure alias on mouse input
await aid.pointer.click({x: 1, y: 1}, {pressure: .5});
// @ts-expect-error unknown legacy method
await aid.pointer.runTimeline({});
// @ts-expect-error unrecognized state
const status: WireExecutionStatus = {executionId: 'e', workspaceId: 'w', state: 'done-ish', sequence: '1', historyExpired: false, droppedRecords: 0, quiescent: true};
void [unframed, pidOnly, mixed, oldSource, owner, twoTargets, status];
