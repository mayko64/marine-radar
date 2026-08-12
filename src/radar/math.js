/* RADAR_MATH_START */
        const radarMath = (() => {
            const offsetPixels = state => state.offset ? -state.radius * 0.5 : 0;

            function clientToCanvas(clientX, clientY, rect, width, height) {
                if (rect.width <= 0 || rect.height <= 0) {
                    throw new Error('Canvas has no rendered size');
                }
                return {
                    x: (clientX - rect.left) * width / rect.width,
                    y: (clientY - rect.top) * height / rect.height
                };
            }

            function clampToCircle(point, center, circleRadius) {
                const dx = point.x - center.x;
                const dy = point.y - center.y;
                const distance = Math.hypot(dx, dy);
                if (distance <= circleRadius || distance === 0) {
                    return { x: point.x, y: point.y, clamped: false };
                }
                const scale = circleRadius / distance;
                return {
                    x: center.x + dx * scale,
                    y: center.y + dy * scale,
                    clamped: true
                };
            }

            function worldToDisplay(world, state) {
                const pixelsPerNm = state.radius / state.range;
                let east = world.x - state.ownShip.x;
                let north = world.y - state.ownShip.y;

                if (state.headingMode !== 'NORTH_UP') {
                    const heading = state.ownShip.heading * Math.PI / 180;
                    const right = east * Math.cos(heading) - north * Math.sin(heading);
                    const forward = east * Math.sin(heading) + north * Math.cos(heading);
                    east = right;
                    north = forward;
                }

                return {
                    x: state.centerX + east * pixelsPerNm,
                    y: state.centerY + offsetPixels(state) - north * pixelsPerNm
                };
            }

            function displayToWorld(display, state) {
                const pixelsPerNm = state.radius / state.range;
                let east = (display.x - state.centerX) / pixelsPerNm;
                let north = -(display.y - state.centerY - offsetPixels(state)) / pixelsPerNm;

                if (state.headingMode !== 'NORTH_UP') {
                    const heading = state.ownShip.heading * Math.PI / 180;
                    const worldEast = east * Math.cos(heading) + north * Math.sin(heading);
                    const worldNorth = -east * Math.sin(heading) + north * Math.cos(heading);
                    east = worldEast;
                    north = worldNorth;
                }

                return {
                    x: state.ownShip.x + east,
                    y: state.ownShip.y + north
                };
            }

            function rotationDurationMs(degreesPerSecond) {
                if (degreesPerSecond <= 0) {
                    throw new Error('Sweep speed must be positive');
                }
                return 360000 / degreesPerSecond;
            }

            function echoAlpha(ageMs, lifetimeMs) {
                if (lifetimeMs <= 0) return 0;
                return Math.max(0, Math.min(1, 1 - ageMs / lifetimeMs));
            }

            function velocityVector(speedKnots, courseDegrees) {
                const radians = courseDegrees * Math.PI / 180;
                const x = speedKnots * Math.sin(radians);
                const y = speedKnots * Math.cos(radians);
                return {
                    x: Math.abs(x) < 1e-12 ? 0 : x,
                    y: Math.abs(y) < 1e-12 ? 0 : y
                };
            }

            function recordWakeSample(
                trail,
                position,
                now,
                enabled,
                maxAgeMs = 60000
            ) {
                if (!enabled) return [];
                return [
                    ...trail,
                    { x: position.x, y: position.y, time: now }
                ].filter(point => now - point.time < maxAgeMs);
            }

            function clearWakeTrails(targets) {
                targets.forEach(target => {
                    target.trail = [];
                });
            }

            function setWakeRecording(targets, enabled) {
                clearWakeTrails(targets);
                return Boolean(enabled);
            }

            function resetTargetGeneration(target) {
                target.generation += 1;
                target.trail = [];
                target.lastDetectedSweepCycle = null;
                target.lastDetectedRangeNm = null;
                target.lastDetectedTrueBearing = null;
            }

            function calculateCpaTcpa(own, target) {
                const ownVelocity = velocityVector(own.speed, own.heading);
                const targetVelocity = velocityVector(target.speed, target.heading);
                const position = {
                    x: target.x - own.x,
                    y: target.y - own.y
                };
                const relative = {
                    x: targetVelocity.x - ownVelocity.x,
                    y: targetVelocity.y - ownVelocity.y
                };
                const speedSquared = relative.x ** 2 + relative.y ** 2;

                if (speedSquared < 1e-12) {
                    return {
                        cpaNm: Math.hypot(position.x, position.y),
                        tcpaMinutes: null,
                        past: false
                    };
                }

                const tcpaHours = -(position.x * relative.x + position.y * relative.y) / speedSquared;
                const closest = {
                    x: position.x + relative.x * tcpaHours,
                    y: position.y + relative.y * tcpaHours
                };
                return {
                    cpaNm: Math.hypot(closest.x, closest.y),
                    tcpaMinutes: tcpaHours * 60,
                    past: tcpaHours < 0
                };
            }

            function pointInPolygon(point, polygon) {
                let inside = false;
                for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                    if (
                        ((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
                        point.x < (polygon[j].x - polygon[i].x) *
                            (point.y - polygon[i].y) /
                            (polygon[j].y - polygon[i].y) +
                            polygon[i].x
                    ) {
                        inside = !inside;
                    }
                }
                return inside;
            }

            function pointToSegmentDistance(point, start, end) {
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const lengthSquared = dx * dx + dy * dy;
                const projection = lengthSquared === 0
                    ? 0
                    : Math.max(0, Math.min(1,
                        ((point.x - start.x) * dx + (point.y - start.y) * dy) /
                        lengthSquared
                    ));
                return Math.hypot(
                    point.x - (start.x + projection * dx),
                    point.y - (start.y + projection * dy)
                );
            }

            function distanceToPolygon(point, polygon) {
                if (pointInPolygon(point, polygon)) return 0;
                let distance = Infinity;
                for (let i = 0; i < polygon.length; i++) {
                    distance = Math.min(
                        distance,
                        pointToSegmentDistance(point, polygon[i], polygon[(i + 1) % polygon.length])
                    );
                }
                return distance;
            }

            function hasLandClearance(point, polygons, clearanceNm) {
                return polygons.every(polygon => distanceToPolygon(point, polygon) >= clearanceNm);
            }

            function segmentsIntersect(a, b, c, d) {
                const cross = (p, q, r) =>
                    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
                const onSegment = (p, q, r) =>
                    q.x >= Math.min(p.x, r.x) - 1e-12 &&
                    q.x <= Math.max(p.x, r.x) + 1e-12 &&
                    q.y >= Math.min(p.y, r.y) - 1e-12 &&
                    q.y <= Math.max(p.y, r.y) + 1e-12;
                const abC = cross(a, b, c);
                const abD = cross(a, b, d);
                const cdA = cross(c, d, a);
                const cdB = cross(c, d, b);

                if (
                    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
                    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
                ) {
                    return true;
                }
                return (
                    (Math.abs(abC) <= 1e-12 && onSegment(a, c, b)) ||
                    (Math.abs(abD) <= 1e-12 && onSegment(a, d, b)) ||
                    (Math.abs(cdA) <= 1e-12 && onSegment(c, a, d)) ||
                    (Math.abs(cdB) <= 1e-12 && onSegment(c, b, d))
                );
            }

            function segmentToSegmentDistance(a, b, c, d) {
                if (segmentsIntersect(a, b, c, d)) return 0;
                return Math.min(
                    pointToSegmentDistance(a, c, d),
                    pointToSegmentDistance(b, c, d),
                    pointToSegmentDistance(c, a, b),
                    pointToSegmentDistance(d, a, b)
                );
            }

            function segmentToPolygonDistance(start, end, polygon) {
                if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return 0;
                let distance = Infinity;
                for (let i = 0; i < polygon.length; i++) {
                    distance = Math.min(
                        distance,
                        segmentToSegmentDistance(
                            start,
                            end,
                            polygon[i],
                            polygon[(i + 1) % polygon.length]
                        )
                    );
                }
                return distance;
            }

            function hasLandClearanceAlongPath(start, end, polygons, clearanceNm) {
                return polygons.every(
                    polygon => segmentToPolygonDistance(start, end, polygon) >= clearanceNm
                );
            }

            function polygonsOverlap(first, second) {
                for (let i = 0; i < first.length; i++) {
                    for (let j = 0; j < second.length; j++) {
                        if (segmentsIntersect(
                            first[i],
                            first[(i + 1) % first.length],
                            second[j],
                            second[(j + 1) % second.length]
                        )) {
                            return true;
                        }
                    }
                }
                return pointInPolygon(first[0], second) || pointInPolygon(second[0], first);
            }

            function polygonSelfIntersects(polygon) {
                for (let i = 0; i < polygon.length; i++) {
                    for (let j = i + 1; j < polygon.length; j++) {
                        const adjacent = j === i + 1 || (i === 0 && j === polygon.length - 1);
                        if (adjacent) continue;
                        if (segmentsIntersect(
                            polygon[i],
                            polygon[(i + 1) % polygon.length],
                            polygon[j],
                            polygon[(j + 1) % polygon.length]
                        )) {
                            return true;
                        }
                    }
                }
                return false;
            }

            function smoothClosedPolygon(points, rounds) {
                let smoothed = points.map(point => ({ x: point.x, y: point.y }));
                for (let round = 0; round < rounds; round++) {
                    const next = [];
                    for (let i = 0; i < smoothed.length; i++) {
                        const current = smoothed[i];
                        const following = smoothed[(i + 1) % smoothed.length];
                        next.push({
                            x: current.x * 0.75 + following.x * 0.25,
                            y: current.y * 0.75 + following.y * 0.25
                        });
                        next.push({
                            x: current.x * 0.25 + following.x * 0.75,
                            y: current.y * 0.25 + following.y * 0.75
                        });
                    }
                    smoothed = next;
                }
                return smoothed;
            }

            function seededNoise(seed) {
                const raw = Math.sin(seed * 12.9898) * 43758.5453;
                return raw - Math.floor(raw);
            }

            function normalizeDegrees(value) {
                return ((value % 360) + 360) % 360;
            }

            function trueBearingToDisplayBearing(
                trueBearing,
                headingMode,
                ownHeading
            ) {
                return normalizeDegrees(
                    trueBearing - (headingMode === 'NORTH_UP' ? 0 : ownHeading)
                );
            }

            function displayBearingToTrueBearing(
                displayBearing,
                headingMode,
                ownHeading
            ) {
                return normalizeDegrees(
                    displayBearing + (headingMode === 'NORTH_UP' ? 0 : ownHeading)
                );
            }

            function clockwiseBearingSpan(startBearing, endBearing) {
                return normalizeDegrees(endBearing - startBearing);
            }

            function shortestBearingDelta(fromBearing, toBearing) {
                const delta = normalizeDegrees(toBearing - fromBearing);
                return delta > 180 ? delta - 360 : delta;
            }

            function bearingInsideSector(bearing, startBearing, endBearing) {
                const width = clockwiseBearingSpan(startBearing, endBearing);
                if (width <= 0) return false;
                return normalizeDegrees(bearing - startBearing) <= width;
            }

            function measurementFromPoint(point, state) {
                const dx = point.x - state.center.x;
                const dy = point.y - state.center.y;
                const pixelRange = Math.min(
                    state.radiusPixels,
                    Math.hypot(dx, dy)
                );
                const displayBearing = normalizeDegrees(
                    Math.atan2(dx, -dy) * 180 / Math.PI
                );
                return {
                    rangeNm: pixelRange / state.radiusPixels * state.rangeNm,
                    trueBearing: displayBearingToTrueBearing(
                        displayBearing,
                        state.headingMode,
                        state.ownHeading
                    )
                };
            }

            function guardMeasurementFromPoint(point, state) {
                const dx = point.x - state.center.x;
                const dy = point.y - state.center.y;
                const displayBearing = normalizeDegrees(
                    Math.atan2(dx, -dy) * 180 / Math.PI
                );
                return {
                    rangeNm: Math.min(
                        state.rangeNm,
                        Math.hypot(dx, dy) / state.radiusPixels * state.rangeNm
                    ),
                    trueBearing: displayBearingToTrueBearing(
                        displayBearing,
                        state.headingMode,
                        state.ownHeading
                    )
                };
            }

            function polarPoint(center, bearingDegrees, radiusPixels) {
                const radians = bearingDegrees * Math.PI / 180;
                return {
                    x: center.x + Math.sin(radians) * radiusPixels,
                    y: center.y - Math.cos(radians) * radiusPixels
                };
            }

            function guardZoneGeometry(zone, state) {
                const startDisplayBearing = trueBearingToDisplayBearing(
                    zone.startBearing,
                    state.headingMode,
                    state.ownHeading
                );
                const endDisplayBearing = trueBearingToDisplayBearing(
                    zone.endBearing,
                    state.headingMode,
                    state.ownHeading
                );
                const angularWidth = clockwiseBearingSpan(
                    startDisplayBearing,
                    endDisplayBearing
                );
                const innerRadiusPixels = zone.innerRange / state.rangeNm * state.radiusPixels;
                const outerRadiusPixels = zone.outerRange / state.rangeNm * state.radiusPixels;
                const midRadiusPixels = (innerRadiusPixels + outerRadiusPixels) / 2;
                const midDisplayBearing = normalizeDegrees(
                    startDisplayBearing + angularWidth / 2
                );
                const center = { ...state.center };
                const ppiCenter = state.ppiCenter ? { ...state.ppiCenter } : null;
                const startInner = polarPoint(center, startDisplayBearing, innerRadiusPixels);
                const startOuter = polarPoint(center, startDisplayBearing, outerRadiusPixels);
                const endInner = polarPoint(center, endDisplayBearing, innerRadiusPixels);
                const endOuter = polarPoint(center, endDisplayBearing, outerRadiusPixels);
                const handles = {
                    inner: polarPoint(center, midDisplayBearing, innerRadiusPixels),
                    outer: polarPoint(center, midDisplayBearing, outerRadiusPixels),
                    start: polarPoint(center, startDisplayBearing, midRadiusPixels),
                    end: polarPoint(center, endDisplayBearing, midRadiusPixels)
                };
                return {
                    zone: { ...zone },
                    center,
                    ppiCenter,
                    headingMode: state.headingMode,
                    ownHeading: state.ownHeading,
                    rangeNm: state.rangeNm,
                    radiusPixels: state.radiusPixels,
                    innerRangeNm: zone.innerRange,
                    outerRangeNm: zone.outerRange,
                    startBearing: zone.startBearing,
                    endBearing: zone.endBearing,
                    startDisplayBearing,
                    endDisplayBearing,
                    angularWidth,
                    innerRadiusPixels,
                    outerRadiusPixels,
                    midRadiusPixels,
                    midDisplayBearing,
                    handles,
                    startEdge: { start: startInner, end: startOuter },
                    endEdge: { start: endInner, end: endOuter },
                    bodyHandle: polarPoint(center, midDisplayBearing, midRadiusPixels)
                };
            }

            function guardHitTolerance(pointerType) {
                return pointerType === 'touch' || pointerType === 'pen'
                    ? { handle: 18, boundary: 14 }
                    : { handle: 12, boundary: 10 };
            }

            function hitTestGuardZone(point, geometry, tolerance) {
                if (
                    geometry.ppiCenter &&
                    Math.hypot(
                        point.x - geometry.ppiCenter.x,
                        point.y - geometry.ppiCenter.y
                    ) > geometry.radiusPixels
                ) {
                    return null;
                }

                for (const component of ['inner', 'outer', 'start', 'end']) {
                    const handle = geometry.handles && geometry.handles[component];
                    if (
                        handle &&
                        Math.hypot(point.x - handle.x, point.y - handle.y) <= tolerance.handle
                    ) {
                        return component;
                    }
                }

                const measurement = guardMeasurementFromPoint(point, geometry);
                const pointRadiusPixels = Math.hypot(
                    point.x - geometry.center.x,
                    point.y - geometry.center.y
                );
                if (bearingInsideSector(
                    measurement.trueBearing,
                    geometry.startBearing,
                    geometry.endBearing
                )) {
                    if (
                        Math.abs(pointRadiusPixels - geometry.innerRadiusPixels) <= tolerance.boundary
                    ) {
                        return 'inner';
                    }
                    if (
                        Math.abs(pointRadiusPixels - geometry.outerRadiusPixels) <= tolerance.boundary
                    ) {
                        return 'outer';
                    }
                }

                if (
                    pointToSegmentDistance(
                        point,
                        geometry.startEdge.start,
                        geometry.startEdge.end
                    ) <= tolerance.boundary
                ) {
                    return 'start';
                }
                if (
                    pointToSegmentDistance(
                        point,
                        geometry.endEdge.start,
                        geometry.endEdge.end
                    ) <= tolerance.boundary
                ) {
                    return 'end';
                }

                if (
                    pointRadiusPixels >= geometry.innerRadiusPixels &&
                    pointRadiusPixels <= geometry.outerRadiusPixels &&
                    bearingInsideSector(
                        measurement.trueBearing,
                        geometry.startBearing,
                        geometry.endBearing
                    )
                ) {
                    return 'body';
                }

                return null;
            }

            function applyGuardBoundaryDrag(
                zone,
                component,
                measurement,
                constraints
            ) {
                const maxRangeNm = constraints.maxRangeNm;
                const minThicknessNm = constraints.minThicknessNm ?? 0.1;
                const minWidthDeg = constraints.minWidthDeg ?? 10;

                if (component === 'inner') {
                    return {
                        ...zone,
                        innerRange: Math.max(
                            0,
                            Math.min(
                                measurement.rangeNm,
                                zone.outerRange - minThicknessNm,
                                maxRangeNm - minThicknessNm
                            )
                        )
                    };
                }

                if (component === 'outer') {
                    return {
                        ...zone,
                        outerRange: Math.min(
                            maxRangeNm,
                            Math.max(
                                measurement.rangeNm,
                                zone.innerRange + minThicknessNm
                            )
                        )
                    };
                }

                if (component === 'start') {
                    const maximumClosingDelta = Math.max(
                        0,
                        clockwiseBearingSpan(zone.startBearing, zone.endBearing) -
                            minWidthDeg
                    );
                    const dragDelta = shortestBearingDelta(
                        zone.startBearing,
                        measurement.trueBearing
                    );
                    const startBearing = dragDelta > maximumClosingDelta
                        ? normalizeDegrees(zone.startBearing + maximumClosingDelta)
                        : normalizeDegrees(measurement.trueBearing);
                    return {
                        ...zone,
                        startBearing
                    };
                }

                if (component === 'end') {
                    const maximumClosingDelta = Math.max(
                        0,
                        clockwiseBearingSpan(zone.startBearing, zone.endBearing) -
                            minWidthDeg
                    );
                    const dragDelta = shortestBearingDelta(
                        zone.endBearing,
                        measurement.trueBearing
                    );
                    const endBearing = dragDelta < -maximumClosingDelta
                        ? normalizeDegrees(zone.endBearing - maximumClosingDelta)
                        : normalizeDegrees(measurement.trueBearing);
                    return {
                        ...zone,
                        endBearing
                    };
                }

                return { ...zone };
            }

            function rotateGuardZone(zone, pointerBearing, dragOrigin) {
                const delta = shortestBearingDelta(
                    dragOrigin.pointerBearing,
                    pointerBearing
                );
                return {
                    ...zone,
                    startBearing: normalizeDegrees(dragOrigin.startBearing + delta),
                    endBearing: normalizeDegrees(dragOrigin.endBearing + delta)
                };
            }

            function targetInsideGuardZone(measurement, zone) {
                return (
                    measurement.rangeNm >= zone.innerRange &&
                    measurement.rangeNm <= zone.outerRange &&
                    bearingInsideSector(
                        measurement.trueBearing,
                        zone.startBearing,
                        zone.endBearing
                    )
                );
            }

            function guardTargetKey(target) {
                return `${target.id}:${target.generation}`;
            }

            function updateGuardAlarmLifecycle(lifecycle, detection) {
                const targetsInside = new Set(lifecycle.targetsInside || []);
                let alarmActive = lifecycle.alarmActive;
                let alarmSequence = lifecycle.alarmSequence;
                const wasInside = targetsInside.has(detection.key);

                if (detection.inside) {
                    targetsInside.add(detection.key);
                    if (!wasInside) {
                        alarmActive = true;
                        alarmSequence += 1;
                    }
                } else {
                    targetsInside.delete(detection.key);
                }

                return {
                    ...lifecycle,
                    targetsInside,
                    alarmActive,
                    alarmSequence
                };
            }

            function pruneGuardAlarmLifecycle(lifecycle, liveKeys) {
                return {
                    ...lifecycle,
                    targetsInside: new Set(
                        [...(lifecycle.targetsInside || [])].filter(
                            key => liveKeys.has(key)
                        )
                    )
                };
            }

            function guardZoneControlTransition(zone, action) {
                const next = {
                    ...zone,
                    targetsInside: new Set(zone.targetsInside || [])
                };

                if (action === 'hide') {
                    next.active = false;
                    next.edit = false;
                    next.armed = false;
                    next.alarmActive = false;
                    next.targetsInside.clear();
                    return next;
                }

                if (action !== 'show-change') {
                    throw new Error(`Unsupported Guard Zone action: ${action}`);
                }

                if (!next.active) {
                    next.active = true;
                    next.edit = true;
                    next.armed = false;
                    next.alarmActive = false;
                    next.targetsInside.clear();
                    return next;
                }

                if (next.alarmActive) {
                    next.alarmActive = false;
                    next.edit = false;
                    next.armed = true;
                    return next;
                }

                if (next.edit) {
                    next.edit = false;
                    next.armed = true;
                    next.alarmActive = false;
                    next.targetsInside.clear();
                    return next;
                }

                next.edit = true;
                next.armed = false;
                next.alarmActive = false;
                next.targetsInside.clear();
                return next;
            }

            function rayCircleBoundaryDistance(
                origin,
                direction,
                circleCenter,
                radius
            ) {
                const offset = {
                    x: origin.x - circleCenter.x,
                    y: origin.y - circleCenter.y
                };
                const projection = (
                    offset.x * direction.x +
                    offset.y * direction.y
                );
                const discriminant = (
                    projection * projection -
                    (offset.x * offset.x + offset.y * offset.y - radius * radius)
                );
                return -projection + Math.sqrt(Math.max(0, discriminant));
            }

            function sweepAzimuths(previousDegrees, advanceDegrees, stepDegrees) {
                if (!(stepDegrees > 0)) {
                    throw new Error('Azimuth step must be positive');
                }
                if (advanceDegrees < 0) {
                    throw new Error('Sweep advance cannot be negative');
                }
                const start = normalizeDegrees(previousDegrees);
                const advance = Math.min(360, advanceDegrees);
                const bins = [];
                const count = Math.ceil(advance / stepDegrees);
                for (let index = 1; index <= count; index++) {
                    bins.push(normalizeDegrees(
                        start + Math.min(index * stepDegrees, advance)
                    ));
                }
                return bins;
            }

            function boundedSweepAdvance(advanceDegrees, maxCatchUpDegrees) {
                if (advanceDegrees < 0 || !(maxCatchUpDegrees > 0)) {
                    throw new Error('Sweep bounds must be positive');
                }
                return advanceDegrees > maxCatchUpDegrees ? 0 : advanceDegrees;
            }

            function bearingSwept(
                previousDegrees,
                advanceDegrees,
                bearingDegrees,
                halfBeamDegrees = 0
            ) {
                if (advanceDegrees <= 0) return false;
                const offset = normalizeDegrees(bearingDegrees - previousDegrees);
                return (
                    offset <= advanceDegrees + halfBeamDegrees ||
                    offset >= 360 - halfBeamDegrees
                );
            }

            function sweptBearingCycle(
                previousDegrees,
                advanceDegrees,
                bearingDegrees,
                halfBeamDegrees,
                endingCycle
            ) {
                if (!bearingSwept(
                    previousDegrees,
                    advanceDegrees,
                    bearingDegrees,
                    halfBeamDegrees
                )) {
                    return null;
                }
                const start = normalizeDegrees(previousDegrees);
                const crossedWrap = start + advanceDegrees >= 360;
                const baseCycle = endingCycle - (crossedWrap ? 1 : 0);
                let offset = normalizeDegrees(bearingDegrees - start);
                if (offset >= 360 - halfBeamDegrees) {
                    return baseCycle - (
                        normalizeDegrees(bearingDegrees) > start ? 1 : 0
                    );
                }
                return baseCycle + Math.floor((start + offset) / 360);
            }

            function raySegmentIntersection(origin, direction, start, end) {
                const edge = { x: end.x - start.x, y: end.y - start.y };
                const determinant = direction.x * edge.y - direction.y * edge.x;
                if (Math.abs(determinant) < 1e-10) return null;

                const offset = { x: start.x - origin.x, y: start.y - origin.y };
                const distance = (
                    offset.x * edge.y - offset.y * edge.x
                ) / determinant;
                const segmentT = (
                    offset.x * direction.y - offset.y * direction.x
                ) / determinant;
                if (distance < 0 || segmentT < 0 || segmentT >= 1) return null;
                return { distance, segmentT };
            }

            function landIntervalsOnRay(origin, bearingDegrees, polygons, maxRangeNm) {
                const radians = bearingDegrees * Math.PI / 180;
                const direction = { x: Math.sin(radians), y: Math.cos(radians) };
                const intervals = [];

                polygons.forEach((polygon, polygonIndex) => {
                    const hits = [];
                    for (let index = 0; index < polygon.length; index++) {
                        const start = polygon[index];
                        const end = polygon[(index + 1) % polygon.length];
                        const hit = raySegmentIntersection(origin, direction, start, end);
                        if (!hit) continue;
                        const edgeLength = Math.hypot(end.x - start.x, end.y - start.y);
                        if (edgeLength < 1e-10) continue;
                        const normal = {
                            x: -(end.y - start.y) / edgeLength,
                            y: (end.x - start.x) / edgeLength
                        };
                        hits.push({
                            distance: hit.distance,
                            incidence: Math.abs(
                                normal.x * direction.x + normal.y * direction.y
                            )
                        });
                    }
                    hits.sort((left, right) => left.distance - right.distance);
                    const uniqueHits = [];
                    for (const hit of hits) {
                        const previous = uniqueHits[uniqueHits.length - 1];
                        if (
                            previous &&
                            Math.abs(previous.distance - hit.distance) <= 1e-7
                        ) {
                            previous.incidence = Math.max(
                                previous.incidence,
                                hit.incidence
                            );
                        } else {
                            uniqueHits.push({ ...hit });
                        }
                    }

                    let entry = pointInPolygon(origin, polygon)
                        ? { distance: 0, incidence: 1 }
                        : null;
                    for (const hit of uniqueHits) {
                        const epsilon = Math.max(
                            1e-7,
                            Math.min(1e-4, Math.max(1, hit.distance) * 1e-7)
                        );
                        const beforeDistance = Math.max(0, hit.distance - epsilon);
                        const afterDistance = hit.distance + epsilon;
                        const beforeInside = pointInPolygon({
                            x: origin.x + direction.x * beforeDistance,
                            y: origin.y + direction.y * beforeDistance
                        }, polygon);
                        const afterInside = pointInPolygon({
                            x: origin.x + direction.x * afterDistance,
                            y: origin.y + direction.y * afterDistance
                        }, polygon);
                        if (beforeInside === afterInside) continue;

                        if (!beforeInside && afterInside) {
                            entry = hit;
                            continue;
                        }
                        if (entry && entry.distance < maxRangeNm) {
                            intervals.push({
                                entryRange: entry.distance,
                                exitRange: Math.min(maxRangeNm, hit.distance),
                                incidence: entry.incidence,
                                polygonIndex
                            });
                        }
                        entry = null;
                    }
                    if (entry && entry.distance < maxRangeNm) {
                        intervals.push({
                            entryRange: entry.distance,
                            exitRange: maxRangeNm,
                            incidence: entry.incidence,
                            polygonIndex
                        });
                    }
                });

                return intervals.sort(
                    (left, right) => left.entryRange - right.entryRange
                );
            }

            function smoothstep(value) {
                return value * value * (3 - 2 * value);
            }

            function valueNoise2D(x, y, seed) {
                const x0 = Math.floor(x);
                const y0 = Math.floor(y);
                const tx = smoothstep(x - x0);
                const ty = smoothstep(y - y0);
                const hash = (ix, iy) => seededNoise(
                    ix * 374761393 + iy * 668265263 + seed * 1442695041
                );
                const top = hash(x0, y0) * (1 - tx) + hash(x0 + 1, y0) * tx;
                const bottom = (
                    hash(x0, y0 + 1) * (1 - tx) +
                    hash(x0 + 1, y0 + 1) * tx
                );
                return top * (1 - ty) + bottom * ty;
            }

            function terrainReflectivity(x, y, detailScale) {
                const scale = Math.max(0.25, detailScale);
                const low = valueNoise2D(
                    x * 0.42 / scale,
                    y * 0.42 / scale,
                    17
                );
                const medium = valueNoise2D(
                    x * 1.65 / scale,
                    y * 1.65 / scale,
                    53
                );
                const high = valueNoise2D(
                    x * 5.4 / scale,
                    y * 5.4 / scale,
                    97
                );
                const combined = low * 0.28 + medium * 0.52 + high * 0.20;
                return Math.pow(
                    Math.max(0, Math.min(1, combined)),
                    2.35
                );
            }

            function terrainClusterProfile(x, y, detailScale, incidence) {
                const scale = Math.max(0.25, detailScale);
                const reflectivity = terrainReflectivity(x, y, scale);
                const cluster = valueNoise2D(
                    x * 1.9 / scale,
                    y * 1.9 / scale,
                    211
                );
                const breakup = valueNoise2D(
                    x * 7.5 / scale,
                    y * 7.5 / scale,
                    307
                );
                const depth = valueNoise2D(
                    x * 2.7 / scale,
                    y * 2.7 / scale,
                    401
                );
                const spread = valueNoise2D(
                    x * 4.3 / scale,
                    y * 4.3 / scale,
                    503
                );
                const coastGate = valueNoise2D(
                    x * 4.9 / scale,
                    y * 4.9 / scale,
                    607
                );
                const visibility = Math.pow(
                    Math.max(
                        0,
                        Math.min(
                            1,
                            reflectivity * 0.5 +
                                cluster * 0.38 +
                                breakup * 0.12
                        )
                    ),
                    1.35
                );
                return {
                    reflectivity,
                    visibility,
                    coastStrength: visibility * (
                        0.65 +
                        0.35 * Math.max(0, Math.min(1, incidence))
                    ),
                    depthCells: 0.6 + depth * depth * 5.8,
                    seaSpreadCells: Math.max(0, spread - 0.58) * 2.2,
                    beamScale: 0.55 + cluster * 0.9,
                    coastGate
                };
            }

            function radialResolutionNm(rangeNm, radiusPixels) {
                return Math.max(
                    0.012,
                    rangeNm / Math.max(120, radiusPixels) * 1.6
                );
            }

            function landEchoIntensity({
                reflectivity,
                visibility,
                coastStrength,
                rangeNm,
                gain,
                sea,
                occlusion
            }) {
                const rangeResponse = 1 / (1 + 0.008 * rangeNm * rangeNm);
                const gainResponse = Math.pow(10, (gain - 65) / 70);
                const clutterThreshold = 0.11 + sea / 100 * 0.08;
                const shadow = (
                    1 -
                    Math.max(0, Math.min(0.82, occlusion)) * 0.72
                );
                const raw = (
                    reflectivity * 0.72 +
                    visibility * 0.42 +
                    coastStrength * 0.28
                ) * rangeResponse * gainResponse * shadow;
                return Math.max(
                    0,
                    Math.min(1, (raw - clutterThreshold) * 1.55)
                );
            }

            function sampleLandRay(origin, bearingDegrees, polygons, options) {
                const {
                    maxRangeNm,
                    radiusPixels,
                    gain,
                    sea
                } = options;
                const resolution = radialResolutionNm(maxRangeNm, radiusPixels);
                const detailScale = 1 + maxRangeNm / 24;
                const radians = bearingDegrees * Math.PI / 180;
                const direction = { x: Math.sin(radians), y: Math.cos(radians) };
                const cells = [];
                let occlusion = 0;
                let occlusionRange = 0;

                for (const interval of landIntervalsOnRay(
                    origin,
                    bearingDegrees,
                    polygons,
                    maxRangeNm
                )) {
                    const start = Math.max(0, interval.entryRange);
                    const end = Math.min(maxRangeNm, interval.exitRange);
                    const entryX = origin.x + direction.x * start;
                    const entryY = origin.y + direction.y * start;
                    const baseProfile = terrainClusterProfile(
                        entryX,
                        entryY,
                        detailScale,
                        interval.incidence
                    );
                    const seaSpread = (
                        baseProfile.visibility > 0.4
                            ? baseProfile.seaSpreadCells * resolution
                            : 0
                    );
                    const sampleStart = Math.max(0, start - seaSpread);
                    for (
                        let range = sampleStart;
                        range < end;
                        range += resolution
                    ) {
                        const decayCells = Math.max(
                            0,
                            (range - occlusionRange) / resolution
                        );
                        occlusion = Math.max(
                            0,
                            occlusion - decayCells * 0.035
                        );
                        occlusionRange = Math.max(occlusionRange, range);
                        const worldX = origin.x + direction.x * range;
                        const worldY = origin.y + direction.y * range;
                        const profile = terrainClusterProfile(
                            worldX,
                            worldY,
                            detailScale,
                            interval.incidence
                        );
                        const depthCells = Math.max(
                            0,
                            range - start
                        ) / resolution;
                        const coastEnvelope = Math.max(
                            0,
                            1 - depthCells / Math.max(
                                0.5,
                                baseProfile.depthCells
                            )
                        );
                        const eligibility = (
                            profile.visibility +
                            coastEnvelope * baseProfile.coastStrength * 0.24
                        );
                        const threshold = (
                            0.3 +
                            maxRangeNm / 400 +
                            Math.min(0.16, occlusion * 0.18)
                        );
                        const breakupThreshold = 0.38 - coastEnvelope * 0.05;
                        if (
                            eligibility < threshold ||
                            profile.coastGate < breakupThreshold
                        ) {
                            continue;
                        }

                        const intensity = landEchoIntensity({
                            reflectivity: profile.reflectivity,
                            visibility: profile.visibility,
                            coastStrength: (
                                coastEnvelope * baseProfile.coastStrength
                            ),
                            rangeNm: Math.max(start, range),
                            gain,
                            sea,
                            occlusion
                        });
                        if (intensity <= 0.045) continue;

                        const footprint = 0.7 + profile.depthCells * 0.24;
                        cells.push({
                            range,
                            length: (
                                resolution * Math.min(2.4, footprint)
                            ),
                            intensity,
                            beamScale: profile.beamScale,
                            worldX,
                            worldY
                        });
                        occlusion = Math.min(
                            1,
                            occlusion + intensity * 0.22
                        );
                    }
                }
                return cells;
            }

            function safeNextPosition(
                position,
                heading,
                speedKnots,
                deltaTimeSeconds,
                isSafe,
                isPathSafe
            ) {
                const distanceNm = speedKnots / 3600 * deltaTimeSeconds;
                const radians = heading * Math.PI / 180;
                const candidate = {
                    x: position.x + distanceNm * Math.sin(radians),
                    y: position.y + distanceNm * Math.cos(radians)
                };
                if (!isSafe(candidate) || !isPathSafe(position, candidate)) {
                    return { x: position.x, y: position.y };
                }
                return candidate;
            }

            function measurementGeometry(measurement, state) {
                const displayBearing = trueBearingToDisplayBearing(
                    measurement.bearing,
                    state.headingMode,
                    state.ownHeading
                );
                const radians = displayBearing * Math.PI / 180;
                const vrmRadiusPixels = (
                    measurement.range / state.rangeNm * state.radiusPixels
                );
                const vrmVisible = (
                    measurement.range >= 0 &&
                    measurement.range <= state.rangeNm
                );
                const direction = {
                    x: Math.sin(radians),
                    y: -Math.cos(radians)
                };
                const eblLengthPixels = rayCircleBoundaryDistance(
                    state.center,
                    direction,
                    state.ppiCenter,
                    state.radiusPixels
                );
                const eblEnd = {
                    x: state.center.x + direction.x * eblLengthPixels,
                    y: state.center.y + direction.y * eblLengthPixels
                };
                const candidateHandle = {
                    x: state.center.x + direction.x * vrmRadiusPixels,
                    y: state.center.y + direction.y * vrmRadiusPixels
                };
                const handleInsidePpi = Math.hypot(
                    candidateHandle.x - state.ppiCenter.x,
                    candidateHandle.y - state.ppiCenter.y
                ) <= state.radiusPixels;
                return {
                    center: { ...state.center },
                    ppiCenter: { ...state.ppiCenter },
                    displayBearing,
                    vrmRadiusPixels,
                    vrmVisible,
                    eblEnd,
                    handle: vrmVisible && handleInsidePpi ? candidateHandle : null,
                    radarRadiusPixels: state.radiusPixels
                };
            }

            function measurementHitTolerance(pointerType) {
                return pointerType === 'touch' || pointerType === 'pen'
                    ? { handle: 18, vrm: 14, ebl: 16 }
                    : { handle: 12, vrm: 9, ebl: 10 };
            }

            function hitTestMeasurement(point, geometry, tolerance) {
                const insidePpi = Math.hypot(
                    point.x - geometry.ppiCenter.x,
                    point.y - geometry.ppiCenter.y
                ) <= geometry.radarRadiusPixels;
                if (
                    geometry.handle &&
                    Math.hypot(
                        point.x - geometry.handle.x,
                        point.y - geometry.handle.y
                    ) <= tolerance.handle
                ) return 'handle';

                const pointRadius = Math.hypot(
                    point.x - geometry.center.x,
                    point.y - geometry.center.y
                );
                if (
                    geometry.vrmVisible &&
                    insidePpi &&
                    Math.abs(pointRadius - geometry.vrmRadiusPixels) <= tolerance.vrm
                ) return 'vrm';

                if (
                    insidePpi &&
                    pointToSegmentDistance(
                        point,
                        geometry.center,
                        geometry.eblEnd
                    ) <= tolerance.ebl
                ) return 'ebl';

                return null;
            }

            function applyMeasurementDrag(
                measurement,
                component,
                point,
                state
            ) {
                const selected = measurementFromPoint(point, state);
                return {
                    ...measurement,
                    range: component === 'ebl'
                        ? measurement.range
                        : selected.rangeNm,
                    bearing: component === 'vrm'
                        ? measurement.bearing
                        : selected.trueBearing
                };
            }

            return {
                clientToCanvas,
                clampToCircle,
                worldToDisplay,
                displayToWorld,
                rotationDurationMs,
                echoAlpha,
                velocityVector,
                recordWakeSample,
                clearWakeTrails,
                setWakeRecording,
                resetTargetGeneration,
                calculateCpaTcpa,
                pointToSegmentDistance,
                distanceToPolygon,
                hasLandClearance,
                segmentToPolygonDistance,
                hasLandClearanceAlongPath,
                polygonsOverlap,
                polygonSelfIntersects,
                smoothClosedPolygon,
                seededNoise,
                normalizeDegrees,
                trueBearingToDisplayBearing,
                displayBearingToTrueBearing,
                clockwiseBearingSpan,
                shortestBearingDelta,
                bearingInsideSector,
                measurementFromPoint,
                guardMeasurementFromPoint,
                guardZoneGeometry,
                guardHitTolerance,
                hitTestGuardZone,
                applyGuardBoundaryDrag,
                rotateGuardZone,
                targetInsideGuardZone,
                guardTargetKey,
                updateGuardAlarmLifecycle,
                pruneGuardAlarmLifecycle,
                guardZoneControlTransition,
                rayCircleBoundaryDistance,
                measurementGeometry,
                measurementHitTolerance,
                hitTestMeasurement,
                applyMeasurementDrag,
                sweepAzimuths,
                boundedSweepAdvance,
                bearingSwept,
                sweptBearingCycle,
                raySegmentIntersection,
                landIntervalsOnRay,
                valueNoise2D,
                terrainReflectivity,
                terrainClusterProfile,
                radialResolutionNm,
                landEchoIntensity,
                sampleLandRay,
                safeNextPosition
            };
        })();
        /* RADAR_MATH_END */