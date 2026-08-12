const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const htmlPath = path.resolve(ROOT, process.argv[2] || 'dist/radar.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/\/\* RADAR_MATH_START \*\/([\s\S]*?)\/\* RADAR_MATH_END \*\//);
assert.ok(match, 'radarMath block must be extractable');

const context = { window: {} };
vm.runInNewContext(`${match[1]}; window.result = radarMath;`, context);
const math = context.window.result;

function close(actual, expected, tolerance = 1e-9) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

assert.deepEqual(
    { ...math.clientToCanvas(150, 100, { left: 100, top: 50, width: 200, height: 100 }, 400, 200) },
    { x: 100, y: 100 }
);

assert.deepEqual(
    { ...math.clampToCircle({ x: 130, y: 100 }, { x: 100, y: 100 }, 20) },
    { x: 120, y: 100, clamped: true }
);

assert.deepEqual(
    {
        ...math.clientToCanvas(
            350,
            250,
            { left: 100, top: 50, width: 500, height: 500 },
            1000,
            1000
        )
    },
    { x: 500, y: 400 }
);

for (const headingMode of ['NORTH_UP', 'HEAD_UP', 'COURSE_UP']) {
    for (const offset of [false, true]) {
        const state = {
            ownShip: { x: 47, y: 48.5, heading: 30 },
            headingMode,
            offset,
            centerX: 300,
            centerY: 300,
            radius: 240,
            range: 12
        };
        const world = { x: 49.2, y: 51.1 };
        const display = math.worldToDisplay(world, state);
        const roundTrip = math.displayToWorld(display, state);
        close(roundTrip.x, world.x);
        close(roundTrip.y, world.y);
    }
}

assert.equal(math.trueBearingToDisplayBearing(73, 'NORTH_UP', 30), 73);
assert.equal(math.trueBearingToDisplayBearing(73, 'HEAD_UP', 30), 43);
assert.equal(math.trueBearingToDisplayBearing(10, 'COURSE_UP', 30), 340);
assert.equal(math.displayBearingToTrueBearing(43, 'HEAD_UP', 30), 73);
assert.equal(math.displayBearingToTrueBearing(340, 'COURSE_UP', 30), 10);

assert.equal(math.clockwiseBearingSpan(330, 30), 60);
assert.equal(math.clockwiseBearingSpan(30, 60), 30);
assert.equal(math.shortestBearingDelta(350, 10), 20);
assert.equal(math.shortestBearingDelta(10, 350), -20);
assert.equal(math.bearingInsideSector(0, 330, 30), true);
assert.equal(math.bearingInsideSector(330, 330, 30), true);
assert.equal(math.bearingInsideSector(30, 330, 30), true);
assert.equal(math.bearingInsideSector(180, 330, 30), false);
assert.equal(math.bearingInsideSector(30, 30, 30), false);

const guardZone = {
    innerRange: 2,
    outerRange: 4,
    startBearing: 330,
    endBearing: 30
};
const originalGuardZone = { ...guardZone };
assert.equal(
    math.targetInsideGuardZone(
        { rangeNm: 3, trueBearing: 0 },
        guardZone
    ),
    true
);
assert.equal(
    math.targetInsideGuardZone(
        { rangeNm: 1.99, trueBearing: 0 },
        guardZone
    ),
    false
);
assert.equal(
    math.targetInsideGuardZone(
        { rangeNm: 3, trueBearing: 180 },
        guardZone
    ),
    false
);

const measurementState = {
    center: { x: 300, y: 260 },
    ppiCenter: { x: 300, y: 260 },
    radiusPixels: 240,
    rangeNm: 12,
    headingMode: 'HEAD_UP',
    ownHeading: 30
};
const northPoint = { x: 300, y: 140 };
assert.deepEqual(
    { ...math.measurementFromPoint(northPoint, measurementState) },
    { rangeNm: 6, trueBearing: 30 }
);

const guardState = {
    ...measurementState,
    center: { x: 300, y: 260 }
};
const guardGeometry = math.guardZoneGeometry(guardZone, guardState);
close(guardGeometry.innerRadiusPixels, 40);
close(guardGeometry.outerRadiusPixels, 80);
assert.equal(guardGeometry.angularWidth, 60);
assert.equal(guardGeometry.startDisplayBearing, 300);
assert.equal(guardGeometry.endDisplayBearing, 0);
assert.ok(guardGeometry.handles.inner);
assert.ok(guardGeometry.handles.outer);
assert.ok(guardGeometry.handles.start);
assert.ok(guardGeometry.handles.end);

assert.deepEqual(
    { ...math.guardMeasurementFromPoint(
        { x: 300, y: 180 },
        guardState
    ) },
    { rangeNm: 4, trueBearing: 30 }
);

const guardMouseTolerance = math.guardHitTolerance('mouse');
assert.deepEqual({ ...guardMouseTolerance }, {
    handle: 12,
    boundary: 10
});
const guardTouchTolerance = math.guardHitTolerance('touch');
assert.ok(guardTouchTolerance.handle > guardMouseTolerance.handle);
assert.ok(guardTouchTolerance.boundary > guardMouseTolerance.boundary);

const offscreenGuardGeometry = math.guardZoneGeometry(guardZone, {
    ...guardState,
    ppiCenter: { x: 700, y: 260 }
});
assert.equal(
    math.hitTestGuardZone(
        offscreenGuardGeometry.bodyHandle,
        offscreenGuardGeometry,
        guardMouseTolerance
    ),
    null
);

for (const component of ['inner', 'outer', 'start', 'end']) {
    assert.equal(
        math.hitTestGuardZone(
            guardGeometry.handles[component],
            guardGeometry,
            guardMouseTolerance
        ),
        component
    );
}
assert.equal(
    math.hitTestGuardZone(
        guardGeometry.bodyHandle,
        guardGeometry,
        guardMouseTolerance
    ),
    'body'
);
assert.equal(
    math.hitTestGuardZone(
        { x: 100, y: 100 },
        guardGeometry,
        guardMouseTolerance
    ),
    null
);

const baseGuardControl = {
    active: false,
    edit: false,
    armed: false,
    alarmActive: false,
    alarmSequence: 0,
    innerRange: 2,
    outerRange: 4,
    startBearing: 30,
    endBearing: 60,
    targetsInside: new Set()
};

const editingGuard = math.guardZoneControlTransition(
    baseGuardControl,
    'show-change'
);
assert.equal(editingGuard.active, true);
assert.equal(editingGuard.edit, true);
assert.equal(editingGuard.armed, false);

const armedGuard = math.guardZoneControlTransition(
    editingGuard,
    'show-change'
);
assert.equal(armedGuard.active, true);
assert.equal(armedGuard.edit, false);
assert.equal(armedGuard.armed, true);

const alarmGuard = {
    ...armedGuard,
    alarmActive: true,
    targetsInside: new Set(['1:0'])
};
const acknowledgedGuard = math.guardZoneControlTransition(
    alarmGuard,
    'show-change'
);
assert.equal(acknowledgedGuard.armed, true);
assert.equal(acknowledgedGuard.alarmActive, false);
assert.deepEqual([...acknowledgedGuard.targetsInside], ['1:0']);

const returnedToEdit = math.guardZoneControlTransition(
    acknowledgedGuard,
    'show-change'
);
assert.equal(returnedToEdit.edit, true);
assert.equal(returnedToEdit.armed, false);
assert.equal(returnedToEdit.targetsInside.size, 0);

const hiddenGuard = math.guardZoneControlTransition(
    alarmGuard,
    'hide'
);
assert.equal(hiddenGuard.active, false);
assert.equal(hiddenGuard.armed, false);
assert.equal(hiddenGuard.alarmActive, false);
assert.equal(hiddenGuard.innerRange, 2);
assert.equal(hiddenGuard.outerRange, 4);

assert.equal(math.guardTargetKey({ id: 7, generation: 3 }), '7:3');

const emptyLifecycle = {
    targetsInside: new Set(),
    alarmActive: false,
    alarmSequence: 0
};
const firstEntry = math.updateGuardAlarmLifecycle(
    emptyLifecycle,
    { key: '7:3', inside: true }
);
assert.deepEqual([...firstEntry.targetsInside], ['7:3']);
assert.equal(firstEntry.alarmActive, true);
assert.equal(firstEntry.alarmSequence, 1);

const sameTargetStillInside = math.updateGuardAlarmLifecycle(
    firstEntry,
    { key: '7:3', inside: true }
);
assert.equal(sameTargetStillInside.alarmSequence, 1);

const secondEntry = math.updateGuardAlarmLifecycle(
    { ...sameTargetStillInside, alarmActive: false },
    { key: '8:0', inside: true }
);
assert.deepEqual(
    [...secondEntry.targetsInside].sort(),
    ['7:3', '8:0']
);
assert.equal(secondEntry.alarmActive, true);
assert.equal(secondEntry.alarmSequence, 2);

const targetLeft = math.updateGuardAlarmLifecycle(
    firstEntry,
    { key: '7:3', inside: false }
);
assert.equal(targetLeft.targetsInside.size, 0);
assert.equal(targetLeft.alarmSequence, 1);

const targetReentered = math.updateGuardAlarmLifecycle(
    { ...targetLeft, alarmActive: false },
    { key: '7:3', inside: true }
);
assert.equal(targetReentered.alarmSequence, 2);

const respawnEntry = math.updateGuardAlarmLifecycle(
    firstEntry,
    { key: '7:4', inside: true }
);
assert.equal(respawnEntry.alarmSequence, 2);

const pruned = math.pruneGuardAlarmLifecycle(
    secondEntry,
    new Set(['8:0'])
);
assert.deepEqual([...pruned.targetsInside], ['8:0']);
assert.equal(pruned.alarmSequence, 2);

const geometry = math.measurementGeometry(
    { active: true, range: 6, bearing: 120 },
    measurementState
);
close(geometry.vrmRadiusPixels, 120);
close(geometry.displayBearing, 90);
close(geometry.eblEnd.x, 540);
close(geometry.eblEnd.y, 260);
close(geometry.handle.x, 420);
close(geometry.handle.y, 260);
assert.equal(geometry.vrmVisible, true);

const outsideGeometry = math.measurementGeometry(
    { active: true, range: 18, bearing: 120 },
    measurementState
);
assert.equal(outsideGeometry.vrmVisible, false);
assert.equal(outsideGeometry.handle, null);

const offsetGeometry = math.measurementGeometry(
    { active: true, range: 6, bearing: 210 },
    {
        ...measurementState,
        center: { x: 300, y: 180 },
        ppiCenter: { x: 300, y: 300 }
    }
);
close(offsetGeometry.displayBearing, 180);
close(offsetGeometry.eblEnd.x, 300);
close(offsetGeometry.eblEnd.y, 540);

const mouseTolerance = math.measurementHitTolerance('mouse');
assert.deepEqual({ ...mouseTolerance }, {
    handle: 12,
    vrm: 9,
    ebl: 10
});
const touchTolerance = math.measurementHitTolerance('touch');
assert.ok(touchTolerance.handle > mouseTolerance.handle);
assert.ok(touchTolerance.vrm > mouseTolerance.vrm);
assert.ok(touchTolerance.ebl > mouseTolerance.ebl);

assert.equal(
    math.hitTestMeasurement(
        { x: 420, y: 260 },
        geometry,
        mouseTolerance
    ),
    'handle'
);
assert.equal(
    math.hitTestMeasurement(
        { x: 300, y: 140 },
        geometry,
        mouseTolerance
    ),
    'vrm'
);
assert.equal(
    math.hitTestMeasurement(
        { x: 500, y: 263 },
        geometry,
        mouseTolerance
    ),
    'ebl'
);
assert.equal(
    math.hitTestMeasurement(
        { x: 150, y: 400 },
        geometry,
        mouseTolerance
    ),
    null
);

const offsetBugGeometry = math.measurementGeometry(
    { active: true, range: 9, bearing: 120 },
    {
        ...measurementState,
        center: { x: 300, y: 180 },
        ppiCenter: { x: 300, y: 300 },
        rangeNm: 12
    }
);
assert.equal(
    math.hitTestMeasurement(
        { x: 300, y: 0 },
        offsetBugGeometry,
        mouseTolerance
    ),
    null
);
const outsideCornerProjection = math.clampToCircle(
    { x: 0, y: 0 },
    measurementState.ppiCenter,
    measurementState.radiusPixels
);
assert.equal(outsideCornerProjection.clamped, true);
const projectedBoundaryMeasurement = math.measurementFromPoint(
    outsideCornerProjection,
    measurementState
);
const boundaryHitGeometry = math.measurementGeometry(
    {
        active: true,
        range: measurementState.rangeNm,
        bearing: projectedBoundaryMeasurement.trueBearing
    },
    measurementState
);
assert.equal(
    math.hitTestMeasurement(
        outsideCornerProjection,
        boundaryHitGeometry,
        mouseTolerance
    ),
    'handle'
);

const originalMeasurement = { active: true, range: 3, bearing: 45 };
assert.deepEqual(
    { ...math.applyMeasurementDrag(
        originalMeasurement,
        'handle',
        { x: 300, y: 20 },
        measurementState
    ) },
    { active: true, range: 12, bearing: 30 }
);
assert.deepEqual(
    { ...math.applyMeasurementDrag(
        originalMeasurement,
        'vrm',
        { x: 300, y: 140 },
        measurementState
    ) },
    { active: true, range: 6, bearing: 45 }
);
assert.deepEqual(
    { ...math.applyMeasurementDrag(
        originalMeasurement,
        'ebl',
        { x: 540, y: 260 },
        measurementState
    ) },
    { active: true, range: 3, bearing: 120 }
);
assert.deepEqual(originalMeasurement, {
    active: true,
    range: 3,
    bearing: 45
});

const guardConstraints = {
    maxRangeNm: 12,
    minThicknessNm: 0.1,
    minWidthDeg: 10
};
assert.deepEqual(
    {
        ...math.applyGuardBoundaryDrag(
            guardZone,
            'inner',
            { rangeNm: 3, trueBearing: 0 },
            guardConstraints
        )
    },
    { innerRange: 3, outerRange: 4, startBearing: 330, endBearing: 30 }
);
assert.equal(
    math.applyGuardBoundaryDrag(
        guardZone,
        'inner',
        { rangeNm: 4, trueBearing: 0 },
        guardConstraints
    ).innerRange,
    3.9
);
assert.equal(
    math.applyGuardBoundaryDrag(
        guardZone,
        'outer',
        { rangeNm: 20, trueBearing: 0 },
        guardConstraints
    ).outerRange,
    12
);
assert.equal(
    math.clockwiseBearingSpan(
        math.applyGuardBoundaryDrag(
            guardZone,
            'start',
            { rangeNm: 3, trueBearing: 25 },
            guardConstraints
        ).startBearing,
        30
    ),
    10
);
const startPastEnd = math.applyGuardBoundaryDrag(
    guardZone,
    'start',
    { rangeNm: 3, trueBearing: 30.1 },
    guardConstraints
);
close(startPastEnd.startBearing, 20);
assert.equal(
    math.clockwiseBearingSpan(startPastEnd.startBearing, startPastEnd.endBearing),
    10
);
const endPastStart = math.applyGuardBoundaryDrag(
    guardZone,
    'end',
    { rangeNm: 3, trueBearing: 329 },
    guardConstraints
);
close(endPastStart.endBearing, 340);
assert.equal(
    math.clockwiseBearingSpan(endPastStart.startBearing, endPastStart.endBearing),
    10
);
const offsetFullRangeGeometry = math.guardZoneGeometry(
    {
        innerRange: 2,
        outerRange: 12,
        startBearing: 150,
        endBearing: 210
    },
    {
        ...measurementState,
        center: { x: 300, y: 180 },
        ppiCenter: { x: 300, y: 300 },
        headingMode: 'NORTH_UP',
        ownHeading: 0
    }
);
assert.equal(
    math.hitTestGuardZone(
        { x: 300, y: 500 },
        offsetFullRangeGeometry,
        guardMouseTolerance
    ),
    null,
    'a point beyond the drawn offset outer arc must not hit the Guard body'
);
assert.deepEqual(guardZone, originalGuardZone);

const rotatedGuard = math.rotateGuardZone(
    guardZone,
    20,
    { pointerBearing: 0, startBearing: 330, endBearing: 30 }
);
assert.deepEqual(
    { ...rotatedGuard },
    { innerRange: 2, outerRange: 4, startBearing: 350, endBearing: 50 }
);
assert.equal(math.clockwiseBearingSpan(
    rotatedGuard.startBearing,
    rotatedGuard.endBearing
), 60);
assert.deepEqual(guardZone, originalGuardZone);

assert.equal(math.rotationDurationMs(144), 2500);
assert.equal(math.echoAlpha(0, 3750), 1);
assert.equal(math.echoAlpha(1875, 3750), 0.5);
assert.equal(math.echoAlpha(3750, 3750), 0);
assert.equal(math.echoAlpha(5000, 3750), 0);

assert.deepEqual({ ...math.velocityVector(10, 90) }, { x: 10, y: 0 });

const priorWake = [
    { x: 1, y: 1, time: 1000 },
    { x: 2, y: 2, time: 2000 }
];
const normalizeWake = trail => [...trail].map(point => ({ ...point }));
assert.deepEqual(
    normalizeWake(
        math.recordWakeSample(priorWake, { x: 3, y: 3 }, 3000, false)
    ),
    []
);
assert.deepEqual(
    normalizeWake(
        math.recordWakeSample(priorWake, { x: 3, y: 3 }, 3000, true)
    ),
    [
        { x: 1, y: 1, time: 1000 },
        { x: 2, y: 2, time: 2000 },
        { x: 3, y: 3, time: 3000 }
    ]
);
assert.deepEqual(
    normalizeWake(
        math.recordWakeSample(priorWake, { x: 3, y: 3 }, 62001, true)
    ),
    [{ x: 3, y: 3, time: 62001 }]
);
assert.deepEqual(priorWake, [
    { x: 1, y: 1, time: 1000 },
    { x: 2, y: 2, time: 2000 }
]);
const wakeTargets = [
    { trail: [{ x: 1, y: 1, time: 1000 }] },
    { trail: [{ x: 2, y: 2, time: 2000 }] }
];
assert.equal(math.setWakeRecording(wakeTargets, true), true);
assert.ok(wakeTargets.every(target => target.trail.length === 0));
wakeTargets[0].trail.push({ x: 3, y: 3, time: 3000 });
assert.equal(math.setWakeRecording(wakeTargets, false), false);
assert.ok(wakeTargets.every(target => target.trail.length === 0));
wakeTargets[1].trail.push({ x: 4, y: 4, time: 4000 });
math.clearWakeTrails(wakeTargets);
assert.ok(wakeTargets.every(target => target.trail.length === 0));
const resetTarget = {
    generation: 2,
    trail: [{ x: 5, y: 5, time: 5000 }],
    lastDetectedSweepCycle: 12,
    lastDetectedRangeNm: 3,
    lastDetectedTrueBearing: 45
};
math.resetTargetGeneration(resetTarget);
assert.equal(resetTarget.generation, 3);
assert.equal(resetTarget.trail.length, 0);
assert.equal(resetTarget.lastDetectedSweepCycle, null);
assert.equal(resetTarget.lastDetectedRangeNm, null);
assert.equal(resetTarget.lastDetectedTrueBearing, null);

const approaching = math.calculateCpaTcpa(
    { x: 0, y: 0, speed: 0, heading: 0 },
    { x: 10, y: 0, speed: 10, heading: 270 }
);
close(approaching.cpaNm, 0);
close(approaching.tcpaMinutes, 60);
assert.equal(approaching.past, false);

const sameVelocity = math.calculateCpaTcpa(
    { x: 0, y: 0, speed: 10, heading: 90 },
    { x: 2, y: 0, speed: 10, heading: 90 }
);
assert.equal(sameVelocity.tcpaMinutes, null);
close(sameVelocity.cpaNm, 2);

close(
    math.pointToSegmentDistance(
        { x: 1, y: 1 },
        { x: 0, y: 0 },
        { x: 2, y: 0 }
    ),
    1
);

const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 }
];
assert.equal(math.distanceToPolygon({ x: 1, y: 1 }, square), 0);
close(math.distanceToPolygon({ x: 3, y: 1 }, square), 1);
assert.equal(math.hasLandClearance({ x: 2.2, y: 1 }, [square], 0.25), false);
assert.equal(math.hasLandClearance({ x: 2.3, y: 1 }, [square], 0.25), true);
const sharpLand = [
    { x: 0, y: 0 },
    { x: 2, y: -10 },
    { x: -2, y: -10 }
];
assert.ok(
    math.segmentToPolygonDistance(
        { x: -0.015, y: 0.2497 },
        { x: 0.015, y: 0.2497 },
        sharpLand
    ) < 0.25
);
assert.equal(
    math.hasLandClearanceAlongPath(
        { x: -0.015, y: 0.2497 },
        { x: 0.015, y: 0.2497 },
        [sharpLand],
        0.25
    ),
    false
);

