const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CHROME =
    process.env.CHROME_PATH ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = path.join(ROOT, '.radar-cdp-profile');
const RADAR_PAGE = path.resolve(
    ROOT,
    process.argv[2] || 'dist/radar.html'
);
const sleep = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds));

function removeProfile() {
    fs.rmSync(PROFILE, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
    });
}

function close(actual, expected, tolerance = 0.02) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `${actual} is not within ${tolerance} of ${expected}`
    );
}

function childHasExited(child) {
    return child.exitCode !== null || child.signalCode !== null;
}

function waitForChildExit(child, timeoutMs) {
    if (childHasExited(child)) return Promise.resolve(true);

    return new Promise(resolve => {
        let timer;
        const finish = exited => {
            clearTimeout(timer);
            child.removeListener('exit', onExit);
            child.removeListener('error', onError);
            resolve(exited);
        };
        const onExit = () => finish(true);
        const onError = () => finish(true);

        child.once('exit', onExit);
        child.once('error', onError);
        timer = setTimeout(() => finish(false), timeoutMs);
        if (childHasExited(child)) finish(true);
    });
}

async function stopChild(child) {
    if (!child) return;

    signalChild(child, 'SIGTERM');
    await sleep(500);

    if (process.platform !== 'win32' || !childHasExited(child)) {
        signalChild(child, 'SIGKILL');
    }
    if (!(await waitForChildExit(child, 3000)) && !childHasExited(child)) {
        throw new Error(`Timed out stopping child process ${child.pid}`);
    }
}

function signalChild(child, signal) {
    try {
        if (process.platform === 'win32') {
            child.kill(signal);
        } else {
            process.kill(-child.pid, signal);
        }
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}

function startServer() {
    const server = http.createServer((request, response) => {
        const requestUrl = new URL(
            request.url || '/',
            'http://127.0.0.1'
        );
        if (requestUrl.pathname !== '/radar.html') {
            response.writeHead(404).end();
            return;
        }
        fs.createReadStream(RADAR_PAGE)
            .on('error', error => {
                response.writeHead(500).end(error.message);
            })
            .pipe(response);
    });

    return new Promise((resolve, reject) => {
        const onError = error => {
            server.removeListener('listening', onListening);
            reject(error);
        };
        const onListening = () => {
            server.removeListener('error', onError);
            const address = server.address();
            resolve({ server, port: address.port });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
    });
}

function stopServer(server) {
    if (!server || !server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    });
}

function spawnChrome(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(CHROME, args, {
            stdio: 'ignore',
            detached: process.platform !== 'win32'
        });
        const onError = error => {
            child.removeListener('spawn', onSpawn);
            reject(error);
        };
        const onSpawn = () => {
            child.removeListener('error', onError);
            resolve(child);
        };
        child.once('error', onError);
        child.once('spawn', onSpawn);
    });
}

async function waitForDevToolsUrl(chrome, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    const activePortFile = path.join(PROFILE, 'DevToolsActivePort');
    while (Date.now() < deadline) {
        if (childHasExited(chrome)) {
            throw new Error(
                `Chrome exited before opening DevTools (${chrome.exitCode ?? chrome.signalCode})`
            );
        }
        try {
            const [port] = fs.readFileSync(activePortFile, 'utf8')
                .trim()
                .split('\n');
            if (/^\d+$/.test(port)) return `http://127.0.0.1:${port}`;
        } catch {
            // Chrome is still starting.
        }
        await sleep(100);
    }
    throw new Error('Timed out waiting for Chrome DevTools port');
}

async function waitForJson(url, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return response.json();
        } catch {
            // The child process is still starting.
        }
        await sleep(100);
    }
    throw new Error(`Timed out waiting for ${url}`);
}

class Cdp {
    constructor(webSocketUrl) {
        this.nextId = 1;
        this.pending = new Map();
        this.socket = new WebSocket(webSocketUrl);
        this.socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (!message.id || !this.pending.has(message.id)) return;
            const { resolve, reject } = this.pending.get(message.id);
            this.pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        };
    }

    async open() {
        if (this.socket.readyState === WebSocket.OPEN) return;
        await new Promise((resolve, reject) => {
            this.socket.onopen = resolve;
            this.socket.onerror = reject;
        });
    }

    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const result = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text);
        }
        return result.result.value;
    }
}

