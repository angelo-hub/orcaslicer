package com.margelo.nitro.orca

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import androidx.annotation.Keep
import com.caverock.androidsvg.SVG
import com.facebook.proguard.annotations.DoNotStrip
import java.io.File
import java.util.concurrent.Executors

/**
 * The Kotlin handle on the native Vulkan renderer (VulkanViewportRenderer.cpp), which owns
 * the platform-neutral viewport controller shared with iOS. Draws on demand: the
 * controller asks for a frame through [requestRender], and the request is coalesced onto
 * the next Choreographer frame, the counterpart of MTKView's setNeedsDisplay.
 *
 * Every method runs on the UI thread.
 */
class OrcaViewportRenderer private constructor() {
  private var handle = 0L
  private var framePending = false
  private val frameCallback = Choreographer.FrameCallback {
    framePending = false
    if (handle != 0L) nativeDraw(handle)
  }
  private var bedTexturePath: String? = null

  /** Asks for one frame. Called by the native controller whenever what it shows changed. */
  @DoNotStrip
  @Keep
  fun requestRender() {
    if (framePending || handle == 0L) return
    framePending = true
    Choreographer.getInstance().postFrameCallback(frameCallback)
  }

  fun release() {
    if (handle == 0L) return
    if (framePending) Choreographer.getInstance().removeFrameCallback(frameCallback)
    framePending = false
    nativeDestroy(handle)
    handle = 0L
  }

  // Surface lifecycle, from the TextureView.
  fun setSurface(surface: Surface) {
    if (handle != 0L && nativeSetSurface(handle, surface)) requestRender()
  }
  fun surfaceResized() {
    if (handle == 0L) return
    nativeSurfaceResized(handle)
    requestRender()
  }
  fun releaseSurface() {
    if (handle != 0L) nativeReleaseSurface(handle)
  }

  /** The view's size in dp, the unit touch coordinates are given to the controller in. */
  fun setViewSize(width: Float, height: Float) = ifLive { nativeSetViewSize(it, width, height) }

  fun setSessionId(id: Long) = ifLive { nativeSetSessionId(it, id) }
  fun setMode(mode: ViewportMode) = ifLive { nativeSetMode(it, if (mode == ViewportMode.PREVIEW) 1 else 0) }
  fun setMinLayer(layer: Long) = ifLive { nativeSetMinLayer(it, layer) }
  fun setMaxLayer(layer: Long) = ifLive { nativeSetMaxLayer(it, layer) }
  fun setMaxTime(seconds: Float) = ifLive { nativeSetMaxTime(it, seconds) }
  fun setShowTravels(show: Boolean) = ifLive { nativeSetShowTravels(it, show) }
  fun setShowRetractions(show: Boolean) = ifLive { nativeSetShowRetractions(it, show) }
  fun setShowWipes(show: Boolean) = ifLive { nativeSetShowWipes(it, show) }
  fun setColorMode(mode: PreviewColorMode) = ifLive {
    nativeSetColorMode(
      it,
      when (mode) {
        PreviewColorMode.FEATURE -> 0
        PreviewColorMode.SPEED -> 1
        PreviewColorMode.FLOW -> 2
        PreviewColorMode.LAYERTIME -> 3
        PreviewColorMode.TOOL -> 4
      },
    )
  }
  var selectedId: Long
    get() = if (handle != 0L) nativeSelectedId(handle) else 0L
    set(value) = ifLive { nativeSetSelectedId(it, value) }

  /** Re-reads bed, objects and toolpath from the session and redraws. */
  fun reload() = ifLive {
    nativeReload(it)
    syncBedTexture()
  }
  fun fit() = ifLive { nativeFit(it) }
  fun orbitBy(dx: Float, dy: Float) = ifLive { nativeOrbit(it, dx, dy) }
  fun panBy(dx: Float, dy: Float) = ifLive { nativePan(it, dx, dy) }
  fun zoomBy(factor: Float) = ifLive { nativeZoom(it, factor) }

  /** Origin xyz then direction xyz, or null when the view has no size yet. */
  fun screenToRay(x: Float, y: Float): FloatArray? {
    if (handle == 0L) return null
    val out = FloatArray(6)
    return if (nativeScreenToRay(handle, x, y, out)) out else null
  }
  fun pickObject(x: Float, y: Float): Long = if (handle != 0L) nativePickObject(handle, x, y) else 0L
  fun setObjectTool(tool: ObjectTool) = ifLive {
    nativeSetObjectTool(
      it,
      when (tool) {
        ObjectTool.MOVE -> 0
        ObjectTool.ROTATE -> 1
        ObjectTool.SCALE -> 2
      },
    )
  }
  fun beginDrag(objectId: Long, x: Float, y: Float): Boolean = handle != 0L && nativeBeginDrag(handle, objectId, x, y)
  fun dragTo(x: Float, y: Float) = ifLive { nativeDragTo(it, x, y) }
  fun endDrag() = ifLive {
    nativeEndDrag(it)
    syncBedTexture()
  }
  val isDragging: Boolean
    get() = handle != 0L && nativeIsDragging(handle)