assert.match(html, /id="guard-zone-readout"/);
assert.match(html, /function showOrChangeGuardZone\(\)/);
assert.match(html, /function hideGuardZone\(\)/);
assert.match(html, /function drawGuardZone\(now\)/);
assert.match(html, /function recordGuardDetection\(/);
assert.match(html, /function evaluateRecentGuardDetections\(\)/);
assert.match(html, /function pruneStaleGuardDetections\(\)/);
assert.match(
    html,
    /sweepCycle \+= Math\.floor[\s\S]*pruneStaleGuardDetections\(\);/
);
assert.match(
    html,
    /if \(finalIntensity > 0\) \{[\s\S]*recordGuardDetection\(/s
);
assert.match(html, /lastDetectedSweepCycle/);
assert.match(html, /lastDetectedRangeNm/);
assert.match(html, /lastDetectedTrueBearing/);
assert.match(html, /target\.id[\s\S]*target\.generation/);
const paintLandSource = html.match(
    /function paintLand\(previousSweepAngle, sweepAdvance\) \{([\s\S]*?)\n        \}\n\n        function paintTargets/
);
assert.ok(paintLandSource, 'paintLand source must be extractable');
assert.doesNotMatch(paintLandSource[1], /recordGuardDetection\(/);
assert.match(html, /settings\.guardZone\.armed/);
assert.match(html, /settings\.guardZone\.alarmActive/);
assert.match(html, /btn-gz-show/);
assert.match(html, /textContent = guard\.alarmActive \? 'ACK' : 'SHOW\/CHG'/);
assert.match(html, /drag the inner and outer boundaries to set range/i);
assert.match(html, /drag the start and end boundaries to set bearing limits/i);
assert.match(html, /SHOW\/CHG acts as ACK first/);
assert.match(html, /keeps the stored geometry/);
assert.doesNotMatch(html, /btn-gz-hide'\)\.classList\.toggle\('active'/);
assert.doesNotMatch(html, /rgba\(255,\s*0,\s*0,\s*0\.4\)/);
assert.doesNotMatch(html, /--guard-zone-color/);
const pruneGuardSource = html.match(
    /function pruneStaleGuardDetections\(\) \{([\s\S]*?)\n        \}\n\n        function worldToScreen/
);
assert.ok(pruneGuardSource, 'pruneStaleGuardDetections source must be extractable');
assert.match(
    pruneGuardSource[1],
    /settings\.guardZone\.targetsInside = nextLifecycle\.targetsInside/
);
assert.doesNotMatch(
    pruneGuardSource[1],
    /Object\.assign\(settings\.guardZone,\s*nextLifecycle\)/
);

assert.equal(math.polygonsOverlap(square, [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 3 },
    { x: 1, y: 3 }
]), true);
assert.equal(math.polygonsOverlap(square, [
    { x: 0.5, y: 0.5 },
    { x: 1.5, y: 0.5 },
    { x: 1.5, y: 1.5 },
    { x: 0.5, y: 1.5 }
]), true);
assert.equal(math.polygonsOverlap(square, [
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 4, y: 4 },
    { x: 3, y: 4 }
]), false);
assert.equal(math.polygonSelfIntersects(square), false);
assert.equal(math.polygonSelfIntersects([
    { x: 0, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
    { x: 2, y: 0 }
]), true);
const smoothedSquare = math.smoothClosedPolygon(square, 1);
assert.equal(smoothedSquare.length, 8);
assert.equal(math.polygonSelfIntersects(smoothedSquare), false);
assert.deepEqual(
    smoothedSquare.map(point => ({ ...point })),
    math.smoothClosedPolygon(square, 1).map(point => ({ ...point }))
);
assert.equal(math.seededNoise(12345), math.seededNoise(12345));
assert.notEqual(math.seededNoise(12345), math.seededNoise(12346));

assert.equal(math.normalizeDegrees(-10), 350);
assert.equal(math.normalizeDegrees(370), 10);
assert.deepEqual(
    [...math.sweepAzimuths(358, 4, 1)],
    [359, 0, 1, 2]
);
assert.deepEqual(
    [...math.sweepAzimuths(45, 720, 90)],
    [135, 225, 315, 45]
);
assert.equal(math.boundedSweepAdvance(20, 30), 20);
assert.equal(math.boundedSweepAdvance(45, 30), 0);
assert.equal(math.bearingSwept(350, 20, 5, 3), true);
assert.equal(math.bearingSwept(350, 20, 40, 3), false);
assert.equal(math.sweptBearingCycle(350, 20, 355, 3, 1), 0);
assert.equal(math.sweptBearingCycle(350, 20, 5, 3, 1), 1);
assert.equal(math.sweptBearingCycle(10, 20, 20, 3, 4), 4);
assert.equal(math.sweptBearingCycle(1, 1, 359, 3, 1), 0);

assert.deepEqual(
    { ...math.raySegmentIntersection(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: -1 },
        { x: 2, y: 1 }
    ) },
    { distance: 2, segmentT: 0.5 }
);
assert.equal(
    math.raySegmentIntersection(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: -2, y: -1 },
        { x: -2, y: 1 }
    ),
    null
);

const raySquare = [
    { x: 2, y: -1 },
    { x: 4, y: -1 },
    { x: 4, y: 1 },
    { x: 2, y: 1 }
];
const intervals = math.landIntervalsOnRay(
    { x: 0, y: 0 },
    90,
    [raySquare],
    10
);
assert.equal(intervals.length, 1);
close(intervals[0].entryRange, 2);
close(intervals[0].exitRange, 4);
assert.equal(intervals[0].polygonIndex, 0);
assert.ok(intervals[0].incidence >= 0.99);

const rangeClippedIntervals = math.landIntervalsOnRay(
    { x: 0, y: 0 },
    90,
    [[
        { x: 2, y: -1 },
        { x: 12, y: -1 },
        { x: 12, y: 1 },
        { x: 2, y: 1 }
    ]],
    10
);
assert.equal(rangeClippedIntervals.length, 1);
close(rangeClippedIntervals[0].entryRange, 2);
close(rangeClippedIntervals[0].exitRange, 10);

const tangentThenCrossing = math.landIntervalsOnRay(
    { x: 0, y: 0 },
    0,
    [[
        { x: 0, y: 2 },
        { x: 1, y: 3 },
        { x: 1, y: 7 },
        { x: -1, y: 7 },
        { x: -1, y: 5 },
        { x: 0.5, y: 5 },
        { x: 0.5, y: 3 }
    ]],
    10
);
assert.equal(tangentThenCrossing.length, 1);
close(tangentThenCrossing[0].entryRange, 5);
close(tangentThenCrossing[0].exitRange, 7);

const noiseA = math.valueNoise2D(12.25, -7.5, 91);
const noiseB = math.valueNoise2D(12.25, -7.5, 91);
assert.equal(noiseA, noiseB);
assert.ok(noiseA >= 0 && noiseA <= 1);
assert.notEqual(noiseA, math.valueNoise2D(12.75, -7.5, 91));

const reflectivity = math.terrainReflectivity(52.25, 49.75, 1);
assert.ok(reflectivity >= 0 && reflectivity <= 1);
assert.equal(reflectivity, math.terrainReflectivity(52.25, 49.75, 1));

const terrainSamples = [];
const clusterProfiles = [];
for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 20; y++) {
        terrainSamples.push(
            math.terrainReflectivity(40 + x * 0.17, 40 + y * 0.17, 1)
        );
        clusterProfiles.push(math.terrainClusterProfile(
            40 + x * 0.17,
            40 + y * 0.17,
            1,
            0.8
        ));
    }
}
assert.ok(terrainSamples.filter(value => value < 0.25).length > 120);
assert.ok(terrainSamples.filter(value => value > 0.7).length < 80);
assert.ok(clusterProfiles.some(profile => profile.visibility < 0.25));
assert.ok(clusterProfiles.some(profile => profile.visibility > 0.65));
assert.ok(
    new Set(clusterProfiles.map(profile => profile.depthCells.toFixed(1))).size > 8
);
assert.ok(clusterProfiles.some(profile => profile.seaSpreadCells > 0.4));
assert.deepEqual(
    { ...math.terrainClusterProfile(52.25, 49.75, 1, 0.8) },
    { ...math.terrainClusterProfile(52.25, 49.75, 1, 0.8) }
);

