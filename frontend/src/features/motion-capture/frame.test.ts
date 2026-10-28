import { describe, expect, it } from "vitest";
import { inferenceFrame } from "./frame";

describe("portrait inference framing", () => {
  it("preserves the full field of view for the process profile", () => {
    expect(inferenceFrame(1920, 1080, 1920 / 1080)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      resizeWidth: 640,
      resizeHeight: 360,
    });
  });
  it("excludes landscape edges that are outside the visible viewfinder", () => {
    expect(inferenceFrame(640, 480, 3 / 4)).toEqual({
      x: 140,
      y: 0,
      width: 360,
      height: 480,
      resizeWidth: 360,
      resizeHeight: 480,
    });
  });
  it("scales the whole portrait image without changing its proportions", () => {
    expect(inferenceFrame(960, 1280, 3 / 4)).toEqual({
      x: 0,
      y: 0,
      width: 960,
      height: 1280,
      resizeWidth: 360,
      resizeHeight: 480,
    });
  });
  it("crops the top and bottom of a narrower source", () => {
    expect(inferenceFrame(300, 600, 3 / 4)).toEqual({
      x: 0,
      y: 100,
      width: 300,
      height: 400,
      resizeWidth: 300,
      resizeHeight: 400,
    });
  });
});