  private inline fun ifLive(block: (Long) -> Unit) {
    if (handle != 0L) block(handle)
  }

  // Decodes the bed texture the scene names, only when the path changed, so a slice does
  // not thrash it. Decoding runs off the UI thread; the plate draws without the texture
  // until it lands, and a result for a path no longer wanted is dropped.
  private fun syncBedTexture() {
    val path = nativeBedTexturePath(handle)
    if (path == bedTexturePath) return
    bedTexturePath = path
    nativeSetBedTexture(handle, null)
    if (path == null) return
    decoder.execute {
      val bitmap = decodeBedTexture(path)
      mainThread.post {
        if (handle != 0L && path == bedTexturePath && bitmap != null) {
          nativeSetBedTexture(handle, bitmap)
          requestRender()
        }
        bitmap?.recycle()
      }
    }
  }

  private external fun nativeCreate(): Long
  private external fun nativeDestroy(handle: Long)
  private external fun nativeSetSurface(handle: Long, surface: Surface): Boolean
  private external fun nativeSurfaceResized(handle: Long)
  private external fun nativeReleaseSurface(handle: Long)
  private external fun nativeDraw(handle: Long)
  private external fun nativeSetViewSize(handle: Long, width: Float, height: Float)
  private external fun nativeSetSessionId(handle: Long, id: Long)
  private external fun nativeSetMode(handle: Long, mode: Int)
  private external fun nativeSetMinLayer(handle: Long, layer: Long)
  private external fun nativeSetMaxLayer(handle: Long, layer: Long)
  private external fun nativeSetMaxTime(handle: Long, seconds: Float)
  private external fun nativeSetShowTravels(handle: Long, show: Boolean)
  private external fun nativeSetShowRetractions(handle: Long, show: Boolean)
  private external fun nativeSetShowWipes(handle: Long, show: Boolean)
  private external fun nativeSetColorMode(handle: Long, mode: Int)
  private external fun nativeSetSelectedId(handle: Long, id: Long)
  private external fun nativeSelectedId(handle: Long): Long
  private external fun nativeReload(handle: Long)
  private external fun nativeFit(handle: Long)
  private external fun nativeOrbit(handle: Long, dx: Float, dy: Float)
  private external fun nativePan(handle: Long, dx: Float, dy: Float)
  private external fun nativeZoom(handle: Long, factor: Float)
  private external fun nativeScreenToRay(handle: Long, x: Float, y: Float, out: FloatArray): Boolean
  private external fun nativePickObject(handle: Long, x: Float, y: Float): Long
  private external fun nativeSetObjectTool(handle: Long, tool: Int)
  private external fun nativeBeginDrag(handle: Long, objectId: Long, x: Float, y: Float): Boolean
  private external fun nativeDragTo(handle: Long, x: Float, y: Float)
  private external fun nativeEndDrag(handle: Long)
  private external fun nativeIsDragging(handle: Long): Boolean
  private external fun nativeBedTexturePath(handle: Long): String?
  private external fun nativeSetBedTexture(handle: Long, bitmap: Bitmap?)

  companion object {
    private const val TAG = "OrcaViewport"
    // Vendor SVG bed art is rasterized at the size the iOS backend snapshots it at.
    private const val SVG_SIZE = 1024

    private val decoder = Executors.newSingleThreadExecutor()
    private val mainThread = Handler(Looper.getMainLooper())

    init {
      NitroOrcaCoreOnLoad.initializeNative()
    }

    /** A renderer, or null when the device cannot run the Vulkan backend. */
    fun create(): OrcaViewportRenderer? {
      val renderer = OrcaViewportRenderer()
      renderer.handle = renderer.nativeCreate()
      return if (renderer.handle != 0L) renderer else null
    }

    // PNG and JPG through BitmapFactory; SVG, which vendors such as Qidi, Prusa and Voron
    // ship, through AndroidSVG.
    private fun decodeBedTexture(path: String): Bitmap? = try {
      if (path.endsWith(".svg", ignoreCase = true)) {
        val svg = File(path).inputStream().use { SVG.getFromInputStream(it) }
        Bitmap.createBitmap(SVG_SIZE, SVG_SIZE, Bitmap.Config.ARGB_8888).also {
          svg.renderToCanvas(Canvas(it), RectF(0f, 0f, SVG_SIZE.toFloat(), SVG_SIZE.toFloat()))
        }
      } else {
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.ARGB_8888 })
      }
    } catch (e: Exception) {
      Log.w(TAG, "bed texture load failed for $path", e)
      null
    }
  }
}
