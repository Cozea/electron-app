import {aid} from 'aid:runtime';
const app = await aid.apps.get({name: 'AID Fixture'});
const window = await app.mainWindow();
const evidence = await window.observe({accessibility: true, image: 'overview'});
const choices = evidence.query({roles: ['AXLink']});
if (!choices.coverage.complete || choices.items.length === 0) throw new Error('Expand evidence first');
const ids = choices.items.map(x => x.id);
const selected = await aid.execution.decide<string>({question: 'Which result matches the task?', observation: evidence,
  choices: choices.items.map(x => ({id: x.id, label: x.observed.label})), responseSchema: {type: 'string', enum: ids}});
const target = choices.items.find(x => x.id === selected);
if (!target) throw new Error('Answer outside choices');
// Host checks dependencies before settling decide; each action checks again.
await aid.pointer.click(target);
export const selectedLabel = target.observed.label;
