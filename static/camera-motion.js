import { Spherical, Vector3, MathUtils } from 'three';

// Orbit around the moving study target instead of taking a chord through anatomy.
// All scratch objects belong to the flight: stepping it allocates nothing.
export function createFlight(position, target, destination, destinationTarget, now) {
  if (position.distanceToSquared(destination) < 1e-12 && target.distanceToSquared(destinationTarget) < 1e-12) return null;
  const from = new Spherical().setFromVector3(new Vector3().subVectors(position, target));
  const to = new Spherical().setFromVector3(new Vector3().subVectors(destination, destinationTarget));
  from.radius = Math.max(from.radius, 1e-6);
  to.radius = Math.max(to.radius, 1e-6);
  const theta = Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
  const logRadius = Math.log(to.radius / from.radius);
  return {
    start: now, duration: MathUtils.clamp(420 + Math.abs(theta) * 150 + Math.abs(logRadius) * 90, 420, 1000),
    from, to, theta, logRadius, spherical: new Spherical(),
    fromTarget: target.clone(), toTarget: destinationTarget.clone(), destination: destination.clone(),
  };
}

export function stepFlight(flight, now, position, target) {
  const t = MathUtils.clamp((now - flight.start) / flight.duration, 0, 1);
  const ease = t * t * t * (t * (t * 6 - 15) + 10);
  target.lerpVectors(flight.fromTarget, flight.toTarget, ease);
  flight.spherical.set(
    flight.from.radius * Math.exp(flight.logRadius * ease),
    MathUtils.lerp(flight.from.phi, flight.to.phi, ease),
    flight.from.theta + flight.theta * ease,
  ).makeSafe();
  position.setFromSpherical(flight.spherical).add(target);
  if (t === 1) { position.copy(flight.destination); target.copy(flight.toTarget); }
  return t === 1;
}
