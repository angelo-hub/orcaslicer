package com.margelo.nitro.orca

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * The React package autolinking registers. It exports no TurboModules: the Hybrid Objects
 * are created by Nitro once the native library is loaded, which happens here.
 */
class NitroOrcaCorePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      NitroOrcaCoreOnLoad.initializeNative()
    }
  }
}
