#include "VulkanViewportRenderer.hpp"

#include "SessionRegistry.hpp"

#include <android/log.h>
#include <vulkan/vulkan_android.h>

#include <algorithm>
#include <array>
#include <cstring>

// Vulkan's create-info structs are initialised as `VkFooInfo info{VK_STRUCTURE_TYPE_FOO}`,
// leaving the remaining fields zero, which is what the API expects for anything unset.
#pragma clang diagnostic ignored "-Wmissing-field-initializers"

namespace orca::viewport {

namespace {

#define LOG_WARN(...) __android_log_print(ANDROID_LOG_WARN, "OrcaViewport", __VA_ARGS__)

// SPIR-V compiled from src/main/shaders at build time (see CMakeLists.txt).
const uint32_t kLineVert[] = {
#include "line.vert.inc"
};
const uint32_t kSegmentLineVert[] = {
#include "segment_line.vert.inc"
};
const uint32_t kRibbonVert[] = {
#include "ribbon.vert.inc"
};
const uint32_t kColorFrag[] = {
#include "color.frag.inc"
};
const uint32_t kMeshVert[] = {
#include "mesh.vert.inc"
};
const uint32_t kMeshFrag[] = {
#include "mesh.frag.inc"
};
const uint32_t kBedVert[] = {
#include "bed.vert.inc"
};
const uint32_t kBedFrag[] = {
#include "bed.frag.inc"
};

// 4x MSAA, which Vulkan requires every device to support for colour and depth.
constexpr VkSampleCountFlagBits kSampleCount = VK_SAMPLE_COUNT_4_BIT;
const VkClearColorValue kClearColor = {{0.93f, 0.94f, 0.95f, 1.f}};

VkDeviceSize alignUp(VkDeviceSize value, VkDeviceSize alignment) {
  return (value + alignment - 1) / alignment * alignment;
}

void transition(VkCommandBuffer cb, VkImage image, VkImageLayout from, VkImageLayout to, VkAccessFlags srcAccess,
                VkAccessFlags dstAccess, VkPipelineStageFlags srcStage, VkPipelineStageFlags dstStage) {
  VkImageMemoryBarrier barrier{VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER};
  barrier.oldLayout = from;
  barrier.newLayout = to;
  barrier.srcAccessMask = srcAccess;
  barrier.dstAccessMask = dstAccess;
  barrier.srcQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  barrier.dstQueueFamilyIndex = VK_QUEUE_FAMILY_IGNORED;
  barrier.image = image;
  barrier.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  vkCmdPipelineBarrier(cb, srcStage, dstStage, 0, 0, nullptr, 0, nullptr, 1, &barrier);
}

} // namespace

std::unique_ptr<VulkanViewportRenderer> VulkanViewportRenderer::create(ViewportController::RedrawRequest redraw) {
  std::unique_ptr<VulkanViewportRenderer> renderer(new VulkanViewportRenderer(std::move(redraw)));
  if (!renderer->initDevice() || !renderer->initPipelineObjects()) return nullptr;
  return renderer;
}

VulkanViewportRenderer::VulkanViewportRenderer(ViewportController::RedrawRequest redraw) : redraw_(std::move(redraw)) {
  controller_ = std::make_unique<ViewportController>(
      [](uint64_t id, const std::function<void(Slic3r::Mobile::Session&)>& fn) {
        return margelo::nitro::orca::SessionRegistry::with(id, fn);
      },
      redraw_);
}

VulkanViewportRenderer::~VulkanViewportRenderer() {
  if (device_ != VK_NULL_HANDLE) {
    vkDeviceWaitIdle(device_);
    releaseWindow();
    destroyRenderPassAndPipelines();
    for (Buffer* b : {&bedLineBuffer_, &bedModelBuffer_, &bedQuadBuffer_, &meshBuffer_, &extrusionBuffer_, &markerBuffer_, &uniformRing_})
      destroy(*b);
    destroy(bedTexture_);
    for (VkShaderModule module : shaderModules_) vkDestroyShaderModule(device_, module, nullptr);
    vkDestroySampler(device_, sampler_, nullptr);
    vkDestroyDescriptorPool(device_, descriptorPool_, nullptr);
    vkDestroyPipelineLayout(device_, pipelineLayout_, nullptr);
    vkDestroyDescriptorSetLayout(device_, uniformLayout_, nullptr);
    vkDestroyDescriptorSetLayout(device_, textureLayout_, nullptr);
    vkDestroySemaphore(device_, imageAvailable_, nullptr);
    vkDestroyFence(device_, frameFence_, nullptr);
    vkDestroyCommandPool(device_, commandPool_, nullptr);
    vkDestroyDevice(device_, nullptr);
  }
  if (instance_ != VK_NULL_HANDLE) vkDestroyInstance(instance_, nullptr);
}

bool VulkanViewportRenderer::initDevice() {
  VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
  app.pApplicationName = "Orca Mobile";
  app.apiVersion = VK_API_VERSION_1_0;
  const char* instanceExtensions[] = {VK_KHR_SURFACE_EXTENSION_NAME, VK_KHR_ANDROID_SURFACE_EXTENSION_NAME};
  VkInstanceCreateInfo instanceInfo{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
  instanceInfo.pApplicationInfo = &app;
  instanceInfo.enabledExtensionCount = 2;
  instanceInfo.ppEnabledExtensionNames = instanceExtensions;
#ifndef NDEBUG
  // The validation layer logs to logcat on its own; it is only present when a debug
  // build packages it, so ask for it only if the loader can see it.
  const char* validation = "VK_LAYER_KHRONOS_validation";
  uint32_t layerCount = 0;
  vkEnumerateInstanceLayerProperties(&layerCount, nullptr);
  std::vector<VkLayerProperties> layers(layerCount);
  vkEnumerateInstanceLayerProperties(&layerCount, layers.data());
  if (std::any_of(layers.begin(), layers.end(), [&](const VkLayerProperties& l) { return std::strcmp(l.layerName, validation) == 0; })) {
    instanceInfo.enabledLayerCount = 1;
    instanceInfo.ppEnabledLayerNames = &validation;
  }
#endif
  if (vkCreateInstance(&instanceInfo, nullptr, &instance_) != VK_SUCCESS) {
    LOG_WARN("vkCreateInstance failed; the viewport stays a placeholder");
    return false;
  }

  uint32_t deviceCount = 0;
  vkEnumeratePhysicalDevices(instance_, &deviceCount, nullptr);
  std::vector<VkPhysicalDevice> devices(deviceCount);
  vkEnumeratePhysicalDevices(instance_, &deviceCount, devices.data());
  for (VkPhysicalDevice candidate : devices) {
    uint32_t familyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, nullptr);
    std::vector<VkQueueFamilyProperties> families(familyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(candidate, &familyCount, families.data());
    for (uint32_t i = 0; i < familyCount; ++i) {
      if (families[i].queueFlags & VK_QUEUE_GRAPHICS_BIT) {
        physicalDevice_ = candidate;
        queueFamily_ = i;
        break;
      }
    }
    if (physicalDevice_ != VK_NULL_HANDLE) break;
  }
  if (physicalDevice_ == VK_NULL_HANDLE) {
    LOG_WARN("no Vulkan device with a graphics queue");
    return false;
  }
  vkGetPhysicalDeviceMemoryProperties(physicalDevice_, &memoryProperties_);
  VkPhysicalDeviceProperties properties;
  vkGetPhysicalDeviceProperties(physicalDevice_, &properties);
  uniformAlignment_ = std::max<VkDeviceSize>(properties.limits.minUniformBufferOffsetAlignment, 16);

  for (VkFormat format : {VK_FORMAT_D32_SFLOAT, VK_FORMAT_X8_D24_UNORM_PACK32, VK_FORMAT_D24_UNORM_S8_UINT, VK_FORMAT_D16_UNORM}) {
    VkFormatProperties props;
    vkGetPhysicalDeviceFormatProperties(physicalDevice_, format, &props);
    if (props.optimalTilingFeatures & VK_FORMAT_FEATURE_DEPTH_STENCIL_ATTACHMENT_BIT) {
      depthFormat_ = format;
      break;
    }
  }

  const float priority = 1.f;
  VkDeviceQueueCreateInfo queueInfo{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
  queueInfo.queueFamilyIndex = queueFamily_;
  queueInfo.queueCount = 1;
  queueInfo.pQueuePriorities = &priority;
  const char* deviceExtensions[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
  VkDeviceCreateInfo deviceInfo{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
  deviceInfo.queueCreateInfoCount = 1;
  deviceInfo.pQueueCreateInfos = &queueInfo;
  deviceInfo.enabledExtensionCount = 1;
  deviceInfo.ppEnabledExtensionNames = deviceExtensions;
  if (vkCreateDevice(physicalDevice_, &deviceInfo, nullptr, &device_) != VK_SUCCESS) {
    LOG_WARN("vkCreateDevice failed");
    return false;
  }
  vkGetDeviceQueue(device_, queueFamily_, 0, &queue_);

  VkCommandPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO};
  poolInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
  poolInfo.queueFamilyIndex = queueFamily_;
  vkCreateCommandPool(device_, &poolInfo, nullptr, &commandPool_);
  VkCommandBufferAllocateInfo allocInfo{VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO};
  allocInfo.commandPool = commandPool_;
  allocInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
  allocInfo.commandBufferCount = 1;
  vkAllocateCommandBuffers(device_, &allocInfo, &commandBuffer_);
  VkFenceCreateInfo fenceInfo{VK_STRUCTURE_TYPE_FENCE_CREATE_INFO};
  fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;
  vkCreateFence(device_, &fenceInfo, nullptr, &frameFence_);
  VkSemaphoreCreateInfo semaphoreInfo{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
  vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &imageAvailable_);
  return depthFormat_ != VK_FORMAT_UNDEFINED;
}

bool VulkanViewportRenderer::initPipelineObjects() {
  VkDescriptorSetLayoutBinding uniformBinding{0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC, 1,
                                              VK_SHADER_STAGE_VERTEX_BIT | VK_SHADER_STAGE_FRAGMENT_BIT, nullptr};
  VkDescriptorSetLayoutCreateInfo layoutInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_LAYOUT_CREATE_INFO};
  layoutInfo.bindingCount = 1;
  layoutInfo.pBindings = &uniformBinding;
  vkCreateDescriptorSetLayout(device_, &layoutInfo, nullptr, &uniformLayout_);
  VkDescriptorSetLayoutBinding textureBinding{0, VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1, VK_SHADER_STAGE_FRAGMENT_BIT, nullptr};
  layoutInfo.pBindings = &textureBinding;
  vkCreateDescriptorSetLayout(device_, &layoutInfo, nullptr, &textureLayout_);

  // One layout for every pipeline; only the bed pipeline reads set 1.
  const VkDescriptorSetLayout setLayouts[] = {uniformLayout_, textureLayout_};
  VkPipelineLayoutCreateInfo pipelineLayoutInfo{VK_STRUCTURE_TYPE_PIPELINE_LAYOUT_CREATE_INFO};
  pipelineLayoutInfo.setLayoutCount = 2;
  pipelineLayoutInfo.pSetLayouts = setLayouts;
  vkCreatePipelineLayout(device_, &pipelineLayoutInfo, nullptr, &pipelineLayout_);

  const VkDescriptorPoolSize poolSizes[] = {{VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC, 1}, {VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 1}};
  VkDescriptorPoolCreateInfo poolInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_POOL_CREATE_INFO};
  poolInfo.maxSets = 2;
  poolInfo.poolSizeCount = 2;
  poolInfo.pPoolSizes = poolSizes;
  vkCreateDescriptorPool(device_, &poolInfo, nullptr, &descriptorPool_);
  VkDescriptorSetAllocateInfo setInfo{VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO};
  setInfo.descriptorPool = descriptorPool_;
  setInfo.descriptorSetCount = 2;
  setInfo.pSetLayouts = setLayouts;
  VkDescriptorSet sets[2];
  if (vkAllocateDescriptorSets(device_, &setInfo, sets) != VK_SUCCESS) return false;
  uniformSet_ = sets[0];
  textureSet_ = sets[1];

  VkSamplerCreateInfo samplerInfo{VK_STRUCTURE_TYPE_SAMPLER_CREATE_INFO};
  samplerInfo.magFilter = VK_FILTER_LINEAR;
  samplerInfo.minFilter = VK_FILTER_LINEAR;
  samplerInfo.mipmapMode = VK_SAMPLER_MIPMAP_MODE_LINEAR;
  samplerInfo.addressModeU = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
  samplerInfo.addressModeV = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
  samplerInfo.addressModeW = VK_SAMPLER_ADDRESS_MODE_CLAMP_TO_EDGE;
  samplerInfo.maxLod = 0.f;
  vkCreateSampler(device_, &samplerInfo, nullptr, &sampler_);

  reserveUniforms(16);
  return true;
}

uint32_t VulkanViewportRenderer::memoryType(uint32_t typeBits, VkMemoryPropertyFlags required, VkMemoryPropertyFlags preferred) const {
  uint32_t fallback = UINT32_MAX;
  for (uint32_t i = 0; i < memoryProperties_.memoryTypeCount; ++i) {
    if (!(typeBits & (1u << i))) continue;
    const VkMemoryPropertyFlags flags = memoryProperties_.memoryTypes[i].propertyFlags;
    if ((flags & required) != required) continue;
    if ((flags & preferred) == preferred) return i;
    if (fallback == UINT32_MAX) fallback = i;
  }
  return fallback;
}

// Host-visible, and device-local where the GPU has such a heap, which every unified-
// memory Android GPU does: the upload is a memcpy, like Metal's shared storage, with no
// staging copy doubling a large toolpath's footprint while it uploads.
VulkanViewportRenderer::Buffer VulkanViewportRenderer::makeBuffer(const void* data, VkDeviceSize size, VkBufferUsageFlags usage) {
  Buffer out;
  if (size == 0) return out;
  VkBufferCreateInfo info{VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO};
  info.size = size;
  info.usage = usage;
  info.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  if (vkCreateBuffer(device_, &info, nullptr, &out.buffer) != VK_SUCCESS) return Buffer{};
  VkMemoryRequirements requirements;
  vkGetBufferMemoryRequirements(device_, out.buffer, &requirements);
  VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
  alloc.allocationSize = requirements.size;
  alloc.memoryTypeIndex = memoryType(requirements.memoryTypeBits, VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT,
                                     VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT);
  if (alloc.memoryTypeIndex == UINT32_MAX || vkAllocateMemory(device_, &alloc, nullptr, &out.memory) != VK_SUCCESS) {
    LOG_WARN("could not allocate a %llu-byte buffer", static_cast<unsigned long long>(size));
    vkDestroyBuffer(device_, out.buffer, nullptr);
    return Buffer{};
  }
  vkBindBufferMemory(device_, out.buffer, out.memory, 0);
  vkMapMemory(device_, out.memory, 0, VK_WHOLE_SIZE, 0, &out.mapped);
  if (data != nullptr) std::memcpy(out.mapped, data, size);
  out.size = size;
  return out;
}

void VulkanViewportRenderer::destroy(Buffer& buffer) {
  if (buffer.buffer != VK_NULL_HANDLE) vkDestroyBuffer(device_, buffer.buffer, nullptr);
  if (buffer.memory != VK_NULL_HANDLE) vkFreeMemory(device_, buffer.memory, nullptr);
  buffer = Buffer{};
}

VulkanViewportRenderer::Image VulkanViewportRenderer::makeAttachment(VkFormat format, VkImageUsageFlags usage, VkImageAspectFlags aspect) {
  Image out;
  VkImageCreateInfo info{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
  info.imageType = VK_IMAGE_TYPE_2D;
  info.format = format;
  info.extent = {extent_.width, extent_.height, 1};
  info.mipLevels = 1;
  info.arrayLayers = 1;
  info.samples = kSampleCount;
  info.tiling = VK_IMAGE_TILING_OPTIMAL;
  info.usage = usage | VK_IMAGE_USAGE_TRANSIENT_ATTACHMENT_BIT;
  info.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  vkCreateImage(device_, &info, nullptr, &out.image);
  VkMemoryRequirements requirements;
  vkGetImageMemoryRequirements(device_, out.image, &requirements);
  VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
  alloc.allocationSize = requirements.size;
  alloc.memoryTypeIndex = memoryType(requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, VK_MEMORY_PROPERTY_LAZILY_ALLOCATED_BIT);
  vkAllocateMemory(device_, &alloc, nullptr, &out.memory);
  vkBindImageMemory(device_, out.image, out.memory, 0);
  VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
  viewInfo.image = out.image;
  viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
  viewInfo.format = format;
  viewInfo.subresourceRange = {aspect, 0, 1, 0, 1};
  vkCreateImageView(device_, &viewInfo, nullptr, &out.view);
  return out;
}

void VulkanViewportRenderer::destroy(Image& image) {
  if (image.view != VK_NULL_HANDLE) vkDestroyImageView(device_, image.view, nullptr);
  if (image.image != VK_NULL_HANDLE) vkDestroyImage(device_, image.image, nullptr);
  if (image.memory != VK_NULL_HANDLE) vkFreeMemory(device_, image.memory, nullptr);
  image = Image{};
}

void VulkanViewportRenderer::reserveUniforms(std::size_t count) {
  if (count <= uniformCapacity_) return;
  const std::size_t capacity = std::max<std::size_t>(count, uniformCapacity_ * 2);
  destroy(uniformRing_);
  uniformRing_ = makeBuffer(nullptr, alignUp(sizeof(Uniforms), uniformAlignment_) * capacity, VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT);
  uniformCapacity_ = uniformRing_.buffer != VK_NULL_HANDLE ? capacity : 0;
  VkDescriptorBufferInfo bufferInfo{uniformRing_.buffer, 0, sizeof(Uniforms)};
  VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
  write.dstSet = uniformSet_;
  write.descriptorCount = 1;
  write.descriptorType = VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER_DYNAMIC;
  write.pBufferInfo = &bufferInfo;
  if (uniformCapacity_ > 0) vkUpdateDescriptorSets(device_, 1, &write, 0, nullptr);
}

// Window and swapchain.

bool VulkanViewportRenderer::setWindow(ANativeWindow* window) {
  releaseWindow();
  VkAndroidSurfaceCreateInfoKHR surfaceInfo{VK_STRUCTURE_TYPE_ANDROID_SURFACE_CREATE_INFO_KHR};
  surfaceInfo.window = window;
  if (vkCreateAndroidSurfaceKHR(instance_, &surfaceInfo, nullptr, &surface_) != VK_SUCCESS) {
    LOG_WARN("vkCreateAndroidSurfaceKHR failed");
    return false;
  }
  VkBool32 supported = VK_FALSE;
  vkGetPhysicalDeviceSurfaceSupportKHR(physicalDevice_, queueFamily_, surface_, &supported);
  if (!supported) {
    LOG_WARN("the graphics queue cannot present to the view's surface");
    vkDestroySurfaceKHR(instance_, surface_, nullptr);
    surface_ = VK_NULL_HANDLE;
    return false;
  }
  ANativeWindow_acquire(window);
  window_ = window;
  swapchainStale_ = true;
  return true;
}

void VulkanViewportRenderer::releaseWindow() {
  if (device_ != VK_NULL_HANDLE) vkDeviceWaitIdle(device_);
  destroySwapchain();
  if (surface_ != VK_NULL_HANDLE) vkDestroySurfaceKHR(instance_, surface_, nullptr);
  surface_ = VK_NULL_HANDLE;
  if (window_ != nullptr) ANativeWindow_release(window_);
  window_ = nullptr;
}

bool VulkanViewportRenderer::createSwapchain() {
  VkSurfaceCapabilitiesKHR caps;
  vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physicalDevice_, surface_, &caps);
  // On Android the surface always reports the window's size.
  if (caps.currentExtent.width == 0 || caps.currentExtent.height == 0) return false;

  uint32_t formatCount = 0;
  vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice_, surface_, &formatCount, nullptr);
  std::vector<VkSurfaceFormatKHR> formats(formatCount);
  vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice_, surface_, &formatCount, formats.data());
  if (formats.empty()) return false;
  // UNORM like the MTKView's default, so the shaders' colours land unchanged.
  VkSurfaceFormatKHR format = formats[0];
  for (const VkSurfaceFormatKHR& f : formats) {
    if (f.format == VK_FORMAT_R8G8B8A8_UNORM || f.format == VK_FORMAT_B8G8R8A8_UNORM) {
      format = f;
      break;
    }
  }
  if (format.format != colorFormat_) {
    destroyRenderPassAndPipelines();
    if (!createRenderPassAndPipelines(format.format)) return false;
  }