assert.ok(
    math.radialResolutionNm(24, 240) >
    math.radialResolutionNm(3, 240)
);

const lowGain = math.landEchoIntensity({
    reflectivity: 0.35,
    visibility: 0.5,
    coastStrength: 0.2,
    rangeNm: 5,
    gain: 20,
    sea: 20,
    occlusion: 0
});
const highGain = math.landEchoIntensity({
    reflectivity: 0.35,
    visibility: 0.5,
    coastStrength: 0.2,
    rangeNm: 5,
    gain: 90,
    sea: 20,
    occlusion: 0
});
assert.ok(highGain > lowGain);

const coastalRays = [];
const clusterCoastPolygon = [
    { x: 0, y: 60 },
    { x: 2, y: 60 },
    { x: 2, y: 70 },
    { x: 0, y: 70 }
];
for (let offset = 60.1; offset <= 69.9; offset += 0.1) {
    const origin = { x: -2, y: offset };
    const interval = math.landIntervalsOnRay(
        origin,
        90,
        [clusterCoastPolygon],
        5
    )[0];
    const cells = math.sampleLandRay(
        origin,
        90,
        [clusterCoastPolygon],
        { maxRangeNm: 5, radiusPixels: 240, gain: 75, sea: 20 }
    );
    coastalRays.push({
        origin,
        entry: interval.entryRange,
        cells,
        hasFront: cells.some(cell =>
            cell.range <= interval.entryRange + cell.length * 1.5
        )
    });
}
assert.ok(coastalRays.some(ray => ray.hasFront));
assert.ok(coastalRays.some(ray => !ray.hasFront));
const visibleFrontRatio = (
    coastalRays.filter(ray => ray.hasFront).length / coastalRays.length
);
assert.ok(visibleFrontRatio >= 0.2);
assert.ok(visibleFrontRatio <= 0.8);

