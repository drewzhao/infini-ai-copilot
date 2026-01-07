# Contributing & Repurposing Guide

This document provides detailed instructions for repurposing this VS Code Copilot provider extension for a different API provider.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Repurposing Procedure](#repurposing-procedure)
  - [Phase 1: Brand Replacement](#phase-1-brand-replacement)
  - [Phase 2: API Endpoints](#phase-2-api-endpoints)
  - [Phase 3: Publisher Information](#phase-3-publisher-information)
  - [Phase 4: Type Definitions (Optional)](#phase-4-type-definitions-optional)
- [File-by-File Change Reference](#file-by-file-change-reference)
- [Validation Checklist](#validation-checklist)
- [Handling Upstream Updates](#handling-upstream-updates)
- [Automation Script](#automation-script)

---

## Overview

This extension uses VS Code's official `vscode.lm.registerLanguageModelChatProvider()` API to register a custom language model provider for GitHub Copilot Chat. The architecture supports multiple API formats:

- **OpenAI-compatible** (default)
- **Anthropic-compatible**
- **Vertex AI-compatible**

To repurpose for a new provider, you need to replace:
1. Brand names and identifiers
2. API endpoint URLs
3. Publisher and repository information
4. (Optionally) Type definitions if API response structure differs

---

## Prerequisites

- Node.js >= 18
- VS Code >= 1.104.0
- GitHub Copilot Chat extension installed
- Your new provider's API documentation

---

## Repurposing Procedure

### Phase 1: Brand Replacement

Replace all occurrences of brand-related strings in the following order (order matters to avoid partial replacements):

| Step | Find | Replace With | Case Sensitive |
|------|------|--------------|----------------|
| 1.1 | `zenmux-copilot` | `{newprovider}-copilot` | Yes |
| 1.2 | `ZenMuxChatModelProvider` | `{NewProvider}ChatModelProvider` | Yes |
| 1.3 | `ZenMuxModelInfo` | `{NewProvider}ModelInfo` | Yes |
| 1.4 | `ZenMuxModelResponse` | `{NewProvider}ModelResponse` | Yes |
| 1.5 | `ZenMux` | `{NewProvider}` | Yes |
| 1.6 | `zenmux` | `{newprovider}` | Yes |

**Files affected:**
- `package.json`
- `src/extension.ts`
- `src/provider.ts`
- `src/utils.ts`
- `src/types.ts`
- `src/commonApi.ts`
- `src/openai/openaiApi.ts`
- `src/anthropic/anthropicApi.ts`
- `src/vertex/vertexApi.ts`
- `README.md`
- `README.zh.md`
- `.vscode/launch.json`

### Phase 2: API Endpoints

Update the following API URLs:

| Location | Current Value | Replace With |
|----------|---------------|--------------|
| `package.json` L71 | `https://zenmux.ai/api/v1` | Your OpenAI-compatible endpoint |
| `package.json` L76 | `https://zenmux.ai/api/anthropic` | Your Anthropic-compatible endpoint (or remove) |
| `package.json` L81 | `https://zenmux.ai/api/vertex-ai` | Your Vertex AI-compatible endpoint (or remove) |
| `src/provider.ts` L157 | `https://zenmux.ai/api/anthropic` | Your Anthropic-compatible endpoint |
| `src/provider.ts` L207 | `https://zenmux.ai/api/v1` | Your OpenAI-compatible endpoint |
| `src/utils.ts` L41 | `https://zenmux.ai/api/frontend/model/listByFilter` | Your model listing API endpoint |

**Note:** If your provider does not support all three API formats, you can:
- Remove the unused configuration entries from `package.json`
- The code will automatically fall back to OpenAI-compatible mode

### Phase 3: Publisher Information

Update publisher and repository references:

| Location | Field | Current Value | Replace With |
|----------|-------|---------------|--------------|
| `package.json` L3 | `publisher` | `hugehardzhang` | Your VS Code Marketplace publisher ID |
| `package.json` L20 | `repository.url` | `git@github.com:ilimei/zenmux-copilot.git` | Your repository URL |
| `package.json` L35 | Badge URL | `ilimei/zenmux-copilot` | Your GitHub repo path |
| `package.json` L37 | Badge href | `ilimei/zenmux-copilot` | Your GitHub repo path |
| `package.json` L41 | `bugs.url` | `ilimei/zenmux-copilot` | Your GitHub repo path |
| `package.json` L137 | Build script | `ilimei/zenmux-copilot` | Your GitHub repo path |
| `src/extension.ts` L7 | Extension ID | `hugehardzhang.zenmux-copilot` | `{publisher}.{extension-name}` |
| `.vscode/launch.json` L15 | Extension ID | `zenmux.zenmux-copilot` | `{publisher}.{extension-name}` |
| `README.md` L9 | Marketplace link | `hugehardzhang.zenmux-copilot` | Your extension ID |
| `README.md` L92 | Issues link | `ilimei/zenmux-copilot` | Your GitHub repo path |
| `README.zh.md` L9 | Marketplace link | `hugehardzhang.zenmux-copilot` | Your extension ID |
| `README.zh.md` L92 | Issues link | `ilimei/zenmux-copilot` | Your GitHub repo path |

### Phase 4: Type Definitions (Optional)

If your provider's model listing API returns a different JSON structure, update:

**File: `src/types.ts`**

```typescript
// Current ZenMuxModelInfo interface (lines 104-132)
export interface ZenMuxModelInfo {
  all_tokens: number;
  author: string;
  context_length: number;
  // ... other fields
}
```

Modify the interface fields to match your provider's API response.

**File: `src/utils.ts`**

Update the `fetchModels()` function (around line 34) to parse your provider's response format.

**File: `src/provider.ts`**

Update `provideLanguageModelChatInformation()` (around line 52) to map your model fields to VS Code's `LanguageModelChatInformation` interface.

---

## File-by-File Change Reference

### Critical Files (Must Change)

| File | Changes Required | Occurrences |
|------|------------------|-------------|
| `package.json` | Name, publisher, vendor, URLs, commands, config keys | 27 |
| `src/extension.ts` | Extension ID, command registration, output channel | 14 |
| `src/provider.ts` | Class name, config keys, URLs, logs | 24 |
| `src/utils.ts` | Type imports, API URL, logs | 16 |

### Secondary Files (Should Change)

| File | Changes Required | Occurrences |
|------|------------------|-------------|
| `src/types.ts` | Interface names | 3 |
| `src/commonApi.ts` | Type imports, logs | 3 |
| `src/openai/openaiApi.ts` | Type imports, logs | 4 |
| `src/anthropic/anthropicApi.ts` | Type imports, logs | 3 |
| `src/vertex/vertexApi.ts` | Type imports | 2 |
| `.vscode/launch.json` | Extension ID | 2 |

### Documentation Files

| File | Changes Required | Occurrences |
|------|------------------|-------------|
| `README.md` | All brand references, URLs, links | ~30 |
| `README.zh.md` | All brand references, URLs, links | ~28 |

---

## Validation Checklist

After completing all replacements, verify:

- [ ] **Compilation**: Run `npm run compile` - no TypeScript errors
- [ ] **Lint**: Run `npm run lint` - no linting errors
- [ ] **Search verification**: `grep -ri "zenmux" .` returns no results (except this file)
- [ ] **Search verification**: `grep -ri "hugehardzhang\|ilimei" .` returns no results (except this file)
- [ ] **Package validation**: `npm run build` creates a valid `.vsix` file
- [ ] **Extension loading**: Install the VSIX and verify it appears in Copilot Chat model picker
- [ ] **API connectivity**: Verify models are fetched from your provider
- [ ] **Chat functionality**: Send a test message and verify response streaming works

---

## Handling Upstream Updates

When the upstream repository (zenmux-copilot) receives updates:

### Option A: Cherry-pick Specific Commits

```bash
# Add upstream remote (one-time setup)
git remote add upstream git@github.com:ilimei/zenmux-copilot.git

# Fetch upstream changes
git fetch upstream

# Cherry-pick specific commits
git cherry-pick <commit-hash>

# Re-run the repurposing script (see below)
./scripts/repurpose.sh
```

### Option B: Merge and Re-apply Branding

```bash
# Fetch upstream
git fetch upstream

# Create a merge branch
git checkout -b merge-upstream

# Merge upstream changes
git merge upstream/main --no-commit

# Resolve conflicts (brand names will conflict)
# Then re-run the repurposing script
./scripts/repurpose.sh

# Commit the merge
git commit -m "Merge upstream and re-apply branding"
```

---

## Automation Script

Create a file `scripts/repurpose.sh` for automated repurposing:

```bash
#!/bin/bash

# Repurpose script for zenmux-copilot
# Usage: ./scripts/repurpose.sh <new_provider_name> <new_publisher_id> <github_repo_path>
#
# Example:
#   ./scripts/repurpose.sh "MyProvider" "mypublisher" "myorg/myprovider-copilot"

set -e

NEW_PROVIDER_LOWER="${1,,}"          # lowercase: myprovider
NEW_PROVIDER_PASCAL="$1"             # PascalCase: MyProvider
NEW_PUBLISHER="$2"                   # VS Code publisher ID
NEW_REPO="$3"                        # GitHub repo path: myorg/myprovider-copilot

if [ -z "$NEW_PROVIDER_LOWER" ] || [ -z "$NEW_PUBLISHER" ] || [ -z "$NEW_REPO" ]; then
    echo "Usage: $0 <NewProviderName> <publisher_id> <github/repo/path>"
    echo "Example: $0 MyProvider mypublisher myorg/myprovider-copilot"
    exit 1
fi

echo "=== Repurposing to: $NEW_PROVIDER_PASCAL ==="
echo "Publisher: $NEW_PUBLISHER"
echo "Repository: $NEW_REPO"
echo ""

# Files to process
FILES=(
    "package.json"
    "src/extension.ts"
    "src/provider.ts"
    "src/utils.ts"
    "src/types.ts"
    "src/commonApi.ts"
    "src/openai/openaiApi.ts"
    "src/anthropic/anthropicApi.ts"
    "src/vertex/vertexApi.ts"
    "README.md"
    "README.zh.md"
    ".vscode/launch.json"
)

# Phase 1: Brand replacement (order matters!)
echo "Phase 1: Replacing brand names..."

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        # Order matters - replace longer strings first
        sed -i '' "s/zenmux-copilot/${NEW_PROVIDER_LOWER}-copilot/g" "$file"
        sed -i '' "s/ZenMuxChatModelProvider/${NEW_PROVIDER_PASCAL}ChatModelProvider/g" "$file"
        sed -i '' "s/ZenMuxModelInfo/${NEW_PROVIDER_PASCAL}ModelInfo/g" "$file"
        sed -i '' "s/ZenMuxModelResponse/${NEW_PROVIDER_PASCAL}ModelResponse/g" "$file"
        sed -i '' "s/ZenMux/${NEW_PROVIDER_PASCAL}/g" "$file"
        sed -i '' "s/zenmux/${NEW_PROVIDER_LOWER}/g" "$file"
    fi
done

# Phase 2: Publisher replacement
echo "Phase 2: Replacing publisher info..."

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        sed -i '' "s/hugehardzhang/${NEW_PUBLISHER}/g" "$file"
        sed -i '' "s|ilimei/zenmux-copilot|${NEW_REPO}|g" "$file"
    fi
done

echo ""
echo "=== Repurposing complete ==="
echo ""
echo "IMPORTANT: You still need to manually update:"
echo "  1. API endpoint URLs in package.json and src/provider.ts"
echo "  2. Model listing API URL in src/utils.ts (line 41)"
echo "  3. (Optional) Type definitions in src/types.ts if API response differs"
echo ""
echo "Run 'npm run compile' to verify no TypeScript errors"
echo "Run 'grep -ri zenmux .' to verify all occurrences replaced"
```

Make the script executable:

```bash
chmod +x scripts/repurpose.sh
```

---

## Quick Reference: Configuration Keys

After repurposing, your extension will use these configuration keys (replace `{provider}` with your lowercase provider name):

| Key | Purpose |
|-----|---------|
| `{provider}.baseUrl` | OpenAI-compatible API endpoint |
| `{provider}.anthropic.baseUrl` | Anthropic-compatible API endpoint |
| `{provider}.vertex.baseUrl` | Vertex AI-compatible API endpoint |
| `{provider}.retry` | Retry configuration object |
| `{provider}.delay` | Delay between requests (ms) |
| `{provider}.apiKey` | Secret storage key for API key |
| `{provider}.setApikey` | Command ID for setting API key |

---

## Support

If you encounter issues during repurposing:

1. Verify all string replacements are complete
2. Check TypeScript compilation errors for missed references
3. Ensure API endpoint URLs are correctly formatted
4. Test with a simple model listing request first

For upstream issues, refer to the original repository.
