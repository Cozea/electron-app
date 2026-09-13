import { app } from 'electron'

/**
 * Lets a second copy of the app run beside the first on one Mac, for example as the
 * second device in a live session test.
 *
 * Every copy of Cozea, dev or packaged, keeps its profile in the same folder (named
 * after `@cozea/desktop`), and the single-instance lock on that folder makes a second
 * copy quit. `COZEA_USER_DATA_DIR` gives a copy its own profile, and with it its own
 * device identity. main.ts imports this module first, so the override lands before
 * anything reads the profile.
 */
const profileDir = process.env.COZEA_USER_DATA_DIR?.trim()
if (profileDir) {
  app.setPath('userData', profileDir)
  app.setPath('sessionData', profileDir)
}
