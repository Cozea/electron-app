import fsPromises from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { getManagedAndroidDeviceSetPath } from './devicePaths'

function getAndroidHome(): string | null {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    '/usr/local/share/android-commandlinetools',
    '/opt/homebrew/share/android-commandlinetools',
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  ]
  return candidates.find((c) => c && fs.existsSync(c)) || null
}

async function findBestSystemImage(androidHome: string): Promise<{ name: string; location: string } | null> {
  const sysImagesPath = path.join(androidHome, 'system-images')
  try {
    const apiLevels = await fsPromises.readdir(sysImagesPath)
    // Sort descending to get highest API level
    apiLevels.sort((a, b) => b.localeCompare(a))

    const isArm = process.arch === 'arm64'

    for (const api of apiLevels) {
      const apiPath = path.join(sysImagesPath, api)
      const types: string[] = await fsPromises.readdir(apiPath).catch(() => [])
      
      for (const type of ['google_apis_playstore', 'google_apis', 'default']) {
        if (types.includes(type)) {
          const typePath = path.join(apiPath, type)
          const archs: string[] = await fsPromises.readdir(typePath).catch(() => [])
          
          const preferredArch = isArm ? 'arm64-v8a' : 'x86_64'
          if (archs.includes(preferredArch)) {
            return {
              name: `Android API ${api} ${type}`,
              location: path.join(typePath, preferredArch)
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors reading system-images
  }
  return null
}

export async function createManagedEmulator(name: string = 'Cozea Emulator'): Promise<string | null> {
  const androidHome = getAndroidHome()
  if (!androidHome) return null

  const systemImage = await findBestSystemImage(androidHome)
  if (!systemImage) return null

  const avdDirectory = getManagedAndroidDeviceSetPath() || path.join(os.homedir(), '.android', 'avd')
  const avdId = crypto.randomUUID()
  const avdIni = path.join(avdDirectory, `${avdId}.ini`)
  const avdLocation = path.join(avdDirectory, `${avdId}.avd`)
  const configIni = path.join(avdLocation, 'config.ini')

  await fsPromises.mkdir(avdLocation, { recursive: true })

  const avdIniContent = `avd.ini.encoding=UTF-8\npath=${avdLocation}\n`
  await fsPromises.writeFile(avdIni, avdIniContent, 'utf-8')

  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  const abi = process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64'

  const configIniData = [
    ['AvdId', avdId],
    ['PlayStore.enabled', 'true'],
    ['abi.type', abi],
    ['avd.ini.displayname', name],
    ['avd.ini.encoding', 'UTF-8'],
    ['disk.dataPartition.size', '6442450944'],
    ['fastboot.chosenSnapshotFile', ''],
    ['fastboot.forceChosenSnapshotBoot', 'no'],
    ['fastboot.forceColdBoot', 'no'],
    ['fastboot.forceFastBoot', 'yes'],
    ['hw.accelerometer', 'yes'],
    ['hw.arc', 'false'],
    ['hw.audioInput', 'yes'],
    ['hw.battery', 'yes'],
    ['hw.camera.back', 'virtualscene'],
    ['hw.camera.front', 'emulated'],
    ['hw.cpu.arch', arch],
    ['hw.cpu.ncore', '4'],
    ['hw.dPad', 'no'],
    ['hw.device.manufacturer', 'Google'],
    ['hw.device.name', 'pixel_9'],
    ['hw.gps', 'yes'],
    ['hw.gpu.enabled', 'yes'],
    ['hw.gpu.mode', 'auto'],
    ['hw.initialOrientation', 'Portrait'],
    ['hw.keyboard', 'yes'],
    ['hw.lcd.density', '420'],
    ['hw.lcd.height', '2400'],
    ['hw.lcd.width', '1080'],
    ['hw.mainKeys', 'no'],
    ['hw.ramSize', '1536'],
    ['hw.sdCard', 'yes'],
    ['hw.sensors.orientation', 'yes'],
    ['hw.sensors.proximity', 'yes'],
    ['hw.trackBall', 'no'],
    ['image.sysdir.1', systemImage.location],
    ['runtime.network.latency', 'none'],
    ['runtime.network.speed', 'full'],
    ['sdcard.size', '512M'],
    ['showDeviceFrame', 'no'],
    ['tag.display', 'Google Play'],
    ['tag.id', 'google_apis_playstore'],
    ['vm.heapSize', '228']
  ]

  const configIniContent = configIniData.map(([k, v]) => `${k}=${v}`).join('\n')
  await fsPromises.writeFile(configIni, configIniContent, 'utf-8')

  return avdId
}
