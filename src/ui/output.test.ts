import { describe, expect, it } from "vitest";
import { ICON_ERROR, ICON_INFO, ICON_SUCCESS, ICON_WARNING } from "./output.js";

describe("output icons", () => {
  it("ICON_SUCCESS contains the checkmark character", () => {
    expect(ICON_SUCCESS).toContain("\u2713");
  });

  it("ICON_WARNING contains the warning character", () => {
    expect(ICON_WARNING).toContain("\u26A0");
  });

  it("ICON_ERROR contains the cross character", () => {
    expect(ICON_ERROR).toContain("\u2717");
  });

  it("ICON_INFO contains the circle character", () => {
    expect(ICON_INFO).toContain("\u25CB");
  });
});
