import { tsParticles } from '@tsparticles/engine';
import { loadBasic } from '@tsparticles/basic';
import { loadLineShape } from '@tsparticles/shape-line';
// 只載發射器本體，不載「點擊產生」互動（那個需要額外的互動外掛）
import { loadEmittersPluginSimple } from '@tsparticles/plugin-emitters/plugin';
import { loadEmittersShapeSquare } from '@tsparticles/plugin-emitters-shape-square';
import { loadLifeUpdater } from '@tsparticles/updater-life';
import { loadRotateUpdater } from '@tsparticles/updater-rotate';
let ready;
export function engine() {
  ready ||= (async () => {
    await loadBasic(tsParticles);
    await loadLineShape(tsParticles);
    await loadEmittersPluginSimple(tsParticles);
    await loadEmittersShapeSquare(tsParticles);  // v4 的發射器形狀是另外的套件，沒載就噴不出東西
    await loadLifeUpdater(tsParticles);
    await loadRotateUpdater(tsParticles);
    return tsParticles;
  })();
  return ready;
}
