import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";
import type { ParserOutput } from "../contract";
import { loadGrammars, type Grammars } from "../languages/tree-sitter";
import { parseRepository } from "../parse-repository";
import { readParserOutput } from "../validate";

// Run with `pnpm check:adapters`. One small repository per language, written
// out below, so every expected edge and every unlinked reference can be read
// off the files. Nothing is compiled or run.

// The parser's grammars load asynchronously, once, before any test.
let grammars: Grammars;
before(async () => {
  grammars = await loadGrammars();
});

function analyse(files: Record<string, string>): ParserOutput {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "impactlia-languages-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
      fs.writeFileSync(path.join(directory, file), content);
    }
    return readParserOutput(JSON.parse(JSON.stringify(parseRepository(directory, grammars))));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const edgesOf = (output: ParserOutput) =>
  output.edges.map((edge) => `${edge.source} -> ${edge.target} [${edge.kinds.join("+")}]`);
const unlinkedOf = (output: ParserOutput) =>
  output.unlinkedReferences.map(
    (reference) =>
      `${reference.source}:${reference.line} ${reference.specifier ?? "(expression)"} ${
        reference.status === "external" ? `external:${reference.externalKind}` : reference.status === "unresolved" ? `unresolved:${reference.reason}` : reference.status
      }`,
  );
const rolesOf = (output: ParserOutput) =>
  Object.fromEntries(output.files.map((file) => [file.path, `${file.language}:${file.role.id}`]));

test("Go: an import links to every non-test file of the package, and a test to its own package", () => {
  const output = analyse({
    "go.mod": "module example.com/shop\n\ngo 1.22\n",
    "cmd/main.go": 'package main\n\nimport (\n\t"fmt"\n\t"example.com/shop/cart"\n\t"github.com/google/uuid"\n\t"example.com/shop/missing"\n)\n\nfunc main() { fmt.Println(cart.Total()) }\n',
    "cart/cart.go": "package cart\n\nfunc Total() int { return price() }\n",
    "cart/price.go": "package cart\n\nfunc price() int { return 1 }\n",
    "cart/cart_test.go": 'package cart\n\nimport "testing"\n\nfunc TestTotal(t *testing.T) {}\n',
    "testdata/broken.go": "package nope {",
  });
  assert.deepEqual(edgesOf(output), [
    "cart/cart_test.go -> cart/cart.go [same-package]",
    "cart/cart_test.go -> cart/price.go [same-package]",
    "cmd/main.go -> cart/cart.go [import]",
    "cmd/main.go -> cart/price.go [import]",
  ]);
  assert.deepEqual(unlinkedOf(output), [
    "cart/cart_test.go:3 testing external:builtin",
    "cmd/main.go:4 fmt external:builtin",
    "cmd/main.go:6 github.com/google/uuid external:package",
    "cmd/main.go:7 example.com/shop/missing unresolved:file-not-found",
  ]);
  assert.equal(rolesOf(output)["cart/cart_test.go"], "go:test");
  // Go's tools ignore testdata, and so does the parser.
  assert.ok(output.excluded.some((entry) => entry.path === "testdata" && entry.rule === "test-data-directory"));
});

