import { VolumeRadarScanner } from './src/core/volumeRadarScanner.js';
async function test() {
    await VolumeRadarScanner.initializeBaselines();
}
test();
