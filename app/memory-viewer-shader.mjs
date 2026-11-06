// Independently authored fullscreen treatments. The only RAF lives during the
// bounded opening; texture upgrades and layout changes repaint without a restart.
const OPEN_MILLISECONDS = 1500;
const vertexSource = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uResolution;
uniform float uAspect;
uniform float uProgress;
uniform int uEffect;
uniform int uTarget;
out vec4 outColor;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(173.3, 269.5))) * 31741.137);
}
float noise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
             mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1)), f.x), f.y);
}
float revealAt(float progress, float field) {
  if (progress <= 0.0) return 0.0;
  if (progress >= 1.0) return 1.0;
  float reveal = smoothstep(0.0, 1.0, progress);
  if (uEffect == 1) {
    reveal = smoothstep(field - 0.14, field + 0.14, progress * 1.42 - 0.18);
  } else if (uEffect == 2) {
    reveal = smoothstep(-0.035, 0.12, mix(-0.16, 1.18, progress) - field);
  } else if (uEffect == 3) {
    reveal = smoothstep(field * 0.64, field * 0.64 + 0.32, progress);
  } else if (uEffect == 4) {
    float distance = mix(-0.25, 1.3, progress) - field;
    float ring = 0.5 + 0.5 * cos(distance * 52.0);
    ring *= ring;
    ring *= ring;
    ring *= smoothstep(-0.25, -0.04, distance) * (1.0 - smoothstep(-0.04, 0.16, distance));
    reveal = max(smoothstep(-0.02, 0.18, distance), ring * 4.0 * progress * (1.0 - progress));
  }
  return mix(reveal, 1.0, smoothstep(0.92, 1.0, progress));
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uResolution;
  float p = clamp(uProgress, 0.0, 1.0);
  vec4 photo = texture(uImage, uv);
  vec3 gray = vec3(dot(photo.rgb, vec3(0.2126, 0.7152, 0.0722)));
  if (p <= 0.0) {
    outColor = vec4(uTarget == 1 ? photo.rgb : gray, uTarget == 0 ? photo.a : 0.0);
    return;
  }
  if (p >= 1.0) {
    outColor = photo;
    return;
  }
  // Share the spatial field between the image front and the later color front.
  float field = 0.0;
  if (uEffect == 1 || uEffect == 4) {
    vec2 centered = (uv - 0.5) * vec2(uAspect, 1.0);
    field = length(centered) / length(vec2(uAspect, 1.0) * 0.5);
    if (uEffect == 1) {
      float mist = noise(uv * 7.0 + vec2(p * 1.8, -p)) * 0.65
                 + noise(uv * 17.0 - p * 2.0) * 0.35;
      field += (mist - 0.5) * 0.23;
    }
  } else if (uEffect == 2) {
    field = uv.x * 0.73 + uv.y * 0.27;
  } else if (uEffect == 3) {
    field = hash(floor(uv * vec2(76.0 * uAspect, 76.0)));
  }
  // Combined mode first reveals grayscale, then brings color along the same
  // pattern. The image finishes at 72%; color starts at 28% of the opening.
  float imageProgress = uTarget == 2 ? min(p / 0.72, 1.0) : p;
  float reveal = revealAt(imageProgress, field);
  float colorAmount = uTarget == 1 ? 1.0 : reveal;
  if (uTarget == 2) colorAmount = revealAt(max((p - 0.28) / 0.72, 0.0), field);
  float opacity = uTarget == 0 ? 1.0 : reveal;
  outColor = vec4(mix(gray, photo.rgb, colorAmount), photo.a * opacity);
}`;

export function createMemoryViewerShader(canvas, {onFailure = () => {}, onRestored = () => {}, onSettled = () => {}} = {}) {
  const events = new AbortController();
  let gl = null;
  let program = null;
  let texture = null;
  let uniforms = null;
  let source = null;
  let textureSource = null;
  let staging = null;
  let stagingContext = null;
  let failed = false;
  let disposed = false;
  let active = false;
  let suspended = document.hidden;
  let elapsed = OPEN_MILLISECONDS;
  let lastTime = 0;
  let frame = 0;
  let effect = 0;
  let target = 0;
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;
  let maxEdge = 2048;
  const pixelLimit = window.matchMedia('(pointer: coarse)').matches ? 1048576 : 2097152;

  function cancelFrame() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  function releaseResources() {
    if (texture) gl?.deleteTexture(texture);
    if (program) gl?.deleteProgram(program);
    texture = program = uniforms = null;
    textureSource = null;
  }

  function fail() {
    if (failed || disposed) return;
    failed = true;
    cancelFrame();
    releaseResources();
    onFailure();
  }

  function initialize() {
    const shaders = [];
    try {
      gl ||= canvas.getContext('webgl2', {alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power'});
      if (!gl || gl.isContextLost()) throw new Error('Fullscreen WebGL unavailable');
      program = gl.createProgram();
      if (!program) throw new Error('Fullscreen program unavailable');
      for (const [type, code] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('Fullscreen shader unavailable');
        shaders.push(shader);
        gl.shaderSource(shader, code);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      uniforms = Object.fromEntries(['uImage', 'uResolution', 'uAspect', 'uProgress', 'uEffect', 'uTarget'].map(name => [name, gl.getUniformLocation(program, name)]));
      maxEdge = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      failed = false;
    } catch {
      failed = true;
      releaseResources();
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }

  function upload() {
    if (!source || failed || suspended) return;
    if (!texture) {
      texture = gl.createTexture();
      if (!texture) throw new Error('Fullscreen texture unavailable');
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let pixels = source;
    if (source.naturalWidth > canvas.width || source.naturalHeight > canvas.height) {
      staging ||= document.createElement('canvas');
      staging.width = canvas.width;
      staging.height = canvas.height;
      stagingContext ||= staging.getContext('2d', {alpha: false});
      if (!stagingContext) throw new Error('Fullscreen downsampling unavailable');
      stagingContext.drawImage(source, 0, 0, staging.width, staging.height);
      pixels = staging;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Fullscreen texture upload failed');
    textureSource = source;
  }

  function draw() {
    if (!active || suspended || failed || disposed || !texture) return;
    try {
      if (gl.isContextLost()) throw new Error('Fullscreen context lost');
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.uImage, 0);
      gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.uAspect, source.naturalWidth / source.naturalHeight);
      gl.uniform1f(uniforms.uProgress, elapsed / OPEN_MILLISECONDS);
      gl.uniform1i(uniforms.uEffect, effect);
      gl.uniform1i(uniforms.uTarget, target);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } catch { fail(); }
  }

  function schedule() {
    if (!frame && active && !suspended && !failed && !disposed && elapsed < OPEN_MILLISECONDS) {
      if (!lastTime) lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    frame = 0;
    if (!active || suspended || failed || disposed) return;
    elapsed = Math.min(OPEN_MILLISECONDS, elapsed + Math.max(0, now - lastTime));
    lastTime = now;
    draw();
    if (elapsed < OPEN_MILLISECONDS) schedule();
    else {
      lastTime = 0;
      onSettled();
    }
  }

  function resize(width = viewportWidth, height = viewportHeight, forceUpload = false) {
    viewportWidth = width;
    viewportHeight = height;
    if (!active || !source || suspended || failed || disposed) return;
    const ratio = source.naturalWidth / source.naturalHeight;
    const displayWidth = Math.max(1, Math.min(width, height * ratio));
    const displayHeight = displayWidth / ratio;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    const density = Math.min(2, window.devicePixelRatio || 1,
      maxEdge / Math.max(displayWidth, displayHeight), Math.sqrt(pixelLimit / (displayWidth * displayHeight)));
    const backingWidth = Math.max(1, Math.round(displayWidth * density));
    const backingHeight = Math.max(1, Math.round(displayHeight * density));
    const changed = canvas.width !== backingWidth || canvas.height !== backingHeight;
    if (changed) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    try {
      if (changed || forceUpload || !texture || textureSource !== source) upload();
      draw();
    } catch { fail(); }
  }

  function clear() {
    active = false;
    cancelFrame();
    source = null;
    elapsed = OPEN_MILLISECONDS;
    if (texture) gl?.deleteTexture(texture);
    texture = textureSource = null;
    canvas.width = canvas.height = 1;
    if (staging) staging.width = staging.height = 1;
  }

  initialize();
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    fail();
  }, {signal: events.signal});
  canvas.addEventListener('webglcontextrestored', () => {
    if (disposed) return;
    releaseResources();
    initialize();
    if (!failed) onRestored();
  }, {signal: events.signal});

  return {
    get available() { return !failed && !disposed; },
    get progress() { return elapsed / OPEN_MILLISECONDS; },
    get moving() { return Boolean(frame); },
    get sourceWidth() { return source?.naturalWidth || 0; },
    get sourceHeight() { return source?.naturalHeight || 0; },
    open(decoded, nextEffect, nextTarget, reducedMotion, width, height) {
      if (failed || disposed) return false;
      cancelFrame();
      source = decoded;
      effect = nextEffect;
      target = nextTarget;
      elapsed = reducedMotion ? OPEN_MILLISECONDS : 0;
      active = true;
      resize(width, height, true);
      schedule();
      return !failed;
    },
    replaceSource(decoded) {
      if (!active || failed || disposed) return false;
      source = decoded;
      resize(viewportWidth, viewportHeight, true);
      return !failed;
    },
    resize,
    suspend(hidden) {
      if (hidden === suspended) return;
      suspended = hidden;
      cancelFrame();
      if (!hidden && active) {
        resize(viewportWidth, viewportHeight);
        schedule();
      }
    },
    settle() {
      cancelFrame();
      elapsed = OPEN_MILLISECONDS;
      draw();
    },
    clear,
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      events.abort();
      releaseResources();
      staging = stagingContext = null;
    },
  };
}
