import type { Page } from "playwright";

import { getPageViewport } from "./viewport.js";

export interface Point {
  x: number;
  y: number;
}

export interface HumanMouseOptions {
  minStepDelayMs?: number;
  maxStepDelayMs?: number;
  overshootProbability?: number;
}

let lastMousePosition: Point | null = null;

function randomIn(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function cubicBezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  return {
    x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
    y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y,
  };
}

function generateAngularPath(from: Point, to: Point, steps: number): Point[] {
  const corner: Point =
    Math.abs(to.y - from.y) > Math.abs(to.x - from.x)
      ? {
          x: from.x + randomIn(-35, 35),
          y: lerp(from.y, to.y, randomIn(0.35, 0.65)),
        }
      : {
          x: lerp(from.x, to.x, randomIn(0.35, 0.65)),
          y: from.y + randomIn(-35, 35),
        };

  const firstLegSteps = Math.max(8, Math.floor(steps * randomIn(0.4, 0.6)));
  const secondLegSteps = Math.max(8, steps - firstLegSteps);
  const path: Point[] = [];

  for (let i = 0; i <= firstLegSteps; i++) {
    const t = easeInOutQuad(i / firstLegSteps);
    path.push({ x: lerp(from.x, corner.x, t), y: lerp(from.y, corner.y, t) });
  }
  for (let i = 1; i <= secondLegSteps; i++) {
    const t = easeInOutQuad(i / secondLegSteps);
    path.push({ x: lerp(corner.x, to.x, t), y: lerp(corner.y, to.y, t) });
  }

  return path;
}

function generateBezierPath(from: Point, to: Point, steps: number): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cp1: Point = {
    x: from.x + dx * randomIn(0.15, 0.45) + randomIn(-70, 70),
    y: from.y + dy * randomIn(0.05, 0.35) + randomIn(-55, 55),
  };
  const cp2: Point = {
    x: from.x + dx * randomIn(0.55, 0.85) + randomIn(-70, 70),
    y: from.y + dy * randomIn(0.65, 0.95) + randomIn(-55, 55),
  };

  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    path.push(cubicBezierPoint(easeInOutQuad(i / steps), from, cp1, cp2, to));
  }
  return path;
}

function generateMixedPath(from: Point, to: Point, steps: number): Point[] {
  const mid: Point = {
    x: lerp(from.x, to.x, randomIn(0.3, 0.5)),
    y: lerp(from.y, to.y, randomIn(0.3, 0.5)) + randomIn(-30, 30),
  };
  const half = Math.max(10, Math.floor(steps / 2));
  const bezierPart = generateBezierPath(from, mid, half);
  const angularPart = generateAngularPath(mid, to, steps - half);
  return [...bezierPart.slice(0, -1), ...angularPart];
}

export function buildHumanMousePath(from: Point, to: Point): Point[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.min(140, Math.max(24, Math.floor(distance / 5)));
  const styleRoll = Math.random();

  if (styleRoll < 0.34) {
    return generateAngularPath(from, to, steps);
  }
  if (styleRoll < 0.68) {
    return generateBezierPath(from, to, steps);
  }
  return generateMixedPath(from, to, steps);
}

async function resolveStartPoint(page: Page): Promise<Point> {
  if (lastMousePosition) {
    return lastMousePosition;
  }

  const viewport = await getPageViewport(page);

  return {
    x: randomIn(viewport.width * 0.15, viewport.width * 0.85),
    y: randomIn(viewport.height * 0.12, viewport.height * 0.65),
  };
}

export async function moveMouseHumanLike(
  page: Page,
  target: Point,
  options: HumanMouseOptions = {},
): Promise<void> {
  const minDelay = options.minStepDelayMs ?? 4;
  const maxDelay = options.maxStepDelayMs ?? 14;
  const from = await resolveStartPoint(page);
  let path = buildHumanMousePath(from, target);

  if (Math.random() < (options.overshootProbability ?? 0.18)) {
    const overshoot: Point = {
      x: target.x + randomIn(4, 14) * Math.sign(target.x - from.x || 1),
      y: target.y + randomIn(-8, 10),
    };
    const tail = buildHumanMousePath(path[path.length - 1], overshoot).slice(1);
    const correction = buildHumanMousePath(overshoot, target).slice(1);
    path = [...path, ...tail, ...correction];
  }

  for (const point of path) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(randomIn(minDelay, maxDelay));
    lastMousePosition = point;
  }
}

export function resetMousePosition(): void {
  lastMousePosition = null;
}
