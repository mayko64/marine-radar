
        window.__radarTestApi = radarMath;

        /* HELP_TOPICS_START */
        const helpTopics = {
            brilliance: {
                title: 'Brilliance',
                body: 'Adjusts the brightness of the complete radar presentation. Lower values dim the display without changing which echoes are detected.'
            },
            gain: {
                title: 'Gain',
                body: 'Controls receiver sensitivity. Increase gain to reveal weaker returns; excessive gain also raises clutter and can make targets harder to distinguish.'
            },
            sea: {
                title: 'Sea clutter',
                body: 'Simulates suppression of short-range reflections from waves. Increase SEA when the centre of the display is obscured, but avoid suppressing nearby small craft.'
            },
            rain: {
                title: 'Rain clutter',
                body: 'Controls simulated precipitation clutter. Higher settings add diffuse returns that can mask targets inside rain showers.'
            },
            cursor: {
                title: 'PPI cursor',
                body: 'Press and drag on the radar to position the turquoise cross. The readout shows true bearing and range. If the pointer leaves the PPI, the cross remains clamped to the radar edge.'
            },
            range: {
                title: 'Range',
                body: 'Changes the maximum displayed distance. RANGE + shows a larger area with less detail; RANGE - magnifies nearby contacts.'
            },
            heading: {
                title: 'Heading modes',
                body: 'NORTH UP keeps true north at the top. HEAD UP and COURSE UP rotate the radar presentation relative to own ship so the vessel direction is at the top.'
            },
            screen: {
                title: 'Screen controls',
                body: 'Controls presentation aids such as range rings, the ship heading marker, and off-centred own-ship display. These aids do not change target motion.'
            },
            rings: {
                title: 'Range rings',
                body: 'Shows six equally spaced circles. Their spacing is listed in the top-right radar indication and changes with the selected range.'
            },
            shm: {
                title: 'Ship heading marker',
                body: 'The SHM indicates own-ship heading. Hold the button to suppress the line temporarily when it obscures an echo.'
            },
            offset: {
                title: 'Offset display',
                body: 'Moves own ship below the PPI centre to provide more view ahead. Cursor, echoes, ARPA, rings, vectors, and acquisition use the same shifted origin.'
            },
            targets: {
                title: 'Targets',
                body: 'Radar contacts represent anchored, stationary, and moving vessels. Their returns appear only when illuminated by the rotating sweep.'
            },
            wakes: {
                title: 'Target wakes',
                body: 'WAKES starts a new wake recording from the moment it is enabled. Disabling WAKES stops recording and discards the current tracks. CLEAR WAKES clears the current recording without affecting targets or ARPA tracking.'
            },
            arpa: {
                title: 'ARPA',
                body: 'Select ACQUIRE, then click close to a radar target. ARPA follows the live target and displays true course, speed, CPA, and TCPA. SELECT cycles tracks; CANCEL removes one; CANCEL ALL removes every track. LOST means the original target lifecycle ended.'
            },
            vrm: {
                title: 'VRM and EBL',
                body: 'SHOW/CHG displays and selects a VRM/EBL set. Drag the circle to measure range, the line to measure true bearing, or the small intersection handle to adjust both. HIDE preserves the measurement for later restoration.'
            },
            guard: {
                title: 'Guard zone',
                body: 'SHOW/CHG creates the zone, then cycles it between edit and armed states. Drag the inner and outer boundaries to set range, drag the start and end boundaries to set bearing limits, and drag the body to rotate the whole sector. When an alarm is active, SHOW/CHG acts as ACK first; the next press returns to edit. HIDE turns monitoring off but keeps the stored geometry.'
            }
        };
        /* HELP_TOPICS_END */