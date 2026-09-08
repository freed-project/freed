/// <reference types="@webgpu/types" />

/** Initialize geometry without retaining a CPU mapping for each GPU buffer. */
export function createFriendsGalaxyGpuBuffer(
  device: GPUDevice,
  data: Float32Array,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(Float32Array.BYTES_PER_ELEMENT, data.byteLength),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  try {
    if (data.byteLength > 0) {
      device.queue.writeBuffer(
        buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength,
      );
    }
    return buffer;
  } catch (error) {
    buffer.destroy();
    throw error;
  }
}
