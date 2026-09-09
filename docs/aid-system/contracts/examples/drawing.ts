import {aid} from 'aid:runtime';
import {ellipse} from 'workspace:/geometry';
const app = await aid.apps.get({name: 'AID Drawing Fixture'});
const window = await app.mainWindow();
const initial = await window.observe({accessibility: true, image: 'overview'});
const canvas = initial.query({roles: ['AXGroup'], name: 'Drawing canvas'}).one();
if (!canvas.observed.frame) throw new Error('Missing canvas geometry');
const surface = await initial.bindSurface({region: canvas.observed.frame, anchors: [canvas.id], intent: 'drawing'});
await aid.execution.emit({kind: 'observation', observation: initial});
let receipt;
for (let i = 0; i < 20; i++) {
  receipt = await surface.pointer.stroke(ellipse(.5, .5, .1 + i * .008, .15 + i * .008), {durationMs: 700, interpolation: 'polyline'});
}
const final = await surface.observe({image: 'overview', after: receipt?.after});
await aid.execution.emit({kind: 'observation', observation: final});
await surface.release();
