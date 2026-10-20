// The JNI side of OrcaViewportRenderer.kt: one native object per view, owning the Vulkan
// renderer and, through it, the shared viewport controller. Every call arrives on the UI
// thread, which is also where the controller's redraw requests are sent back to Kotlin.

#include "VulkanViewportRenderer.hpp"

#include <android/bitmap.h>
#include <android/native_window_jni.h>
#include <jni.h>

#include <memory>

using orca::viewport::ColorMode;
using orca::viewport::Mode;
using orca::viewport::ObjectTool;
using orca::viewport::VulkanViewportRenderer;

namespace {

struct NativeViewport {
  JavaVM* vm = nullptr;
  jobject owner = nullptr; // global reference to the Kotlin OrcaViewportRenderer
  jmethodID requestRender = nullptr;
  std::unique_ptr<VulkanViewportRenderer> renderer;
};

NativeViewport* from(jlong handle) {
  return reinterpret_cast<NativeViewport*>(handle);
}

orca::viewport::ViewportController& controller(jlong handle) {
  return from(handle)->renderer->controller();
}

} // namespace

#define ORCA_JNI(ret, name) extern "C" JNIEXPORT ret JNICALL Java_com_margelo_nitro_orca_OrcaViewportRenderer_##name

// Returns 0 when the device has no usable Vulkan, in which case the view stays a placeholder.
ORCA_JNI(jlong, nativeCreate)(JNIEnv* env, jobject thiz) {
  auto native = std::make_unique<NativeViewport>();
  env->GetJavaVM(&native->vm);
  native->owner = env->NewGlobalRef(thiz);
  native->requestRender = env->GetMethodID(env->GetObjectClass(thiz), "requestRender", "()V");
  NativeViewport* raw = native.get();
  native->renderer = VulkanViewportRenderer::create([raw] {
    JNIEnv* e = nullptr;
    if (raw->vm->GetEnv(reinterpret_cast<void**>(&e), JNI_VERSION_1_6) == JNI_OK) e->CallVoidMethod(raw->owner, raw->requestRender);
  });
  if (!native->renderer) {
    env->DeleteGlobalRef(native->owner);
    return 0;
  }
  return reinterpret_cast<jlong>(native.release());
}

ORCA_JNI(void, nativeDestroy)(JNIEnv* env, jobject, jlong handle) {
  NativeViewport* native = from(handle);
  native->renderer.reset();
  env->DeleteGlobalRef(native->owner);
  delete native;
}

ORCA_JNI(jboolean, nativeSetSurface)(JNIEnv* env, jobject, jlong handle, jobject surface) {
  ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
  if (window == nullptr) return JNI_FALSE;
  const bool ok = from(handle)->renderer->setWindow(window);
  ANativeWindow_release(window); // setWindow holds its own reference
  return ok ? JNI_TRUE : JNI_FALSE;
}

ORCA_JNI(void, nativeSurfaceResized)(JNIEnv*, jobject, jlong handle) {
  from(handle)->renderer->windowResized();
}

ORCA_JNI(void, nativeReleaseSurface)(JNIEnv*, jobject, jlong handle) {
  from(handle)->renderer->releaseWindow();
}

ORCA_JNI(void, nativeDraw)(JNIEnv*, jobject, jlong handle) {
  from(handle)->renderer->draw();
}

ORCA_JNI(void, nativeSetViewSize)(JNIEnv*, jobject, jlong handle, jfloat width, jfloat height) {
  controller(handle).setViewSize(width, height);
}

ORCA_JNI(void, nativeSetSessionId)(JNIEnv*, jobject, jlong handle, jlong id) {
  controller(handle).setSessionId(static_cast<uint64_t>(id));
}

ORCA_JNI(void, nativeSetMode)(JNIEnv*, jobject, jlong handle, jint mode) {
  controller(handle).setMode(mode == 1 ? Mode::Preview : Mode::Scene);
}

ORCA_JNI(void, nativeSetMinLayer)(JNIEnv*, jobject, jlong handle, jlong layer) {
  controller(handle).setMinLayer(static_cast<long>(layer));
}

ORCA_JNI(void, nativeSetMaxLayer)(JNIEnv*, jobject, jlong handle, jlong layer) {
  controller(handle).setMaxLayer(static_cast<long>(layer));
}

ORCA_JNI(void, nativeSetMaxTime)(JNIEnv*, jobject, jlong handle, jfloat seconds) {
  controller(handle).setMaxTime(seconds);
}

ORCA_JNI(void, nativeSetShowTravels)(JNIEnv*, jobject, jlong handle, jboolean show) {
  controller(handle).setShowTravels(show);
}

