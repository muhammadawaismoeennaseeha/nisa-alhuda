import "@testing-library/jest-dom";
import { vi } from "vitest";

/**
 * Stub the app-router hooks.
 *
 * `useRouter` throws "invariant expected app router to be mounted" outside a
 * Next request, so any client component that can navigate — which is most of
 * the dashboard — is otherwise unrenderable in a unit test. The stubs are inert:
 * a component can call them, but a test that wants to assert on navigation
 * should re-mock them locally with spies.
 */
vi.mock("next/navigation", async () => {
  const actual =
    await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
  };
});