  VkCompositeAlphaFlagBitsKHR alpha = VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR;
  for (VkCompositeAlphaFlagBitsKHR candidate : {VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR, VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR,
                                                VK_COMPOSITE_ALPHA_PRE_MULTIPLIED_BIT_KHR, VK_COMPOSITE_ALPHA_POST_MULTIPLIED_BIT_KHR}) {
    if (caps.supportedCompositeAlpha & candidate) {
      alpha = candidate;
      break;
    }
  }
  uint32_t imageCount = std::max(caps.minImageCount, 2u);
  if (caps.maxImageCount > 0) imageCount = std::min(imageCount, caps.maxImageCount);

  // draw() has waited for the device, so the old swapchain can go before the new one
  // exists rather than being handed over as oldSwapchain.
  destroySwapchain();
  VkSwapchainCreateInfoKHR info{VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR};
  info.surface = surface_;
  info.minImageCount = imageCount;
  info.imageFormat = format.format;
  info.imageColorSpace = format.colorSpace;
  info.imageExtent = caps.currentExtent;
  info.imageArrayLayers = 1;
  info.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
  info.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
  // A TextureView's buffers are composited by the view hierarchy, which applies the
  // display's rotation itself.
  info.preTransform = (caps.supportedTransforms & VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR) ? VK_SURFACE_TRANSFORM_IDENTITY_BIT_KHR
                                                                                          : caps.currentTransform;
  info.compositeAlpha = alpha;
  info.presentMode = VK_PRESENT_MODE_FIFO_KHR;
  info.clipped = VK_TRUE;
  const VkResult result = vkCreateSwapchainKHR(device_, &info, nullptr, &swapchain_);
  if (result != VK_SUCCESS) {
    LOG_WARN("vkCreateSwapchainKHR failed: %d", result);
    swapchain_ = VK_NULL_HANDLE;
    return false;
  }
  extent_ = caps.currentExtent;

