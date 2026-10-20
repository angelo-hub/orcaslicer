package com.margelo.nitro.orca

import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.TextView
import com.facebook.react.uimanager.ThemedReactContext

/**
 * The `OrcaViewport` Nitro View on Android. Props arrive from React; geometry comes from
 * the native session the `sessionId` names, read by the renderer, so nothing crosses the
 * JS bridge. Without a usable Vulkan driver the view is a placeholder message.
 */
class HybridOrcaViewport(context: ThemedReactContext) : HybridOrcaViewportSpec() {
  private val renderer = OrcaViewportRenderer.create()

  override val view: View = renderer?.let { r ->
    OrcaViewportView(context, r).also { v ->
      v.onSingleTap = { x, y -> onTap?.invoke(x.toDouble(), y.toDouble()) }
    }
  } ?: TextView(context).apply {
    text = "The 3D view is not available on this device."
    gravity = Gravity.CENTER
    setTextColor(Color.rgb(0x5c, 0x63, 0x68))
    setBackgroundColor(Color.rgb(0xed, 0xf0, 0xf2))
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
    val padding = (24 * context.resources.displayMetrics.density).toInt()
    setPadding(padding, 0, padding, 0)
  }

  // A session, mode or revision change re-reads the scene once per React update, after
  // every prop of that update is set.
  private var needsReload = false

  override var sessionId: Double = 0.0
    set(value) {
      field = value
      renderer?.setSessionId(if (value > 0) value.toLong() else 0L)
      needsReload = true
    }

  override var mode: ViewportMode = ViewportMode.SCENE
    set(value) {
      field = value
      renderer?.setMode(value)
      needsReload = true
    }

  override var minLayer: Double = -1.0
    set(value) {
      field = value
      renderer?.setMinLayer(value.toLong())
    }

  override var maxLayer: Double = -1.0
    set(value) {
      field = value
      renderer?.setMaxLayer(value.toLong())
    }

  override var maxTime: Double = -1.0
    set(value) {
      field = value
      renderer?.setMaxTime(value.toFloat())
    }

  override var showTravels: Boolean = false
    set(value) {
      field = value
      renderer?.setShowTravels(value)
    }

  override var showRetractions: Boolean = false
    set(value) {
      field = value
      renderer?.setShowRetractions(value)
    }

  override var showWipes: Boolean = false
    set(value) {
      field = value
      renderer?.setShowWipes(value)
    }

  override var colorMode: PreviewColorMode = PreviewColorMode.FEATURE
    set(value) {
      field = value
      renderer?.setColorMode(value)
    }

  override var revision: Double = 0.0
    set(value) {
      field = value
      needsReload = true
    }

  override var onTap: ((x: Double, y: Double) -> Unit)? = null

  override fun afterUpdate() {
    if (!needsReload) return
    needsReload = false
    renderer?.reload()
  }

  override fun onDropView() {
    renderer?.release()
  }

  // The methods arrive on the JS thread, the props and gestures on the UI thread, and the
  // controller is not thread-safe: hop over.
  private val mainThread = Handler(Looper.getMainLooper())
  private fun onUiThread(block: (OrcaViewportRenderer) -> Unit) {
    val r = renderer ?: return
    if (Looper.myLooper() == Looper.getMainLooper()) block(r) else mainThread.post { block(r) }
  }

  override fun fit() = onUiThread { it.fit() }

  // Synchronous, so it runs on the calling thread; it only reads the camera.
  override fun screenToRay(x: Double, y: Double): PickRay {
    val ray = renderer?.screenToRay(x.toFloat(), y.toFloat())
      ?: return PickRay(0.0, 0.0, 0.0, 0.0, 0.0, -1.0)
    return PickRay(
      ray[0].toDouble(), ray[1].toDouble(), ray[2].toDouble(),
      ray[3].toDouble(), ray[4].toDouble(), ray[5].toDouble(),
    )
  }

  override fun setSelectedId(id: Double) = onUiThread { it.selectedId = if (id > 0) id.toLong() else 0L }

  override fun setObjectTool(tool: ObjectTool) = onUiThread { it.setObjectTool(tool) }
}
