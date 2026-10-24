#version 450
#extension GL_GOOGLE_include_directive : require
#include "common.glsl"

// The bed texture quad over the printable area.
layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec2 inUV;
layout(location = 0) out vec2 outUV;

void main() {
  gl_Position = clipPosition(inPosition + u.modelOffset.xyz);
  outUV = inUV;
}