  uint32_t count = 0;
  vkGetSwapchainImagesKHR(device_, swapchain_, &count, nullptr);
  std::vector<VkImage> images(count);
  vkGetSwapchainImagesKHR(device_, swapchain_, &count, images.data());
  msaaColor_ = makeAttachment(colorFormat_, VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT, VK_IMAGE_ASPECT_COLOR_BIT);
  msaaDepth_ = makeAttachment(depthFormat_, VK_IMAGE_USAGE_DEPTH_STENCIL_ATTACHMENT_BIT, VK_IMAGE_ASPECT_DEPTH_BIT);
  VkSemaphoreCreateInfo semaphoreInfo{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
  for (VkImage image : images) {
    VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
    viewInfo.image = image;
    viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
    viewInfo.format = colorFormat_;
    viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
    VkImageView view;
    vkCreateImageView(device_, &viewInfo, nullptr, &view);
    swapchainViews_.push_back(view);
    const VkImageView attachments[] = {msaaColor_.view, msaaDepth_.view, view};
    VkFramebufferCreateInfo fbInfo{VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO};
    fbInfo.renderPass = renderPass_;
    fbInfo.attachmentCount = 3;
    fbInfo.pAttachments = attachments;
    fbInfo.width = extent_.width;
    fbInfo.height = extent_.height;
    fbInfo.layers = 1;
    VkFramebuffer framebuffer;
    vkCreateFramebuffer(device_, &fbInfo, nullptr, &framebuffer);
    framebuffers_.push_back(framebuffer);
    VkSemaphore semaphore;
    vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &semaphore);
    renderFinished_.push_back(semaphore);
  }
  swapchainStale_ = false;
  return true;
}

