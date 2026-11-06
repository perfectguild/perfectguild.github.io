import {t} from './i18n.mjs';
import {backgroundFlowGLSL} from './background-flow.mjs';

// Independently authored edge atmosphere, not a port of either Shadertoy reference.
// The caller supplies the existing WASM clock. This module never schedules frames.
const vertexSource = `#version 300 es
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;
const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uFlowForeground;
uniform sampler2D uMemories[3];
uniform vec4 uMemoryBounds[3];
uniform float uMemoryAmount[3];
uniform float uMemoryTime[3];
uniform int uMemoryReveal;
uniform vec2 uResolution;
uniform vec4 uClearBounds;
uniform float uPhase;
uniform int uStyle;
out vec4 outColor;
${backgroundFlowGLSL}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1, 0)), f.x),
             mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1)), f.x), f.y);
}
float cloud(vec2 p) {
  float sum = 0.0, weight = 0.5;
  const mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
  for (int octave = 0; octave < 4; octave++) {
    sum += noise(p) * weight;
    p = turn * p * 2.03 + vec2(7.3, 3.1);
    weight *= 0.5;
  }
  return sum;
}

vec4 memoryLayer(vec2 source, sampler2D photoTexture, vec4 bounds, float amount, float seconds) {
  if (amount <= 0.0) return vec4(0.0);
  vec2 uv = (source - bounds.xy) / bounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  vec2 drift = vec2(-seconds * 0.065, seconds * 0.035);
  float mist = cloud(uv * vec2(4.0, 3.0) + drift);
  float curls = cloud(uv * vec2(8.0, 5.0) - drift * 0.7 + 9.2);
  float border = smoothstep(0.0, 0.19 + mist * 0.08, edge);
  // Spatial reveals share the slot envelope; zero/full are the same
  // invisible/stable endpoints, so changing style never restarts a slot.
  float transition = 4.0 * amount * (1.0 - amount);
  float reveal, glow;
  vec2 photoUv = uv;
  if (uMemoryReveal == 3) {
    reveal = smoothstep(mist * 0.5, mist * 0.5 + 0.48, amount);
    glow = 0.0;
  } else if (uMemoryReveal == 1) {
    float front = uv.x * 0.75 + uv.y * 0.25 + (curls - 0.47) * 0.11;
    float travel = mix(-0.12, 1.12, amount);
    reveal = smoothstep(front - 0.09, front + 0.09, travel);
    glow = (1.0 - smoothstep(0.0, 0.065, abs(travel - front))) * 0.9;
  } else if (uMemoryReveal == 2) {
    vec2 grains = uv * vec2(26.0, 18.0);
    vec2 cell = floor(grains), seed = floor(bounds.xy * 31.0);
    float threshold = 0.12 + noise(grains + seed) * 0.76;
    reveal = smoothstep(threshold - 0.12, threshold + 0.12, amount);
    vec2 center = 0.25 + 0.5 * vec2(hash(cell + seed), hash(cell + seed + 19.7));
    float spark = 1.0 - smoothstep(0.015, 0.14, length(fract(grains) - center));
    float birth = 1.0 - smoothstep(0.0, 0.14, abs(amount - threshold));
    glow = spark * birth * (0.7 + 0.3 * sin(seconds * 7.0 + hash(cell) * 36.0));
  } else {
    float threshold = 0.15 + mist * 0.7;
    reveal = smoothstep(threshold - 0.12, threshold + 0.12, amount);
    photoUv += (vec2(curls, mist) - 0.47) * 0.04 * (1.0 - amount);
    glow = (1.0 - smoothstep(0.0, 0.09, abs(amount - threshold))) * 0.22;
  }
  float alpha = border * reveal * amount * (0.62 + 0.20 * curls);
  vec3 photo = texture(photoTexture, clamp(photoUv, 0.0, 1.0)).rgb;
  float luminance = dot(photo, vec3(0.2126, 0.7152, 0.0722));
  float silver = mix(luminance, 0.17, mist * 0.3);
  float light = border * glow * transition * 0.7;
  return vec4(vec3(silver * alpha + light * (1.0 - alpha)), alpha + light * (1.0 - alpha));
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uResolution;
  vec2 source = vec2(uv.x * 1.2 - 0.1, uv.y);
  vec2 distance = min(source, 1.0 - source);
  float rim = max(1.0 - smoothstep(0.0, 0.22, distance.x),
                  1.0 - smoothstep(0.0, 0.18, distance.y));
  float outer = smoothstep(0.0, 0.07, min(uv.x, 1.0 - uv.x))
              * smoothstep(0.0, 0.07, min(uv.y, 1.0 - uv.y));
  vec4 memory = memoryLayer(source, uMemories[0], uMemoryBounds[0], uMemoryAmount[0], uMemoryTime[0]);
  memory += memoryLayer(source, uMemories[1], uMemoryBounds[1], uMemoryAmount[1], uMemoryTime[1]) * (1.0 - memory.a);
  memory += memoryLayer(source, uMemories[2], uMemoryBounds[2], uMemoryAmount[2], uMemoryTime[2]) * (1.0 - memory.a);
  if (uStyle == 7) {
    // Prefilter premultiplied ink, not a nearest source pixel: small screens need
    // the same stationary letter coverage without aliasing or a frozen rectangle.
    vec4 foreground = texture(uFlowForeground, source);
    vec3 background = sampleFlowBackground(source) * (1.0 - memory.a) + memory.rgb;
    vec3 color = background * (1.0 - foreground.a) + foreground.rgb;
    outColor = vec4(color * outer, outer);
    return;
  }
  // Blend over the source texture, but never over the protected name cloud.
  vec2 guard = smoothstep(uClearBounds.xy - vec2(0.035, 0.08), uClearBounds.xy, source)
             * (1.0 - smoothstep(uClearBounds.zw, uClearBounds.zw + vec2(0.035, 0.08), source));
  float envelope = rim * outer * (1.0 - guard.x * guard.y);
  if (envelope <= 0.0) { outColor = memory; return; }

  // A high mip level removes source lettering from the atmosphere only.
  vec3 background = textureLod(uImage, clamp(source, 0.0, 1.0), 6.0).rgb;
  if (uStyle == 0) {
    float alpha = envelope * 0.85;
    outColor = memory + vec4(background * alpha, alpha) * (1.0 - memory.a);
    return;
  }
  vec2 p = source * vec2(9.0, 6.0);
  // Integer circular harmonics meet seamlessly at the clock's 60-second wrap.
  vec2 drift = vec2(sin(uPhase), cos(uPhase)) * vec2(0.85, 1.2);
  vec2 warp = vec2(cloud(p * 0.67 + drift), cloud(p * 0.67 - drift + 12.7));
  float density;
  vec3 tint;
  if (uStyle == 1) {
    // Broad rolling masses with smaller curls, not uniform alpha breathing.
    density = smoothstep(0.20, 0.76, cloud(p + (warp - 0.45) * 3.0 + drift));
    tint = vec3(0.12, 0.14, 0.135);
  } else if (uStyle == 2) {
    // Long turbulent ribbons flowing through the larger cloud field.
    float ribbon = 0.5 + 0.5 * sin(p.y * 3.6 + warp.x * 11.0 + sin(uPhase) * 3.0);
    density = pow(ribbon, 3.0) * (0.35 + 0.65 * cloud(p * 1.3 - drift));
    tint = vec3(0.17, 0.185, 0.175);
  } else if (uStyle == 3) {
    // Fine, cool silver wisps; deliberately different scale and edge lighting.
    float folds = cloud(p * 1.8 + warp * 3.6 - drift);
    density = pow(1.0 - abs(folds * 2.0 - 0.9), 5.0);
    density *= 0.55 + 0.45 * cloud(p * 0.5 + drift);
    tint = vec3(0.16, 0.18, 0.20);
  } else if (uStyle == 4) {
    // Large opposing bends give the smoke rolling, folded edges.
    vec2 bend = vec2(sin(p.y * 1.2 + uPhase), cos(p.x * 1.1 - uPhase));
    float folds = cloud(p * 0.8 + bend * 1.6 + warp * 4.5 + drift);
    density = pow(clamp(1.0 - abs(folds * 2.4 - 1.1), 0.0, 1.0), 4.0);
    tint = vec3(0.14, 0.165, 0.155);
  } else if (uStyle == 5) {
    // Wide refractive waves, unlike the narrow turbulent smoke ribbons.
    float wave = sin(p.y * 2.3 + sin(p.x * 1.4 + uPhase) * 2.0 - uPhase * 2.0);
    density = smoothstep(-0.65, 0.85, wave) * (0.6 + 0.4 * warp.x);
    background = textureLod(uImage,
      clamp(source + vec2(wave * 0.018, sin(p.x + uPhase) * 0.012), 0.0, 1.0), 6.0).rgb;
    tint = vec3(0.13, 0.15, 0.17);
  } else {
    // Slow, broad banks brighten and recede without a sharp travelling crest.
    float breath = 0.5 + 0.5 * sin(uPhase * 2.0 + p.y * 0.55);
    density = smoothstep(0.12, 0.72, cloud(p * 0.45 + drift * 0.6))
            * (0.25 + 0.75 * breath);
    tint = vec3(0.19, 0.195, 0.18);
  }
  float alpha = envelope * (0.30 + 0.65 * density);
  vec3 color = background * (0.70 + 0.65 * density) + tint * density;
  outColor = memory + vec4(color * alpha, alpha) * (1.0 - memory.a);
}
`;

