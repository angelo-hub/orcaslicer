import { getOrcaCore, type OrcaSession } from 'react-native-orca-core'
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { deviceLanguage, setLanguage } from './i18n'
import { dataDirectory, ensureDirectories, nativePath, resourcesDirectory } from './profiles'

// One session for the app. The native core is initialized once with the app's
// directories, then a session is created and its presets loaded.

export interface CoreState {
  version: string
  session: OrcaSession | null
  /** Error text from loading presets, empty when fine. */
  presetError: string
  ready: boolean
  /** Re-reads the profiles from disk, e.g. after installing a vendor. */
  reloadPresets: () => Promise<void>
}

const CoreContext = createContext<CoreState | null>(null)

export function CoreProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const core = useMemo(() => getOrcaCore(), [])
  const [session, setSession] = useState<OrcaSession | null>(null)
  const [presetError, setPresetError] = useState('')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setLanguage(deviceLanguage())
    ensureDirectories()
    core.initialize(nativePath(resourcesDirectory()), nativePath(dataDirectory()))
    const created = core.createSession()
    setSession(created)
    created
      .loadPresets()
      .then((error) => setPresetError(error))
      .catch((error: unknown) => setPresetError(String(error)))
      .finally(() => setReady(true))
  }, [core])

  const value = useMemo<CoreState>(
    () => ({
      version: core.version,
      session,
      presetError,
      ready,
      reloadPresets: async () => {
        if (session === null) return
        // reloadPresets wipes data/system before rereading so a fresh
        // vendor install (or a reinstall over a corrupt file) really
        // takes effect, unlike loadPresets which skips a same-version
        // reinstall and leaves the mirror as-is.
        setPresetError(await session.reloadPresets())
      },
    }),
    [core, session, presetError, ready]
  )

  return <CoreContext.Provider value={value}>{children}</CoreContext.Provider>
}

export function useCore(): CoreState {
  const state = useContext(CoreContext)
  if (state === null) {
    throw new Error('useCore() needs a CoreProvider above it')
  }
  return state
}

/** The session, once the provider created it. Screens render nothing until then. */
export function useSession(): OrcaSession | null {
  return useCore().session
}
