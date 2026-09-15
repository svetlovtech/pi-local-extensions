/**
 * pi-schema-sanitizer
 *
 * Fixes HTTP 400 `invalid_json_schema: regex lookaround is not supported` errors
 * from OpenAI-compatible gateways (e.g. "Console Go" / "Upstream request failed").
 *
 * Some providers validate tool JSON schemas with a regex engine (RE2-style) that
 * rejects lookaround assertions `(?=...)`, `(?!...)`, `(?<=...)`, `(?<!...)`.
 * Packages like @henryqw/pi-subagent historically embedded such patterns in tool
 * schemas (e.g. delegate_flow units[].name.pattern). This extension rewrites any
 * lookaround-bearing `pattern` in the outgoing payload's tool schemas:
 *
 *  - `^(?![\s\S]*[R])[\s\S]+$`  is exactly equivalent to `^[^R]+$` (rewritten,
 *    validation semantics preserved);
 *  - any other lookaround pattern is dropped (descriptions + runtime validation
 *    in the tool handlers still enforce the constraint).
 *
 * RE2 also does NOT support `\uXXXX` unicode escapes in patterns (Go regexp:
 * "invalid escape sequence: \u" — observed as HTTP 400 from gonkarouter.io on
 * every request carrying delegate_flow/delegate_task after the lookaround fix
 * above rewrote their patterns into `^[^\u0000-\u001F\u007F-\u009F]+$`).
 * Therefore every `\uXXXX` escape in a pattern is additionally rewritten to an
 * equivalent all-engines form before the request goes out:
 *
 *  - code point <= 0xFF  -> `\xNN`   (valid in RE2/Go, JavaScript, Python alike);
 *  - code point >  0xFF  -> the literal character (never a regex metachar;
 *    valid in RE2, JavaScript, and Python as a plain literal).
 *
 * The rewrite is purely syntactic over the regex SOURCE and preserves matching
 * semantics in every engine that accepted the original pattern.
 *
 * Hooks `before_provider_request`, so it survives package reinstalls/updates and
 * covers all tools: built-in, extension packages, and MCP-adapter tools.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR = join(homedir(), ".pi", "agent", "logs");
const LOG_FILE = join(LOG_DIR, "schema-sanitizer.log");
const DEBUG = process.env.PI_SCHEMA_SANITIZER_DEBUG === "1";

function log(message) {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`);
	} catch {
		// never break a request over logging
	}
}

// Matches lookaround assertions anywhere in a pattern string.
const LOOKAROUND_RE = /\(\?<?[=!]/;

// Matches a \uXXXX unicode escape (regex-source syntax).
const UNICODE_ESCAPE_RE = /\\u([0-9a-fA-F]{4})/g;

/**
 * Rewrite \uXXXX escapes to their RE2-compatible equivalents.
 * Returns undefined when the pattern contains no \u escapes (nothing to do).
 *
 * \xNN (and literal non-ASCII characters) are accepted identically by RE2/Go,
 * JavaScript RegExp, and Python re, so matching semantics are unchanged for
 * every engine — including the ones that understood \u all along.
 */
function rewriteUnicodeEscapes(pattern) {
	if (typeof pattern !== "string" || !pattern.includes("\\u")) return undefined;
	return pattern.replace(UNICODE_ESCAPE_RE, (_esc, hex) => {
		const cp = parseInt(hex, 16);
		if (cp <= 0xff) return "\\x" + cp.toString(16).padStart(2, "0");
		// Non-ASCII: a literal character. Regex metacharacters are all ASCII,
		// so a literal non-ASCII rune is unambiguous in every engine.
		return String.fromCodePoint(cp);
	});
}

/**
 * Exact lookaround-free rewrite for the common "no char from class R anywhere"
 * idiom: ^(?![\s\S]*[R])[\s\S]+$  ->  ^[^R]+$
 * Returns undefined when the pattern does not match this safe shape.
 */
function rewriteNegatedScanIdiom(pattern) {
	// The incoming pattern is a regex SOURCE string, e.g.
	//   ^(?![\s\S]*[\u0000-\u001F\u007F-\u009F])[\s\S]+$
	const m = /^\^\(\?!\[\\s\\S\]\*\[(.+?)\]\)\[\\s\\S\]\+\$$/.exec(pattern);
	if (!m) return undefined;
	const cls = m[1];
	// Defensive: the captured class came from an existing [...] so it is already a
	// valid class body; make sure a literal `]` or nesting cannot leak (they would
	// not have matched the lazy capture end anyway).
	if (cls.includes("]")) return undefined;
	return `^[^${cls}]+$`;
}

