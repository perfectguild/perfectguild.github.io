import {t} from './i18n.mjs';
import {backgroundFlowGLSL} from './background-flow.mjs';

const vertexSource = `#version 300 es
precision highp float;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;
const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uMask;
uniform sampler2D uRepair;
uniform vec4 uBounds;
uniform vec3 uMotion;
uniform float uImageHeight;
uniform int uPass;
uniform int uStyle;
uniform int uEffect;
uniform float uBreath;
uniform float uTime;
uniform bool uAnimate;
out vec4 outColor;
uniform bool uFlowEnabled;
${backgroundFlowGLSL}
bool inside(vec2 point, vec2 size) {
  return all(greaterThanEqual(point, vec2(0.0))) && all(lessThan(point, size));
}
float maskAt(vec2 point) {
  return inside(point, uBounds.zw) ? texture(uMask, point / uBounds.zw).a : 0.0;
}
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uImageHeight - gl_FragCoord.y);
  float visibility = clamp(uMotion.x * 2.8, 0.0, 1.0);
  if (uPass == 0) {
    vec2 local = pixel - uBounds.xy;
    vec4 repair = inside(local, uBounds.zw) ? texelFetch(uRepair, ivec2(local), 0) : vec4(0.0);
    float alpha = repair.a * visibility;
    vec3 background = uFlowEnabled
      ? sampleFlowBackground(pixel / vec2(textureSize(uFlowBackground, 0))) : repair.rgb;
    outColor = vec4(background * alpha, alpha);
    return;
  }
  vec2 center = uBounds.xy + uBounds.zw * 0.5;
  vec2 sourcePixel = (pixel - center - vec2(0.0, uMotion.z)) / uMotion.y + center;
  vec2 glyphLocal = sourcePixel - uBounds.xy;
  float glyphCoverage = maskAt(glyphLocal);
  float glyphAlpha = glyphCoverage * visibility;
  vec3 ink = vec3(0.94, 1.0, 0.96);
  float material = smoothstep(0.10, 0.95, uMotion.x);
  float halo = 0.0;
  vec3 faceLow = vec3(0.77, 0.74, 0.72);
  vec3 faceHigh = vec3(0.99, 0.98, 0.93);
  vec3 edgeColor = vec3(0.78, 0.025, 0.12);
  vec3 glowColor = vec3(0.95, 0.065, 0.19);
  float glowNear = 0.30;
  float glowFar = 0.12;
  float wave = 0.0;
  if (uStyle == 1) {
    faceLow = vec3(0.78, 0.94, 1.0);
    faceHigh = vec3(0.98, 1.0, 1.0);
    edgeColor = vec3(0.025, 0.62, 0.94);
    glowColor = vec3(0.10, 0.72, 1.0);
    glowNear = 0.42;
    glowFar = 0.22;
  } else if (uStyle == 2) {
    faceLow = vec3(0.83, 0.65, 0.29);
    faceHigh = vec3(1.0, 0.96, 0.78);
    edgeColor = vec3(0.90, 0.43, 0.04);
    glowColor = vec3(1.0, 0.64, 0.10);
    glowNear = 0.24;
    glowFar = 0.08;
  } else if (uStyle == 3) {
    faceLow = vec3(0.72, 0.62, 0.86);
    faceHigh = vec3(0.98, 0.92, 1.0);
    edgeColor = vec3(0.55, 0.08, 0.95);
    glowColor = vec3(0.70, 0.12, 1.0);
    if (uAnimate) {
      vec2 uv = glyphLocal / uBounds.zw;
      wave = smoothstep(0.35, 0.98, 0.5 + 0.5 * sin(
        (uv.x * 1.1 - uv.y * 0.25 - uTime / 4.0) * 6.2831853072));
    }
    glowNear = 0.24 + 0.40 * wave;
    glowFar = 0.10 + 0.20 * wave;
  } else if (uStyle == 4) {
    faceLow = vec3(0.68);
    faceHigh = vec3(0.99);
    edgeColor = vec3(0.45);
    glowColor = vec3(0.90);
    glowNear = 0.18;
    glowFar = 0.07;
  } else if (uStyle == 5) {
    faceLow = vec3(0.42, 0.45, 0.50);
    faceHigh = vec3(0.98, 0.99, 1.0);
    edgeColor = vec3(0.38, 0.42, 0.49);
    glowColor = vec3(0.78, 0.86, 1.0);
    glowNear = 0.22;
    glowFar = 0.08;
  } else if (uStyle == 6) {
    faceLow = vec3(0.38, 0.43, 0.42);
    faceHigh = vec3(0.93, 0.99, 0.97);
    edgeColor = vec3(0.47, 0.62, 0.60);
    glowColor = vec3(0.72, 0.94, 0.88);
    glowNear = 0.26;
    glowFar = 0.10;
  }
  float flow = 0.0;
  float sparkle = 0.0;
  if (uAnimate) {
    float glowGain = 1.0;
    if (uEffect == 1) {
      glowGain = uBreath;
    } else if (uEffect == 3) {
      vec2 uv = glyphLocal / uBounds.zw;
      flow = 0.5 + 0.5 * sin(uv.x * 6.2831853072 + uv.y * 1.8 - uTime * 1.2566370614);
      glowGain = 0.65 + 0.70 * flow;
    } else if (uEffect == 4) {
      float grain = fract(dot(floor(glyphLocal * 0.7), vec2(0.754877666, 0.569840296)));
      float pulse = 1.0 - smoothstep(0.025, 0.16,
        abs(fract(uTime / 3.0 + fract(grain * 17.0)) - 0.5));
      sparkle = step(0.80, grain) * pulse * pulse;
      glowGain = 0.75 + 1.5 * sparkle;
    }
    glowNear *= glowGain;
    glowFar *= glowGain;
  }
  if (material > 0.0) {
    float left = maskAt(glyphLocal - vec2(1.0, 0.0));
    float right = maskAt(glyphLocal + vec2(1.0, 0.0));
    float top = maskAt(glyphLocal - vec2(0.0, 1.0));
    float bottom = maskAt(glyphLocal + vec2(0.0, 1.0));
    if (glyphAlpha > 0.0) {
      float facing = clamp((right - left) * 0.8 + (bottom - top) * 0.6, -1.0, 1.0);
      float rim = 1.0 - min(min(left, right), min(top, bottom));
      float glint = smoothstep(0.05, 0.75, facing);
      float shade = smoothstep(0.05, 0.75, -facing);
      // Keep the opaque face readable; color the bevel and surrounding halo.
      vec3 face = mix(faceLow, faceHigh, glint);
      float bevel = rim * (1.0 - 0.92 * smoothstep(0.35, 0.90, glyphCoverage));
      float coloredEdge = bevel * (0.64 + 0.32 * shade) * (1.0 - 0.65 * glint);
      vec3 relief = mix(face, edgeColor, coloredEdge);
      if (uStyle == 2 && uAnimate) {
        vec2 uv = glyphLocal / uBounds.zw;
        float sweep = 1.0 - smoothstep(0.025, 0.14, abs(fract(uv.x + uv.y * 0.22 - uTime / 6.0) - 0.5));
        relief = mix(relief, vec3(1.0, 0.98, 0.88), sweep * 0.65);
      } else if (uStyle == 3 && uAnimate) {
        relief = mix(relief * 0.82, vec3(1.0, 0.84, 1.0), wave * 0.82);
      } else if (uStyle == 5) {
        vec2 uv = glyphLocal / uBounds.zw;
        float time = uAnimate ? uTime : 0.0;
        float bend = 0.28 * sin(uv.y * 5.5 + time * 1.2566370614)
          + 0.13 * sin(uv.x * 5.0 - time * 1.0471975512);
        float reflection = sin((uv.x + uv.y * 0.22 + bend) * 12.5663706144 - time * 1.5707963268);
        float tone = smoothstep(-0.55, 0.72, reflection);
        float seam = 1.0 - smoothstep(0.02, 0.10, abs(reflection - 0.05));
        relief = mix(faceLow, faceHigh, tone);
        relief = mix(relief, vec3(1.0), seam * 0.8);
        relief = mix(relief, edgeColor, bevel * 0.55);
      } else if (uStyle == 6) {
        vec2 uv = glyphLocal / uBounds.zw;
        vec2 p = uv * vec2(5.0, 3.0);
        float time = uAnimate ? uTime : 0.0;
        float curl = sin(p.x + sin(p.y + time * 1.2566370614))
          + 0.65 * sin(p.y * 1.7 - p.x * 0.7 - time * 1.0471975512);
        float folds = abs(sin(curl * 2.8 + uv.y * 4.0 - time * 1.5707963268));
        float crest = 1.0 - smoothstep(0.03, 0.16, abs(folds - 0.52));
        relief = mix(faceLow, faceHigh, smoothstep(0.12, 0.88, folds));
        relief = mix(relief, vec3(1.0), crest * 0.8);
        relief = mix(relief, edgeColor, bevel * 0.40);
      }
      if (uAnimate && uEffect == 2) {
        vec2 uv = glyphLocal / uBounds.zw;
        float sweep = 1.0 - smoothstep(0.06, 0.25, abs(fract(uv.x - uv.y * 0.15 - uTime / 5.0) - 0.5));
        relief = mix(relief, mix(faceHigh, vec3(1.0), 0.7), sweep * 0.75);
      } else if (uAnimate && uEffect == 3) {
        relief = mix(relief, faceHigh, flow * 0.45);
      } else if (uAnimate && uEffect == 4) {
        relief = mix(relief, mix(faceHigh, vec3(1.0), 0.8), sparkle * rim * 0.9);
      }
      ink = mix(ink, relief, material);
    }
    if (glyphAlpha < 1.0) {
      float nearInk = max(max(left, right), max(top, bottom));
      float radius = uStyle == 3 && uAnimate ? 3.8 : 2.2;
      float diagonal = radius * 0.7071067812;
      float farInk = max(max(maskAt(glyphLocal - vec2(radius, 0.0)), maskAt(glyphLocal + vec2(radius, 0.0))),
                        max(maskAt(glyphLocal - vec2(0.0, radius)), maskAt(glyphLocal + vec2(0.0, radius))));
      farInk = max(farInk, max(max(maskAt(glyphLocal + vec2(-diagonal, -diagonal)), maskAt(glyphLocal + vec2(diagonal, -diagonal))),
                              max(maskAt(glyphLocal + vec2(-diagonal, diagonal)), maskAt(glyphLocal + vec2(diagonal, diagonal)))));
      halo = min(1.0, max(nearInk * glowNear, farInk * glowFar)) * material * visibility * (1.0 - glyphAlpha);
    }
  }
  outColor = vec4(ink * glyphAlpha + glowColor * halo, glyphAlpha + halo);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(t('errors.webgl'));
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(t('errors.shader', {message}));
  }
  return shader;
}

export function createEnsembleRenderer(canvas, scene, images, defaultPeakScale, maxLift, backgroundImage) {
  const {imageWidth, imageHeight, occurrences} = scene;
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const gl = canvas.getContext('webgl2', {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: true, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error(t('errors.webgl'));
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error(t('errors.webgl'));
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  const message = linked ? '' : gl.getProgramInfoLog(program);
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!linked) {
    gl.deleteProgram(program);
    throw new Error(t('errors.program', {message}));
  }
  const vertexArray = gl.createVertexArray();
  gl.bindVertexArray(vertexArray);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'uMask'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'uRepair'), 1);
  gl.uniform1i(gl.getUniformLocation(program, 'uFlowBackground'), 2);
  gl.uniform1f(gl.getUniformLocation(program, 'uImageHeight'), imageHeight);
  const boundsLocation = gl.getUniformLocation(program, 'uBounds');
  const motionLocation = gl.getUniformLocation(program, 'uMotion');
  const passLocation = gl.getUniformLocation(program, 'uPass');
  const styleLocation = gl.getUniformLocation(program, 'uStyle');
  const effectLocation = gl.getUniformLocation(program, 'uEffect');
  const breathLocation = gl.getUniformLocation(program, 'uBreath');
  const timeLocation = gl.getUniformLocation(program, 'uTime');
  const animateLocation = gl.getUniformLocation(program, 'uAnimate');
  const flowEnabledLocation = gl.getUniformLocation(program, 'uFlowEnabled');
  const flowPhaseLocation = gl.getUniformLocation(program, 'uFlowPhase');
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  function upload(image, unit) {
    const texture = gl.createTexture();
    if (!texture) throw new Error(t('errors.texture'));
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return texture;
  }
  const flowBackground = upload(backgroundImage, 2);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  const layers = occurrences.map((occurrence, index) => {
    const {bounds} = occurrence;
    const {mask, repair} = images[index];
    if (mask.naturalWidth !== bounds.width || mask.naturalHeight !== bounds.height ||
        repair.naturalWidth !== bounds.width || repair.naturalHeight !== bounds.height) {
      throw new Error(t('errors.dimensions'));
    }
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const peakScale = occurrence.peakScale ?? defaultPeakScale;
    const padding = Math.ceil(4 * peakScale) + 1;
    const left = Math.max(0, Math.floor(Math.min(bounds.x, centerX - bounds.width * peakScale / 2)) - padding);
    const right = Math.min(imageWidth, Math.ceil(Math.max(bounds.x + bounds.width, centerX + bounds.width * peakScale / 2)) + padding);
    const top = Math.max(0, Math.floor(Math.min(bounds.y, centerY + maxLift - bounds.height * peakScale / 2)) - padding);
    const bottom = Math.min(imageHeight, Math.ceil(Math.max(bounds.y + bounds.height, centerY + maxLift + bounds.height * peakScale / 2)) + padding);
    return {bounds, mask: upload(mask, 0), repair: upload(repair, 1),
      dirty: {x: left, y: top, width: right - left, height: bottom - top}};
  });
  gl.viewport(0, 0, imageWidth, imageHeight);
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DITHER);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.CULL_FACE);

  function drawLayer(index, states, repairPass) {
    const offset = index * 3;
    if (states[offset] === 0) return;
    const {bounds, mask, repair, dirty} = layers[index];
    if (repairPass) {
      gl.scissor(bounds.x, imageHeight - bounds.y - bounds.height, bounds.width, bounds.height);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, repair);
    } else {
      gl.scissor(dirty.x, imageHeight - dirty.y - dirty.height, dirty.width, dirty.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, mask);
    }
    gl.uniform4f(boundsLocation, bounds.x, bounds.y, bounds.width, bounds.height);
    gl.uniform3f(motionLocation, states[offset], states[offset + 1], states[offset + 2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function draw(states, selectedIndex, style, effect, seconds, animated, backgroundSeconds = null) {
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.uniform1f(timeLocation, seconds);
    const flowing = typeof backgroundSeconds === 'number';
    gl.uniform1i(flowEnabledLocation, Number(flowing));
    gl.uniform1f(flowPhaseLocation, flowing ? backgroundSeconds / 60 : 0);
    gl.uniform1f(breathLocation, effect === 1 && animated
      ? 0.55 + 0.70 * (0.5 + 0.5 * Math.sin(seconds * Math.PI / 2)) : 1);
    gl.uniform1i(styleLocation, style);
    gl.uniform1i(effectLocation, effect);
    gl.uniform1i(animateLocation, 0);
    // Repair all original positions before any moving glyph: a later repair
    // must never cut a neighbouring nickname that has already moved into it.
    gl.uniform1i(passLocation, 0);
    for (let index = 0; index < layers.length; index++) drawLayer(index, states, true);
    gl.uniform1i(passLocation, 1);
    for (let index = 0; index < layers.length; index++) {
      if (index !== selectedIndex) drawLayer(index, states, false);
    }
    if (selectedIndex >= 0) {
      gl.uniform1i(animateLocation, Number(animated));
      drawLayer(selectedIndex, states, false);
    }
  }
  function dispose() {
    for (const layer of layers) {
      gl.deleteTexture(layer.mask);
      gl.deleteTexture(layer.repair);
    }
    gl.deleteTexture(flowBackground);
    gl.deleteVertexArray(vertexArray);
    gl.deleteProgram(program);
  }
  return {draw, dispose};
}
