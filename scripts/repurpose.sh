#!/bin/bash

# =============================================================================
# Repurpose Script for zenmux-copilot
# =============================================================================
#
# This script automates the process of repurposing the zenmux-copilot extension
# for a different API provider.
#
# Usage:
#   ./scripts/repurpose.sh <NewProviderName> <publisher_id> <github_repo_path>
#
# Example:
#   ./scripts/repurpose.sh "MyProvider" "mypublisher" "myorg/myprovider-copilot"
#
# Arguments:
#   NewProviderName  - PascalCase name for your provider (e.g., "MyProvider")
#   publisher_id     - Your VS Code Marketplace publisher ID
#   github_repo_path - Your GitHub repository path (e.g., "myorg/repo-name")
#
# =============================================================================

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
NEW_PROVIDER_PASCAL="$1"
NEW_PUBLISHER="$2"
NEW_REPO="$3"

# Convert to lowercase for configuration keys
NEW_PROVIDER_LOWER=$(echo "$NEW_PROVIDER_PASCAL" | tr '[:upper:]' '[:lower:]')

# Validate arguments
if [ -z "$NEW_PROVIDER_PASCAL" ] || [ -z "$NEW_PUBLISHER" ] || [ -z "$NEW_REPO" ]; then
    echo -e "${RED}Error: Missing required arguments${NC}"
    echo ""
    echo "Usage: $0 <NewProviderName> <publisher_id> <github_repo_path>"
    echo ""
    echo "Example:"
    echo "  $0 MyProvider mypublisher myorg/myprovider-copilot"
    echo ""
    echo "Arguments:"
    echo "  NewProviderName  - PascalCase name (e.g., 'MyProvider')"
    echo "  publisher_id     - VS Code Marketplace publisher ID"
    echo "  github_repo_path - GitHub repo path (e.g., 'myorg/repo-name')"
    exit 1
fi

echo ""
echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}  Repurposing zenmux-copilot Extension${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""
echo -e "  Provider Name:  ${YELLOW}$NEW_PROVIDER_PASCAL${NC}"
echo -e "  Config Prefix:  ${YELLOW}$NEW_PROVIDER_LOWER${NC}"
echo -e "  Publisher:      ${YELLOW}$NEW_PUBLISHER${NC}"
echo -e "  Repository:     ${YELLOW}$NEW_REPO${NC}"
echo ""

# Confirm before proceeding
read -p "Proceed with repurposing? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

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

# Define sed_inplace function for cross-platform compatibility
# macOS sed requires '' as a separate argument for in-place editing without backup
# GNU sed (Linux) does not need the empty string argument
sed_inplace() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

# =============================================================================
# Phase 1: Publisher/Repository Replacement (MUST run before brand replacement)
# =============================================================================
echo -e "${YELLOW}Phase 1: Replacing publisher info...${NC}"

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        # Replace publisher ID
        sed_inplace "s/hugehardzhang/${NEW_PUBLISHER}/g" "$file"

        # Replace repository paths (must be done before brand replacement)
        sed_inplace "s|ilimei/zenmux-copilot|${NEW_REPO}|g" "$file"
    fi
done

echo -e "${GREEN}  ✓ Publisher info replacement complete${NC}"
echo ""

# =============================================================================
# Phase 2: Brand Replacement
# =============================================================================
echo -e "${YELLOW}Phase 2: Replacing brand names...${NC}"

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  Processing: $file"

        # Order matters - replace longer/more specific strings first
        # to avoid partial replacements

        # 1. Compound names with hyphens
        sed_inplace "s/zenmux-copilot/${NEW_PROVIDER_LOWER}-copilot/g" "$file"

        # 2. Class names (PascalCase compound)
        sed_inplace "s/ZenMuxChatModelProvider/${NEW_PROVIDER_PASCAL}ChatModelProvider/g" "$file"
        sed_inplace "s/ZenMuxModelInfo/${NEW_PROVIDER_PASCAL}ModelInfo/g" "$file"
        sed_inplace "s/ZenMuxModelResponse/${NEW_PROVIDER_PASCAL}ModelResponse/g" "$file"

        # 3. Simple names
        sed_inplace "s/ZenMux/${NEW_PROVIDER_PASCAL}/g" "$file"
        sed_inplace "s/zenmux/${NEW_PROVIDER_LOWER}/g" "$file"
    else
        echo -e "  ${RED}Warning: File not found: $file${NC}"
    fi
done

echo -e "${GREEN}  ✓ Brand replacement complete${NC}"
echo ""

# =============================================================================
# Verification
# =============================================================================
echo -e "${YELLOW}Phase 3: Verification...${NC}"

# Check for remaining occurrences
REMAINING_ZENMUX=$(grep -ri "zenmux" --include="*.ts" --include="*.json" --include="*.md" . 2>/dev/null | grep -v "CONTRIBUTE.md" | grep -v "scripts/repurpose.sh" | wc -l | tr -d ' ')
REMAINING_PUBLISHER=$(grep -ri "hugehardzhang\|ilimei" --include="*.ts" --include="*.json" --include="*.md" . 2>/dev/null | grep -v "CONTRIBUTE.md" | grep -v "scripts/repurpose.sh" | wc -l | tr -d ' ')

if [ "$REMAINING_ZENMUX" -gt 0 ]; then
    echo -e "  ${RED}⚠ Warning: Found $REMAINING_ZENMUX remaining 'zenmux' references${NC}"
    echo "    Run: grep -ri 'zenmux' . --include='*.ts' --include='*.json' --include='*.md'"
else
    echo -e "  ${GREEN}✓ No remaining 'zenmux' references${NC}"
fi

if [ "$REMAINING_PUBLISHER" -gt 0 ]; then
    echo -e "  ${RED}⚠ Warning: Found $REMAINING_PUBLISHER remaining publisher references${NC}"
    echo "    Run: grep -ri 'hugehardzhang\\|ilimei' . --include='*.ts' --include='*.json' --include='*.md'"
else
    echo -e "  ${GREEN}✓ No remaining publisher references${NC}"
fi

echo ""

# =============================================================================
# Summary
# =============================================================================
echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}  Repurposing Complete!${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""
echo -e "${YELLOW}IMPORTANT: Manual steps still required:${NC}"
echo ""
echo "  1. Update API endpoint URLs:"
echo "     - package.json (lines 71, 76, 81)"
echo "     - src/provider.ts (lines 157, 207)"
echo "     - src/utils.ts (line 41) - model listing endpoint"
echo ""
echo "  2. (Optional) Update type definitions:"
echo "     - src/types.ts - if your API response structure differs"
echo ""
echo "  3. Verify and test:"
echo "     - npm install"
echo "     - npm run compile"
echo "     - npm run build"
echo ""
echo -e "${GREEN}Your new configuration keys will be:${NC}"
echo "  - ${NEW_PROVIDER_LOWER}.baseUrl"
echo "  - ${NEW_PROVIDER_LOWER}.anthropic.baseUrl"
echo "  - ${NEW_PROVIDER_LOWER}.vertex.baseUrl"
echo "  - ${NEW_PROVIDER_LOWER}.retry"
echo "  - ${NEW_PROVIDER_LOWER}.delay"
echo ""