const allCoastalCells = coastalRays.flatMap(ray => ray.cells);
assert.ok(
    new Set(allCoastalCells.map(cell => cell.length.toFixed(4))).size > 6
);
assert.ok(allCoastalCells.every(cell => Number.isFinite(cell.beamScale)));
assert.ok(
    new Set(allCoastalCells.map(cell => cell.beamScale.toFixed(2))).size > 6
);
assert.ok(coastalRays.some(ray =>
    ray.cells.some(cell => cell.range < ray.entry)
));

const clearClusterIntensity = math.landEchoIntensity({
    reflectivity: 0.55,
    visibility: 0.65,
    coastStrength: 0,
    rangeNm: 4,
    gain: 75,
    sea: 20,
    occlusion: 0
});
const shadowedClusterIntensity = math.landEchoIntensity({
    reflectivity: 0.55,
    visibility: 0.65,
    coastStrength: 0,
    rangeNm: 4,
    gain: 75,
    sea: 20,
    occlusion: 0.75
});
assert.ok(clearClusterIntensity > shadowedClusterIntensity);

const nearStrongCluster = math.landEchoIntensity({
    reflectivity: 0.7,
    visibility: 0.72,
    coastStrength: 0.55,
    rangeNm: 6,
    gain: 75,
    sea: 20,
    occlusion: 0
});
const farStrongCluster = math.landEchoIntensity({
    reflectivity: 0.7,
    visibility: 0.72,
    coastStrength: 0.55,
    rangeNm: 24,
    gain: 75,
    sea: 20,
    occlusion: 0
});
assert.ok(nearStrongCluster > farStrongCluster);
assert.ok(farStrongCluster > 0.08);