async function runEditingAssertions(cdp, click, snapshot, drag) {
    const guardState = {
        active: true,
        edit: true,
        armed: false,
        alarmActive: false,
        alarmSequence: 0,
        targetsInside: [],
        innerRange: 2,
        outerRange: 4,
        startBearing: 330,
        endBearing: 30
    };
    const setGuard = state => cdp.evaluate(
        `window.__radarTestApi.setGuardZoneState(${JSON.stringify(state)})`
    );
    const guardPoint = async (rangeNm, trueBearing) => cdp.evaluate(`(() => {
        const snapshot = window.__radarTestApi.getGuardZoneSnapshot();
        const displayBearing = window.__radarTestApi.trueBearingToDisplayBearing(
            ${trueBearing},
            snapshot.headingMode,
            snapshot.ownHeading
        );
        const radians = displayBearing * Math.PI / 180;
        const pixels = ${rangeNm} / snapshot.rangeNm * snapshot.radiusPixels;
        return {
            x: snapshot.displayCenter.x + Math.sin(radians) * pixels,
            y: snapshot.displayCenter.y - Math.cos(radians) * pixels
        };
    })()`);

    await click('#btn-gz-show');
    assert.equal((await snapshot()).edit, true);

    const cases = [
        {
            component: 'inner',
            rangeNm: 2.5,
            bearing: 0,
            changedField: 'innerRange',
            expected: 2.5,
            direction: 1
        },
        {
            component: 'outer',
            rangeNm: 4.5,
            bearing: 0,
            changedField: 'outerRange',
            expected: 4.5,
            direction: 1
        },
        {
            component: 'start',
            rangeNm: 3,
            bearing: 320,
            changedField: 'startBearing',
            expected: 320,
            direction: -1
        },
        {
            component: 'end',
            rangeNm: 3,
            bearing: 40,
            changedField: 'endBearing',
            expected: 40,
            direction: 1
        }
    ];
    for (const {
        component,
        rangeNm,
        bearing,
        changedField,
        expected,
        direction
    } of cases) {
        await setGuard(guardState);
        const before = await snapshot();
        await drag(
            before.geometry.handles[component],
            await guardPoint(rangeNm, bearing)
        );
        const after = await snapshot();
        close(after[changedField], expected, 0.1);
        assert.ok(
            (after[changedField] - before[changedField]) * direction > 0,
            `${component} drag must change ${changedField} in the expected direction`
        );
        for (const field of [
            'innerRange',
            'outerRange',
            'startBearing',
            'endBearing'
        ]) {
            if (field !== changedField) {
                close(after[field], before[field]);
            }
        }
    }

    await setGuard(guardState);
    const beforeRotation = await snapshot();
    await cdp.evaluate(`(() => {
        const canvas = document.getElementById('radar-scope');
        const rect = canvas.getBoundingClientRect();
        window.__guardPointerCaptureProbe = [];
        canvas.addEventListener('pointermove', event => {
            const outside = (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
            );
            if (outside) {
                window.__guardPointerCaptureProbe.push({
                    type: 'move',
                    captured: canvas.hasPointerCapture(event.pointerId)
                });
            }
        }, { once: true });
        canvas.addEventListener('pointerup', event => {
            window.__guardPointerCaptureProbe.push({
                type: 'up',
                released: !canvas.hasPointerCapture(event.pointerId)
            });
        }, { once: true });
    })()`);
    const outsideCanvas = await cdp.evaluate(`(() => {
        const rect = document.getElementById('radar-scope').getBoundingClientRect();
        const point = { x: rect.right + 40, y: rect.bottom + 40, client: true };
        return {
            ...point,
            outside: point.x > rect.right && point.y > rect.bottom
        };
    })()`);
    assert.equal(outsideCanvas.outside, true);
    await drag(
        beforeRotation.geometry.bodyHandle,
        outsideCanvas,
        await guardPoint(3, 20),
        async () => {
            const captureProbe = await cdp.evaluate(
                'window.__guardPointerCaptureProbe'
            );
            assert.ok(
                captureProbe.some(event => event.type === 'move' && event.captured),
                'the canvas must retain pointer capture while the pointer is outside'
            );
            const outsideDrivenRotation = await snapshot();
            assert.notEqual(
                outsideDrivenRotation.startBearing,
                beforeRotation.startBearing,
                'the outside pointer move must update the active Guard drag'
            );
        }
    );
    const captureProbe = await cdp.evaluate('window.__guardPointerCaptureProbe');
    assert.ok(
        captureProbe.some(event => event.type === 'up' && event.released),
        'the canvas must release pointer capture at drag completion'
    );
    const afterRotation = await snapshot();
    close(afterRotation.innerRange, beforeRotation.innerRange);
    close(afterRotation.outerRange, beforeRotation.outerRange);
    close(afterRotation.startBearing, 350);
    close(afterRotation.endBearing, 50);
    close(
        (afterRotation.endBearing - afterRotation.startBearing + 360) % 360,
        60
    );
    const readout = await cdp.evaluate(
        'document.getElementById("guard-zone-readout").textContent'
    );
    assert.match(readout, /IN  2\.00NM/);
    assert.match(readout, /OUT 4\.00NM/);
    assert.match(readout, /BRG 350\.0-50\.0T/);

    const beforeCursor = await cdp.evaluate(
        'window.__radarTestApi.getMeasurementSnapshot().cursor'
    );
    await drag(await guardPoint(0.5, 180), await guardPoint(0.5, 180));
    const afterCursor = await cdp.evaluate(
        'window.__radarTestApi.getMeasurementSnapshot().cursor'
    );
    assert.equal(afterCursor.active, true);
    assert.notDeepEqual(afterCursor, beforeCursor);
    close(afterCursor.range, 0.5);
    close(afterCursor.bearing, 180, 1);
}

