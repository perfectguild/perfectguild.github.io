"use strict";

// Adapted from U+ Reborn; see THIRD-PARTY-NOTICES.md.
// Let micromark handle indentation, containers, matching markers and lengths.
module.exports = {
  names: ["closed-fences"],
  description: "Fenced code blocks must have an explicit closing fence",
  tags: ["code"],
  parser: "micromark",
  function(params, onError) {
    function visit(tokens) {
      for (const token of tokens) {
        if (token.type === "codeFenced") {
          const fences = token.children.filter((child) => child.type === "codeFencedFence");
          if (fences.length !== 2) {
            onError({
              lineNumber: token.startLine,
              detail: "Close the fence in the same list or blockquote container with matching markers.",
            });
          }
        } else {
          visit(token.children);
        }
      }
    }
    visit(params.parsers.micromark.tokens);
  },
};
