// Source-space sampling shared by the full-field layer and nickname repairs.
// A feature at x moves to x + phase, wrapping once per shared 60-second clock.
export const backgroundFlowGLSL = `
uniform sampler2D uFlowBackground;
uniform float uFlowPhase;
vec3 sampleFlowBackground(vec2 source) {
  vec3 color = texture(uFlowBackground,
    vec2(fract(source.x - uFlowPhase), clamp(source.y, 0.0, 1.0))).rgb;
  // Restore the source's side shading in screen space, never in the moving tile.
  float side = (source.x - 0.5) / 0.305;
  return color * (0.38 + 0.62 * exp(-side * side));
}
`;
