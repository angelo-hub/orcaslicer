#include "NitroOrcaCoreOnLoad.hpp"

#include <fbjni/fbjni.h>
#include <jni.h>

// Registers the Hybrid Objects nitrogen autolinks (OrcaCore) when the Kotlin side loads
// the library; see NitroOrcaCoreOnLoad.kt.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() { margelo::nitro::orca::registerAllNatives(); });
}
