import { describe, expect, it } from "vitest";
import { cropGesture, cropRect } from "../../src/features/profile/image.js";

describe("avatar touch crop", () => {
  it("moves the image with the finger using the displayed crop scale", () => {
    const view = cropGesture(
      800,
      400,
      { zoom: 2, x: 0, y: 0 },
      [{ x: 0.5, y: 0.5 }],
      [{ x: 0.75, y: 0.25 }],
    );
    const rect = cropRect(800, 400, view.zoom, view.x, view.y);
    expect(rect.x).toBeCloseTo(250);
    expect(rect.y).toBeCloseTo(150);
    expect(rect.size).toBe(200);
  });

  it("keeps the image point under an off-centre pinch fixed", () => {
    const view = cropGesture(
      800,
      400,
      { zoom: 1, x: 0, y: 0 },
      [
        { x: 0.1, y: 0.5 },
        { x: 0.3, y: 0.5 },
      ],
      [
        { x: 0, y: 0.5 },
        { x: 0.4, y: 0.5 },
      ],
    );
    const rect = cropRect(800, 400, view.zoom, view.x, view.y);
    expect(view.zoom).toBeCloseTo(2);
    expect(rect.x + 0.2 * rect.size).toBeCloseTo(280);
    expect(rect.y + 0.5 * rect.size).toBeCloseTo(200);
  });

  it("never uncovers the crop at any edge, minimum or maximum zoom", () => {
    for (const [width, height] of [
      [1200, 400],
      [400, 1200],
      [600, 600],
    ]) {
      let view = { zoom: 1, x: 0, y: 0 };
      for (const points of [
        [
          { x: -4, y: -3 },
          { x: 4, y: 3 },
        ],
        [
          { x: 3, y: 4 },
          { x: 3, y: 4 },
        ],
        [
          { x: -10, y: 8 },
          { x: -9, y: 8 },
        ],
      ]) {
        view = cropGesture(
          width!,
          height!,
          view,
          [
            { x: 0.4, y: 0.5 },
            { x: 0.6, y: 0.5 },
          ],
          points,
        );
        const rect = cropRect(width!, height!, view.zoom, view.x, view.y);
        expect(view.zoom).toBeGreaterThanOrEqual(1);
        expect(view.zoom).toBeLessThanOrEqual(3);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.size).toBeLessThanOrEqual(width! + 0.000001);
        expect(rect.y + rect.size).toBeLessThanOrEqual(height! + 0.000001);
      }
    }
  });

  it("does not jump when a remaining finger becomes a new drag", () => {
    const points = [
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
    ];
    const pinched = cropGesture(
      600,
      900,
      { zoom: 1, x: 0, y: 0 },
      [
        { x: 0.3, y: 0.5 },
        { x: 0.7, y: 0.5 },
      ],
      points,
    );
    const dragged = cropGesture(600, 900, pinched, [points[0]!], [points[0]!]);
    expect(dragged).toEqual(pinched);
  });
});
