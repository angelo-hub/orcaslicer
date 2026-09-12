import Foundation
import MetalKit
import NitroModules
import UIKit

/// The MTKView with the camera gestures. Gesture targets must be NSObjects, which the
/// Nitro spec base class is not, so the view owns them.
final class OrcaViewportView: MTKView {
  var renderer: OrcaViewportRenderer?
  private var lastPinchScale: CGFloat = 1

  override init(frame: CGRect, device: MTLDevice?) {
    super.init(frame: frame, device: device)
    isOpaque = true
    let orbit = UIPanGestureRecognizer(target: self, action: #selector(onOrbit(_:)))
    orbit.maximumNumberOfTouches = 1
    addGestureRecognizer(orbit)
    let pan = UIPanGestureRecognizer(target: self, action: #selector(onPan(_:)))
    pan.minimumNumberOfTouches = 2
    pan.maximumNumberOfTouches = 2
    addGestureRecognizer(pan)
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(onPinch(_:)))
    addGestureRecognizer(pinch)
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(onDoubleTap(_:)))
    doubleTap.numberOfTapsRequired = 2
    addGestureRecognizer(doubleTap)
  }

  required init(coder: NSCoder) {
    fatalError("init(coder:) is not supported")
  }

  @objc private func onOrbit(_ gesture: UIPanGestureRecognizer) {
    let delta = gesture.translation(in: self)
    renderer?.orbit(by: delta)
    gesture.setTranslation(.zero, in: self)
  }

  @objc private func onPan(_ gesture: UIPanGestureRecognizer) {
    let delta = gesture.translation(in: self)
    renderer?.pan(by: delta)
    gesture.setTranslation(.zero, in: self)
  }

  @objc private func onPinch(_ gesture: UIPinchGestureRecognizer) {
    if gesture.state == .began {
      lastPinchScale = 1
    }
    renderer?.zoom(by: gesture.scale / lastPinchScale)
    lastPinchScale = gesture.scale
  }

  @objc private func onDoubleTap(_ gesture: UITapGestureRecognizer) {
    renderer?.fit()
  }
}

/// The `OrcaViewport` Nitro View. Props arrive from React; geometry comes from the native
/// session the `sessionId` names, read by the renderer, so nothing crosses the JS bridge.
class HybridOrcaViewport: HybridOrcaViewportSpec {
  private let metalView = OrcaViewportView(frame: .zero, device: nil)
  private let renderer: OrcaViewportRenderer

  var view: UIView { metalView }

  var sessionId: Double = 0 {
    didSet {
      renderer.sessionId = sessionId > 0 ? UInt64(sessionId) : 0
      renderer.reload()
    }
  }

  var mode: ViewportMode = .scene {
    didSet {
      renderer.mode = mode == .preview ? .preview : .scene
      renderer.reload()
    }
  }

  var maxLayer: Double = -1 {
    didSet { renderer.maxLayer = Int(maxLayer) }
  }

  var showTravels: Bool = false {
    didSet { renderer.showTravels = showTravels }
  }

  var revision: Double = 0 {
    didSet { renderer.reload() }
  }

  override init() {
    renderer = OrcaViewportRenderer(view: metalView)
    super.init()
    metalView.renderer = renderer
  }

  func fit() throws {
    renderer.fit()
  }
}