const sampledSource = coastalRays.find(ray => ray.cells.length > 3);
assert.ok(sampledSource, 'expected at least one substantial coastal cluster');
const sampledRay = sampledSource.cells;
assert.ok(sampledRay.length > 3);
assert.ok(sampledRay.every(cell => Number.isFinite(cell.range)));
assert.ok(sampledRay.some(cell => cell.intensity > 0));
assert.deepEqual(
    sampledRay,
    math.sampleLandRay(
        sampledSource.origin,
        90,
        [clusterCoastPolygon],
        { maxRangeNm: 5, radiusPixels: 240, gain: 75, sea: 20 }
    )
);
const rearClusterPolygon = [
    { x: 2.15, y: 60 },
    { x: 4.15, y: 60 },
    { x: 4.15, y: 70 },
    { x: 2.15, y: 70 }
];
const occlusionSource = coastalRays.find(ray => {
    const rearCells = math.sampleLandRay(
        ray.origin,
        90,
        [rearClusterPolygon],
        { maxRangeNm: 8, radiusPixels: 240, gain: 75, sea: 20 }
    );
    return ray.cells.length > 3 && rearCells.length > 2;
});
assert.ok(occlusionSource, 'expected two visible land intervals');
const rearOnlyCells = math.sampleLandRay(
    occlusionSource.origin,
    90,
    [rearClusterPolygon],
    { maxRangeNm: 8, radiusPixels: 240, gain: 75, sea: 20 }
);
const combinedCells = math.sampleLandRay(
    occlusionSource.origin,
    90,
    [clusterCoastPolygon, rearClusterPolygon],
    { maxRangeNm: 8, radiusPixels: 240, gain: 75, sea: 20 }
);
const rearEntry = math.landIntervalsOnRay(
    occlusionSource.origin,
    90,
    [rearClusterPolygon],
    8
)[0].entryRange;
const rearOnlyStrength = rearOnlyCells.reduce(
    (sum, cell) => sum + cell.intensity,
    0
);
const shadowedRearStrength = combinedCells
    .filter(cell => cell.range >= rearEntry)
    .reduce((sum, cell) => sum + cell.intensity, 0);