void VulkanViewportRenderer::destroySwapchain() {
  for (VkFramebuffer fb : framebuffers_) vkDestroyFramebuffer(device_, fb, nullptr);
  for (VkImageView view : swapchainViews_) vkDestroyImageView(device_, view, nullptr);
  for (VkSemaphore semaphore : renderFinished_) vkDestroySemaphore(device_, semaphore, nullptr);
  framebuffers_.clear();
  swapchainViews_.clear();
  renderFinished_.clear();
  destroy(msaaColor_);
  destroy(msaaDepth_);
  if (swapchain_ != VK_NULL_HANDLE) vkDestroySwapchainKHR(device_, swapchain_, nullptr);
  swapchain_ = VK_NULL_HANDLE;
}

// Render pass and pipelines.

bool VulkanViewportRenderer::createRenderPassAndPipelines(VkFormat colorFormat) {
  // Multisampled colour and depth are cleared and discarded; only the resolve into the
  // swapchain image is stored.
  VkAttachmentDescription attachments[3] = {};
  attachments[0].format = colorFormat;
  attachments[0].samples = kSampleCount;
  attachments[0].loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
  attachments[0].storeOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  attachments[0].stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  attachments[0].stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
  attachments[0].initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  attachments[0].finalLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
  attachments[1] = attachments[0];
  attachments[1].format = depthFormat_;
  attachments[1].finalLayout = VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
  attachments[2] = attachments[0];
  attachments[2].samples = VK_SAMPLE_COUNT_1_BIT;
  attachments[2].loadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
  attachments[2].storeOp = VK_ATTACHMENT_STORE_OP_STORE;
  attachments[2].finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;
  VkAttachmentReference colorRef{0, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkAttachmentReference depthRef{1, VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL};
  VkAttachmentReference resolveRef{2, VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL};
  VkSubpassDescription subpass{};
  subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
  subpass.colorAttachmentCount = 1;
  subpass.pColorAttachments = &colorRef;
  subpass.pResolveAttachments = &resolveRef;
  subpass.pDepthStencilAttachment = &depthRef;
  // The swapchain image is written only once the acquire semaphore has been waited on.
  VkSubpassDependency dependency{};
  dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
  dependency.dstSubpass = 0;
  dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
  dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT | VK_PIPELINE_STAGE_EARLY_FRAGMENT_TESTS_BIT;
  dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT | VK_ACCESS_DEPTH_STENCIL_ATTACHMENT_WRITE_BIT;
  VkRenderPassCreateInfo info{VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO};
  info.attachmentCount = 3;
  info.pAttachments = attachments;
  info.subpassCount = 1;
  info.pSubpasses = &subpass;
  info.dependencyCount = 1;
  info.pDependencies = &dependency;
  if (vkCreateRenderPass(device_, &info, nullptr, &renderPass_) != VK_SUCCESS) return false;
  colorFormat_ = colorFormat;

  if (shaderModules_.empty()) {
    auto load = [&](const uint32_t* code, std::size_t bytes) {
      VkShaderModuleCreateInfo moduleInfo{VK_STRUCTURE_TYPE_SHADER_MODULE_CREATE_INFO};
      moduleInfo.codeSize = bytes;
      moduleInfo.pCode = code;
      VkShaderModule module = VK_NULL_HANDLE;
      vkCreateShaderModule(device_, &moduleInfo, nullptr, &module);
      shaderModules_.push_back(module);
    };
    load(kLineVert, sizeof(kLineVert));
    load(kSegmentLineVert, sizeof(kSegmentLineVert));
    load(kRibbonVert, sizeof(kRibbonVert));
    load(kColorFrag, sizeof(kColorFrag));
    load(kMeshVert, sizeof(kMeshVert));
    load(kMeshFrag, sizeof(kMeshFrag));
    load(kBedVert, sizeof(kBedVert));
    load(kBedFrag, sizeof(kBedFrag));
  }
  enum { LineVert, SegmentLineVert, RibbonVert, ColorFrag, MeshVert, MeshFrag, BedVert, BedFrag };
  const std::vector<VkShaderModule>& m = shaderModules_;

  auto input = [](const VkVertexInputBindingDescription& binding, const VkVertexInputAttributeDescription* attributes, uint32_t count) {
    VkPipelineVertexInputStateCreateInfo info{VK_STRUCTURE_TYPE_PIPELINE_VERTEX_INPUT_STATE_CREATE_INFO};
    info.vertexBindingDescriptionCount = 1;
    info.pVertexBindingDescriptions = &binding;
    info.vertexAttributeDescriptionCount = count;
    info.pVertexAttributeDescriptions = attributes;
    return info;
  };

  const VkVertexInputBindingDescription lineBinding{0, sizeof(LineVertex), VK_VERTEX_INPUT_RATE_VERTEX};
  const VkVertexInputAttributeDescription lineAttributes[] = {
      {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(LineVertex, position)},
      {1, 0, VK_FORMAT_R32G32B32A32_SFLOAT, offsetof(LineVertex, color)},
  };
  linePipeline_ = makePipeline(m[LineVert], m[ColorFrag], input(lineBinding, lineAttributes, 2), VK_PRIMITIVE_TOPOLOGY_LINE_LIST);

  // One instance per segment, so binding the buffer at an offset selects the filtered
  // range exactly as Metal's buffer offset does.
  const VkVertexInputBindingDescription segmentBinding{0, sizeof(Segment), VK_VERTEX_INPUT_RATE_INSTANCE};
  const VkVertexInputAttributeDescription segmentAttributes[] = {
      {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Segment, a)},
      {1, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(Segment, b)},
      {4, 0, VK_FORMAT_R8G8B8A8_UNORM, offsetof(Segment, color)},
      {2, 0, VK_FORMAT_R32_SFLOAT, offsetof(Segment, width)},
      {3, 0, VK_FORMAT_R32_SFLOAT, offsetof(Segment, height)},
  };
  segmentLinePipeline_ = makePipeline(m[SegmentLineVert], m[ColorFrag], input(segmentBinding, segmentAttributes, 3), VK_PRIMITIVE_TOPOLOGY_LINE_LIST);
  ribbonPipeline_ = makePipeline(m[RibbonVert], m[ColorFrag], input(segmentBinding, segmentAttributes, 5), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST);

  const VkVertexInputBindingDescription meshBinding{0, sizeof(MeshVertex), VK_VERTEX_INPUT_RATE_VERTEX};
  const VkVertexInputAttributeDescription meshAttribute{0, 0, VK_FORMAT_R32G32B32_SFLOAT, 0};
  meshPipeline_ = makePipeline(m[MeshVert], m[MeshFrag], input(meshBinding, &meshAttribute, 1), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST);

  const VkVertexInputBindingDescription bedBinding{0, sizeof(TexturedVertex), VK_VERTEX_INPUT_RATE_VERTEX};
  const VkVertexInputAttributeDescription bedAttributes[] = {
      {0, 0, VK_FORMAT_R32G32B32_SFLOAT, offsetof(TexturedVertex, position)},
      {1, 0, VK_FORMAT_R32G32_SFLOAT, offsetof(TexturedVertex, uv)},
  };
  bedPipeline_ = makePipeline(m[BedVert], m[BedFrag], input(bedBinding, bedAttributes, 2), VK_PRIMITIVE_TOPOLOGY_TRIANGLE_LIST);

  return linePipeline_ && segmentLinePipeline_ && ribbonPipeline_ && meshPipeline_ && bedPipeline_;
}

