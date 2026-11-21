"use strict";

const GPS_FIELDS = ["latitude", "longitude", "altitudeM", "accuracy_m"];

// Record visibility is decided by the Observation query. Exact location has an
// additional species-visibility gate, even for an Observation's author.
function projectObservationGps(row, user, viewerSubject, projectGps) {
  const { gps_visibility_allowed, ...observation } = row;
  const projected = projectGps(observation, user);
  if (user?.role !== "Botanist" || !gps_visibility_allowed ||
      (observation.status !== "Approved" && observation.owner_subject !== viewerSubject))
    return projected;
  const content = { ...projected.content };
  for (const field of GPS_FIELDS) {
    if (Object.hasOwn(observation.content || {}, field)) content[field] = observation.content[field];
  }
  return { ...projected, content };
}

module.exports = { projectObservationGps };
