/**
 * The space the cursor clears in the mark.
 *
 * Points within its reach are pushed out along the line from its centre until
 * they sit on the rim, which leaves a hollow sphere where the cursor rests.
 * Depth counts toward the distance — push on x and y alone and the hollow is a
 * tube bored through the mark, which reads wrong the moment the mark turns.
 *
 * The vertex shader mirrors this function line for line; it is kept here so the
 * shape of the hole can be stated once and held to by test.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export function spherePush(
  point: Point3,
  centre: Point3,
  radius: number,
  strength: number,
): Point3 {
  const ax = point.x - centre.x;
  const ay = point.y - centre.y;
  const az = point.z - centre.z;
  const distance = Math.sqrt(ax * ax + ay * ay + az * az);
  if (distance >= radius || distance < 1e-4 || strength <= 0) return point;

  const push = (radius / distance - 1) * strength;
  return {
    x: point.x + ax * push,
    y: point.y + ay * push,
    z: point.z + az * push,
  };
}