VkPipeline VulkanViewportRenderer::makePipeline(VkShaderModule vert, VkShaderModule frag, const VkPipelineVertexInputStateCreateInfo& input,
                                                VkPrimitiveTopology topology) {
  VkPipelineShaderStageCreateInfo stages[2] = {{VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO},
                                               {VK_STRUCTURE_TYPE_PIPELINE_SHADER_STAGE_CREATE_INFO}};
  stages[0].stage = VK_SHADER_STAGE_VERTEX_BIT;
  stages[0].module = vert;
  stages[0].pName = "main";
  stages[1].stage = VK_SHADER_STAGE_FRAGMENT_BIT;
  stages[1].module = frag;
  stages[1].pName = "main";
  VkPipelineInputAssemblyStateCreateInfo assembly{VK_STRUCTURE_TYPE_PIPELINE_INPUT_ASSEMBLY_STATE_CREATE_INFO};
  assembly.topology = topology;
  VkPipelineViewportStateCreateInfo viewport{VK_STRUCTURE_TYPE_PIPELINE_VIEWPORT_STATE_CREATE_INFO};
  viewport.viewportCount = 1;
  viewport.scissorCount = 1;
  VkPipelineRasterizationStateCreateInfo raster{VK_STRUCTURE_TYPE_PIPELINE_RASTERIZATION_STATE_CREATE_INFO};
  raster.polygonMode = VK_POLYGON_MODE_FILL;
  raster.cullMode = VK_CULL_MODE_NONE;
  raster.frontFace = VK_FRONT_FACE_COUNTER_CLOCKWISE;
  raster.lineWidth = 1.f;
  VkPipelineMultisampleStateCreateInfo multisample{VK_STRUCTURE_TYPE_PIPELINE_MULTISAMPLE_STATE_CREATE_INFO};
  multisample.rasterizationSamples = kSampleCount;
  VkPipelineDepthStencilStateCreateInfo depth{VK_STRUCTURE_TYPE_PIPELINE_DEPTH_STENCIL_STATE_CREATE_INFO};
  depth.depthTestEnable = VK_TRUE;
  depth.depthWriteEnable = VK_TRUE;
  depth.depthCompareOp = VK_COMPARE_OP_LESS_OR_EQUAL;
  VkPipelineColorBlendAttachmentState blendAttachment{};
  blendAttachment.colorWriteMask = VK_COLOR_COMPONENT_R_BIT | VK_COLOR_COMPONENT_G_BIT | VK_COLOR_COMPONENT_B_BIT | VK_COLOR_COMPONENT_A_BIT;
  VkPipelineColorBlendStateCreateInfo blend{VK_STRUCTURE_TYPE_PIPELINE_COLOR_BLEND_STATE_CREATE_INFO};
  blend.attachmentCount = 1;
  blend.pAttachments = &blendAttachment;
  const VkDynamicState dynamicStates[] = {VK_DYNAMIC_STATE_VIEWPORT, VK_DYNAMIC_STATE_SCISSOR};
  VkPipelineDynamicStateCreateInfo dynamic{VK_STRUCTURE_TYPE_PIPELINE_DYNAMIC_STATE_CREATE_INFO};
  dynamic.dynamicStateCount = 2;
  dynamic.pDynamicStates = dynamicStates;

  VkGraphicsPipelineCreateInfo info{VK_STRUCTURE_TYPE_GRAPHICS_PIPELINE_CREATE_INFO};
  info.stageCount = 2;
  info.pStages = stages;
  info.pVertexInputState = &input;
  info.pInputAssemblyState = &assembly;
  info.pViewportState = &viewport;
  info.pRasterizationState = &raster;
  info.pMultisampleState = &multisample;
  info.pDepthStencilState = &depth;
  info.pColorBlendState = &blend;
  info.pDynamicState = &dynamic;
  info.layout = pipelineLayout_;
  info.renderPass = renderPass_;
  VkPipeline pipeline = VK_NULL_HANDLE;
  if (vkCreateGraphicsPipelines(device_, VK_NULL_HANDLE, 1, &info, nullptr, &pipeline) != VK_SUCCESS) {
    LOG_WARN("vkCreateGraphicsPipelines failed");
    return VK_NULL_HANDLE;
  }
  return pipeline;
}

