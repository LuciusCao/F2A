# RFC-010: CLI JSON Error Handling Research

| Field | Value |
|-------|-------|
| Status | 📝 Research Document |
| Author | Hermes Agent |
| Created | 2026-04-22 |
| Purpose | Research how CLI tools handle JSON output for errors |

---

## Summary

Research into how popular CLI tools handle JSON output for errors, particularly parameter validation errors, when JSON output mode is enabled. This is critical for "AI-first" CLI design where output must be machine-parseable.

---

## Key Finding

**Most CLI tools do NOT output parameter validation errors in JSON format, even when JSON output mode is enabled.** This is a significant gap for AI agent consumption.

---

## Tool-by-Tool Analysis

### 1. GitHub CLI (`gh`)

**JSON Flag:** `--json <fields>`

**Error Behavior:**
| Error Type | JSON Output? | Example |
|------------|--------------|---------|
| Invalid JSON field | ❌ No | `Unknown JSON field: "nonexistentfield"` |
| Missing required arg | ❌ No | `accepts 1 arg(s), received 0` |
| Invalid repo/API error | ❌ No | Plain text error |
| Valid operation | ✅ Yes | Returns JSON |

**Sample Output:**
```
$ gh issue list --json nonexistentfield
Unknown JSON field: "nonexistentfield"
Available fields:
  assignees
  author
  ...

$ gh issue view --json number
accepts 1 arg(s), received 0
```

**Pattern:** JSON output only for successful operations. All errors are plain text.

---

### 2. kubectl

**JSON Flag:** `-o json` or `--output json`

**Error Behavior:**
| Error Type | JSON Output? | Example |
|------------|--------------|---------|
| Unknown flag | ❌ No | `error: unknown flag: --invalid-flag` |
| Missing resource | ❌ No | `error: Required resource not specified.` |
| API/Server error | ❌ No | Plain text with log prefixes |
| Valid operation | ✅ Yes | Returns JSON |

**Sample Output:**
```
$ kubectl get pods --invalid-flag -o json
error: unknown flag: --invalid-flag
See 'kubectl get --help' for usage.

$ kubectl get -o json
You must specify the type of resource to get.
error: Required resource not specified.
```

**Pattern:** JSON output only for successful operations. No JSON error format exists.

---

### 3. Docker CLI

**JSON Flag:** `--format json`

**Error Behavior:**
| Error Type | JSON Output? | Example |
|------------|--------------|---------|
| Unknown flag | ❌ No | `unknown flag: --invalid-flag` |
| Missing required arg | ❌ No | `docker inspect requires at least 1 argument` |
| Non-existent resource | ⚠️ Partial | Returns `[]` with error on stderr |
| Valid operation | ✅ Yes | Returns JSON |

**Sample Output:**
```
$ docker --invalid-flag version --format json
unknown flag: --invalid-flag

$ docker inspect nonexistent12345 --format json
[]
error: no such object: nonexistent12345
```

**Pattern:** Docker returns empty JSON for missing resources but errors are still plain text.

---

### 4. AWS CLI (from documentation)

**JSON Flag:** `--output json`

**Error Behavior (documented):**
| Error Type | JSON Output? | Notes |
|------------|--------------|-------|
| Parameter validation | ❌ No | Plain text to stderr |
| API errors | ⚠️ Sometimes | HTTP errors may have JSON structure |
| Valid operation | ✅ Yes | Returns JSON |

**Pattern:** Similar to others - JSON for success, plain text for errors.

---

### 5. Stripe CLI (from documentation)

**JSON Flag:** `--format json` or `stripe log tail --format json`

**Error Behavior:**
| Error Type | JSON Output? | Notes |
|------------|--------------|-------|
| Invalid parameters | ❌ No | Plain text |
| API errors | ⚠️ Partial | May include JSON error body |
| Valid operation | ✅ Yes | Returns JSON |

---

### 6. F2A CLI (Current Implementation)

**JSON Flag:** `--json`

**Current Behavior:**
| Error Type | JSON Output? | Location |
|------------|--------------|----------|
| Unknown command | ✅ Yes | `main.ts` |
| Missing subcommand | ❌ No | Shows help |
| Missing required param | ❌ No | Handler functions |
| API/operation errors | ⚠️ Partial | Some handlers check `isJsonMode()` |

