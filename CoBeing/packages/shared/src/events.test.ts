import { describe, it, expect } from "vitest";
import { EventEmitter } from "./events.js";

describe("EventEmitter", () => {
  it("should emit and receive events", () => {
    const bus = new EventEmitter();
    let received = "";
    bus.on<string>("test", (data) => {
      received = data;
    });
    bus.emit("test", "hello");
    expect(received).toBe("hello");
  });

  it("should support unsubscribing", () => {
    const bus = new EventEmitter();
    let count = 0;
    const unsub = bus.on("test", () => count++);
    bus.emit("test", undefined);
    expect(count).toBe(1);
    unsub();
    bus.emit("test", undefined);
    expect(count).toBe(1);
  });

  it("should support once", () => {
    const bus = new EventEmitter();
    let count = 0;
    bus.once("test", () => count++);
    bus.emit("test", undefined);
    bus.emit("test", undefined);
    expect(count).toBe(1);
  });
});