ORCA_JNI(void, nativeSetShowRetractions)(JNIEnv*, jobject, jlong handle, jboolean show) {
  controller(handle).setShowRetractions(show);
}

ORCA_JNI(void, nativeSetShowWipes)(JNIEnv*, jobject, jlong handle, jboolean show) {
  controller(handle).setShowWipes(show);
}

// 0 feature, 1 speed, 2 flow, 3 layer time, 4 tool: ColorMode's order.
ORCA_JNI(void, nativeSetColorMode)(JNIEnv*, jobject, jlong handle, jint mode) {
  controller(handle).setColorMode(static_cast<ColorMode>(mode));
}

ORCA_JNI(void, nativeSetSelectedId)(JNIEnv*, jobject, jlong handle, jlong id) {
  controller(handle).setSelectedId(static_cast<uint64_t>(id));
}

ORCA_JNI(jlong, nativeSelectedId)(JNIEnv*, jobject, jlong handle) {
  return static_cast<jlong>(controller(handle).selectedId());
}

ORCA_JNI(void, nativeReload)(JNIEnv*, jobject, jlong handle) {
  controller(handle).reload();
}

ORCA_JNI(void, nativeFit)(JNIEnv*, jobject, jlong handle) {
  controller(handle).fit();
}

ORCA_JNI(void, nativeOrbit)(JNIEnv*, jobject, jlong handle, jfloat dx, jfloat dy) {
  controller(handle).orbitBy(dx, dy);
}

ORCA_JNI(void, nativePan)(JNIEnv*, jobject, jlong handle, jfloat dx, jfloat dy) {
  controller(handle).panBy(dx, dy);
}

ORCA_JNI(void, nativeZoom)(JNIEnv*, jobject, jlong handle, jfloat factor) {
  controller(handle).zoomBy(factor);
}

// Writes origin xyz then direction xyz into `out`, which holds six floats.
ORCA_JNI(jboolean, nativeScreenToRay)(JNIEnv* env, jobject, jlong handle, jfloat x, jfloat y, jfloatArray out) {
  orca::viewport::float3 origin, direction;
  if (!controller(handle).screenToRay(x, y, origin, direction)) return JNI_FALSE;
  const jfloat values[6] = {origin.x, origin.y, origin.z, direction.x, direction.y, direction.z};
  env->SetFloatArrayRegion(out, 0, 6, values);
  return JNI_TRUE;
}

ORCA_JNI(jlong, nativePickObject)(JNIEnv*, jobject, jlong handle, jfloat x, jfloat y) {
  return static_cast<jlong>(controller(handle).pickObject(x, y));
}

// 0 move, 1 rotate, 2 scale: ObjectTool's order.
ORCA_JNI(void, nativeSetObjectTool)(JNIEnv*, jobject, jlong handle, jint tool) {
  controller(handle).setObjectTool(static_cast<ObjectTool>(tool));
}

ORCA_JNI(jboolean, nativeBeginDrag)(JNIEnv*, jobject, jlong handle, jlong objectId, jfloat x, jfloat y) {
  return controller(handle).beginDrag(static_cast<uint64_t>(objectId), x, y) ? JNI_TRUE : JNI_FALSE;
}

ORCA_JNI(void, nativeDragTo)(JNIEnv*, jobject, jlong handle, jfloat x, jfloat y) {
  controller(handle).dragTo(x, y);
}

ORCA_JNI(void, nativeEndDrag)(JNIEnv*, jobject, jlong handle) {
  controller(handle).endDrag();
}

ORCA_JNI(jboolean, nativeIsDragging)(JNIEnv*, jobject, jlong handle) {
  return controller(handle).isDragging() ? JNI_TRUE : JNI_FALSE;
}

// The image the printer's bed texture names, or null when it has none.
ORCA_JNI(jstring, nativeBedTexturePath)(JNIEnv* env, jobject, jlong handle) {
  const std::string& path = controller(handle).scene().bedTexturePath;
  return path.empty() ? nullptr : env->NewStringUTF(path.c_str());
}

// An ARGB_8888 bitmap, or null to clear the texture.
ORCA_JNI(void, nativeSetBedTexture)(JNIEnv* env, jobject, jlong handle, jobject bitmap) {
  VulkanViewportRenderer& renderer = *from(handle)->renderer;
  AndroidBitmapInfo info;
  void* pixels = nullptr;
  if (bitmap == nullptr || AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS) {
    renderer.clearBedTexture();
    return;
  }
  renderer.setBedTexture(static_cast<const uint8_t*>(pixels), info.width, info.height, info.stride);
  AndroidBitmap_unlockPixels(env, bitmap);
}