/** Sanitize one regex pattern string. Returns fixed pattern, or null to drop. */
function sanitizePattern(pattern) {
	if (typeof pattern !== "string") return pattern;
	// 1) \uXXXX escapes are rejected by RE2 outright — rewrite them first so the
	//    lookaround rewrite below sees (and emits) RE2-friendly syntax.
	const base = rewriteUnicodeEscapes(pattern) ?? pattern;
	// 2) Lookaround assertions are the other RE2 dealbreaker.
	if (!LOOKAROUND_RE.test(base)) return base;
	const rewritten = rewriteNegatedScanIdiom(base);
	if (rewritten) return rewritten;
	return null; // unsupported lookaround shape: drop, runtime validation remains
}

/** Recursively sanitize a JSON-schema node. Returns list of JSON Pointers fixed. */
function sanitizeSchemaNode(node, pointer, fixes) {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i++) {
			sanitizeSchemaNode(node[i], `${pointer}/${i}`, fixes);
		}
		return fixes;
	}
	if (!node || typeof node !== "object") return fixes;

	if (typeof node.pattern === "string") {
		const fixed = sanitizePattern(node.pattern);
		if (fixed === null) {
			delete node.pattern;
			fixes.push(`${pointer}/pattern (dropped)`);
		} else if (fixed !== node.pattern) {
			node.pattern = fixed;
			fixes.push(`${pointer}/pattern (rewritten)`);
		}
	}
	if (node.patternProperties && typeof node.patternProperties === "object") {
		for (const key of Object.keys(node.patternProperties)) {
			if (LOOKAROUND_RE.test(key)) {
				// A lookaround key cannot be faithfully converted in general; drop the
				// entry (patternProperties only ADDS constraints, so dropping is the
				// conservative, schema-valid behavior).
				delete node.patternProperties[key];
				fixes.push(`${pointer}/patternProperties key (entry dropped)`);
				continue;
			}
			const newKey = rewriteUnicodeEscapes(key) ?? key;
			if (newKey !== key) {
				node.patternProperties[newKey] = node.patternProperties[key];
				delete node.patternProperties[key];
				fixes.push(`${pointer}/patternProperties key (rewritten)`);
			}
			sanitizeSchemaNode(node.patternProperties[newKey], `${pointer}/patternProperties`, fixes);
		}
	}
	for (const key of Object.keys(node)) {
		if (key === "pattern" || key === "patternProperties") continue;
		const value = node[key];
		if (value && typeof value === "object") {
			sanitizeSchemaNode(value, `${pointer}/${key}`, fixes);
		}
	}
	return fixes;
}

/** Find schema holders on one tool entry across provider payload shapes. */
function schemaHolders(tool) {
	const holders = [];
	if (!tool || typeof tool !== "object") return holders;
	if (tool.function && typeof tool.function === "object") holders.push(tool.function.parameters);
	if (tool.input_schema !== undefined) holders.push(tool.input_schema);
	if (tool.parameters !== undefined) holders.push(tool.parameters);
	if (Array.isArray(tool.functionDeclarations)) {
		for (const decl of tool.functionDeclarations) {
			if (decl && typeof decl === "object") holders.push(decl.parameters);
		}
	}
	return holders;
}

export default function (pi) {
	pi.on("before_provider_request", (event) => {
		const payload = event?.payload;
		if (!payload || typeof payload !== "object" || !Array.isArray(payload.tools)) return undefined;

		const allFixes = [];
		for (let i = 0; i < payload.tools.length; i++) {
			const tool = payload.tools[i];
			const name =
				tool?.function?.name ?? tool?.name ?? tool?.functionDeclarations?.[0]?.name ?? `tools[${i}]`;
			for (const schema of schemaHolders(tool)) {
				if (!schema || typeof schema !== "object") continue;
				const fixes = sanitizeSchemaNode(schema, `$['${name}']`, []);
				allFixes.push(...fixes);
			}
		}

		if (allFixes.length > 0) {
			log(`sanitized provider request: ${allFixes.join("; ")}`);
		} else if (DEBUG) {
			const names = payload.tools
				.map((t) => t?.function?.name ?? t?.name ?? t?.functionDeclarations?.[0]?.name)
				.filter(Boolean);
			log(`no lookaround patterns found (tools: ${payload.tools.length}: ${names.join(", ")})`);
		}
		return undefined; // payload mutated in place
	});
}
