package com.margelo.nitro.orca

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.Surface
import android.view.TextureView
import android.view.ViewConfiguration
import kotlin.math.hypot

/**
 * The Vulkan surface with the camera gestures, the counterpart of the Swift OrcaViewportView.
 *
 * A TextureView rather than a SurfaceView: it composes like any other view, so React
 * Native's transforms, clipping and screen transitions apply to it, at the cost of one
 * extra composition copy.
 *
 * Gestures match iOS: one finger orbits, or drags the selected object when it starts on
 * it; two fingers pan; a pinch zooms; a double tap fits; a single tap is reported for
 * picking. Coordinates go to the controller in dp, which is what iOS points are.
 */
@SuppressLint("ViewConstructor")
class OrcaViewportView(context: Context, private val renderer: OrcaViewportRenderer) :
  TextureView(context), TextureView.SurfaceTextureListener {

  /** Called on a short single tap, with the point in dp from the view's top-left. */
  var onSingleTap: ((x: Float, y: Float) -> Unit)? = null

  private val density = resources.displayMetrics.density
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var surface: Surface? = null

  private enum class Gesture { NONE, PENDING, ORBIT, DRAG, MULTI }
  private var gesture = Gesture.NONE
  private var downX = 0f
  private var downY = 0f
  private var lastX = 0f
  private var lastY = 0f

  // A single tap waits for the double-tap timeout, so a two-tap fit does not also pick,
  // as on iOS where the single tap requires the double tap to fail.
  private val taps = GestureDetector(
    context,
    object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true
      override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
        onSingleTap?.invoke(e.x / density, e.y / density)
        return true
      }
      override fun onDoubleTap(e: MotionEvent): Boolean {
        renderer.fit()
        return true
      }
    },
  )

  private val pinch = ScaleGestureDetector(
    context,
    object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
      override fun onScale(detector: ScaleGestureDetector): Boolean {
        renderer.zoomBy(detector.scaleFactor)
        return true
      }
    },
  )

  init {
    isOpaque = true
    surfaceTextureListener = this
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    renderer.setViewSize(w / density, h / density)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent): Boolean {
    pinch.onTouchEvent(event)
    taps.onTouchEvent(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        gesture = Gesture.PENDING
        downX = event.x
        downY = event.y
        lastX = event.x
        lastY = event.y
      }
      MotionEvent.ACTION_POINTER_DOWN -> {
        // A second finger turns the gesture into pan and pinch until every finger lifts.
        if (gesture == Gesture.DRAG) renderer.endDrag()
        gesture = Gesture.MULTI
        lastX = focusX(event)
        lastY = focusY(event)
      }
      MotionEvent.ACTION_POINTER_UP -> {
        // Continue the pan from the remaining fingers' centre, not the lifted one's.
        lastX = focusX(event, event.actionIndex)
        lastY = focusY(event, event.actionIndex)
      }
      MotionEvent.ACTION_MOVE -> onMove(event)
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        // A scrolling parent that takes the touch over cancels it; a drag in flight
        // still commits, as an iOS pan that fails does.
        if (gesture == Gesture.DRAG) renderer.endDrag()
        gesture = Gesture.NONE
      }
    }
    return true
  }

  private fun onMove(event: MotionEvent) {
    when (gesture) {
      Gesture.PENDING -> {
        if (hypot(event.x - downX, event.y - downY) < touchSlop) return
        // Drag the selected object when the finger landed on it, otherwise orbit.
        val selected = renderer.selectedId
        val x = downX / density
        val y = downY / density
        gesture = if (selected != 0L && renderer.pickObject(x, y) == selected && renderer.beginDrag(selected, x, y)) {
          Gesture.DRAG
        } else {
          Gesture.ORBIT
        }
        lastX = event.x
        lastY = event.y
        if (gesture == Gesture.DRAG) renderer.dragTo(event.x / density, event.y / density)
      }
      Gesture.ORBIT -> {
        renderer.orbitBy((event.x - lastX) / density, (event.y - lastY) / density)
        lastX = event.x
        lastY = event.y
      }
      Gesture.DRAG -> renderer.dragTo(event.x / density, event.y / density)
      Gesture.MULTI -> {
        // One finger left of a pan does nothing, as iOS's two-finger pan ends.
        if (event.pointerCount < 2) return
        val x = focusX(event)
        val y = focusY(event)
        renderer.panBy((x - lastX) / density, (y - lastY) / density)
        lastX = x
        lastY = y
      }
      Gesture.NONE -> Unit
    }
  }

  // The centre of the fingers on screen, leaving out `skip` (one that is lifting).
  private fun focusX(event: MotionEvent, skip: Int = -1) = focus(event, skip) { event.getX(it) }
  private fun focusY(event: MotionEvent, skip: Int = -1) = focus(event, skip) { event.getY(it) }
  private inline fun focus(event: MotionEvent, skip: Int, coordinate: (Int) -> Float): Float {
    var sum = 0f
    var count = 0
    for (i in 0 until event.pointerCount) {
      if (i == skip) continue
      sum += coordinate(i)
      count++
    }
    return if (count > 0) sum / count else 0f
  }

  override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
    val s = Surface(texture)
    surface = s
    renderer.setSurface(s)
  }

  override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
    renderer.surfaceResized()
  }

  override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
    renderer.releaseSurface()
    surface?.release()
    surface = null
    return true
  }

  override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit
}
