const fs = require('fs');

let settingsStore = fs.readFileSync('src/stores/useSettingsDrawerStore.ts', 'utf8');

settingsStore = settingsStore.replace(/openFromRoute: \(route: string\) =>\s*set\(\(\) => \{[\s\S]*?\}\)/, 
`openFromRoute: (route: string) =>
    set((state) => {
      const parsed = parseSettingsRoute(route)
      if (state.isOpen && state.section === parsed.section && state.route === parsed.route) {
        return state;
      }
      return {
        isOpen: true,
        section: parsed.section,
        route: parsed.route,
      }
    })`);
fs.writeFileSync('src/stores/useSettingsDrawerStore.ts', settingsStore);

