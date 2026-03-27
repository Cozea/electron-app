const fs = require('fs');
let file = fs.readFileSync('server/src/lib/convex.ts', 'utf8');

file = file.replace(
  "/**\n * Update organization AI settings\n */\n): Promise<void> {",
  "/**\n * Update organization AI settings\n */\nexport async function updateOrganizationAiSettings(args: any): Promise<void> {"
);

file = file.replace(
  "    return result as { created: number; updated: number }\n catch (err) {",
  "    return result as { created: number; updated: number }\n  } catch (err) {"
);

file = file.replace(
  "    return result as { removed: number }\n catch (err) {",
  "    return result as { removed: number }\n  } catch (err) {"
);

file = file.replace(
  "      subscriptionPrices: result.subscriptionPrices,\n    }\n catch (err) {",
  "      subscriptionPrices: result.subscriptionPrices,\n    }\n  } catch (err) {"
);

file = file.replace(
  "    migratedFromReplicaAt?: number\n  }\n): Promise<ProjectSyncInfoForServer | null> {",
  "    migratedFromReplicaAt?: number\n  }\n}): Promise<ProjectSyncInfoForServer | null> {"
);

fs.writeFileSync('server/src/lib/convex.ts', file);
