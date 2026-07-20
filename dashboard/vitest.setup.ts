import "@testing-library/jest-dom/vitest";

// recharts(ResponsiveContainer)는 ResizeObserver를 요구하지만 jsdom엔 없다 → 무해한 no-op 폴리필.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Radix(Dropdown/Popover)는 포인터 캡처·scrollIntoView 를 쓰지만 jsdom엔 없다 → no-op 폴리필.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