**Sample Output:**
```bash
$ f2a invalid-command --json
{"success":false,"error":"Unknown command: invalid-command","code":"UNKNOWN_COMMAND"}

$ f2a agent unregister --json
❌ Missing --agent-id parameter
Usage: f2a agent unregister --agent-id <agentId>

$ f2a message list --agent-id nonexistent --json
{"success":false,"error":"Cannot connect to Daemon: ...","code":"DAEMON_NOT_RUNNING"}
```

**Implementation Pattern:**
```typescript
// In main.ts - Top-level routing DOES use JSON errors
if (isJsonMode()) {
  outputError(`Unknown command: ${command}`, 'UNKNOWN_COMMAND');
}

// In handlers - INCONSISTENT
// Some do:
if (isJsonMode()) {
  outputError('Missing required --agent-id parameter', 'MISSING_AGENT_ID');
} else {
  console.error('❌ Error: Missing required --agent-id parameter.');
  process.exit(1);
}

// Others just use console.error directly
console.error('❌ Error: Missing required --agent-id parameter.');
process.exit(1);
```

---

## JSON Error Format Patterns

### F2A CLI Error Format
```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

### Proposed Standard (AI-First CLI)
```json
{
  "success": false,
  "error": {
    "message": "Missing required parameter: --agent-id",
    "code": "MISSING_PARAMETER",
    "type": "validation_error",
    "field": "agent-id",
    "suggestion": "Usage: f2a message list --agent-id <agentId>"
  }
}
```

---

## Patterns Observed

### Pattern 1: JSON Only for Success (Most Common)
- JSON output flag only affects successful output
- All errors remain in plain text/human-readable format
- Examples: `gh`, `kubectl`, `docker`

### Pattern 2: Mixed/Inconsistent
- Some errors in JSON, others not
- Usually top-level command routing errors in JSON
- Handler-level parameter errors remain plain text
- Example: F2A CLI (current)

### Pattern 3: Structured Error Codes (Rare)
- Some tools return structured errors with codes
- Still usually not JSON-formatted on CLI
- May have JSON in API responses

---

## Best Practices for AI-First CLI Design

### Recommendation 1: All Errors in JSON When `--json` Set

When `--json` flag is set, ALL output (including errors) should be valid JSON:

```typescript
// Parameter validation
if (!options.agentId) {
  if (isJsonMode()) {
    outputError('Missing required --agent-id parameter', 'MISSING_PARAMETER');
  } else {
    console.error('❌ Error: Missing --agent-id parameter.');
    process.exit(1);
  }
}
```

### Recommendation 2: Error Structure

```typescript
interface CliError {
  success: false;
  error: {
    message: string;      // Human-readable message
    code: string;         // Machine-parseable error code
    type: 'validation' | 'runtime' | 'network' | 'permission';
    field?: string;       // For parameter errors
    suggestion?: string;  // Help text
  };
}
```

### Recommendation 3: Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Parameter validation error |
| 3 | Network/API error |
| 4 | Permission error |
| 5 | Not found error |

### Recommendation 4: Global Flag Position

Parse `--json` flag BEFORE any command handling to ensure even parsing errors are JSON-formatted:

```typescript
// Parse global flags first
const jsonMode = args.includes('--json');
if (jsonMode) {
  args = args.filter(a => a !== '--json');
  setJsonMode(true);
}

// Then handle commands
try {
  await handleCommand(args);
} catch (error) {
  if (isJsonMode()) {
    outputError(error.message, error.code);
  } else {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}
```

---

## F2A CLI Current Gaps

1. **Inconsistent error handling**: Some handlers check `isJsonMode()`, others don't
2. **Parameter validation before JSON parsing**: `--json` is parsed in `main()`, but some handlers do early validation
3. **No global error wrapper**: Uncaught errors aren't wrapped in JSON

---

## Proposed F2A CLI Improvements

1. Add global try-catch wrapper that outputs JSON errors when `--json` is set
2. Standardize all parameter validation to use `outputError()` in JSON mode
3. Add error codes for all error types
4. Consider adding `--output json-error` flag for tools that want human-readable success but JSON errors

---

## References

- F2A CLI source: `packages/cli/src/main.ts`, `packages/cli/src/output.ts`
- GitHub CLI: https://cli.github.com/manual/
- kubectl: https://kubernetes.io/docs/reference/kubectl/
- Docker CLI: https://docs.docker.com/engine/reference/commandline/cli/

---

*Research completed on 2026-04-22*
