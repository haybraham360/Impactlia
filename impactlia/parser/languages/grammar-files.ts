// Plain data, so next.config.ts can read it without loading tree-sitter.

// Each grammar's .wasm file, inside its package. The deployment includes the
// same list (next.config.ts imports it).
export const GRAMMAR_FILES = {
  python: ["tree-sitter-python", "tree-sitter-python.wasm"],
  java: ["tree-sitter-java", "tree-sitter-java.wasm"],
  go: ["tree-sitter-go", "tree-sitter-go.wasm"],
  csharp: ["tree-sitter-c-sharp", "tree-sitter-c_sharp.wasm"],
  c: ["tree-sitter-c", "tree-sitter-c.wasm"],
  cpp: ["tree-sitter-cpp", "tree-sitter-cpp.wasm"],
  rust: ["tree-sitter-rust", "tree-sitter-rust.wasm"],
  // The grammar for PHP files, which may hold HTML outside <?php ... ?>.
  php: ["tree-sitter-php", "tree-sitter-php.wasm"],
} as const;
export const RUNTIME_FILE = ["web-tree-sitter", "web-tree-sitter.wasm"] as const;
