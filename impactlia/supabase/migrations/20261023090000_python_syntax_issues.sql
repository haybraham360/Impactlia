-- Syntax errors in Python files are reported by tree-sitter's Python parser,
-- not the TypeScript compiler, and an issue says which tool reported it.
alter type public.code_issue_source add value if not exists 'tree-sitter';