void VulkanViewportRenderer::destroyRenderPassAndPipelines() {
  for (VkPipeline* p : {&linePipeline_, &segmentLinePipeline_, &ribbonPipeline_, &meshPipeline_, &bedPipeline_}) {
    if (*p != VK_NULL_HANDLE) vkDestroyPipeline(device_, *p, nullptr);
    *p = VK_NULL_HANDLE;
  }
  if (renderPass_ != VK_NULL_HANDLE) vkDestroyRenderPass(device_, renderPass_, nullptr);
  renderPass_ = VK_NULL_HANDLE;
  colorFormat_ = VK_FORMAT_UNDEFINED;
}

// Geometry.

// Re-uploads whatever the controller rebuilt since the last frame. Runs after the frame
// fence, so the GPU no longer reads the buffers being replaced.
void VulkanViewportRenderer::syncBuffers() {
  if (sceneRevision_ != controller_->sceneRevision()) {
    const SceneGeometry& scene = controller_->scene();
    for (Buffer* b : {&bedLineBuffer_, &bedModelBuffer_, &bedQuadBuffer_, &meshBuffer_}) destroy(*b);
    bedLineBuffer_ = makeBuffer(scene.bedLines, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
    bedModelBuffer_ = makeBuffer(scene.bedModel, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
    bedQuadBuffer_ = makeBuffer(scene.bedQuad, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
    meshBuffer_ = makeBuffer(scene.mesh, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
    sceneRevision_ = controller_->sceneRevision();
  }
  if (toolpathRevision_ != controller_->toolpathRevision()) {
    const Toolpath& toolpath = controller_->toolpath();
    destroy(extrusionBuffer_);
    destroy(markerBuffer_);
    extrusionBuffer_ = makeBuffer(toolpath.extrusions, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
    markerBuffer_ = makeBuffer(toolpath.markers, VK_BUFFER_USAGE_VERTEX_BUFFER_BIT);
    toolpathRevision_ = controller_->toolpathRevision();
  }
}

// Uploads through a staging buffer into a sampled image. Bed textures change only with
// the printer, so the upload waits for the queue rather than tracking its own fence.
void VulkanViewportRenderer::setBedTexture(const uint8_t* pixels, uint32_t width, uint32_t height, uint32_t stride) {
  vkDeviceWaitIdle(device_);
  destroy(bedTexture_);
  if (pixels == nullptr || width == 0 || height == 0) return;

  // Rows go bottom-up, as Metal's loader stores them with its bottom-left origin, which
  // is what the bed quad's UVs assume.
  const VkDeviceSize rowBytes = VkDeviceSize(width) * 4;
  Buffer staging = makeBuffer(nullptr, rowBytes * height, VK_BUFFER_USAGE_TRANSFER_SRC_BIT);
  if (staging.buffer == VK_NULL_HANDLE) return;
  for (uint32_t row = 0; row < height; ++row)
    std::memcpy(static_cast<uint8_t*>(staging.mapped) + rowBytes * (height - 1 - row), pixels + std::size_t(stride) * row, rowBytes);

  VkImageCreateInfo info{VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
  info.imageType = VK_IMAGE_TYPE_2D;
  info.format = VK_FORMAT_R8G8B8A8_UNORM;
  info.extent = {width, height, 1};
  info.mipLevels = 1;
  info.arrayLayers = 1;
  info.samples = VK_SAMPLE_COUNT_1_BIT;
  info.tiling = VK_IMAGE_TILING_OPTIMAL;
  info.usage = VK_IMAGE_USAGE_SAMPLED_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
  info.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  vkCreateImage(device_, &info, nullptr, &bedTexture_.image);
  VkMemoryRequirements requirements;
  vkGetImageMemoryRequirements(device_, bedTexture_.image, &requirements);
  VkMemoryAllocateInfo alloc{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
  alloc.allocationSize = requirements.size;
  alloc.memoryTypeIndex = memoryType(requirements.memoryTypeBits, VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT, 0);
  vkAllocateMemory(device_, &alloc, nullptr, &bedTexture_.memory);
  vkBindImageMemory(device_, bedTexture_.image, bedTexture_.memory, 0);
  VkImageViewCreateInfo viewInfo{VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO};
  viewInfo.image = bedTexture_.image;
  viewInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
  viewInfo.format = VK_FORMAT_R8G8B8A8_UNORM;
  viewInfo.subresourceRange = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1};
  vkCreateImageView(device_, &viewInfo, nullptr, &bedTexture_.view);

  VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
  begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  vkBeginCommandBuffer(commandBuffer_, &begin);
  transition(commandBuffer_, bedTexture_.image, VK_IMAGE_LAYOUT_UNDEFINED, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 0,
             VK_ACCESS_TRANSFER_WRITE_BIT, VK_PIPELINE_STAGE_TOP_OF_PIPE_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT);
  VkBufferImageCopy region{};
  region.imageSubresource = {VK_IMAGE_ASPECT_COLOR_BIT, 0, 0, 1};
  region.imageExtent = {width, height, 1};
  vkCmdCopyBufferToImage(commandBuffer_, staging.buffer, bedTexture_.image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &region);
  transition(commandBuffer_, bedTexture_.image, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL,
             VK_ACCESS_TRANSFER_WRITE_BIT, VK_ACCESS_SHADER_READ_BIT, VK_PIPELINE_STAGE_TRANSFER_BIT, VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT);
  vkEndCommandBuffer(commandBuffer_);
  VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
  submit.commandBufferCount = 1;
  submit.pCommandBuffers = &commandBuffer_;
  vkQueueSubmit(queue_, 1, &submit, VK_NULL_HANDLE);
  vkQueueWaitIdle(queue_);
  destroy(staging);

  VkDescriptorImageInfo imageInfo{sampler_, bedTexture_.view, VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL};
  VkWriteDescriptorSet write{VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET};
  write.dstSet = textureSet_;
  write.descriptorCount = 1;
  write.descriptorType = VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER;
  write.pImageInfo = &imageInfo;
  vkUpdateDescriptorSets(device_, 1, &write, 0, nullptr);
}

void VulkanViewportRenderer::clearBedTexture() {
  vkDeviceWaitIdle(device_);
  destroy(bedTexture_);
}

// Drawing.

void VulkanViewportRenderer::draw() {
  if (surface_ == VK_NULL_HANDLE) return;
  vkWaitForFences(device_, 1, &frameFence_, VK_TRUE, UINT64_MAX);
  if (swapchainStale_ || swapchain_ == VK_NULL_HANDLE) {
    vkDeviceWaitIdle(device_);
    if (!createSwapchain()) return;
  }
  syncBuffers();

  uint32_t imageIndex = 0;
  VkResult result = vkAcquireNextImageKHR(device_, swapchain_, UINT64_MAX, imageAvailable_, VK_NULL_HANDLE, &imageIndex);
  if (result == VK_ERROR_OUT_OF_DATE_KHR) {
    swapchainStale_ = true;
    redraw_();
    return;
  }
  if (result != VK_SUCCESS && result != VK_SUBOPTIMAL_KHR) return;
  vkResetFences(device_, 1, &frameFence_);

  // Uniform slots: the frame, the bed model, then one per object.
  const SceneGeometry& scene = controller_->scene();
  const Uniforms frame = controller_->frameUniforms(float(extent_.width), float(extent_.height));
  reserveUniforms(2 + scene.meshRanges.size());
  const VkDeviceSize stride = alignUp(sizeof(Uniforms), uniformAlignment_);
  auto slot = [&](std::size_t index, const Uniforms& u) {
    std::memcpy(static_cast<uint8_t*>(uniformRing_.mapped) + stride * index, &u, sizeof(u));
    return static_cast<uint32_t>(stride * index);
  };
  const uint32_t frameOffset = slot(0, frame);
  const uint32_t bedModelOffset = slot(1, controller_->bedModelUniforms(frame));

  VkCommandBufferBeginInfo begin{VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO};
  begin.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
  vkBeginCommandBuffer(commandBuffer_, &begin);
  VkClearValue clears[3] = {};
  clears[0].color = kClearColor;
  clears[1].depthStencil = {1.f, 0};
  VkRenderPassBeginInfo pass{VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO};
  pass.renderPass = renderPass_;
  pass.framebuffer = framebuffers_[imageIndex];
  pass.renderArea = {{0, 0}, extent_};
  pass.clearValueCount = 3;
  pass.pClearValues = clears;
  vkCmdBeginRenderPass(commandBuffer_, &pass, VK_SUBPASS_CONTENTS_INLINE);
  const VkViewport viewport{0, 0, float(extent_.width), float(extent_.height), 0, 1};
  const VkRect2D scissor{{0, 0}, extent_};
  vkCmdSetViewport(commandBuffer_, 0, 1, &viewport);
  vkCmdSetScissor(commandBuffer_, 0, 1, &scissor);

  const VkCommandBuffer cb = commandBuffer_;
  auto bindUniforms = [&](uint32_t offset) {
    vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelineLayout_, 0, 1, &uniformSet_, 1, &offset);
  };
  auto bindVertices = [&](const Buffer& buffer, VkDeviceSize offset = 0) {
    vkCmdBindVertexBuffers(cb, 0, 1, &buffer.buffer, &offset);
  };
  const ToolpathRanges& ranges = controller_->ranges();

  // The same order as the Metal backend. Custom bed model (STL) first; it sits under
  // everything.
  if (bedModelBuffer_.buffer != VK_NULL_HANDLE) {
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, meshPipeline_);
    bindUniforms(bedModelOffset);
    bindVertices(bedModelBuffer_);
    vkCmdDraw(cb, uint32_t(scene.bedModel.size()), 1, 0, 0);
  }
  // Bed texture quad, on top of the STL or directly on the polygon.
  if (bedQuadBuffer_.buffer != VK_NULL_HANDLE && bedTexture_.view != VK_NULL_HANDLE) {
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, bedPipeline_);
    bindUniforms(frameOffset);
    vkCmdBindDescriptorSets(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, pipelineLayout_, 1, 1, &textureSet_, 0, nullptr);
    bindVertices(bedQuadBuffer_);
    vkCmdDraw(cb, uint32_t(scene.bedQuad.size()), 1, 0, 0);
  }
  // One instance per segment; the binding offset selects the filtered range. Extrusions
  // are ribbons at the bead's width and height, the other moves thin lines.
  if (extrusionBuffer_.buffer != VK_NULL_HANDLE && ranges.extrusions.count > 0) {
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, ribbonPipeline_);
    bindUniforms(frameOffset);
    bindVertices(extrusionBuffer_, ranges.extrusions.first * sizeof(Segment));
    vkCmdDraw(cb, uint32_t(kRibbonVertexCount), uint32_t(ranges.extrusions.count), 0, 0);
  }
  if (markerBuffer_.buffer != VK_NULL_HANDLE && ranges.markers.count > 0) {
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, segmentLinePipeline_);
    bindUniforms(frameOffset);
    bindVertices(markerBuffer_, ranges.markers.first * sizeof(Segment));
    vkCmdDraw(cb, 2, uint32_t(ranges.markers.count), 0, 0);
  }
  if (bedLineBuffer_.buffer != VK_NULL_HANDLE) {
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, linePipeline_);
    bindUniforms(frameOffset);
    bindVertices(bedLineBuffer_);
    vkCmdDraw(cb, uint32_t(scene.bedLines.size()), 1, 0, 0);
  }
  if (meshBuffer_.buffer != VK_NULL_HANDLE) {
    vkCmdBindPipeline(cb, VK_PIPELINE_BIND_POINT_GRAPHICS, meshPipeline_);
    bindVertices(meshBuffer_);
    for (std::size_t i = 0; i < scene.meshRanges.size(); ++i) {
      const MeshRange& range = scene.meshRanges[i];
      bindUniforms(slot(2 + i, controller_->meshUniforms(frame, range)));
      vkCmdDraw(cb, uint32_t(range.count), 1, uint32_t(range.start), 0);
    }
  }
  vkCmdEndRenderPass(cb);
  vkEndCommandBuffer(cb);

  const VkPipelineStageFlags waitStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
  VkSubmitInfo submit{VK_STRUCTURE_TYPE_SUBMIT_INFO};
  submit.waitSemaphoreCount = 1;
  submit.pWaitSemaphores = &imageAvailable_;
  submit.pWaitDstStageMask = &waitStage;
  submit.commandBufferCount = 1;
  submit.pCommandBuffers = &cb;
  submit.signalSemaphoreCount = 1;
  submit.pSignalSemaphores = &renderFinished_[imageIndex];
  if (vkQueueSubmit(queue_, 1, &submit, frameFence_) != VK_SUCCESS) {
    LOG_WARN("vkQueueSubmit failed");
    return;
  }
  VkPresentInfoKHR present{VK_STRUCTURE_TYPE_PRESENT_INFO_KHR};
  present.waitSemaphoreCount = 1;
  present.pWaitSemaphores = &renderFinished_[imageIndex];
  present.swapchainCount = 1;
  present.pSwapchains = &swapchain_;
  present.pImageIndices = &imageIndex;
  result = vkQueuePresentKHR(queue_, &present);
  if (result == VK_ERROR_OUT_OF_DATE_KHR || result == VK_SUBOPTIMAL_KHR) {
    swapchainStale_ = true;
    redraw_();
  }
}

} // namespace orca::viewport
