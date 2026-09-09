import {aid} from 'aid:runtime';
const window = await (await aid.apps.get({name: 'AID Fixture'})).mainWindow();
const ready = await aid.events.until(async () => {
  const matches = await window.query({roles: ['AXButton'], name: /^Skip( ad)?$/});
  return matches.coverage.complete && matches.items.length === 1 && matches.items[0].observed.enabled
    ? matches.items[0] : null;
}, {scope: window, deadlineMs: 30000, stableForMs: 100});
await aid.pointer.click(ready);