assert.ok(shadowedRearStrength < rearOnlyStrength);
assert.equal(
    math.sampleLandRay(
        { x: 0, y: 0 },
        0,
        [raySquare],
        { maxRangeNm: 10, radiusPixels: 240, gain: 75, sea: 20 }
    ).length,
    0
);
assert.ok(coastalRays.some(ray =>
    ray.cells.some((cell, index) =>
        index > 0 &&
        cell.range - ray.cells[index - 1].range > cell.length * 1.5
    )
), 'terrain returns should contain stable internal gaps');

assert.deepEqual(
    { ...math.safeNextPosition(
        { x: 0, y: 0 },
        90,
        3600,
        1,
        point => point.x < 0.5,
        (start, end) => end.x < 0.5
    ) },
    { x: 0, y: 0 }
);
const safeStep = math.safeNextPosition(
    { x: 0, y: 0 },
    90,
    1,
    3600,
    () => true,
    () => true
);
close(safeStep.x, 1);
close(safeStep.y, 0);

let guardedPosition = { x: -1, y: 1 };
for (let i = 0; i < 10000; i++) {
    guardedPosition = math.safeNextPosition(
        guardedPosition,
        90,
        12,
        10,
        point => math.hasLandClearance(point, [square], 0.25),
        (start, end) => math.hasLandClearanceAlongPath(start, end, [square], 0.25)
    );
    assert.ok(math.distanceToPolygon(guardedPosition, square) >= 0.25);
}