test("Java: imports, wildcards and same-package names link to the declaring files", () => {
  const output = analyse({
    "src/main/java/com/shop/Cart.java": [
      "package com.shop;",
      "import java.util.List;",
      "import com.shop.pricing.Price;",
      "import com.shop.util.*;",
      "import static com.shop.util.Strings.trim;",
      "import org.slf4j.Logger;",
      "import com.shop.Gone;",
      "public class Cart {",
      "  private Item item;",
      "  int total() { return Price.of(item) + Money.ZERO; }",
      "}",
    ].join("\n"),
    "src/main/java/com/shop/Item.java": "package com.shop;\npublic class Item {}\n",
    "src/main/java/com/shop/Unused.java": "package com.shop;\nclass Unused {}\n",
    "src/main/java/com/shop/pricing/Price.java": "package com.shop.pricing;\npublic class Price { public static int of(Object o) { return 1; } }\n",
    "src/main/java/com/shop/util/Money.java": "package com.shop.util;\npublic class Money { public static final int ZERO = 0; }\n",
    "src/main/java/com/shop/util/Strings.java": "package com.shop.util;\npublic class Strings { public static String trim(String s) { return s; } }\n",
    "src/main/java/com/shop/util/Other.java": "package com.shop.util;\npublic class Other {}\n",
    "src/test/java/com/shop/CartTest.java": "package com.shop;\nimport org.junit.jupiter.api.Test;\nclass CartTest { @Test void total() { new Cart(); } }\n",
  });
  const prefix = "src/main/java/com/shop/";
  assert.deepEqual(
    edgesOf(output).filter((edge) => edge.startsWith(`${prefix}Cart.java`)),
    [
      `${prefix}Cart.java -> ${prefix}Item.java [type-reference]`,
      `${prefix}Cart.java -> ${prefix}pricing/Price.java [import]`,
      `${prefix}Cart.java -> ${prefix}util/Money.java [import]`,
      `${prefix}Cart.java -> ${prefix}util/Strings.java [import]`,
    ],
  );
  assert.deepEqual(edgesOf(output).filter((edge) => edge.startsWith("src/test")), [
    `src/test/java/com/shop/CartTest.java -> ${prefix}Cart.java [type-reference]`,
  ]);
  assert.deepEqual(unlinkedOf(output), [
    `${prefix}Cart.java:2 java.util.List external:builtin`,
    `${prefix}Cart.java:6 org.slf4j.Logger external:package`,
    `${prefix}Cart.java:7 com.shop.Gone unresolved:file-not-found`,
    "src/test/java/com/shop/CartTest.java:2 org.junit.jupiter.api.Test external:package",
  ]);
  assert.equal(rolesOf(output)["src/test/java/com/shop/CartTest.java"], "java:test");
});

test("C#: types named from used and enclosing namespaces link to their files, partial classes to every part", () => {
  const output = analyse({
    "Shop/Cart.cs": "using System;\nusing Shop.Pricing;\nusing Newtonsoft.Json;\nnamespace Shop;\npublic class Cart { Price p; Item i; }\n",
    "Shop/Item.cs": "namespace Shop { public partial class Item {} }\n",
    "Shop/Item.Generated.cs": "namespace Shop { public partial class Item {} }\n",
    "Shop/Pricing/Price.cs": "namespace Shop.Pricing;\npublic class Price {}\n",
    "Shop/Pricing/Unused.cs": "namespace Shop.Pricing;\npublic class Unused {}\n",
    "Tests/CartTests.cs": "using Xunit;\nusing Shop;\nnamespace Shop.Tests;\npublic class CartTests { [Fact] public void Total() { new Cart(); } }\n",
  });
  assert.deepEqual(edgesOf(output), [
    "Shop/Cart.cs -> Shop/Item.Generated.cs [type-reference]",
    "Shop/Cart.cs -> Shop/Item.cs [type-reference]",
    "Shop/Cart.cs -> Shop/Pricing/Price.cs [type-reference]",
    "Shop/Item.Generated.cs -> Shop/Item.cs [type-reference]",
    "Shop/Item.cs -> Shop/Item.Generated.cs [type-reference]",
    "Tests/CartTests.cs -> Shop/Cart.cs [type-reference]",
  ]);
  assert.deepEqual(unlinkedOf(output), [
    "Shop/Cart.cs:1 System external:builtin",
    "Shop/Cart.cs:3 Newtonsoft.Json external:package",
    "Tests/CartTests.cs:1 Xunit external:package",
  ]);
  assert.equal(rolesOf(output)["Tests/CartTests.cs"], "csharp:test");
});