export function createEdgeFog(canvas, image, protectedBounds, flowAssets) {
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error(t('errors.webgl'));
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(t('errors.shader', {message}));
    }
    return shader;
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(t('errors.program', {message}));
  }
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  gl.useProgram(program);
  const resolution = gl.getUniformLocation(program, 'uResolution');
  const phase = gl.getUniformLocation(program, 'uPhase');
  const style = gl.getUniformLocation(program, 'uStyle');
  const flowPhase = gl.getUniformLocation(program, 'uFlowPhase');
  const texture = gl.createTexture();
  if (!texture) throw new Error(t('errors.texture'));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);
  function uploadFlowTexture(image, unit, repeat, premultiplied = false) {
    const texture = gl.createTexture();
    if (!texture) throw new Error(t('errors.texture'));
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      premultiplied ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
    gl.texImage2D(gl.TEXTURE_2D, 0, premultiplied ? gl.RGBA8 : gl.RGB8,
      premultiplied ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, image);
    if (premultiplied) gl.generateMipmap(gl.TEXTURE_2D);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return texture;
  }
  const flowBackground = uploadFlowTexture(flowAssets.background, 1, true);
  const flowForeground = uploadFlowTexture(flowAssets.foreground, 2, false, true);
  gl.uniform1i(gl.getUniformLocation(program, 'uFlowBackground'), 1);
  gl.uniform1i(gl.getUniformLocation(program, 'uFlowForeground'), 2);
  const blankMemory = new Uint8Array(4);
  const memorySlots = Array.from({length: 3}, (_, index) => {
    const texture = gl.createTexture();
    if (!texture) throw new Error(t('errors.texture'));
    gl.activeTexture(gl.TEXTURE3 + index);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, blankMemory);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.uniform1i(gl.getUniformLocation(program, `uMemories[${index}]`), 3 + index);
    return {
      texture, image: null, amount: 0, time: 0, x: 0, y: 0, width: 0, height: 0,
      boundsLocation: gl.getUniformLocation(program, `uMemoryBounds[${index}]`),
      amountLocation: gl.getUniformLocation(program, `uMemoryAmount[${index}]`),
      timeLocation: gl.getUniformLocation(program, `uMemoryTime[${index}]`),
    };
  });
  const memoryRevealLocation = gl.getUniformLocation(program, 'uMemoryReveal');
  gl.uniform4f(gl.getUniformLocation(program, 'uClearBounds'),
    protectedBounds.x / image.naturalWidth, protectedBounds.y / image.naturalHeight,
    (protectedBounds.x + protectedBounds.width) / image.naturalWidth,
    (protectedBounds.y + protectedBounds.height) / image.naturalHeight);
  gl.disable(gl.DITHER);
  let lastTime = NaN, lastStyle = -1, lastMemoryReveal = -1, enabled = false, dirty = true;

  function paint() {
    if (!enabled || gl.isContextLost()) return;
    gl.uniform1f(phase, lastTime * Math.PI / 30);
    gl.uniform1f(flowPhase, lastTime / 60);
    gl.uniform1i(style, lastStyle);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = false;
  }
  function resize() {
    // Flow uses device resolution up to the native source size, never supersampling
    // tiny displays. The other variants retain their half-resolution atmosphere.
    const fullFlow = lastStyle === 7;
    const width = fullFlow
      ? Math.max(1, Math.min(Math.round(image.naturalWidth * 1.2),
        Math.ceil(image.clientWidth * 1.2 * devicePixelRatio)))
      : Math.max(1, Math.min(1152, Math.ceil(image.clientWidth * 1.2 * devicePixelRatio * 0.5)));
    const height = Math.max(1, Math.round(width / 1.2 * image.naturalHeight / image.naturalWidth));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(resolution, width, height);
    dirty = true;
    paint();
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(image);
  window.addEventListener('resize', resize);
  return {
    update(seconds, variant, visible, memories, memoryReveal) {
      if (visible && !enabled) dirty = true;
      enabled = visible;
      canvas.hidden = !visible;
      const time = variant === 0 ? 0 : seconds;
      if (!visible) return;
      if (memoryReveal !== lastMemoryReveal) {
        lastMemoryReveal = memoryReveal;
        gl.uniform1i(memoryRevealLocation, memoryReveal);
        dirty = true;
      }
      for (let index = 0; index < memorySlots.length; index++) {
        const memory = memories[index];
        const slot = memorySlots[index];
        if (memory.image && memory.image !== slot.image) {
          gl.activeTexture(gl.TEXTURE3 + index);
          gl.bindTexture(gl.TEXTURE_2D, slot.texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, memory.image);
          gl.generateMipmap(gl.TEXTURE_2D);
          slot.image = memory.image;
          dirty = true;
        }
        const amount = memory.image ? memory.amount : 0;
        const elapsed = amount > 0 ? memory.elapsed : 0;
        if (amount !== slot.amount || elapsed !== slot.time) {
          slot.amount = amount;
          slot.time = elapsed;
          gl.uniform1f(slot.amountLocation, amount);
          gl.uniform1f(slot.timeLocation, elapsed);
          dirty = true;
        }
        if (amount > 0) {
          const bounds = memory.bounds;
          if (bounds.x !== slot.x || bounds.y !== slot.y ||
              bounds.width !== slot.width || bounds.height !== slot.height) {
            slot.x = bounds.x; slot.y = bounds.y;
            slot.width = bounds.width; slot.height = bounds.height;
            gl.uniform4f(slot.boundsLocation, slot.x / image.naturalWidth, slot.y / image.naturalHeight,
              slot.width / image.naturalWidth, slot.height / image.naturalHeight);
            dirty = true;
          }
        }
      }
      const resolutionChanged = (variant === 7) !== (lastStyle === 7);
      if (dirty || time !== lastTime || variant !== lastStyle) {
        lastTime = time;
        lastStyle = variant;
        dirty = true;
        if (resolutionChanged) resize();
        if (dirty) paint();
      }
    },
    dispose() {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      gl.deleteTexture(texture);
      gl.deleteTexture(flowBackground);
      gl.deleteTexture(flowForeground);
      for (const slot of memorySlots) gl.deleteTexture(slot.texture);
      gl.deleteVertexArray(vertexArray);
      gl.deleteProgram(program);
    },
  };
}
