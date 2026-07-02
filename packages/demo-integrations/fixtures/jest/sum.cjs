// Tiny function under test. The Jest worker imports this through CommonJS so
// Jest can run without any transform step.
function sum(a, b) {
  return a + b;
}

// CommonJS export keeps the Jest fixture deliberately boring and dependency-free.
module.exports = { sum };
