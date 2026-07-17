import "@testing-library/jest-dom/vitest";

// recharts(ResponsiveContainer)는 ResizeObserver를 요구하지만 jsdom엔 없다 → 무해한 no-op 폴리필.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