async function placeStationaryTarget(cdp, targetId, range, bearings) {
    return cdp.evaluate(`(() => {
        const api = window.__radarTestApi;
        const own = api.getSafetySnapshot().ownShip;
        for (const bearing of ${JSON.stringify(bearings)}) {
            const radians = bearing * Math.PI / 180;
            api.setTargetState(${targetId}, {
                x: own.x + Math.sin(radians) * ${range},
                y: own.y + Math.cos(radians) * ${range},
                heading: 0,
                speed: 0,
                rcs: 1000,
                status: 'stationary'
            });
            const target = api.getSafetySnapshot().targets.find(
                item => item.id === ${targetId}
            );
            if (
                target.clearance >= 0.25 &&
                target.status === 'stationary' &&
                target.speed === 0
            ) {
                return { ...target, bearing };
            }
        }
        throw new Error('No safe stationary target position');
    })()`);
}

async function runAlarmAssertions(cdp, click, snapshot) {
    const presentation = () => cdp.evaluate(
        'window.__radarTestApi.getGuardZonePresentation()'
    );
    await cdp.evaluate(`(() => {
        for (const targetId of [3, 4]) {
            window.__radarTestApi.setTargetState(targetId, {
                speed: 0,
                rcs: 0,
                status: 'stationary'
            });
        }
    })()`);
    await sleep(2800);
    const firstTarget = await placeStationaryTarget(
        cdp,
        3,
        0.5,
        [0, 45, 90, 135, 180, 225, 270, 315]
    );
    await placeStationaryTarget(
        cdp,
        4,
        1.2,
        [0, 45, 90, 135, 180, 225, 270, 315]
    );
    await cdp.evaluate(`(() => {
        window.__radarTestApi.setGuardZoneState({
            active: true,
            edit: false,
            armed: true,
            alarmActive: false,
            alarmSequence: 0,
            targetsInside: [],
            innerRange: 0.2,
            outerRange: 0.8,
            startBearing: (${firstTarget.bearing} + 345) % 360,
            endBearing: (${firstTarget.bearing} + 15) % 360
        });
    })()`);
    await sleep(3200);
    const sweptAlarm = await snapshot();
    assert.equal(sweptAlarm.alarmActive, true);
    assert.equal(sweptAlarm.alarmSequence, 1);
    assert.equal(sweptAlarm.targetsInside.length, 1);
    assert.equal((await presentation()).state, 'alarm');

    await sleep(2800);
    const repeatedSweep = await snapshot();
    assert.equal(repeatedSweep.alarmSequence, 1);

    await click('#btn-gz-show');
    const acknowledged = await snapshot();
    assert.equal(acknowledged.armed, true);
    assert.equal(acknowledged.alarmActive, false);
    assert.equal(acknowledged.targetsInside.length, 1);
    assert.equal((await presentation()).state, 'violation');

    const secondTarget = await placeStationaryTarget(
        cdp,
        4,
        0.6,
        [firstTarget.bearing]
    );
    const secondTargetKey = `${secondTarget.id}:${secondTarget.generation}`;
    await cdp.evaluate(`(() => {
        window.__radarTestApi.recordGuardDetectionForTest(4);
    })()`);
    const secondEntry = await snapshot();
    assert.equal(secondEntry.alarmSequence, 2);
    assert.equal(secondEntry.alarmActive, true);
    assert.equal(secondEntry.targetsInside.length, 2);
    assert.ok(secondEntry.targetsInside.includes(secondTargetKey));

    await cdp.evaluate('window.__radarTestApi.recordGuardDetectionForTest(4)');
    assert.equal((await snapshot()).alarmSequence, 2);

    const outsideTarget = await placeStationaryTarget(
        cdp,
        4,
        1.2,
        [firstTarget.bearing]
    );
    assert.ok(outsideTarget.clearance >= 0.25);
    await cdp.evaluate('window.__radarTestApi.recordGuardDetectionForTest(4)');
    assert.equal((await snapshot()).targetsInside.length, 1);

    const reenteredTarget = await placeStationaryTarget(
        cdp,
        4,
        0.6,
        [firstTarget.bearing]
    );
    await cdp.evaluate('window.__radarTestApi.recordGuardDetectionForTest(4)');
    await cdp.evaluate(`(() => {
        const target = window.__radarTestApi.getSafetySnapshot().targets.find(
            item => item.id === 4
        );
        window.__radarTestApi.setTargetState(4, {
            generation: target.generation + 1
        });
        window.__radarTestApi.recordGuardDetectionForTest(4);
    })()`);
    const reentered = await snapshot();
    assert.equal(reentered.alarmSequence, 4);
    assert.equal(reentered.targetsInside.length, 3);
    assert.ok(
        reentered.targetsInside.includes(
            `${reenteredTarget.id}:${reenteredTarget.generation}`
        )
    );

    await cdp.evaluate(`(() => {
        window.__radarTestApi.setTargetState(3, {
            rcs: 0
        });
        window.__radarTestApi.setTargetState(4, {
            rcs: 0
        });
    })()`);
    await sleep(5600);
    const pruned = await snapshot();
    assert.equal(pruned.targetsInside.length, 0);
    assert.equal(pruned.alarmActive, true);

    await click('#btn-gz-show');
    const finalAcknowledgement = await snapshot();
    assert.equal(finalAcknowledgement.armed, true);
    assert.equal(finalAcknowledgement.alarmActive, false);
}

