/**
 * Bug Condition Exploration Test for Dead Code Removal
 * 
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
 * 
 * **Property 1: Bug Condition** - Dead Code Functions Exist
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 * 
 * NOTE: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * GOAL: Surface counterexamples that demonstrate the dead code exists
 * 
 * Scoped PBT Approach: For deterministic bugs, scope the property to the concrete failing case(s) to ensure reproducibility
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const REPO_ROOT = path.resolve(__dirname, '../..')

/**
 * Property 1: Dead Code Functions Should NOT Exist
 * 
 * For any function declaration in the codebase where the function name is one of:
 * - resolveRegisteredWorkspaceId
 * - normalizeRepositoryUrl (in registerProjectHandlers.ts)
 * - resolveAvailableProjectPath
 * 
 * And the function has zero call sites, the codebase SHALL NOT contain that function declaration.
 * 
 * This property encodes the EXPECTED BEHAVIOR (after fix).
 * On UNFIXED code, this test will FAIL, which is the correct outcome for exploration.
 */
describe('Bug Condition Exploration: Dead Code Functions', () => {
  describe('Property 1: Dead Code Functions Should NOT Exist', () => {
    it('should NOT find resolveRegisteredWorkspaceId in WorkbenchSessionManager.ts', () => {
      const filePath = path.join(REPO_ROOT, 'apps/desktop/electron/services/WorkbenchSessionManager.ts')
      const content = fs.readFileSync(filePath, 'utf-8')
      
      // Search for the function declaration
      const functionPattern = /function\s+resolveRegisteredWorkspaceId\s*\(/
      const match = functionPattern.test(content)
      
      // Expected behavior: function should NOT exist
      // On unfixed code: this will FAIL (function exists)
      // On fixed code: this will PASS (function removed)
      expect(match, 
        'EXPECTED BEHAVIOR: resolveRegisteredWorkspaceId should NOT exist in WorkbenchSessionManager.ts. ' +
        'COUNTEREXAMPLE: Function declaration found at line 169. ' +
        'This confirms the bug exists.'
      ).toBe(false)
    })

    it('should NOT find normalizeRepositoryUrl in registerProjectHandlers.ts', () => {
      const filePath = path.join(REPO_ROOT, 'apps/desktop/electron/ipc/registerProjectHandlers.ts')
      const content = fs.readFileSync(filePath, 'utf-8')
      
      // Search for the function declaration
      const functionPattern = /function\s+normalizeRepositoryUrl\s*\(/
      const match = functionPattern.test(content)
      
      // Expected behavior: function should NOT exist in this file
      // On unfixed code: this will FAIL (function exists)
      // On fixed code: this will PASS (function removed)
      expect(match,
        'EXPECTED BEHAVIOR: normalizeRepositoryUrl should NOT exist in registerProjectHandlers.ts. ' +
        'COUNTEREXAMPLE: Function declaration found at line 151. ' +
        'This confirms the bug exists. ' +
        'Note: A different function with the same name exists in repositoryAccessService.ts and must NOT be removed.'
      ).toBe(false)
    })

    it('should NOT find resolveAvailableProjectPath in registerProjectHandlers.ts', () => {
      const filePath = path.join(REPO_ROOT, 'apps/desktop/electron/ipc/registerProjectHandlers.ts')
      const content = fs.readFileSync(filePath, 'utf-8')
      
      // Search for the function declaration
      const functionPattern = /function\s+resolveAvailableProjectPath\s*\(/
      const match = functionPattern.test(content)
      
      // Expected behavior: function should NOT exist
      // On unfixed code: this will FAIL (function exists)
      // On fixed code: this will PASS (function removed)
      expect(match,
        'EXPECTED BEHAVIOR: resolveAvailableProjectPath should NOT exist in registerProjectHandlers.ts. ' +
        'COUNTEREXAMPLE: Function declaration found at line 172. ' +
        'This confirms the bug exists.'
      ).toBe(false)
    })

    it('should NOT produce ESLint warnings for unused functions in affected files', () => {
      // Run ESLint on the affected files
      // Note: We expect this to fail on unfixed code (ESLint will report warnings)
      
      const affectedFiles = [
        'apps/desktop/electron/services/WorkbenchSessionManager.ts',
        'apps/desktop/electron/ipc/registerProjectHandlers.ts',
      ]
      
      let eslintOutput = ''
      try {
        // Run oxlint (the linter used in this project)
        eslintOutput = execSync(
          `bunx --bun oxlint ${affectedFiles.join(' ')}`,
          { 
            cwd: REPO_ROOT,
            encoding: 'utf-8',
            stdio: 'pipe'
          }
        )
      } catch (error: any) {
        // oxlint exits with non-zero code when it finds issues
        eslintOutput = error.stdout || error.stderr || ''
      }
      
      // Check for "declared but never used" warnings for our three functions
      const hasResolveRegisteredWorkspaceIdWarning = 
        eslintOutput.includes('resolveRegisteredWorkspaceId') && 
        (eslintOutput.includes('never used') || eslintOutput.includes('unused'))
      
      const hasNormalizeRepositoryUrlWarning = 
        eslintOutput.includes('normalizeRepositoryUrl') && 
        (eslintOutput.includes('never used') || eslintOutput.includes('unused'))
      
      const hasResolveAvailableProjectPathWarning = 
        eslintOutput.includes('resolveAvailableProjectPath') && 
        (eslintOutput.includes('never used') || eslintOutput.includes('unused'))
      
      const hasAnyWarning = 
        hasResolveRegisteredWorkspaceIdWarning || 
        hasNormalizeRepositoryUrlWarning || 
        hasResolveAvailableProjectPathWarning
      
      // Expected behavior: NO warnings for these functions
      // On unfixed code: this will FAIL (ESLint reports warnings)
      // On fixed code: this will PASS (no warnings)
      expect(hasAnyWarning,
        'EXPECTED BEHAVIOR: ESLint should NOT produce "declared but never used" warnings for the three functions. ' +
        'COUNTEREXAMPLES: ' +
        (hasResolveRegisteredWorkspaceIdWarning ? 'resolveRegisteredWorkspaceId is unused. ' : '') +
        (hasNormalizeRepositoryUrlWarning ? 'normalizeRepositoryUrl is unused. ' : '') +
        (hasResolveAvailableProjectPathWarning ? 'resolveAvailableProjectPath is unused. ' : '') +
        'This confirms the bug exists.'
      ).toBe(false)
    })
  })

  describe('Verification: Removed functions stay removed', () => {
    it('does not contain resolveRegisteredWorkspaceId in WorkbenchSessionManager.ts', () => {
      const filePath = path.join(REPO_ROOT, 'apps/desktop/electron/services/WorkbenchSessionManager.ts')
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).not.toMatch(/function\s+resolveRegisteredWorkspaceId\s*\(/)
    })

    it('does not contain normalizeRepositoryUrl in registerProjectHandlers.ts', () => {
      const filePath = path.join(REPO_ROOT, 'apps/desktop/electron/ipc/registerProjectHandlers.ts')
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).not.toMatch(/function\s+normalizeRepositoryUrl\s*\(/)
    })

    it('does not contain resolveAvailableProjectPath in registerProjectHandlers.ts', () => {
      const filePath = path.join(REPO_ROOT, 'apps/desktop/electron/ipc/registerProjectHandlers.ts')
      const content = fs.readFileSync(filePath, 'utf-8')
      expect(content).not.toMatch(/function\s+resolveAvailableProjectPath\s*\(/)
    })
  })
})
