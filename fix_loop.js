const fs = require('fs');

let rts = fs.readFileSync('src/router/routes.tsx', 'utf8');

// If there's any state updates inside the render or useEffect causing loop, let's fix it.
// The issue is: "Maximum update depth exceeded" during component updates.
// Usually caused by `useSettingsDrawerStore` being called improperly or calling setState during render.
// Let's check `SettingsDrawerUrlBridge` in `App.tsx`
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(/const syncFromLocation = useEffectEvent\(\(\) => \{[\s\S]*?\}\)/, 
`const syncFromLocation = useEffectEvent(() => {
    const routeFromLocation = getSettingsRouteFromLocation(window.location)
    if (routeFromLocation) {
      if (!isOpen || route !== routeFromLocation) {
        openFromRoute(routeFromLocation)
      }
      return
    }

    if (isOpen) {
      close()
    }
  })`);
fs.writeFileSync('src/App.tsx', app);