async function runPresentationAssertions(cdp, click, snapshot, drag) {
    const presentation = () => cdp.evaluate(
        'window.__radarTestApi.getGuardZonePresentation()'
    );
    const beforeRange = await snapshot();
    assert.equal(beforeRange.rangeNm, 6);
    await click('#range-up');
    const afterRange = await snapshot();
    assert.equal(afterRange.rangeNm, 12);
    close(afterRange.innerRange, beforeRange.innerRange);
    close(afterRange.outerRange, beforeRange.outerRange);
    close(
        afterRange.geometry.outerRadiusPixels,
        beforeRange.geometry.outerRadiusPixels / 2
    );

    const trueBearings = {
        startBearing: afterRange.startBearing,
        endBearing: afterRange.endBearing
    };
    for (const selector of ['#btn-north-up', '#btn-head-up', '#btn-course-up']) {
        await click(selector);
        const current = await snapshot();
        assert.equal(current.startBearing, trueBearings.startBearing);
        assert.equal(current.endBearing, trueBearings.endBearing);
        const displayStart = await cdp.evaluate(
            `window.__radarTestApi.trueBearingToDisplayBearing(
                ${trueBearings.startBearing},
                ${JSON.stringify(current.headingMode)},
                ${current.ownHeading}
            )`
        );
        close(current.geometry.startDisplayBearing, displayStart);
    }

    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        active: true,
        edit: false,
        armed: true,
        alarmActive: false,
        targetsInside: [],
        innerRange: 0.2,
        outerRange: 12,
        startBearing: 80,
        endBearing: 280
    })`);
    await click('#btn-offset');
    const offset = await snapshot();
    const offsetPresentation = await presentation();
    close(offset.displayCenter.x, offset.ppiCenter.x);
    close(
        offset.displayCenter.y,
        offset.ppiCenter.y - offset.radiusPixels / 2
    );
    assert.deepEqual(offsetPresentation.ppiClip.center, offset.ppiCenter);
    close(offsetPresentation.ppiClip.radius, offset.radiusPixels);
    const outerSouth = await cdp.evaluate(`(() => {
        const state = window.__radarTestApi.getGuardZoneSnapshot();
        const displayBearing = window.__radarTestApi.trueBearingToDisplayBearing(
            180,
            state.headingMode,
            state.ownHeading
        );
        const radians = displayBearing * Math.PI / 180;
        return {
            x: state.displayCenter.x +
                Math.sin(radians) * state.geometry.outerRadiusPixels,
            y: state.displayCenter.y -
                Math.cos(radians) * state.geometry.outerRadiusPixels
        };
    })()`);
    assert.ok(
        Math.hypot(
            outerSouth.x - offsetPresentation.ppiClip.center.x,
            outerSouth.y - offsetPresentation.ppiClip.center.y
        ) < offsetPresentation.ppiClip.radius,
        'the outer Guard sector must retain an in-PPI section when offset'
    );
    assert.ok(
        Math.hypot(
            offset.geometry.startEdge.end.x - offsetPresentation.ppiClip.center.x,
            offset.geometry.startEdge.end.y - offsetPresentation.ppiClip.center.y
        ) > offsetPresentation.ppiClip.radius,
        'the outer Guard sector must cross the PPI clip when offset'
    );
    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        active: true,
        edit: true,
        armed: false,
        alarmActive: false,
        targetsInside: [],
        innerRange: 0.2,
        outerRange: 12,
        startBearing: 80,
        endBearing: 280
    })`);
    const offsetEditBeforeFallback = await snapshot();
    const beyondOffsetOuterArc = await cdp.evaluate(`(() => {
        const state = window.__radarTestApi.getGuardZoneSnapshot();
        const displayBearing = window.__radarTestApi.trueBearingToDisplayBearing(
            180,
            state.headingMode,
            state.ownHeading
        );
        const radians = displayBearing * Math.PI / 180;
        const pixels = state.radiusPixels * 1.4;
        const point = {
            x: state.displayCenter.x + Math.sin(radians) * pixels,
            y: state.displayCenter.y - Math.cos(radians) * pixels
        };
        return {
            point,
            insidePpi: Math.hypot(
                point.x - state.ppiCenter.x,
                point.y - state.ppiCenter.y
            ) < state.radiusPixels,
            beyondOuterArc: pixels > state.geometry.outerRadiusPixels
        };
    })()`);
    assert.equal(beyondOffsetOuterArc.insidePpi, true);
    assert.equal(beyondOffsetOuterArc.beyondOuterArc, true);
    const cursorBeforeOffsetFallback = await cdp.evaluate(
        'window.__radarTestApi.getMeasurementSnapshot().cursor'
    );
    await drag(beyondOffsetOuterArc.point, beyondOffsetOuterArc.point);
    const cursorAfterOffsetFallback = await cdp.evaluate(
        'window.__radarTestApi.getMeasurementSnapshot().cursor'
    );
    const offsetEditAfterFallback = await snapshot();
    assert.equal(cursorAfterOffsetFallback.active, true);
    close(cursorAfterOffsetFallback.range, offsetEditBeforeFallback.rangeNm);
    assert.notDeepEqual(cursorAfterOffsetFallback, cursorBeforeOffsetFallback);
    assert.deepEqual(
        {
            innerRange: offsetEditAfterFallback.innerRange,
            outerRange: offsetEditAfterFallback.outerRange,
            startBearing: offsetEditAfterFallback.startBearing,
            endBearing: offsetEditAfterFallback.endBearing
        },
        {
            innerRange: offsetEditBeforeFallback.innerRange,
            outerRange: offsetEditBeforeFallback.outerRange,
            startBearing: offsetEditBeforeFallback.startBearing,
            endBearing: offsetEditBeforeFallback.endBearing
        },
        'an offset PPI point beyond the outer arc must fall through Guard editing'
    );
    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        edit: false,
        armed: true
    })`);

    const previousRadius = offset.radiusPixels;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1000,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
    });
    await cdp.evaluate('window.dispatchEvent(new Event("resize"))');
    await sleep(200);
    const resized = await snapshot();
    assert.notEqual(resized.radiusPixels, previousRadius);
    close(
        resized.geometry.outerRadiusPixels,
        resized.outerRange / resized.rangeNm * resized.radiusPixels
    );

    await click('#btn-vrm1-show');
    const measurementBefore = await cdp.evaluate(
        'window.__radarTestApi.getMeasurementSnapshot()'
    );
    const guardBeforeVrmDrag = await snapshot();
    const displayBearing = await cdp.evaluate(`window.__radarTestApi
        .trueBearingToDisplayBearing(90, ${JSON.stringify(resized.headingMode)}, ${resized.ownHeading})`);
    const targetPoint = await cdp.evaluate(`(() => {
        const state = window.__radarTestApi.getMeasurementSnapshot();
        const radians = ${displayBearing} * Math.PI / 180;
        const pixels = 4 / state.rangeNm * ${resized.radiusPixels};
        const center = window.__radarTestApi.getGuardZoneSnapshot().displayCenter;
        return {
            x: center.x + Math.sin(radians) * pixels,
            y: center.y - Math.cos(radians) * pixels
        };
    })()`);
    await drag(measurementBefore.sets[0].geometry.handle, targetPoint);
    const measurementAfter = await cdp.evaluate(
        'window.__radarTestApi.getMeasurementSnapshot()'
    );
    const guardAfterVrmDrag = await snapshot();
    assert.notDeepEqual(measurementAfter.sets[0], measurementBefore.sets[0]);
    assert.deepEqual(
        {
            innerRange: guardAfterVrmDrag.innerRange,
            outerRange: guardAfterVrmDrag.outerRange,
            startBearing: guardAfterVrmDrag.startBearing,
            endBearing: guardAfterVrmDrag.endBearing
        },
        {
            innerRange: guardBeforeVrmDrag.innerRange,
            outerRange: guardBeforeVrmDrag.outerRange,
            startBearing: guardBeforeVrmDrag.startBearing,
            endBearing: guardBeforeVrmDrag.endBearing
        }
    );

    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        active: true, edit: true, armed: false, alarmActive: false, targetsInside: []
    })`);
    const editingPresentation = await presentation();
    assert.equal(editingPresentation.state, 'edit');
    assert.equal(editingPresentation.handlesVisible, true);
    assert.equal(editingPresentation.fillColor, 'rgba(255, 196, 64, 0.08)');
    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        edit: false, armed: true, targetsInside: []
    })`);
    const armedPresentation = await presentation();
    assert.equal(armedPresentation.state, 'armed');
    assert.equal(armedPresentation.handlesVisible, false);
    assert.equal(armedPresentation.fillColor, 'rgba(51, 255, 119, 0.035)');
    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        targetsInside: ['presentation-target']
    })`);
    const violationPresentation = await presentation();
    assert.equal(violationPresentation.state, 'violation');
    assert.equal(violationPresentation.handlesVisible, false);
    assert.equal(violationPresentation.fillColor, 'rgba(255, 196, 64, 0.08)');
    await cdp.evaluate(`window.__radarTestApi.setGuardZoneState({
        alarmActive: true
    })`);
    const alarmPresentation = await presentation();
    assert.equal(alarmPresentation.state, 'alarm');
    assert.equal(alarmPresentation.handlesVisible, false);
    assert.match(alarmPresentation.fillColor, /^rgba\(255, 86, 76, /);

    const beforeHide = await snapshot();
    await click('#btn-gz-hide');
    const hidden = await snapshot();
    assert.equal(hidden.active, false);
    close(hidden.innerRange, beforeHide.innerRange);
    close(hidden.outerRange, beforeHide.outerRange);
    close(hidden.startBearing, beforeHide.startBearing);
    close(hidden.endBearing, beforeHide.endBearing);
    await click('#btn-gz-show');
    const restored = await snapshot();
    assert.equal(restored.active, true);
    assert.equal(restored.edit, true);
    close(restored.innerRange, beforeHide.innerRange);
    close(restored.outerRange, beforeHide.outerRange);
    close(restored.startBearing, beforeHide.startBearing);
    close(restored.endBearing, beforeHide.endBearing);
}

