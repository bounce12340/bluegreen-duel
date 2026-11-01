// WebGL 轉場（gl-transitions 的 shader）：把兩張畫面（canvas 或圖片）用轉場效果接起來，蓋在整個畫面上播。
// 用在開局「藍 VS 綠」與結算。瀏覽器不支援 WebGL 時直接略過（呼叫端會照常進行）。
import { TRANSITIONS } from './gl_transitions.js';

const VERT = `attribute vec2 pos; varying vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`;
const fragOf = (glsl) => `precision mediump float;
varying vec2 uv; uniform sampler2D from, to; uniform float progress, ratio;
vec4 getFromColor(vec2 p) { return texture2D(from, vec2(p.x, 1.0 - p.y)); }
vec4 getToColor(vec2 p) { return texture2D(to, vec2(p.x, 1.0 - p.y)); }
${glsl}
void main() { gl_FragColor = transition(uv); }`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function texture(gl, unit, src) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  return t;
}

// from/to：canvas（同尺寸）；name：TRANSITIONS 的 key；回傳 Promise，播完自動移除畫布
export function playTransition(from, to, name, { dur = 1100, hold = 350, fadeOut = 300, z = 60 } = {}) {
  return new Promise((resolve) => {
    const tr = TRANSITIONS[name];
    const cv = document.createElement('canvas');
    cv.className = 'gl-trans';
    cv.width = from.width; cv.height = from.height;
    cv.style.zIndex = z;
    const gl = cv.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!tr || !gl) { resolve(false); return; }
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragOf(tr.glsl)));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) { console.warn('轉場 shader 編譯失敗', e); resolve(false); return; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    texture(gl, 0, from); texture(gl, 1, to);
    gl.uniform1i(gl.getUniformLocation(prog, 'from'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'to'), 1);
    gl.uniform1f(gl.getUniformLocation(prog, 'ratio'), cv.width / cv.height);
    for (const [k, v] of Object.entries(tr.defaults || {})) gl.uniform1f(gl.getUniformLocation(prog, k), v);
    const uProg = gl.getUniformLocation(prog, 'progress');
    gl.viewport(0, 0, cv.width, cv.height);
    document.body.appendChild(cv);
    const t0 = performance.now();
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      gl.uniform1f(uProg, p);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (p < 1) { requestAnimationFrame(frame); return; }
      setTimeout(() => {
        cv.classList.add('out');
        setTimeout(() => { cv.remove(); gl.getExtension('WEBGL_lose_context')?.loseContext(); resolve(true); }, fadeOut);
      }, hold);
    };
    requestAnimationFrame(frame);
  });
}
