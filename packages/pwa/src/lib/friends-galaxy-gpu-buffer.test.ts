import { afterEach, expect, test, vi } from "vitest";
import { createFriendsGalaxyGpuBuffer } from "../../../ui/src/lib/friends-galaxy-gpu-buffer.js";

afterEach(() => vi.unstubAllGlobals());

function fixture(writeError?: Error) {
  vi.stubGlobal("GPUBufferUsage", { COPY_DST: 8, VERTEX: 32 });
  const bytes: number[] = [];
  const buffer = { destroy: vi.fn() };
  const device = {
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      if (descriptor.mappedAtCreation) throw new RangeError("CPU mapping unavailable");
      return buffer;
    }),
    queue: {
      writeBuffer: vi.fn((_buffer: unknown, _offset: number, source: ArrayBuffer, offset: number, size: number) => {
        if (writeError) throw writeError;
        bytes.push(...new Float32Array(source, offset, size / Float32Array.BYTES_PER_ELEMENT));
      }),
    },
  };
  return { device, buffer, bytes };
}

test("uploads the exact geometry view when CPU mapping allocation is unavailable", () => {
  const { device, buffer, bytes } = fixture();
  const source = new Float32Array([99, 1, 2, 3, 88]);
  expect(createFriendsGalaxyGpuBuffer(device as unknown as GPUDevice, source.subarray(1, 4), 32)).toBe(buffer);
  expect(bytes).toEqual([1, 2, 3]);
  expect(device.createBuffer.mock.calls[0][0]).toMatchObject({ size: 12, usage: 40 });
  expect(buffer.destroy).not.toHaveBeenCalled();
});

test("keeps empty geometry valid without a zero-length upload", () => {
  const { device } = fixture();
  createFriendsGalaxyGpuBuffer(device as unknown as GPUDevice, new Float32Array(), 32);
  expect(device.createBuffer.mock.calls[0][0].size).toBe(4);
  expect(device.queue.writeBuffer).not.toHaveBeenCalled();
});

test("releases the allocation and preserves an upload failure", () => {
  const error = new Error("upload unavailable");
  const { device, buffer } = fixture(error);
  expect(() => createFriendsGalaxyGpuBuffer(device as unknown as GPUDevice, new Float32Array([1]), 32)).toThrow(error);
  expect(buffer.destroy).toHaveBeenCalledOnce();
});
