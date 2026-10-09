import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LoadingEndpoints from "../../app/loading";
import LoadingDashboard from "../../app/dashboard/loading";
import LoadingEndpoint from "../../app/endpoints/[id]/loading";

describe("loading states", () => {
  it.each([
    [LoadingEndpoints, "Loading endpoints"],
    [LoadingDashboard, "Loading dashboard"],
    [LoadingEndpoint, "Loading endpoint"],
  ] as const)("announces a busy state without fabricated observations: %s", (Component, label) => {
    const markup = renderToStaticMarkup(createElement(Component));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(`aria-label="${label}"`);
    expect(markup).toContain(`role="status">${label}...`);
    expect(markup).not.toMatch(/100%|Healthy|Down|SUCCESS|FAILURE|TIMEOUT/);
  });
});
