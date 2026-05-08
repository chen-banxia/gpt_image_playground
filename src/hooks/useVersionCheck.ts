export interface LatestRelease {
  tag: string
  url: string
}

export function useVersionCheck() {
  return {
    hasUpdate: false,
    latestRelease: null as LatestRelease | null,
    dismiss: () => {},
  }
}