assert.match(html, /const NAVIGATION_CLEARANCE_NM = 0\.25/);
assert.match(html, /\{ x: 42\.8, y: 50\.7 \}/);
assert.match(html, /\{ x: 55\.5, y: 53\.2 \}/);
assert.match(html, /function isSafeWaterPosition\(/);
assert.match(html, /function ensureSafeInitialPositions\(/);
assert.match(html, /getSafetySnapshot/);
assert.match(html, /advanceWorldForTest/);
assert.match(html, /getLandGeometry/);
assert.match(html, /smoothClosedPolygon\(basePoints/);
assert.match(html, /polygonSelfIntersects\(feature\.points\)/);
assert.match(html, /function displayBearingToWorldBearing\(/);
assert.match(html, /function paintLand\(previousSweepAngle, sweepAdvance\)/);
assert.match(html, /function paintTargets\(previousSweepAngle, sweepAdvance\)/);
assert.match(html, /radarMath\.sweepAzimuths\(/);
assert.match(html, /radarMath\.boundedSweepAdvance\(/);
assert.match(html, /radarMath\.sweptBearingCycle\(/);
assert.match(html, /radarMath\.sampleLandRay\(/);
assert.match(html, /const MAX_CATCH_UP_DEGREES = ECHO_SECTOR_DEGREES/);
assert.match(html, /paintTargets\(previousSweepAngle, sweepAdvance\)/);
assert.match(html, /paintLand\(previousSweepAngle, sweepAdvance\)/);
assert.match(html, /sampleLandEcho/);
assert.match(html, /getLandEchoMetrics/);
assert.match(html, /getRenderStats/);
assert.match(html, /lastFrameLandMs/);
assert.match(html, /activeMeasurementSet: null/);
assert.match(html, /let measurementDrag = null/);
assert.match(html, /let guardDrag = null/);
assert.match(html, /function showMeasurementSet\(setNumber\)/);
assert.match(html, /function hideMeasurementSet\(setNumber\)/);
assert.match(html, /function hitTestMeasurements\(point, pointerType\)/);
assert.match(html, /function applyMeasurementPointer\(point\)/);
assert.match(html, /function hitTestEditableGuardZone\(point, pointerType\)/);
assert.match(html, /function applyGuardPointer\(point\)/);
assert.match(
    html,
    /const guardHit = hitTestEditableGuardZone\(canvasPoint, event\.pointerType\);[\s\S]*if \(guardHit\) \{[\s\S]*return;[\s\S]*const measurementPoint/s
);
assert.match(
    html,
    /const measurementPoint = pointerToMeasurementPoint\(event\);\s+const measurementHit = measurementPoint\.clamped\s*\?\s*null\s*:\s*hitTestMeasurements\(\s*measurementPoint,\s*event\.pointerType/s
);
assert.match(html, /component: guardHit/);
assert.match(html, /pointerBearing:/);
assert.match(html, /startBearing:/);
assert.match(html, /endBearing:/);
assert.match(html, /component: hit\.component/);
assert.match(html, /event\.pointerType/);
assert.match(html, /canvas\.style\.cursor = 'grabbing'/);
assert.match(html, /canvas\.setPointerCapture\(event\.pointerId\)/);
assert.match(html, /measurementDrag\.pointerId === event\.pointerId/);
assert.match(html, /guardDrag\.pointerId === event\.pointerId/);
assert.match(html, /if \(measurementHit\) \{/);
assert.match(html, /if \(settings\.guardZone\.edit\)/);
assert.match(html, /handleTargetAcquisition\(point\)/);
assert.match(html, /function drawMeasurementSet\(measurement, setNumber\)/);
assert.match(html, /measurement-visible/);
assert.match(html, /measurement-selected/);
assert.match(html, /window\.__radarTestApi\.setMeasurementState =/);
assert.match(html, /°T/);
assert.doesNotMatch(html, /bearingRad \+= ownShip\.heading/);
assert.doesNotMatch(html, /const isCoastCell/);
assert.doesNotMatch(html, /coastWidthNm/);
assert.doesNotMatch(html, /Math\.exp\(-depthNm/);
assert.match(html, /beamScale: profile\.beamScale/);
assert.match(html, /let occlusion = 0/);
assert.match(html, /crossRangePixels \* cell\.beamScale/);
assert.match(html, /function clearTargetTrails\(\)/);
assert.match(html, /function setWakesEnabled\(enabled\)/);
assert.match(html, /recordWakeSample\(/);
assert.match(html, /setWakesEnabled\(!settings\.showWakes\)/);
assert.match(html, /setWakesEnabled\(Boolean\(enabled\)\)/);
assert.match(html, /starts a new wake recording/);
assert.match(
    html,
    /<div>MOTION \$\{settings\.motionMode === 'RELATIVE' \? 'REL' : 'TRUE'\}<\/div>\s+\$\{settings\.showWakes \? '<div>WAKES ON<\/div>' : ''\}/
);
assert.doesNotMatch(html, /echoCtx\.lineTo\(p2\.x, p2\.y\)/);
assert.doesNotMatch(html, /feature\.scanCycles/);

assert.match(html, /addEventListener\('pointerdown'/);

const helpMatch = html.match(/\/\* HELP_TOPICS_START \*\/([\s\S]*?)\/\* HELP_TOPICS_END \*\//);
assert.ok(helpMatch, 'helpTopics block must be extractable');
const helpContext = {};
vm.runInNewContext(`${helpMatch[1]}; this.result = helpTopics;`, helpContext);
const helpTopics = helpContext.result;
const buttonTopics = [...html.matchAll(/data-help-topic="([^"]+)"/g)].map(match => match[1]);
assert.ok(buttonTopics.length >= 15, 'expected help buttons for major and non-obvious controls');
for (const topic of buttonTopics) {
    assert.ok(helpTopics[topic], `missing help topic: ${topic}`);
    assert.ok(helpTopics[topic].title.trim(), `missing help title: ${topic}`);
    assert.ok(helpTopics[topic].body.trim(), `missing help body: ${topic}`);
}

assert.doesNotMatch(html, /<script[^>]+src=/i);
assert.doesNotMatch(html, /<link[^>]+href=/i);
assert.doesNotMatch(html, /\bfetch\s*\(/);
assert.doesNotMatch(html, />TUNE</);
assert.doesNotMatch(html, />FTC\b/);
assert.doesNotMatch(html, /^\s*ftc:\s*\{/m);
assert.match(html, /id="arpa-readout"/);
assert.match(html, /id="help-drawer"/);
assert.match(html, /addEventListener\('pointerdown'/);
assert.match(html, /addEventListener\('pointercancel'/);
assert.match(
    html,
    /const measurementPoint = pointerToMeasurementPoint\(event\);\s+const hit = measurementPoint\.clamped\s*\?\s*null\s*:\s*hitTestMeasurements\(\s*measurementPoint,\s*event\.pointerType/s
);
assert.match(html, /targetGeneration: closestTarget\.generation/);
assert.match(html, /arpa\.status = 'LOST'/);
assert.match(html, /event\.key === 'Escape'/);
assert.match(html, /backdrop\.addEventListener\('click', closeHelp\)/);
assert.match(
    html,
    /function resetTargetGeneration\(target\)[\s\S]*?target\.generation \+= 1/
);
assert.equal(
    (html.match(/radarMath\.resetTargetGeneration\(target\)/g) || []).length,
    2,
    'every target respawn path must invalidate ARPA generation and its wake'
);
assert.match(html, /target\.lastPaintSweepCycle !== targetSweepCycle/);
assert.match(html, /drawer\.inert = true/);
assert.match(html, /drawer\.inert = false/);
assert.match(html, /arpa\.targetGeneration === closestTarget\.generation/);
assert.match(html, /role="dialog"/);
assert.match(html, /aria-modal="true"/);
assert.match(html, /dom\.container\.inert = true/);
assert.match(html, /dom\.container\.inert = false/);
assert.match(html, /event\.key !== 'Tab'/);
assert.match(html, /window\.__radarTestApi\.getGuardZoneSnapshot =/);
assert.match(html, /window\.__radarTestApi\.setGuardZoneState =/);
assert.match(html, /window\.__radarTestApi\.setTargetState =/);
assert.match(html, /window\.__radarTestApi\.recordGuardDetectionForTest =/);
assert.match(html, /alarmSequence/);
assert.match(html, /targetsInside: \[\.\.\.settings\.guardZone\.targetsInside\]/);
assert.match(html, /data-help-topic="guard"/);
assert.match(helpTopics.guard.body, /inner/i);
assert.match(helpTopics.guard.body, /outer/i);
assert.match(helpTopics.guard.body, /arm/i);
assert.match(helpTopics.guard.body, /ack/i);
assert.match(html, /function hitTestMeasurements\(point, pointerType\)/);
assert.match(html, /function handleTargetAcquisition\(point\)/);

const recordGuardDetectionMatch = html.match(
    /function recordGuardDetection\([\s\S]*?(?=\n\s*function evaluateRecentGuardDetections)/
);
assert.ok(
    recordGuardDetectionMatch,
    'recordGuardDetection implementation must be extractable'
);
const recordGuardDetectionSource = recordGuardDetectionMatch[0];
assert.match(
    recordGuardDetectionSource,
    /settings\.guardZone\.targetsInside = nextLifecycle\.targetsInside/
);
assert.match(
    recordGuardDetectionSource,
    /settings\.guardZone\.alarmActive = nextLifecycle\.alarmActive/
);
assert.match(
    recordGuardDetectionSource,
    /settings\.guardZone\.alarmSequence = nextLifecycle\.alarmSequence/
);
assert.match(
    recordGuardDetectionSource,
    /const membershipChanged = \(\s*nextLifecycle\.targetsInside\.has\(key\) !== previousTargetsInside\.has\(key\)\s*\)/s
);
assert.doesNotMatch(recordGuardDetectionSource, /Object\.assign\(/);
assert.match(html, /function guardZonePresentationState\(now\)/);
assert.match(
    html,
    /window\.__radarTestApi\.getGuardZonePresentation =/
);
assert.doesNotMatch(html, /classList\.toggle\('editing'/);
assert.doesNotMatch(html, /classList\.toggle\('armed'/);
assert.doesNotMatch(html, /classList\.toggle\(\s*'violation'/);
assert.doesNotMatch(html, /guard-zone-editing/);

console.log('radarMath coordinate tests passed');