async function main() {
    assert.ok(
        fs.existsSync(CHROME),
        `Chrome executable not found at ${CHROME}; set CHROME_PATH`
    );
    assert.ok(
        fs.existsSync(RADAR_PAGE),
        `Radar artifact not found at ${RADAR_PAGE}`
    );
    assert.equal(
        typeof WebSocket,
        'function',
        'This Node runtime must provide the built-in WebSocket API'
    );
    removeProfile();
    let server;
    let chrome;
    let cdp;
    let primaryFailure;

    try {
        const startedServer = await startServer();
        server = startedServer.server;
        chrome = await spawnChrome([
            '--headless=new',
            '--disable-gpu',
            '--remote-debugging-port=0',
            '--remote-allow-origins=*',
            `--user-data-dir=${PROFILE}`,
            'about:blank'
        ]);
        const devToolsUrl = await waitForDevToolsUrl(chrome);
        await waitForJson(`${devToolsUrl}/json/version`);
        const targetResponse = await fetch(
            `${devToolsUrl}/json/new?` +
            encodeURIComponent(
                `http://127.0.0.1:${startedServer.port}/radar.html`
            ),
            { method: 'PUT' }
        );
        assert.equal(targetResponse.ok, true, 'failed to open radar page');
        const target = await targetResponse.json();
        cdp = new Cdp(target.webSocketDebuggerUrl);
        await cdp.open();
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
            ready = await cdp.evaluate(
                'document.readyState === "complete" && Boolean(window.__radarTestApi)'
            );
            if (ready) break;
            await sleep(100);
        }
        assert.equal(ready, true, 'radar test API did not become ready');
        if (process.env.RADAR56_BROWSER_TEST_FORCE_FAILURE === '1') {
            assert.fail('Forced browser harness failure');
        }

        const click = selector => cdp.evaluate(
            `document.querySelector(${JSON.stringify(selector)}).click()`
        );
        const snapshot = () => cdp.evaluate(
            'window.__radarTestApi.getGuardZoneSnapshot()'
        );
        const toClientPoint = async point => {
            if (point.client) return { x: point.x, y: point.y };
            return cdp.evaluate(`(() => {
                const canvas = document.getElementById('radar-scope');
                const rect = canvas.getBoundingClientRect();
                return {
                    x: rect.left + ${point.x} * rect.width / canvas.width,
                    y: rect.top + ${point.y} * rect.height / canvas.height
                };
            })()`);
        };
        const drag = async (
            from,
            intermediate,
            to = intermediate,
            afterIntermediate = null
        ) => {
            const start = await toClientPoint(from);
            const points = await Promise.all(
                [intermediate, to].map(toClientPoint)
            );
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: start.x,
                y: start.y,
                button: 'left',
                buttons: 1,
                clickCount: 1
            });
            for (const point of points) {
                await cdp.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: point.x,
                    y: point.y,
                    button: 'left',
                    buttons: 1
                });
                if (point === points[0] && afterIntermediate) {
                    await afterIntermediate();
                }
            }
            const end = points.at(-1);
            await cdp.send('Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: end.x,
                y: end.y,
                button: 'left',
                buttons: 0,
                clickCount: 1
            });
        };

        await runEditingAssertions(cdp, click, snapshot, drag);
        await runAlarmAssertions(cdp, click, snapshot);
        await runPresentationAssertions(cdp, click, snapshot, drag);
    } catch (error) {
        primaryFailure = error;
    } finally {
        const cleanupErrors = [];
        try {
            if (cdp) cdp.socket.close();
        } catch (error) {
            cleanupErrors.push(error);
        }
        const cleanupResults = await Promise.allSettled([
            stopServer(server),
            stopChild(chrome)
        ]);
        cleanupErrors.push(...cleanupResults
            .filter(result => result.status === 'rejected')
            .map(result => result.reason)
        );
        try {
            removeProfile();
            assert.equal(
                fs.existsSync(PROFILE),
                false,
                'CDP profile must be removed'
            );
        } catch (error) {
            cleanupErrors.push(error);
        }
        if (process.env.RADAR56_BROWSER_TEST_FORCE_CLEANUP_FAILURE === '1') {
            cleanupErrors.push(new Error('Forced browser harness cleanup failure'));
        }
        if (cleanupErrors.length > 0) {
            const cleanupFailure = cleanupErrors.length === 1
                ? cleanupErrors[0]
                : new AggregateError(
                    cleanupErrors,
                    'Browser harness cleanup failed'
                );
            if (primaryFailure) {
                primaryFailure.cleanupFailure = cleanupFailure;
            } else {
                primaryFailure = cleanupFailure;
            }
        }
    }
    if (primaryFailure) throw primaryFailure;
}

process.once('exit', () => {
    removeProfile();
});

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
