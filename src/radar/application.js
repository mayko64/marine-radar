

        const canvas = document.getElementById('radar-scope');
        const ctx = canvas.getContext('2d');
        let echoCanvas = document.createElement('canvas');
        let echoCtx = echoCanvas.getContext('2d');

        let size, radius, centerX, centerY;
        let sweepAngle = 0;
        let sweepCycle = 0;
        let lastGuardPruneCycle = -1;
        let isDraggingCursor = false;
        let measurementDrag = null;
        let guardDrag = null;
        const SWEEP_DEGREES_PER_SECOND = 144;
        const ECHO_ROTATIONS = 1.5;
        const ECHO_SECTOR_DEGREES = 30;
        const MAX_CATCH_UP_DEGREES = ECHO_SECTOR_DEGREES;
        let echoLayers = [];
        let activeEchoLayer = null;
        let activeEchoSector = -1;
        const renderStats = {
            landRays: 0,
            landCells: 0,
            lastFrameLandMs: 0
        };

        // Add sweep trail canvas for afterglow effect
        const sweepCanvas = document.createElement('canvas');
        const sweepCtx = sweepCanvas.getContext('2d');

        const settings = {
            brilliance: 80, gain: 75, sea: 20, rain: 0,
            ranges: [0.25, 0.5, 0.75, 1.5, 3, 6, 12, 24, 48],
            rangeIndex: 5,
            get range() { return this.ranges[this.rangeIndex]; },
            headingMode: 'HEAD_UP',
            motionMode: 'RELATIVE',
            showRings: true,
            showSHM: true,
            acquireMode: false,
            offset: false,
            showWakes: false,
            vrm1: { active: false, range: 3, bearing: 45 },
            vrm2: { active: false, range: 4.5, bearing: 120 },
            activeMeasurementSet: null,
            guardZone: {
                active: false,
                edit: false,
                armed: false,
                alarmActive: false,
                alarmSequence: 0,
                startBearing: 30,
                endBearing: 60,
                innerRange: 2,
                outerRange: 4,
                targetsInside: new Set()
            },
            cursor: { active: false, bearing: 0, range: 0, x: 0, y: 0 },
        };

        const ownShip = {
            x: 47, y: 48.5, heading: 30, speed: 10, turnRate: 0
        };
        const NAVIGATION_CLEARANCE_NM = 0.25;

        // Function to generate realistic coastline with many points
        function generateCoastline(basePoints, detail = 50) {
            const rounds = detail >= 40 ? 3 : detail >= 20 ? 2 : 1;
            return radarMath.smoothClosedPolygon(basePoints, rounds);
        }

        // Land features definition - Ultra-detailed realistic coastlines
        const landFeatures = [
            // Main coastline (nearby) - Complex detailed shape
            {
                type: 'land',
                points: generateCoastline([
                    { x: 51.5, y: 48.5 }, { x: 52.0, y: 48.3 }, { x: 52.4, y: 48.2 },
                    { x: 52.8, y: 48.4 }, { x: 53.2, y: 48.7 }, { x: 53.6, y: 48.5 },
                    { x: 53.8, y: 48.8 }, { x: 54.0, y: 49.2 }, { x: 54.2, y: 49.5 },
                    { x: 54.0, y: 49.9 }, { x: 53.7, y: 50.1 }, { x: 53.4, y: 50.3 },
                    { x: 53.0, y: 50.5 }, { x: 52.6, y: 50.7 }, { x: 52.2, y: 50.9 },
                    { x: 51.8, y: 51.2 }, { x: 51.3, y: 51.0 }, { x: 50.8, y: 50.8 },
                    { x: 50.4, y: 50.5 }, { x: 50.0, y: 50.2 }, { x: 49.8, y: 49.8 },
                    { x: 49.9, y: 49.4 }, { x: 50.1, y: 49.1 }, { x: 50.4, y: 48.9 },
                    { x: 50.8, y: 48.7 }, { x: 51.2, y: 48.6 }
                ], 40)
            },
            // Small island 1 (nearby) - Detailed irregular blob
            {
                type: 'land',
                points: generateCoastline([
                    { x: 55.5, y: 53.2 }, { x: 55.9, y: 53.0 }, { x: 56.3, y: 52.9 },
                    { x: 56.6, y: 53.2 }, { x: 56.8, y: 53.5 }, { x: 56.5, y: 53.8 },
                    { x: 56.1, y: 54.0 }, { x: 55.7, y: 53.9 }, { x: 55.4, y: 53.6 },
                    { x: 55.2, y: 53.3 }
                ], 25)
            },
            // Small island 2 (nearby) - Elongated detailed shape
            {
                type: 'land',
                points: generateCoastline([
                    { x: 42.8, y: 50.7 }, { x: 43.2, y: 50.5 }, { x: 43.6, y: 50.6 },
                    { x: 43.8, y: 50.9 }, { x: 43.7, y: 51.2 }, { x: 43.4, y: 51.4 },
                    { x: 43.0, y: 51.3 }, { x: 42.7, y: 51.0 }, { x: 42.6, y: 50.8 }
                ], 20)
            },
            // Rocky outcrop (nearby) - Small detailed jagged shape
            {
                type: 'land',
                points: generateCoastline([
                    { x: 52.2, y: 46.8 }, { x: 52.5, y: 46.6 }, { x: 52.8, y: 46.7 },
                    { x: 53.1, y: 47.0 }, { x: 53.0, y: 47.3 }, { x: 52.7, y: 47.4 },
                    { x: 52.4, y: 47.2 }, { x: 52.1, y: 47.0 }
                ], 15)
            },
            // Distant island cluster 1 (North) - Large detailed landmass
            {
                type: 'land',
                points: generateCoastline([
                    { x: 42.8, y: 61.5 }, { x: 43.5, y: 61.3 }, { x: 44.2, y: 61.6 },
                    { x: 44.8, y: 62.0 }, { x: 45.3, y: 62.4 }, { x: 45.8, y: 62.2 },
                    { x: 46.2, y: 62.6 }, { x: 46.5, y: 63.1 }, { x: 46.3, y: 63.6 },
                    { x: 45.8, y: 63.9 }, { x: 45.2, y: 64.1 }, { x: 44.6, y: 63.8 },
                    { x: 44.0, y: 63.4 }, { x: 43.4, y: 63.0 }, { x: 42.9, y: 62.5 },
                    { x: 42.6, y: 62.0 }
                ], 35)
            },
            // Shore/mainland (Southeast) - Very complex detailed coastline
            {
                type: 'land',
                points: generateCoastline([
                    { x: 65.0, y: 28.0 }, { x: 66.5, y: 28.1 }, { x: 68.0, y: 28.3 },
                    { x: 69.5, y: 28.5 }, { x: 71.0, y: 28.8 }, { x: 72.2, y: 29.5 },
                    { x: 72.8, y: 30.8 }, { x: 73.2, y: 32.2 }, { x: 73.6, y: 33.6 },
                    { x: 74.0, y: 35.0 }, { x: 74.2, y: 36.4 }, { x: 73.9, y: 37.8 },
                    { x: 73.4, y: 39.0 }, { x: 72.8, y: 40.2 }, { x: 72.0, y: 41.3 },
                    { x: 71.0, y: 42.2 }, { x: 69.8, y: 42.8 }, { x: 68.5, y: 43.1 },
                    { x: 67.2, y: 43.0 }, { x: 66.0, y: 42.6 }, { x: 65.0, y: 42.0 },
                    { x: 64.2, y: 41.2 }, { x: 63.6, y: 40.2 }, { x: 63.2, y: 39.0 },
                    { x: 62.9, y: 37.6 }, { x: 62.8, y: 36.2 }, { x: 62.7, y: 34.7 },
                    { x: 62.8, y: 33.2 }, { x: 63.0, y: 31.8 }, { x: 63.3, y: 30.5 },
                    { x: 63.7, y: 29.3 }, { x: 64.2, y: 28.4 }
                ], 60)
            },
            // Distant island (West) - Detailed irregular shape
            {
                type: 'land',
                points: generateCoastline([
                    { x: 26.2, y: 49.0 }, { x: 27.0, y: 49.5 }, { x: 27.8, y: 49.3 },
                    { x: 28.4, y: 49.6 }, { x: 28.8, y: 50.2 }, { x: 29.0, y: 50.8 },
                    { x: 28.7, y: 51.4 }, { x: 28.2, y: 51.8 }, { x: 27.5, y: 52.0 },
                    { x: 26.8, y: 51.7 }, { x: 26.2, y: 51.2 }, { x: 25.8, y: 50.6 },
                    { x: 25.7, y: 50.0 }, { x: 25.9, y: 49.4 }
                ], 30)
            },
            // Small offshore rocks (detailed tiny shapes)
            {
                type: 'land',
                points: generateCoastline([
                    { x: 60.4, y: 32.6 }, { x: 60.8, y: 32.4 }, { x: 61.1, y: 32.7 },
                    { x: 61.3, y: 33.1 }, { x: 61.0, y: 33.4 }, { x: 60.6, y: 33.3 },
                    { x: 60.3, y: 33.0 }
                ], 12)
            },
            // Additional small island (Northeast)
            {
                type: 'land',
                points: generateCoastline([
                    { x: 57.2, y: 58.0 }, { x: 57.8, y: 57.8 }, { x: 58.2, y: 58.2 },
                    { x: 58.0, y: 58.7 }, { x: 57.5, y: 58.8 }, { x: 57.0, y: 58.5 },
                    { x: 56.9, y: 58.1 }
                ], 18)
            },
            // Another distant island (Southwest)
            {
                type: 'land',
                points: generateCoastline([
                    { x: 28.5, y: 30.2 }, { x: 29.8, y: 30.0 }, { x: 31.0, y: 30.5 },
                    { x: 31.8, y: 31.3 }, { x: 31.5, y: 32.2 }, { x: 30.8, y: 32.8 },
                    { x: 29.8, y: 33.0 }, { x: 28.8, y: 32.5 }, { x: 28.2, y: 31.7 },
                    { x: 27.9, y: 30.8 }
                ], 22)
            }
        ];
        landFeatures.forEach(feature => {
            if (radarMath.polygonSelfIntersects(feature.points)) {
                throw new Error('Generated coastline contains a self-intersection');
            }
        });
        const landPolygons = landFeatures.map(feature => feature.points);
        for (let i = 0; i < landPolygons.length; i++) {
            for (let j = i + 1; j < landPolygons.length; j++) {
                if (radarMath.polygonsOverlap(landPolygons[i], landPolygons[j])) {
                    throw new Error(`Generated land polygons overlap: ${i}, ${j}`);
                }
            }
        }

        // Target definitions - 5 ships (positioned in safe water away from land)
        const targets = [
            {
                id: 1,
                type: 'oil_tanker',
                name: 'Oil Tanker (Anchored)',
                x: 44.5, y: 52.2, // Clear water north of islands
                heading: 045,
                speed: 0, // Anchored
                length: 300, // meters
                width: 50,
                rcs: 8.5, // Radar Cross Section factor
                status: 'anchored',
                anchorX: 44.5,
                anchorY: 52.2,
                swingRadius: 0.1, // Small swing at anchor
                swingAngle: 0,
                trail: []
            },
            {
                id: 2,
                type: 'cargo_ship',
                name: 'Cargo Ship (Anchored)',
                x: 55.8, y: 45.5, // Clear water east of land
                heading: 270,
                speed: 0, // Anchored
                length: 180,
                width: 28,
                rcs: 6.2,
                status: 'anchored',
                anchorX: 55.8,
                anchorY: 45.5,
                swingRadius: 0.08,
                swingAngle: 0,
                trail: []
            },
            {
                id: 3,
                type: 'tug',
                name: 'Tugboat (Stationary)',
                x: 48.2, y: 51.5, // Clear water near but not on shore
                heading: 180,
                speed: 0,
                length: 35,
                width: 12,
                rcs: 3.8,
                status: 'stationary',
                trail: []
            },
            {
                id: 4,
                type: 'sailing_yacht',
                name: '40ft Sailing Yacht',
                x: 45.5, y: 46.8, // Open water west of islands
                heading: 090, // Eastward course (straight line)
                speed: 4.5, // Slow sailing speed
                length: 12,
                width: 4,
                rcs: 2.1,
                status: 'moving',
                baseHeading: 090, // Base course for straight line movement
                baseSpeed: 4.5,
                trail: []
            },
            {
                id: 5,
                type: 'motorboat',
                name: 'Fast Motorboat',
                x: 44.2, y: 47.8, // Clear water
                heading: 045, // Northeast course (straight line)
                speed: 22, // Fast speed
                length: 8,
                width: 3,
                rcs: 1.8,
                status: 'moving',
                baseHeading: 045, // Base course for straight line movement
                baseSpeed: 22,
                trail: []
            }
        ];
        targets.forEach(target => {
            target.generation = 0;
            target.lastPaintSweepCycle = -1;
            target.lastDetectedSweepCycle = null;
            target.lastDetectedRangeNm = null;
            target.lastDetectedTrueBearing = null;
        });

        // Land collision detection function
        function isPointInLand(x, y) {
            for (let feature of landFeatures) {
                if (isPointInPolygon(x, y, feature.points)) {
                    return true;
                }
            }
            return false;
        }

        function isSafeWaterPosition(x, y, clearanceNm = NAVIGATION_CLEARANCE_NM) {
            return radarMath.hasLandClearance(
                { x, y },
                landPolygons,
                clearanceNm
            );
        }

        function isSafeWaterPath(start, end, clearanceNm = NAVIGATION_CLEARANCE_NM) {
            return radarMath.hasLandClearanceAlongPath(start, end, landPolygons, clearanceNm);
        }

        // Point in polygon test
        function isPointInPolygon(x, y, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                if (((polygon[i].y > y) !== (polygon[j].y > y)) &&
                    (x < (polygon[j].x - polygon[i].x) * (y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        // Find safe water position
        function findSafeWaterPosition(currentX, currentY, radius = 0.5) {
            // If current position is safe, return it
            if (isSafeWaterPosition(currentX, currentY)) {
                return { x: currentX, y: currentY };
            }

            // Try positions in expanding circles around the current position
            for (let r = radius; r <= 20; r += 0.5) {
                for (let angle = 0; angle < 360; angle += 30) {
                    const testX = currentX + r * Math.cos(angle * Math.PI / 180);
                    const testY = currentY + r * Math.sin(angle * Math.PI / 180);
                    if (isSafeWaterPosition(testX, testY)) {
                        return { x: testX, y: testY };
                    }
                }
            }

            throw new Error(`Unable to find safe water near ${currentX}, ${currentY}`);
        }

        function ensureSafeInitialPositions() {
            if (!isSafeWaterPosition(ownShip.x, ownShip.y)) {
                Object.assign(ownShip, findSafeWaterPosition(ownShip.x, ownShip.y));
            }
            targets.forEach(target => {
                if (isSafeWaterPosition(target.x, target.y)) return;
                const safe = findSafeWaterPosition(target.x, target.y);
                target.x = safe.x;
                target.y = safe.y;
                if (target.status === 'anchored') {
                    target.anchorX = safe.x;
                    target.anchorY = safe.y;
                }
            });
        }

        let arpaTargets = [];
        let selectedArpaIndex = -1;

        const dom = {
            container: document.getElementById('radar-container'),
            brillianceVal: document.getElementById('brilliance-value'),
            gainVal: document.getElementById('gain-value'),
            seaVal: document.getElementById('sea-value'),
            rainVal: document.getElementById('rain-value'),
            brillianceSlider: document.getElementById('brilliance-slider'),
            gainSlider: document.getElementById('gain-slider'),
            seaSlider: document.getElementById('sea-slider'),
            rainSlider: document.getElementById('rain-slider'),
            topLeftInd: document.getElementById('top-left-indication'),
            topRightInd: document.getElementById('top-right-indication'),
            bottomLeftInd: document.getElementById('bottom-left-indication'),
            acquireBtn: document.getElementById('btn-acquire'),
            arpaReadout: document.getElementById('arpa-readout'),
            guardZoneReadout: document.getElementById('guard-zone-readout'),
        };

        // --- CORE SIMULATION ---
        function clearTargetTrails() {
            radarMath.clearWakeTrails(targets);
        }

        function setWakesEnabled(enabled) {
            settings.showWakes = radarMath.setWakeRecording(targets, enabled);
            updateUI();
        }

        function updateWorld(deltaTime) {
            ownShip.heading = (ownShip.heading + ownShip.turnRate * deltaTime + 360) % 360;
            const ownShipPosition = radarMath.safeNextPosition(
                ownShip,
                ownShip.heading,
                ownShip.speed,
                deltaTime,
                point => isSafeWaterPosition(point.x, point.y),
                isSafeWaterPath
            );
            ownShip.x = ownShipPosition.x;
            ownShip.y = ownShipPosition.y;

            // Update targets
            targets.forEach(target => {
                if (target.status === 'anchored') {
                    // Anchored ships swing slightly around their anchor point
                    target.swingAngle += deltaTime * 0.1; // Slow swing
                    const swingPosition = {
                        x: target.anchorX + target.swingRadius * Math.sin(target.swingAngle),
                        y: target.anchorY + target.swingRadius * Math.cos(target.swingAngle)
                    };
                    if (isSafeWaterPosition(swingPosition.x, swingPosition.y)) {
                        target.x = swingPosition.x;
                        target.y = swingPosition.y;
                    }
                    target.heading = (target.heading + deltaTime * 2) % 360; // Slow rotation
                } else if (target.status === 'moving') {
                    let nextPosition = radarMath.safeNextPosition(
                        target,
                        target.heading,
                        target.speed,
                        deltaTime,
                        point => isSafeWaterPosition(point.x, point.y),
                        isSafeWaterPath
                    );
                    if (nextPosition.x === target.x && nextPosition.y === target.y) {
                        target.heading = (target.heading + 180) % 360;
                        target.baseHeading = target.heading;
                        nextPosition = radarMath.safeNextPosition(
                            target,
                            target.heading,
                            target.speed,
                            deltaTime,
                            point => isSafeWaterPosition(point.x, point.y),
                            isSafeWaterPath
                        );
                        if (nextPosition.x === target.x && nextPosition.y === target.y) {
                            const safePos = findSafeWaterPosition(target.x, target.y);
                            target.x = safePos.x;
                            target.y = safePos.y;
                            radarMath.resetTargetGeneration(target);
                        } else {
                            target.x = nextPosition.x;
                            target.y = nextPosition.y;
                        }
                    } else {
                        target.x = nextPosition.x;
                        target.y = nextPosition.y;

                        // Only apply minor course variations for realism, but keep mostly straight
                        if (target.type === 'sailing_yacht') {
                            // Very small wind-induced variations (±2 degrees max)
                            const windVariation = Math.sin(Date.now() * 0.0008) * 2;
                            target.heading = target.baseHeading + windVariation;
                            target.speed = target.baseSpeed + Math.sin(Date.now() * 0.0005) * 0.5; // Minor speed variation
                        }

                        if (target.type === 'motorboat') {
                            // Very small steering variations (±1 degree max)
                            const steeringVariation = Math.sin(Date.now() * 0.0003) * 1;
                            target.heading = target.baseHeading + steeringVariation;
                        }
                    }

                    // Wrap targets around when they leave radar range
                    const maxRange = 30;
                    const distFromCenter = Math.sqrt(
                        Math.pow(target.x - ownShip.x, 2) + Math.pow(target.y - ownShip.y, 2)
                    );

                    if (distFromCenter > maxRange) {
                        // Find a safe respawn position in open water
                        let attempts = 0;
                        let safePos;
                        do {
                            const angle = Math.random() * 2 * Math.PI;
                            const spawnDistance = 8 + Math.random() * 6;
                            const testX = ownShip.x + spawnDistance * Math.cos(angle);
                            const testY = ownShip.y + spawnDistance * Math.sin(angle);
                            safePos = findSafeWaterPosition(testX, testY);
                            attempts++;
                        } while (!isSafeWaterPosition(safePos.x, safePos.y) && attempts < 10);

                        target.x = safePos.x;
                        target.y = safePos.y;
                        radarMath.resetTargetGeneration(target);

                        // Set a new straight-line course
                        const courseOptions = [0, 45, 90, 135, 180, 225, 270, 315]; // Cardinal and intercardinal directions
                        target.heading = courseOptions[Math.floor(Math.random() * courseOptions.length)];
                        target.baseHeading = target.heading;

                        // Reset speeds to base values
                        if (target.type === 'sailing_yacht') {
                            target.speed = target.baseSpeed;
                        }

                    }
                }

                target.trail = radarMath.recordWakeSample(
                    target.trail,
                    target,
                    Date.now(),
                    settings.showWakes
                );
            });
        }

        // --- DRAWING ---
        function createEchoLayer(capturedAt) {
            const layerCanvas = document.createElement('canvas');
            layerCanvas.width = size || 0;
            layerCanvas.height = size || 0;
            return {
                canvas: layerCanvas,
                context: layerCanvas.getContext('2d'),
                capturedAt
            };
        }

        function resetEchoLayers(now) {
            echoLayers = [];
            activeEchoLayer = createEchoLayer(now);
            activeEchoSector = Math.floor(sweepAngle / ECHO_SECTOR_DEGREES);
            echoCanvas = activeEchoLayer.canvas;
            echoCtx = activeEchoLayer.context;
        }

        function advanceEchoLayer(now) {
            const sector = Math.floor(sweepAngle / ECHO_SECTOR_DEGREES);
            const sectorDurationMs = radarMath.rotationDurationMs(SWEEP_DEGREES_PER_SECOND)
                * ECHO_SECTOR_DEGREES / 360;
            if (!activeEchoLayer) {
                resetEchoLayers(now);
                return;
            }
            if (sector !== activeEchoSector || now - activeEchoLayer.capturedAt >= sectorDurationMs * 1.5) {
                echoLayers.push(activeEchoLayer);
                activeEchoLayer = createEchoLayer(now);
                activeEchoSector = sector;
                echoCanvas = activeEchoLayer.canvas;
                echoCtx = activeEchoLayer.context;
            }
        }

        function drawEchoLayers(now) {
            const lifetimeMs = radarMath.rotationDurationMs(SWEEP_DEGREES_PER_SECOND) * ECHO_ROTATIONS;
            echoLayers = echoLayers.filter(layer => now - layer.capturedAt < lifetimeMs);

            [...echoLayers, activeEchoLayer].forEach(layer => {
                if (!layer || layer.canvas.width === 0 || layer.canvas.height === 0) return;
                const alpha = radarMath.echoAlpha(now - layer.capturedAt, lifetimeMs);
                if (alpha <= 0) return;
                ctx.globalAlpha = alpha;
                ctx.drawImage(layer.canvas, 0, 0);
            });
            ctx.globalAlpha = 1;
        }

        function resetDisplayPersistence() {
            resetEchoLayers(performance.now());
            sweepCtx.clearRect(0, 0, sweepCanvas.width, sweepCanvas.height);
        }

        function draw(now, deltaTime) {
            if (size <= 0 || radius <= 0) return;

            const previousSweepAngle = sweepAngle;
            const rawSweepAdvance = deltaTime * SWEEP_DEGREES_PER_SECOND;
            const sweepAdvance = radarMath.boundedSweepAdvance(
                rawSweepAdvance,
                MAX_CATCH_UP_DEGREES
            );
            sweepCycle += Math.floor((sweepAngle + rawSweepAdvance) / 360);
            pruneStaleGuardDetections();
            sweepAngle = (sweepAngle + rawSweepAdvance) % 360;
            if (sweepAdvance === 0 && rawSweepAdvance > 0) {
                resetEchoLayers(now);
            } else {
                advanceEchoLayer(now);
            }

            // --- Step 1: Paint returns into the current finite-lifetime sector layer ---
            paintTargets(previousSweepAngle, sweepAdvance);
            paintLand(previousSweepAngle, sweepAdvance);

            // --- Step 2: Update sweep trail (afterglow) ---
            updateSweepTrail();

            // --- Step 3: Draw the main display canvas for this frame ---
            ctx.fillStyle = 'black';
            ctx.fillRect(0, 0, size, size);

            ctx.save();
            ctx.beginPath();
            const ppiClip = ppiClipState();
            ctx.arc(
                ppiClip.center.x,
                ppiClip.center.y,
                ppiClip.radius,
                0,
                2 * Math.PI
            );
            ctx.clip();

            // Draw sweep trail first (behind everything)
            if (sweepCanvas.width > 0 && sweepCanvas.height > 0) {
                ctx.drawImage(sweepCanvas, 0, 0);
            }

            drawEchoLayers(now);

            // Draw wakes/trails only if WAKES is enabled
            if (settings.showWakes) drawTrails();

            // Land is now painted on echo canvas, no separate drawLand() needed
            if (settings.showRings) drawRings();
            drawClutter();
            drawARPA();
            drawGuardViolations(now);
            if(settings.vrm1.active) drawMeasurementSet(settings.vrm1, 1);
            if(settings.vrm2.active) drawMeasurementSet(settings.vrm2, 2);
            if(settings.guardZone.active) drawGuardZone(now);
            if(settings.cursor.active) drawCursor();

            drawSweep();
            ctx.restore();

            // --- Step 4: Draw elements outside the circle ---
            drawBearingScale();
            if (settings.showSHM) drawHeadingLine();
        }

        function getDisplayState() {
            return {
                ownShip,
                headingMode: settings.headingMode,
                offset: settings.offset,
                centerX,
                centerY,
                radius,
                range: settings.range
            };
        }

        function getDisplayCenter() {
            return {
                x: centerX,
                y: centerY + (settings.offset ? -radius * 0.5 : 0)
            };
        }

        function measurementDisplayState() {
            return {
                center: getDisplayCenter(),
                ppiCenter: { x: centerX, y: centerY },
                radiusPixels: radius,
                rangeNm: settings.range,
                headingMode: settings.headingMode,
                ownHeading: ownShip.heading
            };
        }

        function measurementByNumber(setNumber) {
            return settings[`vrm${setNumber}`];
        }

        function hitTestMeasurements(point, pointerType) {
            const order = settings.activeMeasurementSet
                ? [
                    settings.activeMeasurementSet,
                    settings.activeMeasurementSet === 1 ? 2 : 1
                ]
                : [1, 2];
            const tolerance = radarMath.measurementHitTolerance(pointerType);

            for (const setNumber of order) {
                const measurement = measurementByNumber(setNumber);
                if (!measurement.active) continue;
                const geometry = radarMath.measurementGeometry(
                    measurement,
                    measurementDisplayState()
                );
                const component = radarMath.hitTestMeasurement(
                    point,
                    geometry,
                    tolerance
                );
                if (component) return { setNumber, component };
            }
            return null;
        }

        function hitTestEditableGuardZone(point, pointerType) {
            if (!settings.guardZone.active || !settings.guardZone.edit) return null;
            const geometry = radarMath.guardZoneGeometry(
                settings.guardZone,
                measurementDisplayState()
            );
            return radarMath.hitTestGuardZone(
                point,
                geometry,
                radarMath.guardHitTolerance(pointerType)
            );
        }

        function guardCursor(component) {
            if (component === 'body') return 'grab';
            if (component === 'inner' || component === 'outer') return 'ns-resize';
            return 'crosshair';
        }

        function applyMeasurementPointer(point) {
            if (!measurementDrag) return;
            const measurement = measurementByNumber(measurementDrag.setNumber);
            const updated = radarMath.applyMeasurementDrag(
                measurement,
                measurementDrag.component,
                point,
                measurementDisplayState()
            );
            measurement.range = updated.range;
            measurement.bearing = updated.bearing;
            updateUI();
        }

        function applyGuardPointer(point) {
            if (!guardDrag) return;
            const measurement = radarMath.guardMeasurementFromPoint(
                point,
                measurementDisplayState()
            );
            const updated = guardDrag.component === 'body'
                ? radarMath.rotateGuardZone(
                    settings.guardZone,
                    measurement.trueBearing,
                    guardDrag
                )
                : radarMath.applyGuardBoundaryDrag(
                    settings.guardZone,
                    guardDrag.component,
                    measurement,
                    {
                        maxRangeNm: settings.range,
                        minThicknessNm: 0.1,
                        minWidthDeg: 10
                    }
                );
            Object.assign(settings.guardZone, updated);
            updateUI();
        }

        function showMeasurementSet(setNumber) {
            measurementByNumber(setNumber).active = true;
            settings.activeMeasurementSet = setNumber;
            updateUI();
        }

        function hideMeasurementSet(setNumber) {
            measurementByNumber(setNumber).active = false;
            if (settings.activeMeasurementSet === setNumber) {
                settings.activeMeasurementSet = null;
            }
            updateUI();
        }

        function assignGuardZoneState(next) {
            Object.assign(settings.guardZone, next);
        }

        function showOrChangeGuardZone() {
            const wasArmed = settings.guardZone.armed;
            assignGuardZoneState(
                radarMath.guardZoneControlTransition(settings.guardZone, 'show-change')
            );
            if (!wasArmed && settings.guardZone.armed) {
                evaluateRecentGuardDetections();
            }
            updateUI();
        }

        function hideGuardZone() {
            assignGuardZoneState(
                radarMath.guardZoneControlTransition(settings.guardZone, 'hide')
            );
            updateUI();
        }

        function guardTargetSetsEqual(first, second) {
            if (first.size !== second.size) return false;
            for (const key of first) {
                if (!second.has(key)) return false;
            }
            return true;
        }

        function recordGuardDetection(target, rangeNm, trueBearing, targetSweepCycle) {
            if (!settings.guardZone.active || !settings.guardZone.armed) return;
            if (
                !Number.isFinite(rangeNm) ||
                !Number.isFinite(trueBearing) ||
                !Number.isFinite(targetSweepCycle) ||
                targetSweepCycle < sweepCycle - 1
            ) {
                return;
            }

            const key = radarMath.guardTargetKey(target);
            const previousTargetsInside = settings.guardZone.targetsInside;
            const previousAlarmActive = settings.guardZone.alarmActive;
            const previousAlarmSequence = settings.guardZone.alarmSequence;
            const nextLifecycle = radarMath.updateGuardAlarmLifecycle(
                settings.guardZone,
                {
                    key,
                    inside: radarMath.targetInsideGuardZone(
                        { rangeNm, trueBearing },
                        settings.guardZone
                    )
                }
            );
            settings.guardZone.targetsInside = nextLifecycle.targetsInside;
            settings.guardZone.alarmActive = nextLifecycle.alarmActive;
            settings.guardZone.alarmSequence = nextLifecycle.alarmSequence;

            const membershipChanged = (
                nextLifecycle.targetsInside.has(key) !== previousTargetsInside.has(key)
            );
            if (
                membershipChanged ||
                nextLifecycle.alarmActive !== previousAlarmActive ||
                nextLifecycle.alarmSequence !== previousAlarmSequence
            ) {
                updateUI();
            }
        }

        function evaluateRecentGuardDetections() {
            for (const target of targets) {
                if (
                    Number.isFinite(target.lastDetectedSweepCycle) &&
                    target.lastDetectedSweepCycle >= sweepCycle - 1
                ) {
                    recordGuardDetection(
                        target,
                        target.lastDetectedRangeNm,
                        target.lastDetectedTrueBearing,
                        target.lastDetectedSweepCycle
                    );
                }
            }
        }

        function pruneStaleGuardDetections() {
            if (lastGuardPruneCycle === sweepCycle) return;
            lastGuardPruneCycle = sweepCycle;
            if (!settings.guardZone.active || !settings.guardZone.armed) return;

            const liveKeys = new Set();
            for (const target of targets) {
                if (
                    Number.isFinite(target.lastDetectedSweepCycle) &&
                    target.lastDetectedSweepCycle >= sweepCycle - 1
                ) {
                    liveKeys.add(radarMath.guardTargetKey(target));
                }
            }

            const previousTargetsInside = settings.guardZone.targetsInside;
            const nextLifecycle = radarMath.pruneGuardAlarmLifecycle(
                settings.guardZone,
                liveKeys
            );
            settings.guardZone.targetsInside = nextLifecycle.targetsInside;
            if (!guardTargetSetsEqual(previousTargetsInside, nextLifecycle.targetsInside)) {
                updateUI();
            }
        }

        function worldToScreen(worldX, worldY) {
            return radarMath.worldToDisplay({ x: worldX, y: worldY }, getDisplayState());
        }

        function displayBearingToWorldBearing(displayBearing) {
            return radarMath.normalizeDegrees(
                displayBearing +
                (settings.headingMode === 'NORTH_UP' ? 0 : ownShip.heading)
            );
        }

        function paintLand(previousSweepAngle, sweepAdvance) {
            if (echoCanvas.width === 0 || echoCanvas.height === 0) return;
            const startedAt = performance.now();
            renderStats.landRays = 0;
            renderStats.landCells = 0;
            const displayCenter = getDisplayCenter();
            const azimuthStep = Math.max(
                0.35,
                180 / (Math.PI * Math.max(1, radius))
            );
            const beamWidthRadians = 1.2 * Math.PI / 180;

            for (const displayBearing of radarMath.sweepAzimuths(
                previousSweepAngle,
                sweepAdvance,
                azimuthStep
            )) {
                renderStats.landRays += 1;
                const cells = radarMath.sampleLandRay(
                    { x: ownShip.x, y: ownShip.y },
                    displayBearingToWorldBearing(displayBearing),
                    landPolygons,
                    {
                        maxRangeNm: settings.range,
                        radiusPixels: radius,
                        gain: settings.gain,
                        sea: settings.sea
                    }
                );
                const bearingRadians = displayBearing * Math.PI / 180;

                for (const cell of cells) {
                    renderStats.landCells += 1;
                    const nearPixels = Math.max(
                        0,
                        cell.range - cell.length * 0.5
                    ) / settings.range * radius;
                    const farPixels = Math.min(
                        settings.range,
                        cell.range + cell.length * 0.5
                    ) / settings.range * radius;
                    const crossRangePixels = Math.max(
                        1,
                        cell.range / settings.range * radius * beamWidthRadians
                    );
                    echoCtx.strokeStyle =
                        `rgba(51, 255, 119, ${cell.intensity})`;
                    echoCtx.lineWidth = Math.min(
                        5,
                        Math.max(0.8, crossRangePixels * cell.beamScale)
                    );
                    echoCtx.beginPath();
                    echoCtx.moveTo(
                        displayCenter.x + Math.sin(bearingRadians) * nearPixels,
                        displayCenter.y - Math.cos(bearingRadians) * nearPixels
                    );
                    echoCtx.lineTo(
                        displayCenter.x + Math.sin(bearingRadians) * farPixels,
                        displayCenter.y - Math.cos(bearingRadians) * farPixels
                    );
                    echoCtx.stroke();
                }
            }
            renderStats.lastFrameLandMs = performance.now() - startedAt;
        }

        function paintTargets(previousSweepAngle, sweepAdvance) {
            if (echoCanvas.width === 0 || echoCanvas.height === 0) return;
            const displayCenter = getDisplayCenter();

            targets.forEach(target => {
                const screen = worldToScreen(target.x, target.y);

                // Check if target is within radar range
                const distanceFromCenter = Math.sqrt(
                    Math.pow(screen.x - displayCenter.x, 2) +
                    Math.pow(screen.y - displayCenter.y, 2)
                );

                if (distanceFromCenter <= radius) {
                    // Calculate target bearing relative to sweep
                    const targetAngle = (Math.atan2(
                        screen.x - displayCenter.x,
                        -(screen.y - displayCenter.y)
                    ) * 180 / Math.PI + 360) % 360;
                    const targetSweepCycle = radarMath.sweptBearingCycle(
                        previousSweepAngle,
                        sweepAdvance,
                        targetAngle,
                        3,
                        sweepCycle
                    );
                    if (
                        targetSweepCycle !== null &&
                        target.lastPaintSweepCycle !== targetSweepCycle
                    ) {
                        target.lastPaintSweepCycle = targetSweepCycle;
                        // PROPER RADAR GAIN CALCULATION
                        // Gain controls receiver sensitivity and signal amplification
                        const distance = distanceFromCenter / radius * settings.range; // Distance in NM
                        const rangeAttenuation = 1 / Math.max(0.1, Math.pow(distance, 2)); // Radar range equation

                        // Base signal strength from target RCS and range
                        const baseSignalStrength = target.rcs * rangeAttenuation;

                        // Gain amplification (logarithmic scale like real radar)
                        // Gain 0% = 0.1x amplification, 100% = 10x amplification
                        const gainAmplification = Math.pow(10, (settings.gain - 50) / 50); // -20dB to +20dB range

                        // Apply receiver gain to amplify the signal
                        const amplifiedSignal = baseSignalStrength * gainAmplification;

                        // Sea clutter reduces signal-to-noise ratio
                        const seaClutterNoise = settings.sea / 100 * 0.3;
                        const signalToNoise = amplifiedSignal / (1 + seaClutterNoise);

                        // Final intensity with noise threshold
                        const noiseThreshold = 0.05; // Minimum detectable signal
                        const finalIntensity = Math.max(0, Math.min(1, signalToNoise - noiseThreshold));

                        // Only display if signal is above noise threshold
                        if (finalIntensity > 0) {
                            const trueBearing = radarMath.displayBearingToTrueBearing(
                                targetAngle,
                                settings.headingMode,
                                ownShip.heading
                            );
                            target.lastDetectedSweepCycle = targetSweepCycle;
                            target.lastDetectedRangeNm = distance;
                            target.lastDetectedTrueBearing = trueBearing;
                            recordGuardDetection(
                                target,
                                distance,
                                trueBearing,
                                targetSweepCycle
                            );
                            echoCtx.fillStyle = `rgba(51, 255, 119, ${finalIntensity})`;

                            // Draw ship-shaped radar returns based on vessel type
                            const shipLength = Math.max(3, Math.min(12, target.length / 30));
                            const shipWidth = Math.max(1, Math.min(4, target.width / 15));

                            echoCtx.save();
                            echoCtx.translate(screen.x, screen.y);

                            // Rotate based on ship heading
                            let shipHeading = target.heading;
                            if (settings.headingMode !== 'NORTH_UP') {
                                shipHeading -= ownShip.heading;
                            }
                            echoCtx.rotate(shipHeading * Math.PI / 180);

                            // Draw ship shape based on type
                            if (target.type === 'oil_tanker' || target.type === 'cargo_ship') {
                                echoCtx.fillRect(-shipLength/2, -shipWidth/2, shipLength, shipWidth);
                                echoCtx.fillRect(-shipLength/4, -shipWidth/3, shipLength/2, shipWidth/1.5);
                            } else if (target.type === 'tug') {
                                echoCtx.fillRect(-shipLength/2, -shipWidth/2, shipLength, shipWidth);
                                echoCtx.fillRect(-shipLength/6, -shipWidth/2, shipLength/3, shipWidth);
                            } else if (target.type === 'sailing_yacht') {
                                echoCtx.fillRect(-shipLength/2, -shipWidth/2, shipLength, shipWidth);
                                echoCtx.fillRect(-1, -shipWidth, 2, shipWidth * 2);
                            } else if (target.type === 'motorboat') {
                                echoCtx.fillRect(-shipLength/2, -shipWidth/2, shipLength, shipWidth);
                            }

                            echoCtx.restore();

                            // Keep scintillation deterministic so brightness does not depend on refresh rate.
                            const scintillation = value => {
                                const raw = Math.sin(value) * 43758.5453;
                                return raw - Math.floor(raw);
                            };
                            const scintillationSeed = target.id * 17 + activeEchoSector * 31;
                            if (scintillation(scintillationSeed) < 0.2 && finalIntensity > 0.3) {
                                echoCtx.fillStyle = `rgba(51, 255, 119, ${finalIntensity * 0.7})`;
                                echoCtx.beginPath();
                                echoCtx.arc(
                                    screen.x + (scintillation(scintillationSeed + 1) - 0.5) * shipLength,
                                    screen.y + (scintillation(scintillationSeed + 2) - 0.5) * shipWidth,
                                    scintillation(scintillationSeed + 3) * 2 + 1,
                                    0,
                                    2 * Math.PI
                                );
                                echoCtx.fill();
                            }
                        }
                    }
                }
            });
        }

        function drawRings() {
            ctx.strokeStyle = `rgba(51, 255, 119, 0.3)`;
            ctx.lineWidth = 1;
            const numRings = 6;
            const displayCenter = getDisplayCenter();
            for (let i = 1; i <= numRings; i++) {
                ctx.beginPath();
                ctx.arc(displayCenter.x, displayCenter.y, (radius / numRings) * i, 0, 2 * Math.PI);
                ctx.stroke();
            }
        }

        function drawBearingScale() {
            ctx.strokeStyle = `rgba(51, 255, 119, 0.6)`;
            ctx.font = `${Math.max(8, size * 0.02)}px 'Courier New', monospace`;
            ctx.fillStyle = `rgba(51, 255, 119, 0.8)`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            for (let i = 0; i < 360; i += 2) {
                let screenAngle = i;
                if (settings.headingMode !== 'NORTH_UP') {
                    screenAngle = (i - ownShip.heading + 360) % 360;
                }
                const rad = screenAngle * Math.PI / 180;

                const isTenDegreeMark = i % 10 === 0;
                const r1 = radius;
                const r2 = radius * (isTenDegreeMark ? 1.05 : 1.02);

                const x1 = centerX + r1 * Math.sin(rad);
                const y1 = centerY - r1 * Math.cos(rad);
                const x2 = centerX + r2 * Math.sin(rad);
                const y2 = centerY - r2 * Math.cos(rad);

                ctx.beginPath();
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                ctx.stroke();

                if (isTenDegreeMark) {
                    const r3 = radius * 1.08;
                    const x3 = centerX + r3 * Math.sin(rad);
                    const y3 = centerY - r3 * Math.cos(rad);
                    ctx.fillText(i.toString().padStart(3, '0'), x3, y3);
                }
            }
        }

        function drawHeadingLine() {
            const displayCenter = getDisplayCenter();
            ctx.strokeStyle = `rgba(51, 255, 119, 0.9)`;
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]); // Dashed line
            if (settings.headingMode === 'NORTH_UP') {
                ctx.save();
                ctx.translate(displayCenter.x, displayCenter.y);
                ctx.rotate(ownShip.heading * Math.PI / 180);
                ctx.beginPath();
                ctx.moveTo(0, 0); ctx.lineTo(0, -radius);
                ctx.stroke();
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.moveTo(displayCenter.x, displayCenter.y);
                ctx.lineTo(displayCenter.x, displayCenter.y - radius);
                ctx.stroke();
            }
            ctx.setLineDash([]); // Reset to solid line
        }

        function drawTrails() {
            if (!settings.showWakes) return;

            targets.forEach(target => {
                if (target.trail.length < 2) return;

                ctx.strokeStyle = `rgba(51, 255, 119, 0.6)`;
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);

                ctx.beginPath();
                let firstPoint = worldToScreen(target.trail[0].x, target.trail[0].y);
                ctx.moveTo(firstPoint.x, firstPoint.y);

                for (let i = 1; i < target.trail.length; i++) {
                    const point = worldToScreen(target.trail[i].x, target.trail[i].y);
                    ctx.lineTo(point.x, point.y);
                }

                ctx.stroke();
                ctx.setLineDash([]);

                // Draw dots along the trail for better visibility
                ctx.fillStyle = `rgba(51, 255, 119, 0.5)`;
                for (let i = 0; i < target.trail.length; i += 3) {
                    const point = worldToScreen(target.trail[i].x, target.trail[i].y);
                    ctx.beginPath();
                    ctx.arc(point.x, point.y, 1, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });
        }

        function drawClutter() {
            // Simulate sea clutter and rain clutter
            const clutterIntensity = settings.sea + settings.rain;
            if (clutterIntensity > 0) {
                const displayCenter = getDisplayCenter();
                ctx.fillStyle = `rgba(51, 255, 119, ${clutterIntensity * 0.002})`;
                for (let i = 0; i < clutterIntensity * 3; i++) {
                    const angle = Math.random() * 2 * Math.PI;
                    const distance = Math.random() * radius;
                    const x = displayCenter.x + distance * Math.cos(angle);
                    const y = displayCenter.y + distance * Math.sin(angle);

                    ctx.beginPath();
                    ctx.arc(x, y, Math.random() * 2 + 1, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
        }

        function resolveArpaTarget(arpa) {
            const target = targets.find(candidate => candidate.id === arpa.targetId);
            if (!target || target.generation !== arpa.targetGeneration) {
                arpa.status = 'LOST';
                return null;
            }
            arpa.status = 'TRACKING';
            return target;
        }

        function updateArpaReadout() {
            if (selectedArpaIndex < 0 || selectedArpaIndex >= arpaTargets.length) {
                dom.arpaReadout.textContent = 'NO TARGET SELECTED';
                return;
            }

            const arpa = arpaTargets[selectedArpaIndex];
            const target = resolveArpaTarget(arpa);
            if (!target) {
                dom.arpaReadout.textContent = `TARGET ${selectedArpaIndex + 1}\nSTATUS LOST`;
                return;
            }

            const closestApproach = radarMath.calculateCpaTcpa(ownShip, target);
            const tcpa = closestApproach.tcpaMinutes === null
                ? '--.- MIN'
                : closestApproach.past
                    ? `PAST ${Math.abs(closestApproach.tcpaMinutes).toFixed(1)} MIN`
                    : `${closestApproach.tcpaMinutes.toFixed(1)} MIN`;
            dom.arpaReadout.textContent = [
                `TARGET ${selectedArpaIndex + 1}  ${arpa.status}`,
                `COURSE ${target.heading.toFixed(1)}° T`,
                `SPEED ${target.speed.toFixed(1)} KT`,
                `CPA ${closestApproach.cpaNm.toFixed(2)} NM`,
                `TCPA ${tcpa}`
            ].join('\n');
        }

        function drawARPA() {
            arpaTargets.forEach((arpa, index) => {
                const target = resolveArpaTarget(arpa);
                if (!target) return;

                const screen = worldToScreen(target.x, target.y);
                const isSelected = index === selectedArpaIndex;

                ctx.strokeStyle = isSelected ? '#FF6B6B' : '#FFD700';
                ctx.lineWidth = 2;

                // Draw ARPA symbol (square)
                ctx.strokeRect(screen.x - 5, screen.y - 5, 10, 10);

                if (target.speed > 0) {
                    const velocity = radarMath.velocityVector(target.speed, target.heading);
                    const vectorEnd = worldToScreen(
                        target.x + velocity.x * 0.1,
                        target.y + velocity.y * 0.1
                    );
                    const vectorEndX = vectorEnd.x;
                    const vectorEndY = vectorEnd.y;

                    ctx.beginPath();
                    ctx.moveTo(screen.x, screen.y);
                    ctx.lineTo(vectorEndX, vectorEndY);
                    ctx.stroke();

                    // Arrow head
                    const arrowSize = 4;
                    const arrowAngle = Math.atan2(vectorEndY - screen.y, vectorEndX - screen.x);
                    ctx.beginPath();
                    ctx.moveTo(vectorEndX, vectorEndY);
                    ctx.lineTo(
                        vectorEndX - arrowSize * Math.cos(arrowAngle - Math.PI / 6),
                        vectorEndY - arrowSize * Math.sin(arrowAngle - Math.PI / 6)
                    );
                    ctx.moveTo(vectorEndX, vectorEndY);
                    ctx.lineTo(
                        vectorEndX - arrowSize * Math.cos(arrowAngle + Math.PI / 6),
                        vectorEndY - arrowSize * Math.sin(arrowAngle + Math.PI / 6)
                    );
                    ctx.stroke();
                }

                // Draw target number
                ctx.fillStyle = isSelected ? '#FF6B6B' : '#FFD700';
                ctx.font = '10px Courier New';
                ctx.fillText((index + 1).toString(), screen.x + 8, screen.y - 8);
            });
            updateArpaReadout();
        }

        function drawGuardViolations(now) {
            const guard = settings.guardZone;
            if (!guard.active || !guard.armed || guard.targetsInside.size === 0) return;

            const displayCenter = getDisplayCenter();
            const alarmPulse = 0.5 + 0.5 * Math.sin(now / 180);
            const strokeColor = guard.alarmActive
                ? `rgba(255, 86, 76, ${0.45 + alarmPulse * 0.35})`
                : 'rgba(255, 196, 64, 0.82)';
            const halfSize = guard.alarmActive ? 6 : 5;
            const cornerSize = guard.alarmActive ? 4 : 3;

            ctx.save();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = guard.alarmActive ? 1.5 : 1.2;

            for (const target of targets) {
                const key = radarMath.guardTargetKey(target);
                if (!guard.targetsInside.has(key)) continue;

                const screen = worldToScreen(target.x, target.y);
                if (
                    Math.hypot(screen.x - displayCenter.x, screen.y - displayCenter.y) > radius
                ) {
                    continue;
                }

                ctx.beginPath();
                ctx.moveTo(screen.x - halfSize, screen.y - halfSize + cornerSize);
                ctx.lineTo(screen.x - halfSize, screen.y - halfSize);
                ctx.lineTo(screen.x - halfSize + cornerSize, screen.y - halfSize);

                ctx.moveTo(screen.x + halfSize - cornerSize, screen.y - halfSize);
                ctx.lineTo(screen.x + halfSize, screen.y - halfSize);
                ctx.lineTo(screen.x + halfSize, screen.y - halfSize + cornerSize);

                ctx.moveTo(screen.x + halfSize, screen.y + halfSize - cornerSize);
                ctx.lineTo(screen.x + halfSize, screen.y + halfSize);
                ctx.lineTo(screen.x + halfSize - cornerSize, screen.y + halfSize);

                ctx.moveTo(screen.x - halfSize + cornerSize, screen.y + halfSize);
                ctx.lineTo(screen.x - halfSize, screen.y + halfSize);
                ctx.lineTo(screen.x - halfSize, screen.y + halfSize - cornerSize);
                ctx.stroke();
            }

            ctx.restore();
        }

        function drawCursor() {
            const pixelsPerNm = radius / settings.range;
            const displayCenter = getDisplayCenter();
            const screenX = displayCenter.x + settings.cursor.x * pixelsPerNm;
            const screenY = displayCenter.y - settings.cursor.y * pixelsPerNm;
            ctx.strokeStyle = '#40E0D0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(screenX - 10, screenY); ctx.lineTo(screenX + 10, screenY);
            ctx.moveTo(screenX, screenY - 10); ctx.lineTo(screenX, screenY + 10);
            ctx.stroke();
        }

        function drawMeasurementSet(measurement, setNumber) {
            const geometry = radarMath.measurementGeometry(
                measurement,
                measurementDisplayState()
            );
            const selected = settings.activeMeasurementSet === setNumber;
            ctx.strokeStyle = selected
                ? 'rgba(64, 224, 208, 1)'
                : 'rgba(51, 255, 119, 0.58)';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);

            if (geometry.vrmVisible) {
                ctx.beginPath();
                ctx.arc(
                    geometry.center.x,
                    geometry.center.y,
                    geometry.vrmRadiusPixels,
                    0,
                    2 * Math.PI
                );
                ctx.stroke();
            }

            ctx.beginPath();
            ctx.moveTo(geometry.center.x, geometry.center.y);
            ctx.lineTo(geometry.eblEnd.x, geometry.eblEnd.y);
            ctx.stroke();
            ctx.setLineDash([]);

            if (geometry.handle) {
                const halfSize = selected ? 4 : 3;
                ctx.strokeRect(
                    geometry.handle.x - halfSize,
                    geometry.handle.y - halfSize,
                    halfSize * 2,
                    halfSize * 2
                );
            }
        }

        function ppiClipState() {
            return {
                center: { x: centerX, y: centerY },
                radius
            };
        }

        function guardZonePresentationState(now) {
            const guard = settings.guardZone;
            const geometry = radarMath.guardZoneGeometry(
                guard,
                measurementDisplayState()
            );
            const isAcknowledgedViolation = (
                guard.armed &&
                guard.targetsInside.size > 0 &&
                !guard.alarmActive
            );
            const alarmPulse = 0.5 + 0.5 * Math.sin(now / 180);
            const fillAlpha = guard.alarmActive
                ? 0.06 + alarmPulse * 0.06
                : guard.edit || isAcknowledgedViolation
                    ? 0.08
                    : 0.035;
            const strokeAlpha = guard.alarmActive
                ? 0.95
                : guard.edit || isAcknowledgedViolation
                    ? 0.8
                    : 0.68;
            const alertColor = guard.alarmActive
                ? [255, 86, 76]
                : guard.edit || isAcknowledgedViolation
                    ? [255, 196, 64]
                    : [51, 255, 119];
            const [red, green, blue] = alertColor;

            return {
                state: guard.alarmActive
                    ? 'alarm'
                    : isAcknowledgedViolation
                        ? 'violation'
                        : guard.edit
                            ? 'edit'
                            : guard.armed
                                ? 'armed'
                                : 'inactive',
                fillAlpha,
                strokeAlpha,
                fillColor: `rgba(${red}, ${green}, ${blue}, ${fillAlpha})`,
                strokeColor: `rgba(${red}, ${green}, ${blue}, ${strokeAlpha})`,
                lineWidth: guard.alarmActive ? 2 : 1,
                handlesVisible: guard.edit,
                geometry,
                ppiClip: ppiClipState()
            };
        }

        function drawGuardZone(now) {
            const presentation = guardZonePresentationState(now);
            const { geometry } = presentation;
            const displayCenter = geometry.center;
            const startRad = geometry.startDisplayBearing * Math.PI / 180 - Math.PI / 2;
            const endRad = (geometry.startDisplayBearing + geometry.angularWidth) * Math.PI / 180 - Math.PI / 2;

            ctx.save();
            ctx.fillStyle = presentation.fillColor;
            ctx.strokeStyle = presentation.strokeColor;
            ctx.lineWidth = presentation.lineWidth;
            ctx.beginPath();
            ctx.arc(
                displayCenter.x,
                displayCenter.y,
                geometry.outerRadiusPixels,
                startRad,
                endRad
            );
            ctx.arc(
                displayCenter.x,
                displayCenter.y,
                geometry.innerRadiusPixels,
                endRad,
                startRad,
                true
            );
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            if (presentation.handlesVisible) {
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(255, 196, 64, 0.95)';
                for (const handle of [
                    geometry.handles.inner,
                    geometry.handles.outer,
                    geometry.handles.start,
                    geometry.handles.end
                ]) {
                    ctx.beginPath();
                    ctx.strokeRect(handle.x - 3, handle.y - 3, 6, 6);
                    ctx.moveTo(handle.x - 2, handle.y);
                    ctx.lineTo(handle.x + 2, handle.y);
                    ctx.moveTo(handle.x, handle.y - 2);
                    ctx.lineTo(handle.x, handle.y + 2);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }

        function updateSweepTrail() {
            if (sweepCanvas.width === 0 || sweepCanvas.height === 0) return;
            const displayCenter = getDisplayCenter();

            // Fade the existing trail
            sweepCtx.globalCompositeOperation = 'destination-out';
            sweepCtx.fillStyle = 'rgba(0, 0, 0, 0.08)'; // Slow fade
            sweepCtx.fillRect(0, 0, size, size);
            sweepCtx.globalCompositeOperation = 'source-over';

            // Paint new sweep trail line
            sweepCtx.save();
            sweepCtx.translate(displayCenter.x, displayCenter.y);
            sweepCtx.rotate(sweepAngle * Math.PI / 180);

            // Create yellowish afterglow gradient (more subtle)
            const trailGradient = sweepCtx.createLinearGradient(0, 0, 0, -radius);
            trailGradient.addColorStop(0, 'rgba(255, 255, 0, 0)'); // Transparent at center
            trailGradient.addColorStop(0.3, 'rgba(255, 255, 102, 0.04)'); // Very faint yellow
            trailGradient.addColorStop(0.7, 'rgba(255, 255, 51, 0.08)'); // Subtle yellow
            trailGradient.addColorStop(1, 'rgba(255, 255, 0, 0.03)'); // Very faint at edge

            sweepCtx.strokeStyle = trailGradient;
            sweepCtx.lineWidth = 8; // Wider than the main sweep
            sweepCtx.beginPath();
            sweepCtx.moveTo(0, 0);
            sweepCtx.lineTo(0, -radius);
            sweepCtx.stroke();

            sweepCtx.restore();
        }

        function drawSweep() {
            const displayCenter = getDisplayCenter();
            ctx.save();
            ctx.translate(displayCenter.x, displayCenter.y);
            ctx.rotate(sweepAngle * Math.PI / 180);

            // Main bright green sweep beam
            const gradient = ctx.createLinearGradient(0, 0, 0, -radius);
            gradient.addColorStop(0, `rgba(51, 255, 119, 0)`);
            gradient.addColorStop(0.9, `rgba(51, 255, 119, 0.9)`);
            gradient.addColorStop(1, `rgba(51, 255, 119, 0)`);
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -radius);
            ctx.stroke();

            // Add a bright center spot
            ctx.fillStyle = 'rgba(51, 255, 119, 0.6)';
            ctx.beginPath();
            ctx.arc(0, 0, 2, 0, 2 * Math.PI);
            ctx.fill();

            ctx.restore();
        }

        // --- UI & CONTROLS ---
        function formatCoord(value, dir) {
            const degrees = Math.floor(value);
            const minutes = (value - degrees) * 60;
            return `${degrees.toString().padStart(2, '0')}°${minutes.toFixed(3).padStart(6, '0')}'${dir}`;
        }

        function updateUI() {
            dom.container.style.opacity = settings.brilliance / 100;
            dom.brillianceVal.textContent = `${settings.brilliance}%`;
            dom.gainVal.textContent = `${settings.gain}%`;
            dom.seaVal.textContent = `${settings.sea}%`;
            dom.rainVal.textContent = `${settings.rain}%`;
            const guard = settings.guardZone;
            const guardArmed = settings.guardZone.armed;
            const guardAlarmActive = settings.guardZone.alarmActive;
            const guardStatus = guard.alarmActive
                ? 'ALARM'
                : guardArmed && guard.targetsInside.size > 0
                    ? 'VIOL'
                    : guardArmed
                        ? 'ARMED'
                        : guard.edit
                            ? 'EDIT'
                            : 'OFF';
            dom.guardZoneReadout.textContent = guard.active
                ? `GZ ${guardStatus}\nIN  ${guard.innerRange.toFixed(2)}NM\n` +
                  `OUT ${guard.outerRange.toFixed(2)}NM\n` +
                  `BRG ${guard.startBearing.toFixed(1)}-${guard.endBearing.toFixed(1)}T`
                : 'GZ OFF';
            dom.guardZoneReadout.classList.toggle('alarm', guardAlarmActive);
            document.getElementById('btn-gz-show').textContent = guard.alarmActive ? 'ACK' : 'SHOW/CHG';

            const latStr = formatCoord(ownShip.x, 'N');
            const lonStr = formatCoord(ownShip.y, 'W');
            dom.topLeftInd.innerHTML = `
                <div>${latStr}</div>
                <div>${lonStr}</div>
                <div>HDG: ${ownShip.heading.toFixed(1).padStart(5, '0')}° T</div>
                <div>SPD: ${ownShip.speed.toFixed(1)} KT</div>
            `;

            const rangeVal = settings.range < 1 ? settings.range.toFixed(2) : settings.range.toFixed(0);
            let screenParts = [];
            if (settings.showRings) {
                const numRings = 6;
                let ringSpacing = (settings.range / numRings);
                ringSpacing = ringSpacing < 1 ? ringSpacing.toFixed(2) : ringSpacing.toFixed(1);
                screenParts.push(`RINGS ${ringSpacing}NM`);
            }
            if (settings.offset) {
                screenParts.push('OFFSET');
            }
            dom.topRightInd.innerHTML = `
                <div>RNG ${rangeVal}NM</div>
                <div>${screenParts.join(' | ')}</div>
                <div>${settings.headingMode.replace('_', ' ')}</div>
                <div>MOTION ${settings.motionMode === 'RELATIVE' ? 'REL' : 'TRUE'}</div>
                ${settings.showWakes ? '<div>WAKES ON</div>' : ''}
            `;

            const vrm1_brg = settings.vrm1.active ? `EBL1 ${settings.vrm1.bearing.toFixed(1)}°T` : '';
            const vrm2_brg = settings.vrm2.active ? `EBL2 ${settings.vrm2.bearing.toFixed(1)}°T` : '';
            const vrm1_rng = settings.vrm1.active ? `VRM1 ${settings.vrm1.range.toFixed(2)}NM` : '';
            const vrm2_rng = settings.vrm2.active ? `VRM2 ${settings.vrm2.range.toFixed(2)}NM` : '';

            dom.bottomLeftInd.innerHTML = `
                <div>CURSOR BRG</div><div>${vrm1_brg}</div>
                <div>${settings.cursor.active ? settings.cursor.bearing.toFixed(1) : '---.-'}°</div><div>${vrm2_brg}</div>
                <div>CURSOR RNG</div><div>${vrm1_rng}</div>
                <div>${settings.cursor.active ? settings.cursor.range.toFixed(2) : '--.--'} NM</div><div>${vrm2_rng}</div>
            `;

            document.querySelectorAll('#control-panel button').forEach(b => b.classList.remove('active'));
            document.querySelector(`#btn-${settings.headingMode.toLowerCase().replace('_','-')}`).classList.add('active');
            if (settings.showRings) document.getElementById('btn-rings').classList.add('active');
            if (settings.offset) document.getElementById('btn-offset').classList.add('active');
            if (settings.showWakes) document.getElementById('btn-wakes').classList.add('active');
            if (settings.acquireMode) dom.acquireBtn.classList.add('active');
            document.getElementById('btn-gz-show').classList.toggle('active', guard.active);

            [1, 2].forEach(setNumber => {
                const measurement = measurementByNumber(setNumber);
                const button = document.getElementById(`btn-vrm${setNumber}-show`);
                button.classList.toggle('measurement-visible', measurement.active);
                button.classList.toggle(
                    'measurement-selected',
                    measurement.active && settings.activeMeasurementSet === setNumber
                );
            });
        }

        function setupControls() {
            const addSliderCtrl = (id, prop) => {
                dom[`${id}Slider`].addEventListener('input', (e) => {
                    settings[prop] = parseFloat(e.target.value);
                    updateUI();
                });
            };
            addSliderCtrl('brilliance', 'brilliance');
            addSliderCtrl('gain', 'gain');
            addSliderCtrl('sea', 'sea');
            addSliderCtrl('rain', 'rain');

            document.getElementById('range-up').addEventListener('click', () => {
                settings.rangeIndex = Math.min(settings.ranges.length - 1, settings.rangeIndex + 1);
                resetDisplayPersistence();
                updateUI();
            });
            document.getElementById('range-down').addEventListener('click', () => {
                settings.rangeIndex = Math.max(0, settings.rangeIndex - 1);
                resetDisplayPersistence();
                updateUI();
            });
            ['head-up', 'north-up', 'course-up'].forEach(id => {
                document.getElementById(`btn-${id}`).addEventListener('click', () => {
                    settings.headingMode = id.replace('btn-','').toUpperCase().replace('-','_');
                    resetDisplayPersistence();
                    updateUI();
                });
            });

            document.getElementById('btn-rings').addEventListener('click', () => { settings.showRings = !settings.showRings; updateUI(); });
            document.getElementById('btn-offset').addEventListener('click', () => {
                settings.offset = !settings.offset;
                resetDisplayPersistence();
                updateUI();
            });
            document.getElementById('btn-wakes').addEventListener('click', () => {
                setWakesEnabled(!settings.showWakes);
            });
            document.getElementById('btn-clear-wakes').addEventListener('click', () => {
                clearTargetTrails();
            });

            const shmBtn = document.getElementById('btn-shm');
            shmBtn.addEventListener('mousedown', () => { settings.showSHM = false; });
            shmBtn.addEventListener('mouseup', () => { settings.showSHM = true; });
            shmBtn.addEventListener('mouseleave', () => { settings.showSHM = true; });

            // ARPA controls
            document.getElementById('btn-acquire').addEventListener('click', () => {
                settings.acquireMode = !settings.acquireMode;
                updateUI();
            });

            document.getElementById('btn-select').addEventListener('click', () => {
                if (arpaTargets.length > 0) {
                    selectedArpaIndex = (selectedArpaIndex + 1) % arpaTargets.length;
                }
            });

            document.getElementById('btn-cancel').addEventListener('click', () => {
                if (selectedArpaIndex >= 0 && selectedArpaIndex < arpaTargets.length) {
                    arpaTargets.splice(selectedArpaIndex, 1);
                    selectedArpaIndex = -1;
                }
            });

            document.getElementById('btn-cancel-all').addEventListener('click', () => {
                arpaTargets = [];
                selectedArpaIndex = -1;
            });

            [1, 2].forEach(setNumber => {
                document
                    .getElementById(`btn-vrm${setNumber}-show`)
                    .addEventListener('click', () => showMeasurementSet(setNumber));
                document
                    .getElementById(`btn-vrm${setNumber}-hide`)
                    .addEventListener('click', () => hideMeasurementSet(setNumber));
            });
            document.getElementById('btn-gz-show').addEventListener('click', showOrChangeGuardZone);
            document.getElementById('btn-gz-hide').addEventListener('click', hideGuardZone);

            function pointerToCanvasPoint(event) {
                const rect = canvas.getBoundingClientRect();
                return radarMath.clientToCanvas(
                    event.clientX,
                    event.clientY,
                    rect,
                    canvas.width,
                    canvas.height
                );
            }

            function pointerToRadarPoint(event) {
                return radarMath.clampToCircle(
                    pointerToCanvasPoint(event),
                    getDisplayCenter(),
                    radius
                );
            }

            function pointerToMeasurementPoint(event) {
                return radarMath.clampToCircle(
                    pointerToCanvasPoint(event),
                    { x: centerX, y: centerY },
                    radius
                );
            }

            function handleCursorMove(point) {
                const displayCenter = getDisplayCenter();
                settings.cursor.active = true;
                const dx = point.x - displayCenter.x;
                const dy = point.y - displayCenter.y;
                const cursorRangePx = Math.hypot(dx, dy);

                settings.cursor.range = (cursorRangePx / radius) * settings.range;
                let cursorBearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;

                settings.cursor.x = settings.cursor.range * Math.sin(cursorBearing * Math.PI / 180);
                settings.cursor.y = settings.cursor.range * Math.cos(cursorBearing * Math.PI / 180);

                if (settings.headingMode !== 'NORTH_UP') {
                    cursorBearing = (cursorBearing + ownShip.heading) % 360;
                }
                settings.cursor.bearing = cursorBearing;
                updateUI();
            }

            function handleTargetAcquisition(point) {
                if (!settings.acquireMode) return;
                const pixelsPerNm = radius / settings.range;
                const worldPoint = radarMath.displayToWorld(point, getDisplayState());
                const acquisitionToleranceNm = 12 / pixelsPerNm;

                // Find the closest target to the click
                let closestTarget = null;
                let minDistance = Infinity;

                targets.forEach(target => {
                    const distance = Math.hypot(
                        target.x - worldPoint.x,
                        target.y - worldPoint.y
                    );
                    if (distance < minDistance && distance < acquisitionToleranceNm) {
                        minDistance = distance;
                        closestTarget = target;
                    }
                });

                if (closestTarget) {
                    // Add to ARPA if not already tracked
                    const existingIndex = arpaTargets.findIndex(arpa =>
                        arpa.targetId === closestTarget.id &&
                        arpa.targetGeneration === closestTarget.generation
                    );
                    if (existingIndex === -1) {
                        const newTrack = {
                            targetId: closestTarget.id,
                            targetGeneration: closestTarget.generation,
                            acquiredAt: performance.now(),
                            status: 'TRACKING'
                        };
                        const staleIndex = arpaTargets.findIndex(arpa =>
                            arpa.targetId === closestTarget.id
                        );
                        if (staleIndex >= 0) {
                            arpaTargets[staleIndex] = newTrack;
                            selectedArpaIndex = staleIndex;
                        } else {
                            arpaTargets.push(newTrack);
                            selectedArpaIndex = arpaTargets.length - 1;
                        }
                    } else {
                        selectedArpaIndex = existingIndex;
                    }
                    settings.acquireMode = false;
                    updateUI();
                }
            }

            canvas.addEventListener('pointerdown', event => {
                const canvasPoint = pointerToCanvasPoint(event);
                const guardHit = hitTestEditableGuardZone(canvasPoint, event.pointerType);
                if (guardHit) {
                    const measurement = radarMath.guardMeasurementFromPoint(
                        canvasPoint,
                        measurementDisplayState()
                    );
                    guardDrag = {
                        pointerId: event.pointerId,
                        component: guardHit,
                        pointerBearing: measurement.trueBearing,
                        startBearing: settings.guardZone.startBearing,
                        endBearing: settings.guardZone.endBearing
                    };
                    canvas.setPointerCapture(event.pointerId);
                    canvas.style.cursor = 'grabbing';
                    applyGuardPointer(canvasPoint);
                    event.preventDefault();
                    return;
                }

                const measurementPoint = pointerToMeasurementPoint(event);
                const measurementHit = measurementPoint.clamped
                    ? null
                    : hitTestMeasurements(
                        measurementPoint,
                        event.pointerType
                    );
                if (measurementHit) {
                    const hit = measurementHit;
                    measurementDrag = {
                        pointerId: event.pointerId,
                        setNumber: hit.setNumber,
                        component: hit.component
                    };
                    settings.activeMeasurementSet = measurementHit.setNumber;
                    canvas.setPointerCapture(event.pointerId);
                    canvas.style.cursor = 'grabbing';
                    applyMeasurementPointer(measurementPoint);
                    event.preventDefault();
                    return;
                }

                const point = pointerToRadarPoint(event);
                isDraggingCursor = true;
                canvas.setPointerCapture(event.pointerId);
                handleCursorMove(point);
                handleTargetAcquisition(point);
            });
            canvas.addEventListener('pointermove', event => {
                if (
                    guardDrag &&
                    guardDrag.pointerId === event.pointerId
                ) {
                    applyGuardPointer(pointerToCanvasPoint(event));
                    return;
                }
                if (
                    measurementDrag &&
                    measurementDrag.pointerId === event.pointerId
                ) {
                    applyMeasurementPointer(pointerToMeasurementPoint(event));
                    return;
                }
                if (isDraggingCursor) {
                    handleCursorMove(pointerToRadarPoint(event));
                    return;
                }

                const canvasPoint = pointerToCanvasPoint(event);
                if (settings.guardZone.edit) {
                    const guardHit = hitTestEditableGuardZone(canvasPoint, event.pointerType);
                    if (guardHit) {
                        canvas.style.cursor = guardCursor(guardHit);
                        return;
                    }
                }

                const measurementPoint = pointerToMeasurementPoint(event);
                const hit = measurementPoint.clamped
                    ? null
                    : hitTestMeasurements(
                        measurementPoint,
                        event.pointerType
                    );
                canvas.style.cursor = !hit
                    ? 'default'
                    : hit.component === 'handle'
                        ? 'grab'
                        : hit.component === 'vrm'
                            ? 'ns-resize'
                            : 'crosshair';
            });
            const finishPointer = event => {
                if (
                    guardDrag &&
                    guardDrag.pointerId === event.pointerId
                ) {
                    guardDrag = null;
                }
                if (
                    measurementDrag &&
                    measurementDrag.pointerId === event.pointerId
                ) {
                    measurementDrag = null;
                }
                isDraggingCursor = false;
                canvas.style.cursor = 'default';
                if (canvas.hasPointerCapture(event.pointerId)) {
                    canvas.releasePointerCapture(event.pointerId);
                }
            };
            canvas.addEventListener('pointerup', finishPointer);
            canvas.addEventListener('pointercancel', finishPointer);

            window.addEventListener('keydown', e => {
                if (e.key === 'ArrowLeft') ownShip.turnRate = -5;
                if (e.key === 'ArrowRight') ownShip.turnRate = 5;
            });
            window.addEventListener('keyup', e => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') ownShip.turnRate = 0;
            });
        }

        function setupHelp() {
            const drawer = document.getElementById('help-drawer');
            const backdrop = document.getElementById('help-backdrop');
            const closeButton = document.getElementById('help-close');
            const title = document.getElementById('help-title');
            const body = document.getElementById('help-body');
            let activeTrigger = null;
            drawer.inert = true;

            function openHelp(topicKey, trigger) {
                const topic = helpTopics[topicKey];
                if (!topic) {
                    throw new Error(`Missing help topic: ${topicKey}`);
                }
                activeTrigger = trigger;
                title.textContent = topic.title;
                body.textContent = topic.body;
                backdrop.hidden = false;
                drawer.inert = false;
                dom.container.inert = true;
                drawer.classList.add('open');
                drawer.setAttribute('aria-hidden', 'false');
                closeButton.focus();
            }

            function closeHelp() {
                if (drawer.getAttribute('aria-hidden') === 'true') return;
                drawer.classList.remove('open');
                drawer.setAttribute('aria-hidden', 'true');
                drawer.inert = true;
                dom.container.inert = false;
                backdrop.hidden = true;
                const trigger = activeTrigger;
                activeTrigger = null;
                if (trigger) trigger.focus();
            }

            document.querySelectorAll('[data-help-topic]').forEach(button => {
                button.addEventListener('click', () => {
                    openHelp(button.dataset.helpTopic, button);
                });
            });
            closeButton.addEventListener('click', closeHelp);
            backdrop.addEventListener('click', closeHelp);
            drawer.addEventListener('keydown', event => {
                if (event.key !== 'Tab') return;
                const focusable = [...drawer.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )].filter(element => !element.inert);
                if (focusable.length === 0) {
                    event.preventDefault();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            });
            window.addEventListener('keydown', event => {
                if (event.key === 'Escape') closeHelp();
            });
        }

        // --- INITIALIZATION ---
        function init() {
            ensureSafeInitialPositions();
            window.__radarTestApi.getSafetySnapshot = () => {
                const vesselClearance = vessel => Math.min(
                    ...landPolygons.map(polygon =>
                        radarMath.distanceToPolygon({ x: vessel.x, y: vessel.y }, polygon)
                    )
                );
                return {
                    ownShip: { x: ownShip.x, y: ownShip.y, clearance: vesselClearance(ownShip) },
                    targets: targets.map(target => ({
                        id: target.id,
                        x: target.x,
                        y: target.y,
                        clearance: vesselClearance(target),
                        status: target.status,
                        speed: target.speed,
                        generation: target.generation
                    }))
                };
            };
            window.__radarTestApi.advanceWorldForTest = deltaTime => updateWorld(deltaTime);
            window.__radarTestApi.setWakesEnabled = enabled =>
                setWakesEnabled(Boolean(enabled));
            window.__radarTestApi.getWakeSnapshot = () => ({
                enabled: settings.showWakes,
                trails: targets.map(target =>
                    target.trail.map(point => ({ ...point }))
                )
            });
            window.__radarTestApi.getLandGeometry = () =>
                landPolygons.map(polygon => polygon.map(point => ({ ...point })));
            window.__radarTestApi.sampleLandEcho = displayBearing =>
                radarMath.sampleLandRay(
                    { x: ownShip.x, y: ownShip.y },
                    displayBearingToWorldBearing(displayBearing),
                    landPolygons,
                    {
                        maxRangeNm: settings.range,
                        radiusPixels: radius,
                        gain: settings.gain,
                        sea: settings.sea
                    }
                ).map(cell => ({ ...cell }));
            window.__radarTestApi.setRadarRangeIndex = rangeIndex => {
                settings.rangeIndex = Math.max(
                    0,
                    Math.min(settings.ranges.length - 1, rangeIndex)
                );
                resetDisplayPersistence();
                updateUI();
            };
            window.__radarTestApi.getLandEchoMetrics = displayBearing => {
                const cells = window.__radarTestApi.sampleLandEcho(displayBearing);
                if (cells.length === 0) {
                    return {
                        count: 0,
                        brightest: 0,
                        mean: 0,
                        firstRange: null,
                        lastRange: null
                    };
                }
                const intensities = cells.map(cell => cell.intensity);
                return {
                    count: cells.length,
                    brightest: Math.max(...intensities),
                    mean: intensities.reduce(
                        (sum, value) => sum + value,
                        0
                    ) / intensities.length,
                    firstRange: cells[0].range,
                    lastRange: cells[cells.length - 1].range
                };
            };
            window.__radarTestApi.getRenderStats = () => ({ ...renderStats });
            window.__radarTestApi.getMeasurementSnapshot = () => ({
                activeMeasurementSet: settings.activeMeasurementSet,
                rangeNm: settings.range,
                headingMode: settings.headingMode,
                ownHeading: ownShip.heading,
                sets: [1, 2].map(setNumber => ({
                    setNumber,
                    ...measurementByNumber(setNumber),
                    geometry: radarMath.measurementGeometry(
                        measurementByNumber(setNumber),
                        measurementDisplayState()
                    )
                })),
                cursor: { ...settings.cursor }
            });
            window.__radarTestApi.setMeasurementState = (
                setNumber,
                state
            ) => {
                const measurement = measurementByNumber(setNumber);
                if (typeof state.active === 'boolean') {
                    measurement.active = state.active;
                }
                if (Number.isFinite(state.range)) measurement.range = state.range;
                if (Number.isFinite(state.bearing)) {
                    measurement.bearing = radarMath.normalizeDegrees(state.bearing);
                }
                if (state.selected === true) {
                    settings.activeMeasurementSet = setNumber;
                } else if (
                    state.selected === false &&
                    settings.activeMeasurementSet === setNumber
                ) {
                    settings.activeMeasurementSet = null;
                }
                updateUI();
            };
            window.__radarTestApi.getGuardZoneSnapshot = () => ({
                active: settings.guardZone.active,
                edit: settings.guardZone.edit,
                armed: settings.guardZone.armed,
                innerRange: settings.guardZone.innerRange,
                outerRange: settings.guardZone.outerRange,
                startBearing: settings.guardZone.startBearing,
                endBearing: settings.guardZone.endBearing,
                alarmActive: settings.guardZone.alarmActive,
                alarmSequence: settings.guardZone.alarmSequence,
                targetsInside: [...settings.guardZone.targetsInside],
                rangeNm: settings.range,
                headingMode: settings.headingMode,
                ownHeading: ownShip.heading,
                radiusPixels: radius,
                displayCenter: getDisplayCenter(),
                ppiCenter: { x: centerX, y: centerY },
                geometry: radarMath.guardZoneGeometry(
                    settings.guardZone,
                    measurementDisplayState()
                )
            });
            window.__radarTestApi.getGuardZonePresentation = () =>
                guardZonePresentationState(performance.now());
            window.__radarTestApi.setGuardZoneState = state => {
                if (!state || typeof state !== 'object') {
                    throw new Error('Guard zone state must be an object');
                }
                for (const field of ['active', 'edit', 'armed', 'alarmActive']) {
                    if (typeof state[field] === 'boolean') {
                        settings.guardZone[field] = state[field];
                    }
                }
                for (const field of [
                    'innerRange',
                    'outerRange',
                    'alarmSequence'
                ]) {
                    if (Number.isFinite(state[field])) {
                        settings.guardZone[field] = state[field];
                    }
                }
                for (const field of ['startBearing', 'endBearing']) {
                    if (Number.isFinite(state[field])) {
                        settings.guardZone[field] = radarMath.normalizeDegrees(state[field]);
                    }
                }
                if (Array.isArray(state.targetsInside)) {
                    settings.guardZone.targetsInside = new Set(state.targetsInside);
                }
                updateUI();
            };
            window.__radarTestApi.setTargetState = (targetId, state) => {
                const target = targets.find(candidate => candidate.id === targetId);
                if (!target) {
                    throw new Error(`Unknown target ID: ${targetId}`);
                }
                if (!state || typeof state !== 'object') {
                    throw new Error('Target state must be an object');
                }
                for (const field of ['x', 'y', 'speed', 'rcs', 'generation']) {
                    if (Number.isFinite(state[field])) target[field] = state[field];
                }
                if (Number.isFinite(state.heading)) {
                    target.heading = radarMath.normalizeDegrees(state.heading);
                }
                if (state.status === 'stationary') {
                    target.status = state.status;
                }
            };
            window.__radarTestApi.recordGuardDetectionForTest = targetId => {
                const target = targets.find(candidate => candidate.id === targetId);
                if (!target) {
                    throw new Error(`Unknown target ID: ${targetId}`);
                }
                const dx = target.x - ownShip.x;
                const dy = target.y - ownShip.y;
                recordGuardDetection(
                    target,
                    Math.hypot(dx, dy),
                    radarMath.normalizeDegrees(Math.atan2(dx, dy) * 180 / Math.PI),
                    sweepCycle
                );
            };
            const resize = () => {
                const container = document.getElementById('scope-wrapper');
                size = Math.min(container.clientWidth, container.clientHeight);
                canvas.width = size;
                canvas.height = size;
                sweepCanvas.width = size;
                sweepCanvas.height = size;
                radius = size / 2 * 0.8; // Adjusted radius to make space for outer marks
                centerX = size / 2;
                centerY = size / 2;
                resetEchoLayers(performance.now());
            };

            window.addEventListener('resize', resize);
            resize();

            setupControls();
            setupHelp();
            updateUI();

            let lastTime = 0;
            function mainLoop(currentTime) {
                const deltaTime = (currentTime - lastTime) / 1000;
                if (lastTime > 0) {
                    updateWorld(deltaTime);
                }
                draw(currentTime, lastTime > 0 ? deltaTime : 0);
                lastTime = currentTime;
                requestAnimationFrame(mainLoop);
            }
            requestAnimationFrame(mainLoop);
        }

        init();
    });
    