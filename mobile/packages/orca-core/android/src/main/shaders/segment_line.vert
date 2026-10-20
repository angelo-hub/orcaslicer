#version 450
#extension GL_GOOGLE_include_directive : require
#include "common.glsl"

// One instance per toolpath segment (orca::viewport::Segment), drawn as a line between
// its endpoints: travels, wipes and retraction ticks.
layout(location = 0) in vec3 inA;
layout(location = 1) in vec3 inB;
layout(location = 4) in vec4 inColor;
layout(location = 0) out vec4 outColor;

void main() {
  gl_Position = clipPosition(gl_VertexIndex == 0 ? inA : inB);
  outColor = inColor;
}