test("C and C++: includes resolve beside the file, then in include folders; headers follow the repository's language", () => {
  const output = analyse({
    "include/shop/cart.h": "#pragma once\nint total(void);\n",
    "src/cart.c": '#include "shop/cart.h"\n#include "local.h"\n#include <stdio.h>\n#include <openssl/ssl.h>\n#include "config.h"\nint total(void) { return MACRO(1); }\n',
    "src/local.h": "#define MACRO(x) x\n",
  });
  assert.deepEqual(edgesOf(output), [
    "src/cart.c -> include/shop/cart.h [include]",
    "src/cart.c -> src/local.h [include]",
  ]);
  assert.deepEqual(unlinkedOf(output), [
    "src/cart.c:3 stdio.h external:builtin",
    "src/cart.c:4 openssl/ssl.h external:package",
    "src/cart.c:5 config.h unresolved:file-not-found",
  ]);
  assert.deepEqual(rolesOf(output), {
    "include/shop/cart.h": "c:other",
    "src/cart.c": "c:other",
    "src/local.h": "c:other",
  });
  // A macro that reads as broken syntax without a preprocessor is not a failure.
  assert.ok(output.files.every((file) => file.parseStatus === "parsed"));

  const cpp = analyse({ "lib/widget.h": "class Widget {};\n", "lib/widget.cpp": '#include "widget.h"\n#include <vector>\n' });
  assert.deepEqual(rolesOf(cpp), { "lib/widget.cpp": "cpp:other", "lib/widget.h": "cpp:other" });
  assert.deepEqual(edgesOf(cpp), ["lib/widget.cpp -> lib/widget.h [include]"]);
});

test("Rust: mod declarations and use paths follow the crate's module files", () => {
  const output = analyse({
    "Cargo.toml": '[package]\nname = "shop-core"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n',
    "src/lib.rs": "pub mod cart;\nmod pricing;\nmod gone;\npub use cart::Cart;\n",
    "src/cart.rs": "use crate::pricing::price;\nuse serde::Serialize;\nuse std::collections::HashMap;\npub struct Cart;\n",
    "src/pricing/mod.rs": "mod tax;\npub fn price() -> u32 { tax::rate() }\n",
    "src/pricing/tax.rs": "use super::super::cart::Cart;\npub fn rate() -> u32 { 1 }\n",
    "tests/cart.rs": "use shop_core::cart::Cart;\n#[test]\nfn total() {}\n",
  });
  assert.deepEqual(edgesOf(output), [
    "src/cart.rs -> src/pricing/mod.rs [use]",
    "src/lib.rs -> src/cart.rs [use+mod]",
    "src/lib.rs -> src/pricing/mod.rs [mod]",
    "src/pricing/mod.rs -> src/pricing/tax.rs [mod]",
    "src/pricing/tax.rs -> src/cart.rs [use]",
    "tests/cart.rs -> src/cart.rs [use]",
  ]);
  assert.deepEqual(unlinkedOf(output), [
    "src/cart.rs:2 serde::Serialize external:package",
    "src/cart.rs:3 std::collections::HashMap external:builtin",
    "src/lib.rs:3 gone unresolved:file-not-found",
  ]);
  assert.equal(rolesOf(output)["tests/cart.rs"], "rust:test");
});

