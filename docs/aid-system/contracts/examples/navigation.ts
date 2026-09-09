import {aid} from 'aid:runtime';
const {app} = await aid.apps.prepare({app: {bundleId: 'com.apple.Safari'}, launch: true, unhide: true, foreground: true});
const window = await app.mainWindow();
await window.keyboard.chord('super+l');
await window.keyboard.typeText('https://example.org');
const receipt = await window.keyboard.chord('Return');
const observation = await window.observe({accessibility: true, image: 'overview', after: receipt.after});
await aid.execution.emit({kind: 'observation', observation});
