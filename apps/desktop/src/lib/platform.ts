export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod|darwin/i.test(platform)
}

export function isWindowsPlatform(platform: string): boolean {
  return /^win(dows)?/i.test(platform)
}

export function isLinuxPlatform(platform: string): boolean {
  return /linux/i.test(platform)
}

export function getNavigatorPlatform(): string {
  if (typeof navigator === "undefined") return ""
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  return navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? ""
}