test("PHP: use, fully qualified names, same-namespace classes and requires link to files", () => {
  const output = analyse({
    "composer.json": JSON.stringify({ autoload: { "psr-4": { "App\\": "src/" } } }),
    "src/Cart.php": [
      "<?php",
      "namespace App;",
      "use App\\Pricing\\Price;",
      "use Illuminate\\Support\\Collection;",
      "use App\\Missing;",
      "require_once __DIR__ . '/helpers.php';",
      "require $path;",
      "class Cart { public function total(Item $i) { return Price::of($i) + \\App\\Pricing\\Tax::rate(); } }",
    ].join("\n"),
    "src/Item.php": "<?php\nnamespace App;\nclass Item {}\n",
    "src/helpers.php": "<?php\nfunction money() {}\n",
    "src/Pricing/Price.php": "<?php\nnamespace App\\Pricing;\nclass Price {}\n",
    "src/Pricing/Tax.php": "<?php\nnamespace App\\Pricing;\nclass Tax {}\n",
    "tests/CartTest.php": "<?php\nuse PHPUnit\\Framework\\TestCase;\nuse App\\Cart;\nclass CartTest extends TestCase {}\n",
  });
  assert.deepEqual(edgesOf(output), [
    "src/Cart.php -> src/Item.php [type-reference]",
    "src/Cart.php -> src/Pricing/Price.php [use]",
    "src/Cart.php -> src/Pricing/Tax.php [type-reference]",
    "src/Cart.php -> src/helpers.php [require]",
    "tests/CartTest.php -> src/Cart.php [use]",
  ]);
  assert.deepEqual(unlinkedOf(output), [
    "src/Cart.php:4 Illuminate\\Support\\Collection external:package",
    "src/Cart.php:5 App\\Missing unresolved:file-not-found",
    "src/Cart.php:7 (expression) unresolved:non-literal-specifier",
    "tests/CartTest.php:2 PHPUnit\\Framework\\TestCase external:package",
  ]);
  assert.equal(rolesOf(output)["tests/CartTest.php"], "php:test");
});

test("a syntax error in one file of any language fails that file only", () => {
  const output = analyse({
    "a/Broken.java": "package a;\nclass Broken {",
    "a/Fine.java": "package a;\nclass Fine { Broken b; }\n",
    "b/broken.go": "package b\nfunc (",
    "b/fine.go": "package b\nfunc Fine() {}\n",
    "c/broken.rs": "fn (",
    "d/broken.php": "<?php class {",
    "e/Broken.cs": "class {",
  });
  assert.deepEqual(
    output.files.filter((file) => file.parseStatus === "failed").map((file) => file.path),
    ["a/Broken.java", "b/broken.go", "c/broken.rs", "d/broken.php", "e/Broken.cs"],
  );
  assert.deepEqual(
    output.files.filter((file) => file.parseStatus === "parsed").map((file) => file.path),
    ["a/Fine.java", "b/fine.go"],
  );
});

test("every language's output is the same on every run", () => {
  const files = {
    "go.mod": "module m\n",
    "x/x.go": 'package x\nimport "m/y"\n',
    "y/y.go": "package y\n",
    "Main.java": "class Main { Other o; }\n",
    "Other.java": "class Other {}\n",
  };
  assert.equal(JSON.stringify(analyse(files)), JSON.stringify(analyse(files)));
});

test("binary and generated files are left out by rule, and imports of them say so", () => {
  const output = analyse({
    "src/app.ts": 'import "./schema.generated";\nimport "./blob";\n',
    "src/schema.generated.ts": "// Code generated by protoc-gen-ts. DO NOT EDIT.\nexport const x = 1;\n",
    "src/blob.ts": "\0\0\0binary",
    "pb/user_pb2.py": "# Generated by the protocol buffer compiler.  DO NOT EDIT!\nimport os\n",
    // The word in code, not in a header comment, is not the marker.
    "src/handwritten.ts": "const marker = 'x';\nexport const note = `@generated`;\n",
  });
  assert.deepEqual(output.files.map((file) => file.path), ["src/app.ts", "src/handwritten.ts"]);
  assert.deepEqual(
    output.excluded.filter((entry) => entry.type === "file").map((entry) => `${entry.path} ${entry.rule}`),
    ["pb/user_pb2.py generated-file", "src/blob.ts binary-file", "src/schema.generated.ts generated-file"],
  );
  assert.deepEqual(
    output.unlinkedReferences.map((reference) => `${reference.specifier} ${reference.status}`),
    ["./schema.generated excluded", "./blob excluded"],
  );
});
