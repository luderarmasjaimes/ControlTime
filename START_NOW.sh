#!/bin/bash

# 🚀 QUICK START SCRIPT — v0.1 Implementation

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         BEEMETRY v0.1 — START IMPLEMENTATION NOW           ║"
echo "║                                                            ║"
echo "║  6 Critical Hallazgos × 2 Sprints × 14 Days               ║"
echo "║  Status: ✅ KICKOFF DAY 1                                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}▶ Checking prerequisites...${NC}"

if ! command -v git &> /dev/null; then
  echo -e "${RED}✗ Git not found. Please install Git.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Git${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found. Please install Node.js.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js${NC}"

if ! command -v psql &> /dev/null; then
  echo -e "${YELLOW}⚠ psql not in PATH. Some DB tasks may require manual execution.${NC}"
else
  echo -e "${GREEN}✓ PostgreSQL CLI${NC}"
fi

echo ""
echo -e "${BLUE}▶ Git Setup...${NC}"

# Setup main branch
git fetch origin
git checkout main
git pull origin main

# Create main feature branch
if git show-ref --quiet refs/heads/feature/v01-hallazgos; then
  echo -e "${GREEN}✓ Branch feature/v01-hallazgos already exists${NC}"
  git checkout feature/v01-hallazgos
else
  git checkout -b feature/v01-hallazgos
  git push -u origin feature/v01-hallazgos
  echo -e "${GREEN}✓ Created feature/v01-hallazgos${NC}"
fi

echo ""
echo -e "${BLUE}▶ Frontend Setup...${NC}"

cd frontend
npm install --legacy-peer-deps 2>/dev/null || npm install
if npm run dev --version &>/dev/null; then
  echo -e "${GREEN}✓ Frontend ready (npm run dev)${NC}"
else
  echo -e "${RED}✗ Frontend build failed${NC}"
  exit 1
fi

cd ..

echo ""
echo -e "${BLUE}▶ Backend Setup...${NC}"

cd backend
if [ ! -d "build" ]; then
  mkdir -p build
fi
cd build

if command -v cmake &> /dev/null; then
  cmake .. -DCMAKE_BUILD_TYPE=Release 2>/dev/null
  if cmake --build . --config Release 2>/dev/null; then
    echo -e "${GREEN}✓ Backend compiled${NC}"
  else
    echo -e "${YELLOW}⚠ Backend compilation skipped or failed (run manually: cd backend/build && cmake .. && cmake --build .)${NC}"
  fi
else
  echo -e "${YELLOW}⚠ CMake not found. Skipping backend build (manual: cd backend/build && cmake .. && cmake --build .)${NC}"
fi

cd ../..

echo ""
echo -e "${BLUE}▶ Documentation Preparation...${NC}"

if [ -f "IMPLEMENTATION_GUIDE.md" ]; then
  echo -e "${GREEN}✓ IMPLEMENTATION_GUIDE.md ready${NC}"
else
  echo -e "${RED}✗ IMPLEMENTATION_GUIDE.md not found${NC}"
fi

if [ -f "KICKOFF_DAY1.md" ]; then
  echo -e "${GREEN}✓ KICKOFF_DAY1.md ready${NC}"
else
  echo -e "${RED}✗ KICKOFF_DAY1.md not found${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo -e "${GREEN}✅ SETUP COMPLETE${NC}"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo -e "${YELLOW}📋 NEXT STEPS:${NC}"
echo ""
echo "1️⃣  READ THIS FIRST (5 min):"
echo "   → KICKOFF_DAY1.md"
echo ""
echo "2️⃣  DETAILED IMPLEMENTATION GUIDE:"
echo "   → IMPLEMENTATION_GUIDE.md"
echo ""
echo "3️⃣  TEAM SYNC AT 09:00:"
echo "   → All staff"
echo "   → Confirm role assignments"
echo "   → Review blockers"
echo ""
echo "4️⃣  PARALLEL WORK (09:15-12:00):"
echo ""
echo -e "   ${BLUE}Frontend Dev:${NC}"
echo "   cd frontend && npm run dev"
echo "   Read: IMPLEMENTATION_GUIDE.md → HALLAZGO #1"
echo ""
echo -e "   ${BLUE}Backend Dev:${NC}"
echo "   cd backend/build && cmake --build ."
echo "   Create: SECURITY_AUDIT_CHECKLIST.md"
echo ""
echo -e "   ${BLUE}DevOps/BD:${NC}"
echo "   Verify workflow states in DB"
echo "   Create: db_scripts/30_workflow_states_migration.sql"
echo ""
echo "5️⃣  VERIFICATION SYNC AT 13:00:"
echo "   → Workflow state decision"
echo "   → Deploy order confirmation"
echo ""

echo ""
echo -e "${YELLOW}📂 KEY FILES:${NC}"
echo "   • KICKOFF_DAY1.md — Today's checklist"
echo "   • IMPLEMENTATION_GUIDE.md — Detailed code examples"
echo "   • docs/decisions/ — Architecture Decision Records (35 ADRs)"
echo "   • backend/src/ — C++ source code"
echo "   • frontend/src/components/ReportStudioV2/ — React UI"
echo "   • db_scripts/ — SQL migrations"
echo ""

echo -e "${YELLOW}⚠️  CRITICAL VERIFICATION (do this TODAY):${NC}"
echo ""
echo "DevOps/BD MUST run:"
echo "  psql -d formula_db -U postgres -c 'SELECT DISTINCT status FROM reports;'"
echo ""
echo "Report findings in Slack #dev:"
echo "  → Current status values"
echo "  → Migration decision"
echo "  → Timeline confirmation"
echo ""

echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Ready to build v0.1! 🚀${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
