import { vi } from "vitest";

// Vitest runs server modules outside Next.js's react-server export condition.
vi.mock("server-only", () => ({}));
